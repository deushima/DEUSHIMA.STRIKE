import { CS2_PROFILES } from '../combat/cs2-data.js';
import { RecoilState, accuracyRadius } from '../combat/recoil.js';
import { shotDirections } from '../combat/shot.js';
import { shotClock, shotMotion } from './shot-sync.js';
import { HitHistory, MAX_REWIND_MS } from './hit-history.js';
import { CHARACTER_IDS } from '../characters/identities.js';
/**
 * OnlineMatch — authoritative AIM rounds for 1v1 / 2v2 over OnlineSession.
 *
 * Topology:
 *   guests -> host: state, shot, weaponDropRequest, weaponPickupRequest, pong
 *   host   -> guests: relayed states, authoritative snapshots, damage/kills,
 *                     round reset/end, drop/pickup decisions and shot FX.
 *
 * The host is the only machine that changes health, round score, dropped weapon
 * ownership or pickup ownership. Position remains client-predicted (20 Hz state)
 * because the game is intentionally lightweight/P2P, but shot origins are checked
 * against the sender's latest authoritative mirror.
 */
import * as THREE from '../../vendor/three.module.js';
import { clamp } from '../core/utils.js';
import { collisionHullForMap } from '../core/player.js';
import { intersectHitbox } from '../combat/hitboxes.js';
import { HITGROUP, rangedDamage, hitgroupMultiplier, resolveArmorDamage } from '../combat/ballistics.js';
import { EQUIPMENT, WEAPONS } from '../weapons.js';
import { chooseDeathmatchSpawn, DEATHMATCH_RESPAWN_SECONDS, rewardDeathmatchKill } from '../deathmatch.js';
import { RemoteAvatar } from './avatar.js';
import { onlineMapLabel } from '../world/online_map_pool.js';

const COUNTDOWN_MS = 1500;
const ROUND_RESET_MS = 3200;
const STATE_INTERVAL = 1 / 20;
const SNAPSHOT_INTERVAL = 0.1;
const PING_INTERVAL = 1;
const MAX_REMOTE_DT = 0.1;
const DEFAULT_TARGET_ROUNDS = 13;
const DEATHMATCH_MAX_PLAYERS = 10;
const DEATHMATCH_RESPAWN_MS = Math.round(DEATHMATCH_RESPAWN_SECONDS * 1000);
const DEATHMATCH_KILL_REWARD_HEALTH = 100;
const DEATHMATCH_KILL_REWARD_ARMOR = 100;
const DEATHMATCH_GRENADE_MAX = { he: 1, flash: 2, smoke: 1 };
const DEATHMATCH_FALL_Y = -5.5;
const DEATHMATCH_BOUNDS_MARGIN = 8;
const SELF_DEATH_STATE_MAX_AGE_MS = 2500;
const SELF_DEATH_CLAIM_MAX_DELTA = 8;
const SELF_DEATH_PENDING_TIMEOUT_MS = 3000;
const SHOT_ORIGIN_TOLERANCE = 2.6;
const HIT_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
const VALID_PARTS = new Set([...Object.keys(HITGROUP), 'legs']);

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const round1 = (value) => Math.round(num(value) * 10) / 10;
const round3 = (value) => Math.round(num(value) * 1000) / 1000;
const vecPlain = (v) => v ? { x: round3(v.x), y: round3(v.y), z: round3(v.z) } : null;
const isVec = (v) =>
  !!v &&
  Number.isFinite(Number(v.x)) &&
  Number.isFinite(Number(v.y)) &&
  Number.isFinite(Number(v.z));
const vec3 = (v, out = new THREE.Vector3()) =>
  isVec(v) ? out.set(Number(v.x), Number(v.y), Number(v.z)) : null;
const partName = (part) => VALID_PARTS.has(part) ? part : 'chest';
const weaponInfo = (id) => WEAPONS[id] || null;

function normalizeInventoryEntry(entry, slot) {
  const id = String(entry?.id || '');
  const weapon = weaponInfo(id);
  if (!weapon || weapon.slot !== slot) return null;
  return {
    id,
    magazine: Math.max(0, Math.round(num(entry?.magazine, weapon.magazine))),
    reserve: Math.max(0, Math.round(num(entry?.reserve, weapon.reserve))),
  };
}

function cloneInventory(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const grenades = {};
  for (const id of ['he', 'flash', 'smoke']) {
    grenades[id] = Math.max(0, Math.round(num(snapshot.grenades?.[id])));
  }
  return {
    primary: normalizeInventoryEntry(snapshot.primary, 1),
    secondary: normalizeInventoryEntry(snapshot.secondary, 2),
    grenades,
    currentId: typeof snapshot.currentId === 'string' ? snapshot.currentId : null,
    lastId: typeof snapshot.lastId === 'string' ? snapshot.lastId : null,
  };
}

function onlineLoadoutInventory(team) {
  const primaryId = team === 'T' ? 'ak47' : 'm4a1';
  const primary = weaponInfo(primaryId);
  const secondary = weaponInfo('deagle');
  return {
    primary: {
      id: primaryId,
      magazine: Math.max(0, Math.round(num(primary?.magazine, 30))),
      reserve: 999,
    },
    secondary: {
      id: 'deagle',
      magazine: Math.max(0, Math.round(num(secondary?.magazine, 7))),
      reserve: 999,
    },
    grenades: { he: 0, flash: 0, smoke: 0 },
    currentId: primaryId,
    lastId: null,
  };
}

function recordOwnsWeapon(record, weaponId) {
  const id = String(weaponId || '');
  if (!id) return false;
  if (id === 'knife') return true;
  const weapon = weaponInfo(id);
  if (!weapon) return false;
  if (weapon.slot === 1) return record?.inventory?.primary?.id === id;
  if (weapon.slot === 2) return record?.inventory?.secondary?.id === id;
  if (weapon.slot === 4) return num(record?.inventory?.grenades?.[id]) > 0;
  return false;
}

function legacyRoster(payload, session) {
  const lobby = session?.lobby || {};
  const hostTeam = payload.hostTeam === 'T' ? 'T' : 'CT';
  const guestTeam = payload.guestTeam === 'CT' ? 'CT' : 'T';
  return [
    {
      id: 'host',
      name: payload.names?.host || lobby.host?.name || 'Host',
      team: hostTeam,
      slot: 0,
      isHost: true,
      connected: true,
    },
    {
      id: 'guest',
      name: payload.names?.guest || lobby.guest?.name || 'Invitado',
      team: guestTeam,
      slot: 0,
      isHost: false,
      connected: true,
    },
  ];
}

function normalizeRoster(payload, session) {
  const source = Array.isArray(payload.players) && payload.players.length
    ? payload.players
    : Array.isArray(payload.roster) && payload.roster.length
      ? payload.roster
      : legacyRoster(payload, session);
  const seen = new Set();
  const teamSlots = { CT: 0, T: 0 };
  const result = [];
  const limit = payload.mode === 'deathmatch' || Number(payload.maxPlayers) === DEATHMATCH_MAX_PLAYERS
    ? DEATHMATCH_MAX_PLAYERS
    : 4;
  for (let i = 0; i < source.length && result.length < limit; i++) {
    const raw = source[i] || {};
    const id = String(raw.id || raw.playerId || (raw.isHost ? 'host' : 'guest-' + i));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const team = raw.team === 'T' ? 'T' : 'CT';
    const slot = Number.isFinite(Number(raw.slot))
      ? Math.max(0, Math.floor(Number(raw.slot)))
      : teamSlots[team]++;
    teamSlots[team] = Math.max(teamSlots[team], slot + 1);
    result.push({
      id,
      name: String(raw.name || 'Jugador').slice(0, 16),
      team,
      slot,
      isHost: !!raw.isHost,
      connected: raw.connected !== false,
    });
  }
  return result;
}

export class OnlineMatch {
  constructor(game, session, startPayload = {}) {
    this.game = game || null;
    this.session = session || null;
    this.startPayload = startPayload || {};
    this.isHost = session?.role === 'host' || startPayload.role === 'host';
    this.role = this.isHost ? 'host' : 'guest';
    this.code = String(startPayload.code || session?.code || '');
    this.isDeathmatch = startPayload.mode === 'deathmatch' || Number(startPayload.maxPlayers) === DEATHMATCH_MAX_PLAYERS;
    this.mode = this.isDeathmatch
      ? 'deathmatch'
      : startPayload.mode === '2v2' || Number(startPayload.maxPlayers) === 4
        ? '2v2'
        : '1v1';
    this.maxPlayers = this.isDeathmatch ? DEATHMATCH_MAX_PLAYERS : this.mode === '2v2' ? 4 : 2;
    this.targetRounds = this.isDeathmatch
      ? 0
      : clamp(
          Math.round(num(startPayload.targetRounds ?? startPayload.targetKills, DEFAULT_TARGET_ROUNDS)),
          1,
          99,
        );
    this.targetKills = this.isDeathmatch ? 0 : this.targetRounds; // legacy HUD alias.

    this.roster = normalizeRoster(startPayload, session);
    this.hostId =
      this.roster.find((p) => p.isHost)?.id ||
      this.roster[0]?.id ||
      'host';
    const requestedLocal =
      startPayload.playerId ||
      startPayload.localPlayerId ||
      session?.localPlayerId ||
      session?.playerId;
    this.localId = String(
      requestedLocal ||
      (this.isHost ? this.hostId : this.roster.find((p) => p.id !== this.hostId)?.id || 'guest'),
    );
    if (!this.roster.some((p) => p.id === this.localId)) {
      const fallback = this.isHost
        ? this.roster.find((p) => p.isHost)
        : this.roster.find((p) => !p.isHost);
      if (fallback) this.localId = fallback.id;
    }

    this.players = new Map();
    for (const item of this.roster) {
      this.players.set(item.id, {
        ...item,
        health: 100,
        armor: 100,
        helmet: false,
        hasDefuseKit: false,
        alive: true,
        kills: 0,
        deaths: 0,
        lifeSeq: 0,
        respawnAt: 0,
        spawnProtectionUntil: 0,
        lastState: null,
        lastSafeState: null,
        lastStateAt: 0,
        weaponId: item.team === 'CT' ? 'm4a1' : 'ak47',
        inventory: onlineLoadoutInventory(item.team),
        ping: 0,
        lastShotAt: 0,
        lastPurchaseSeq: 0,
      });
    }
    this.local = this.players.get(this.localId) || this.players.values().next().value;
    this.myTeam = this.local?.team || 'CT';
    this.localName = this.local?.name || 'Jugador';

    this.teamScores = { CT: 0, T: 0 };
    this.scores = this.teamScores; // generalized public score alias.
    this.phase = 'countdown';
    this.startAt = 0;
    this.roundResetAt = 0;
    this.roundNumber = 1;
    this.roundWinner = null;
    this._started = false;
    this._disposed = false;
    this._over = false;
    this._rematchRequested = false;
    this._stateAccum = STATE_INTERVAL;
    this._snapshotAccum = SNAPSHOT_INTERVAL;
    this._pingAccum = PING_INTERVAL;
    this._rtt = 0;
    this._dropSeq = 0;
    this._shotSeq = 0;
    this._purchaseSeq = 0;
    this._lastPredictedHitAt = 0;
    this._lastMatchEndData = null;
    this._authoritySeq = 0;
    this._lastAuthoritySeq = 0;
    this._pendingSelfDeath = null;

    this.avatars = new Map();
    this.entities = new Map();
    this.avatar = null; // 1v1 compatibility: first remote avatar.
    this.drops = new Map();
    this._tmpOrigin = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3(0, 1, 0);
    this._tmpRay = new THREE.Ray();
    this._tmpRayHit = new THREE.Vector3();
  }

  start() {
    if (this._started || this._disposed) return;
    this._started = true;
    const now = Date.now();
    const rawStart = Number(this.startPayload.startAt);
    let remaining = COUNTDOWN_MS;
    if (Number.isFinite(rawStart) && Math.abs(rawStart - now) < 60000) {
      remaining = clamp(rawStart - now, 80, 5000);
    }
    this.startAt = now + remaining;
    this.phase = remaining > 80 ? 'countdown' : 'live';

    if (this.game?.player && this.local) {
      this.game.player.team = this.local.team;
      this.game.player.name = this.local.name;
      this._syncAuthorityFromLocal(now);
    }
    this._createRemotePlayers();
    this._sendState(true);
    if (this.isHost) this._sendSnapshot(now);
  }

  update(dt) {
    if (this._disposed) return;
    const step = clamp(num(dt), 0, MAX_REMOTE_DT);
    const now = Date.now();
    if (this.phase === 'countdown' && now >= this.startAt) {
      this.phase = 'live';
      if (this.isDeathmatch) {
        this.game?.showClassicBanner?.('DEATHMATCH', 'TODOS CONTRA TODOS', this.myTeam, 1800);
      } else {
        this.game?.showClassicBanner?.('RONDA ' + this.roundNumber, this.mode.toUpperCase(), this.myTeam, 1800);
      }
    }
    if (this.isHost) {
      this._syncAuthorityFromLocal(now);
      if (this.isDeathmatch && this.phase === 'live') {
        this._hostUpdateDeathmatchRespawns(now);
      } else if (this.phase === 'roundover' && this.roundResetAt && now >= this.roundResetAt) {
        this._hostStartNextRound();
      }
    }
    if (this.phase !== 'over') this._sendNetwork(step, now);
    for (const avatar of this.avatars.values()) avatar.update(step);
  }

  canControl() {
    if (this._disposed || this._over || !this._started || this.phase !== 'live') return false;
    return this.game?.player?.alive === true;
  }

  /**
   * Game notifies local deaths synchronously. In Deathmatch, weapon kills are
   * already resolved by the host; this path is only for environmental/self deaths
   * such as falling below the map or leaving its bounds.
   */
  onKill(killer, victim, weaponId = 'unknown') {
    if (weaponId === 'fall') return false;
    if (!this.isDeathmatch || this._disposed || !this._started || this.phase !== 'live') return false;
    const player = this.game?.player;
    if (!player || victim !== player) return false;
    if (killer && killer !== victim) return false;
    const record = this.local;
    if (!record || record.respawnAt) return false;

    const payload = {
      reason: weaponId === 'fall' ? 'fall' : 'environment',
      pos: vecPlain(player.pos),
      lifeSeq: record.lifeSeq,
      observedAt: Date.now(),
    };
    if (this.isHost) return this._hostHandleSelfDeath(this.localId, payload, true);
    this._pendingSelfDeath = { lifeSeq: record.lifeSeq, at: Date.now() };
    const sent = this._sendToHost('selfDeath', payload);
    if (!sent) this._pendingSelfDeath = null;
    return sent;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._started = false;
    for (const avatar of this.avatars.values()) {
      try { avatar.dispose(); } catch { /* ignore */ }
    }
    this._shotHistory?.clear();
    this.avatars.clear();
    this.entities.clear();
    this.avatar = null;
    this.drops.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Players / avatars                                                   */
  /* ------------------------------------------------------------------ */

  _createRemotePlayers() {
    for (const record of this.players.values()) {
      if (record.id === this.localId) continue;
      this._ensureRemotePlayer(record.id);
    }
  }

  _ensureRemotePlayer(playerId) {
    if (!playerId || playerId === this.localId) return null;
    const record = this.players.get(playerId);
    if (!record) return null;
    let avatar = this.avatars.get(playerId);
    if (!avatar) {
      try {
        avatar = new RemoteAvatar(this.game, { name: record.name, team: record.team });
        this.avatars.set(playerId, avatar);
        if (!this.avatar) this.avatar = avatar;
      } catch (err) {
        console.warn('[online] avatar create', playerId, err);
        return null;
      }
      const spawn = this._spawnForRecord(record);
      avatar.setTarget(spawn, spawn.yawRad, 0, false, record.alive, record.weaponId, true, 0);
      avatar.snapToTarget();
    }
    if (!this.entities.has(playerId)) this.entities.set(playerId, this._makeRemoteEntity(record, avatar));
    return avatar;
  }

  _makeRemoteEntity(record, avatar) {
    const entity = {
      onlinePlayerId: record.id,
      get ballisticCharacter() { return avatar._kenney; },
      get pos() { return avatar.pos; },
      get height() { return avatar.height; },
      get radius() { return avatar.radius; },
      get alive() { return record.alive && avatar.alive; },
      get yaw() { return avatar.yaw; },
      get pitch() { return avatar.pitch; },
      get crouching() { return avatar.crouchAmount > 0.5; },
      get velocity() { return avatar._speed || 0; },
      get weaponId() { return avatar.weaponId || record.weaponId || 'knife'; },
      get onGround() { return avatar.onGround; },
      get health() { return record.health; },
      get armor() { return record.armor; },
      get kills() { return record.kills; },
      get deaths() { return record.deaths; },
      name: record.name,
      team: record.team,
      isRemote: true,
      isPlayer: false,
      isBot: false,
      hasBomb: false,
      hasDefuseKit: false,
    };
    return entity;
  }

  getRemoteEntities() {
    return [...this.entities.values()].filter((entity) => entity && entity.alive);
  }

  getRemoteEntity() {
    return this.getRemoteEntities()[0] || null;
  }

  getRemoteHitboxes(entity = null) {
    const target = entity || this.getRemoteEntity();
    if (!target?.alive || typeof this.game?.getPlayerHitboxes !== 'function') return [];
    try {
      return this.game.getPlayerHitboxes(target) || [];
    } catch {
      return [];
    }
  }

  getPlayerRecord(id) {
    return this.players.get(id) || null;
  }

  getRoster() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      slot: p.slot,
      isHost: p.isHost,
      connected: p.connected,
      alive: p.alive,
      health: p.health,
      armor: p.armor,
      kills: p.kills,
      deaths: p.deaths,
      respawnIn: this.isDeathmatch && p.respawnAt
        ? round1(Math.max(0, (p.respawnAt - Date.now()) / 1000))
        : 0,
      weaponId: p.weaponId,
      ping: p.ping,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Shooting / host authority                                          */
  /* ------------------------------------------------------------------ */

  notifyLocalShot(shot) {
    if (this._disposed || this._over || this.phase !== 'live' || !shot) return;
    const player = this.game?.player;
    const weaponId = typeof shot.weaponId === 'string' ? shot.weaponId : 'ak47';
    const origin =
      isVec(shot.origin) ? vec3(shot.origin, new THREE.Vector3())
        : player?.getEyePosition?.(new THREE.Vector3());
    const dir =
      isVec(shot.dir) ? vec3(shot.dir, new THREE.Vector3())
        : player?.getAimDirection?.(new THREE.Vector3());
    if (!origin || !dir || dir.lengthSq() < 1e-8) return;
    dir.normalize();
    const seq = ++this._shotSeq;
    const context = {
      shotTime: shot.shotTime ?? this.game.weapons?.time,
      motion: shotMotion(player, this.game.weapons?.isScoped?.()),
      round: this.roundNumber,
      lifeSeq: this.players?.get(this.localId)?.lifeSeq,
      viewTimes: Object.fromEntries([...(this.avatars || new Map())]
        .filter(([, avatar]) => avatar.renderHostTime > 0)
        .map(([id, avatar]) => [id, avatar.renderHostTime])),
    };
    if (this.isHost) {
      this._hostResolveShot(this.localId, origin, dir, weaponId, null, seq, context);
    } else {
      this._sendToHost('shot', {
        seq,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
        weaponId,
        ...context,
      });
    }
  }

  _hostResolveShot(shooterId, origin, dir, weaponId, trustedHit = null, seq = 0, context = null) {
    if (!this.isHost || this.phase !== 'live') return;
    const shooter = this.players.get(shooterId);
    const weapon = weaponInfo(weaponId);
    if (!shooter?.alive || !weapon || !recordOwnsWeapon(shooter, weaponId)) return;
    if (shooterId !== this.localId && !this._validShotOrigin(shooter, origin)) return;
    const now = Date.now();
    if(seq>0 && seq <= (shooter.acceptedShotSeq||0))return;
    if(context?.round != null && context.round !== this.roundNumber)return;
    if(context?.lifeSeq != null && context.lifeSeq !== shooter.lifeSeq)return;
    const cycle=1000*weapon.fireInterval;
    const timed = Number.isFinite(context?.shotTime);
    const clock = timed ? shotClock(shooter,context.shotTime,now,cycle,shooterId===this.localId) : null;
    if(timed ? !clock : now+5<(shooter.nextShotAt||0))return;
    this._advanceHostReload(shooter,now);
    if(clock && shooter.reloadReadyAt && Number.isFinite(shooter.reloadClientReadyAt) && clock.time + .01 >= shooter.reloadClientReadyAt)
      this._advanceHostReload(shooter,shooter.reloadReadyAt);
    if(shooter.reloadReadyAt)return;
    const entry=weapon.slot===1?shooter.inventory?.primary:weapon.slot===2?shooter.inventory?.secondary:null;
    if(weapon.magazine && (!entry || (shooterId!==this.localId && entry.magazine<=0)))return;
    if(entry && shooterId!==this.localId)entry.magazine--;
    shooter.acceptedShotSeq=seq;
    if(clock)shooter.shotClock=clock;
    const fireTime=clock?.time ?? Math.max(now-cycle,shooter.nextShotAt||now);
    shooter.nextShotAt=fireTime+cycle;shooter.lastShotAt=now;
    const profile=CS2_PROFILES[weaponId];
    if(!profile){this._hostResolvePellet(shooter,origin,dir,weaponId,seq,context);return;}
    shooter.recoilStates ||= new Map();
    if(!shooter.recoilStates.has(weaponId))shooter.recoilStates.set(weaponId,new RecoilState(weaponId,profile.recoil.seed));
    const recoil=shooter.recoilStates.get(weaponId);
    const state=shooterId===this.localId?this.game.player:shooter.lastState||{};
    const fallback=shooterId===this.localId ? shotMotion(state,this.game.weapons?.isScoped?.())
      : {...state,speed:state.moveSpeed??state.speed,crouching:state.crouch};
    const motion=context?.motion;
    const actor=motion && Number.isFinite(motion.speed) ? {
      speed:clamp(motion.speed,0,50),crouching:!!motion.crouching,
      onGround:motion.onGround!==false,landingTime:clamp(num(motion.landingTime),0,1),
    } : fallback;
    const scoped=weapon.type==='sniper' && !!(motion?.scoped ?? fallback.scoped);
    const accuracy=accuracyRadius(weaponId,actor,recoil,fireTime/1000,scoped);
    const punch=recoil.fire(fireTime/1000,actor);
    // Resolve every pellet on the host. Client contacts/damage are never used.
    for(const direction of shotDirections(weaponId,dir,punch,accuracy))this._hostResolvePellet(shooter,origin,direction,weaponId,seq,context);
  }

  _advanceHostReload(record,now=Date.now()) {
    if(!record.reloadReadyAt || now<record.reloadReadyAt)return;
    const w=weaponInfo(record.reloadId),entry=w?.slot===1?record.inventory?.primary:record.inventory?.secondary;
    if(entry?.id===record.reloadId){const take=Math.min(w.magazine-entry.magazine,entry.reserve);entry.magazine+=take;entry.reserve-=take;}
    record.reloadReadyAt=0;record.reloadClientReadyAt=null;record.reloadId=null;
  }

  _hostResolvePellet(shooter,origin,dir,weaponId,seq,context=null) {
    const shooterId=shooter.id,weapon=weaponInfo(weaponId);
    let hit = null;
    if (shooterId!==this.localId && this._shotHistory?.players.size) {
      hit=this._rewoundRaycast(origin,dir,Math.max(2.4,num(weapon.range,120)),shooter,context);
    } else if (this.isDeathmatch) {
      hit = this._deathmatchRaycast(origin, dir, Math.max(2.4, num(weapon.range, 120)), shooterId);
    } else if (typeof this.game?.raycastShot === 'function') {
      hit = this.game.raycastShot(origin, dir, Math.max(2.4, num(weapon.range, 120)), shooter.team, shooterId===this.localId?this.game.player:this.getRemoteEntities().find(e=>e.onlinePlayerId===shooterId));
    }

    const range = Math.max(2.4, num(weapon.range, 120));
    const endpoint = hit?.point && isVec(hit.point)
      ? vec3(hit.point, new THREE.Vector3())
      : new THREE.Vector3().copy(origin).addScaledVector(dir, range);
    this._broadcast('shotFx', {
      shooterId,
      seq,
      origin: vecPlain(origin),
      dir: vecPlain(dir),
      point: vecPlain(endpoint),
      world: hit?.type === 'world',
      weaponId,
    }, shooterId);
    if (shooterId !== this.localId) {
      this.avatars.get(shooterId)?.playShoot?.();
      this._remoteShotFx(origin, dir, weaponId, endpoint, hit?.type === 'world');
    }

    if (!hit?.entity || hit.type === 'world') {
      this._sendTo(shooterId, 'hitConfirm', { seq, miss: true });
      return;
    }
    const targetId = hit.entity === this.game?.player
      ? this.localId
      : hit.entity.onlinePlayerId;
    const target = this.players.get(targetId);
    if (
      !target ||
      !target.alive ||
      target.id === shooterId ||
      (!this.isDeathmatch && target.team === shooter.team)
    ) {
      this._sendTo(shooterId, 'hitConfirm', { seq, miss: true });
      return;
    }

    const part = partName(hit.part);
    const distance = hit.point ? origin.distanceTo(hit.point) : num(hit.t);
    const base = rangedDamage(weaponId, distance, weapon.damage);
    if (base <= 0) return;
    const result = this._hostDamage(target, base * hitgroupMultiplier(weaponId, part), part, weaponId);
    const headshot = part === 'head';
    const hitPayload = {
      seq,
      shooterId,
      targetId,
      health: target.health,
      armor: target.armor,
      damage: result.damage,
      part,
      headshot,
      point: hit?.point ? vecPlain(hit.point) : null,
    };
    this._sendTo(targetId, 'damage', hitPayload);
    this._sendTo(shooterId, 'hitConfirm', hitPayload);
    this._broadcast('playerHit', hitPayload, null);
    const avatar = this.avatars.get(targetId);
    avatar?.playHit?.();
    if (result.dead) this._hostKill(shooterId, targetId, weaponId, headshot);
  }

  captureShotHistory() {
    if(!this.isHost || this.phase!=='live')return;
    const now=Date.now(), local=this.game.player;
    if(now-(this._historyCapturedAt||0)<1000/30)return;
    this._historyCapturedAt=now;
    this._shotHistory ||= new HitHistory();
    if(local?.alive)this._shotHistory.capture(this.localId,now,this.game.getPlayerHitboxes(local));
    for(const remote of this.getRemoteEntities())
      this._shotHistory.capture(remote.onlinePlayerId,now,this.getRemoteHitboxes(remote));
  }

  _rewoundRaycast(origin,dir,range,shooter,context) {
    const now=Date.now();
    const world=this.game.physics?.raycast?.(origin,dir,range);
    let best=world?{...world,type:'world'}:null;
    const targets=[this.game.player,...this.getRemoteEntities()].filter(Boolean);
    for(const entity of targets) {
      const id=entity===this.game.player?this.localId:entity.onlinePlayerId;
      if(!entity.alive || id===shooter.id || (!this.isDeathmatch&&entity.team===shooter.team))continue;
      // Host-issued render times are bounded by measured RTT + interpolation.
      const budget=Math.min(MAX_REWIND_MS,Math.max(100,num(shooter.ping)+100));
      const requested=context?.viewTimes?.[id];
      const time=clamp(Number.isFinite(requested)?requested:now-num(shooter.ping)/2-55,now-budget,now);
      const historical=this._shotHistory.raycast(id,time,origin,dir,best?.t??range);
      let hit=historical.hit;
      if(!historical.available) {
        for(const hb of this.game.getPlayerHitboxes(entity)) {
          const current=intersectHitbox(origin,dir,hb,hit?.t??best?.t??range);
          if(current&&(!hit||current.t<hit.t))hit=current;
        }
      }
      if(hit&&hit.t<(best?.t??range))best={...hit,entity,type:id===this.localId?'player':'remote',point:origin.clone().addScaledVector(dir,hit.t)};
    }
    return best;
  }

  _deathmatchRaycast(origin, dir, maxDist, shooterId) {
    const direction = this._tmpDir.copy(dir).normalize();
    const worldHit = this.game?.physics?.raycast?.(origin, direction, maxDist) || null;
    let best = worldHit ? { ...worldHit, type: 'world' } : null;
    let bestT = worldHit ? num(worldHit.t, maxDist) : maxDist;
    const ray = this._tmpRay.set(origin, direction);
    const hitPoint = this._tmpRayHit;

    const consider = (boxes, entity, type, playerId) => {
      if (!entity || playerId === shooterId) return;
      for (const hb of boxes || []) {
        const contact = intersectHitbox(origin,direction,hb,bestT);
        if(!contact)continue;
        const t = contact.t;
        hitPoint.copy(origin).addScaledVector(direction,t);
        if (t <= 0.001 || t >= bestT) continue;
        bestT = t;
        best = {
          t,
          point: hitPoint.clone(),
          normal: null,
          type,
          entity,
          part: contact.part || hb.part,
          damageMult: hb.damageMult ?? 1,
        };
      }
    };

    const localPlayer = this.game?.player;
    if (localPlayer?.alive && this.localId !== shooterId) {
      consider(this.game?.getPlayerHitboxes?.(localPlayer), localPlayer, 'player', this.localId);
    }
    for (const remote of this.getRemoteEntities()) {
      const playerId = String(remote?.onlinePlayerId || '');
      if (!playerId || playerId === shooterId) continue;
      consider(this.getRemoteHitboxes(remote), remote, 'remote', playerId);
    }
    return best;
  }

  _validShotOrigin(shooter, origin) {
    const state = shooter.lastState;
    if (!state || Date.now() - shooter.lastStateAt > 2500 || !state.pos) return false;
    const hull = collisionHullForMap(this.game?.map);
    const eye = new THREE.Vector3(
      state.pos.x,
      state.pos.y + (state.crouch ? hull.eyeCrouch : hull.eyeStand),
      state.pos.z,
    );
    return origin.distanceTo(eye) <= SHOT_ORIGIN_TOLERANCE;
  }

  _hostDamage(target, rawDamage, part, weaponId = 'unknown') {
    const result = resolveArmorDamage(rawDamage,target,part,weaponId,Date.now() < target.spawnProtectionUntil ? .5 : 1);
    const damage = result.healthDamage;
    target.armor = result.armorRemaining;
    target.health = result.healthRemaining;
    const dead = target.health <= 0;
    if (dead) target.health = 0;
    if (target.id === this.localId) this._applyLocalAuthorityHealth(target, damage);
    return { damage, dead };
  }

  _applyLocalAuthorityHealth(record, damage) {
    const player = this.game?.player;
    if (!player) return;
    const previousHealth = player.health;
    const previousArmor = player.armor;
    player.health = record.health;
    player.armor = record.armor;
    this.game?.classicUI?.hud?.notifyDamage?.(
      Math.max(0, previousHealth - player.health),
      Math.max(0, previousArmor - player.armor),
    );
    player.damageFlash = 1;
    player.lastDamageTime = num(this.game?.time);
    player.addShake?.(clamp(damage / 65, 0.07, 0.43));
    this.game?.audio?.play?.(previousArmor > player.armor ? 'armor_hit' : 'hurt', { volume: clamp(damage / 55, 0.32, 0.85) });
    this.game?.ui?.flashDamage?.(clamp(damage / 130, 0.04, 0.21));
  }

  _hostKill(killerId, victimId, weaponId, headshot) {
    const killer = this.players.get(killerId);
    const victim = this.players.get(victimId);
    if (!killer || !victim || !victim.alive) return;
    if (this.isDeathmatch && (killer.id === victim.id || !killer.alive || killer.connected === false)) return;
    victim.alive = false;
    victim.health = 0;
    victim.deaths += 1;
    victim.lifeSeq += 1;
    killer.kills += 1;
    if (this.isDeathmatch) this._hostRestoreDeathmatchKiller(killer);
    if (killerId === this.localId && this.game?.player) this.game.player.kills = killer.kills;
    if (victimId === this.localId && this.game?.player) this.game.player.deaths = victim.deaths;

    if (this.isDeathmatch) {
      victim.respawnAt = Date.now() + DEATHMATCH_RESPAWN_MS;
    }

    if (victimId === this.localId) this._applyLocalDeath();
    else this.avatars.get(victimId)?.playDeath?.();

    const payload = {
      killerId,
      victimId,
      weapon: weaponId || 'unknown',
      headshot: !!headshot,
      kills: killer.kills,
      deaths: victim.deaths,
      lifeSeq: victim.lifeSeq,
      killerHealth: this.isDeathmatch ? killer.health : undefined,
      killerArmor: this.isDeathmatch ? killer.armor : undefined,
      killReward: this.isDeathmatch ? true : undefined,
      teamScores: { ...this.teamScores },
      respawnIn: this.isDeathmatch ? DEATHMATCH_RESPAWN_SECONDS : 0,
      authoritySeq: this._nextAuthoritySeq(),
    };
    this._broadcast('kill', payload);
    this._handleKillVisual(payload);

    if (this.isDeathmatch) return;

    const victimTeamAlive = [...this.players.values()].some(
      (p) => p.connected !== false && p.team === victim.team && p.alive,
    );
    if (!victimTeamAlive) this._hostEndRound(killer.team);
  }

  _hostRestoreDeathmatchKiller(killer) {
    if (!this.isHost || !this.isDeathmatch || !killer?.alive) return false;
    rewardDeathmatchKill(killer);
    if (killer.id === this.localId && this.game?.player?.alive) {
      this.game.player.health = killer.health;
      this.game.player.armor = killer.armor;
    }
    return true;
  }

  _nextAuthoritySeq() {
    if (!this.isHost) return 0;
    this._authoritySeq = Math.max(0, Math.floor(num(this._authoritySeq))) + 1;
    return this._authoritySeq;
  }

  _acceptAuthoritySeq(payload) {
    const seq = Math.max(0, Math.floor(num(payload?.authoritySeq)));
    if (!seq) return true;
    if (seq <= this._lastAuthoritySeq) return false;
    this._lastAuthoritySeq = seq;
    return true;
  }

  _isDeathmatchOutOfBoundsPosition(pos) {
    if (!isVec(pos)) return false;
    if (num(pos.y) < DEATHMATCH_FALL_Y) return true;
    const bounds = this.game?.map?.bounds;
    if (!bounds) return false;
    return (
      num(pos.x) < num(bounds.minX, -Infinity) - DEATHMATCH_BOUNDS_MARGIN ||
      num(pos.x) > num(bounds.maxX, Infinity) + DEATHMATCH_BOUNDS_MARGIN ||
      num(pos.z) < num(bounds.minZ, -Infinity) - DEATHMATCH_BOUNDS_MARGIN ||
      num(pos.z) > num(bounds.maxZ, Infinity) + DEATHMATCH_BOUNDS_MARGIN
    );
  }

  _isPlausibleSelfDeath(record, payload, local = false) {
    if (!record) return false;
    const observed = local ? this.game?.player?.pos : record.lastState?.pos;
    if (this._isDeathmatchOutOfBoundsPosition(observed)) return true;

    const claimed = payload?.pos;
    if (!this._isDeathmatchOutOfBoundsPosition(claimed)) return false;
    if (!isVec(observed)) return false;
    if (!local && Date.now() - record.lastStateAt > SELF_DEATH_STATE_MAX_AGE_MS) return false;
    const dx = num(claimed.x) - num(observed.x);
    const dy = num(claimed.y) - num(observed.y);
    const dz = num(claimed.z) - num(observed.z);
    return Math.hypot(dx, dy, dz) <= SELF_DEATH_CLAIM_MAX_DELTA;
  }

  _hostHandleSelfDeath(playerId, payload, local = false) {
    if (!this.isHost || !this.isDeathmatch || this.phase !== 'live') return false;
    const record = this.players.get(String(playerId || ''));
    if (!record || record.connected === false || record.respawnAt) return false;
    if (payload?.reason === 'fall') return false;

    const claimedLifeSeq = Math.max(0, Math.floor(num(payload?.lifeSeq, record.lifeSeq)));
    if (claimedLifeSeq !== record.lifeSeq) {
      if (!local) this._sendPlayerSync(record);
      return false;
    }

    if (!this._isPlausibleSelfDeath(record, payload, local)) {
      return this._hostRecoverDeathmatch(record, 'unverified-self-death');
    }

    record.alive = false;
    record.health = 0;
    record.deaths += 1;
    record.lifeSeq += 1;
    record.respawnAt = Date.now() + DEATHMATCH_RESPAWN_MS;
    if (record.lastState) record.lastState.alive = false;
    if (record.id === this.localId && this.game?.player) {
      this.game.player.deaths = record.deaths;
    } else {
      this.avatars.get(record.id)?.playDeath?.();
    }

    const event = {
      playerId: record.id,
      reason: payload?.reason === 'fall' ? 'fall' : 'environment',
      deaths: record.deaths,
      lifeSeq: record.lifeSeq,
      respawnIn: DEATHMATCH_RESPAWN_SECONDS,
      authoritySeq: this._nextAuthoritySeq(),
    };
    this._broadcast('environmentDeath', event);
    return true;
  }

  _hostRecoverDeathmatch(record, reason = 'recovery') {
    if (!this.isHost || !this.isDeathmatch || !record) return false;
    let safe = record.lastSafeState?.pos && !this._isDeathmatchOutOfBoundsPosition(record.lastSafeState.pos)
      ? {
          x: num(record.lastSafeState.pos.x),
          y: num(record.lastSafeState.pos.y, 0.05),
          z: num(record.lastSafeState.pos.z),
          yawRad: num(record.lastSafeState.yaw),
          yaw: num(record.lastSafeState.yaw) * 180 / Math.PI,
        }
      : null;
    if (!safe) {
      try {
        const selected = chooseDeathmatchSpawn(this.game?.map, [], this.game?.physics);
        const yaw = num(selected?.yaw);
        safe = {
          x: num(selected?.x),
          y: num(selected?.y, 0.05),
          z: num(selected?.z),
          yaw,
          yawRad: yaw * Math.PI / 180,
        };
      } catch {
        safe = this._spawnForRecord(record, Math.random());
      }
    }

    record.health = 100;
    record.armor = 100;
    record.helmet = false;
    record.alive = true;
    record.respawnAt = 0;
    record.lifeSeq += 1;
    record.spawnProtectionUntil = Date.now() + 1000;
    record.inventory = onlineLoadoutInventory(record.team);
    record.recoilStates=new Map();record.nextShotAt=0;record.reloadReadyAt=0;record.acceptedShotSeq=0;
    record.shotClock=null;record.reloadClientReadyAt=null;this._shotHistory?.delete(record.id);
    record.weaponId = record.inventory.currentId;
    record.lastState = {
      pos: { x: safe.x, y: safe.y, z: safe.z },
      yaw: safe.yawRad,
      pitch: 0,
      crouch: false,
      onGround: true,
      moveSpeed: 0,
      weaponId: record.weaponId,
      reloading: false,
      alive: true,
    };
    record.lastSafeState = {
      ...record.lastState,
      pos: { ...record.lastState.pos },
    };
    record.lastStateAt = Date.now();
    if (record.id === this.localId) this._spawnLocal(record, safe);
    else this._spawnRemote(record, safe);

    this._broadcast('respawn', {
      playerId: record.id,
      ...safe,
      health: 100,
      armor: 100,
      protectionMs: 1000,
      recovery: true,
      reason,
      lifeSeq: record.lifeSeq,
      authoritySeq: this._nextAuthoritySeq(),
    });
    return true;
  }

  _hostUpdateDeathmatchRespawns(now = Date.now()) {
    if (!this.isHost || !this.isDeathmatch || this.phase !== 'live') return;
    for (const record of this.players.values()) {
      if (
        record.connected === false ||
        record.alive ||
        !record.respawnAt ||
        now < record.respawnAt
      ) continue;
      this._hostRespawnDeathmatch(record, now);
    }
  }

  _hostRespawnDeathmatch(record, now = Date.now()) {
    if (!this.isHost || !this.isDeathmatch || !record || record.connected === false) return false;
    const opponents = [];
    for (const other of this.players.values()) {
      if (other.id === record.id || other.connected === false || !other.alive) continue;
      const pos = other.id === this.localId
        ? this.game?.player?.pos
        : other.lastState?.pos || this.avatars.get(other.id)?.pos;
      if (pos) opponents.push({ alive: true, pos });
    }

    let selected;
    try {
      selected = chooseDeathmatchSpawn(this.game?.map, opponents, this.game?.physics);
    } catch {
      selected = this._spawnForRecord(record, Math.random());
    }
    const yaw = num(selected?.yaw);
    const spawn = {
      x: num(selected?.x),
      y: num(selected?.y, 0.05),
      z: num(selected?.z),
      yaw,
      yawRad: Number.isFinite(Number(selected?.yawRad))
        ? Number(selected.yawRad)
        : yaw * Math.PI / 180,
    };

    record.health = 100;
    record.armor = 100;
    record.helmet = false;
    record.alive = true;
    record.respawnAt = 0;
    record.lifeSeq += 1;
    record.spawnProtectionUntil = now + 1000;
    record.inventory = onlineLoadoutInventory(record.team);
    record.recoilStates=new Map();record.nextShotAt=0;record.reloadReadyAt=0;record.acceptedShotSeq=0;
    record.shotClock=null;record.reloadClientReadyAt=null;this._shotHistory?.delete(record.id);
    record.weaponId = record.inventory.currentId;
    record.lastState = {
      pos: { x: spawn.x, y: spawn.y, z: spawn.z },
      yaw: spawn.yawRad,
      pitch: 0,
      crouch: false,
      onGround: true,
      moveSpeed: 0,
      weaponId: record.weaponId,
      reloading: false,
      alive: true,
    };
    record.lastSafeState = {
      ...record.lastState,
      pos: { ...record.lastState.pos },
    };
    record.lastStateAt = now;
    if (record.id === this.localId) this._spawnLocal(record, spawn);
    else this._spawnRemote(record, spawn);

    this._broadcast('respawn', {
      playerId: record.id,
      ...spawn,
      health: 100,
      armor: 100,
      protectionMs: 1000,
      lifeSeq: record.lifeSeq,
      authoritySeq: this._nextAuthoritySeq(),
    });
    return true;
  }

  _hostEndRound(winnerTeam) {
    if (!this.isHost || this.phase !== 'live') return;
    const team = winnerTeam === 'T' ? 'T' : 'CT';
    this.teamScores[team] += 1;
    this.roundWinner = team;
    this.phase = 'roundover';
    this.roundResetAt = Date.now() + ROUND_RESET_MS;
    const data = {
      winnerTeam: team,
      teamScores: { ...this.teamScores },
      roundNumber: this.roundNumber,
      nextRoundIn: ROUND_RESET_MS / 1000,
    };
    this._broadcast('roundEnd', data);
    this._showRoundEnd(data);
    if (this.teamScores[team] >= this.targetRounds) this._finish(team, false);
  }

  _showRoundEnd(data) {
    const winner = data.winnerTeam;
    const text = 'CT ' + this.teamScores.CT + ' · ' + this.teamScores.T + ' T';
    this.game?.showClassicBanner?.('RONDA ' + this.roundNumber + ' · ' + winner, text, winner, 2800);
    this.game?.audio?.play?.(winner === this.myTeam ? 'round_win' : 'round_lose', { volume: 0.75 });
  }

  _hostStartNextRound() {
    if (!this.isHost || this._over) return;
    this.roundNumber += 1;
    this.roundResetAt = 0;
    this.roundWinner = null;
    this.phase = 'countdown';
    this.startAt = Date.now() + 900;
    this._clearAuthoritativeDrops();

    const respawns = [];
    const spawnRolls = this._buildRoundSpawnRolls();
    for (const record of this.players.values()) {
      if (record.connected === false) continue;
      record.health = 100;
      record.armor = 100;
      record.helmet = false;
      record.alive = true;
      record.spawnProtectionUntil = Date.now() + 1000;
      record.inventory = onlineLoadoutInventory(record.team);
    record.recoilStates=new Map();record.nextShotAt=0;record.reloadReadyAt=0;record.acceptedShotSeq=0;
    record.shotClock=null;record.reloadClientReadyAt=null;this._shotHistory?.delete(record.id);
      record.weaponId = record.inventory.currentId;
      const spawn = this._spawnForRecord(record, spawnRolls.get(record.id));
      record.lastState = {
        pos: { x: spawn.x, y: spawn.y, z: spawn.z },
        yaw: spawn.yawRad,
        pitch: 0,
        crouch: false,
        onGround: true,
        moveSpeed: 0,
        weaponId: record.weaponId,
        reloading: false,
        alive: true,
      };
      record.lastStateAt = Date.now();
      respawns.push({ playerId: record.id, ...spawn, health: 100, armor: 100 });
      if (record.id === this.localId) this._spawnLocal(record, spawn);
      else this._spawnRemote(record, spawn);
    }
    this._broadcast('roundStart', {
      roundNumber: this.roundNumber,
      startAt: this.startAt,
      respawns,
      teamScores: { ...this.teamScores },
    });
    this._sendSnapshot(Date.now());
  }

  _buildRoundSpawnRolls() {
    const rolls = new Map();
    for (const team of ['CT', 'T']) {
      const records = [...this.players.values()]
        .filter((record) => record.connected !== false && record.team === team)
        .sort((a, b) => num(a.slot) - num(b.slot));
      const spawns = this.game?.map?.spawns?.[team] || [];
      if (!records.length || !spawns.length) continue;
      const firstIndex = Math.floor(Math.random() * spawns.length);
      records.forEach((record, index) => {
        const spawnIndex = (firstIndex + index) % spawns.length;
        rolls.set(record.id, (spawnIndex + 0.5) / spawns.length);
      });
    }
    return rolls;
  }

  _spawnLocal(record, spawn) {
    let spawned = false;
    try {
      if (typeof this.game?.spawnOnlinePlayer === 'function') {
        this.game.spawnOnlinePlayer(record.team, {
          x: spawn.x,
          y: spawn.y,
          z: spawn.z,
          yaw: spawn.yaw,
        });
        spawned = true;
      }
    } catch (err) {
      console.warn('[online] local respawn', err);
    }
    const player = this.game?.player;
    if (player) {
      if (!spawned) {
        if (player.pos?.set) player.pos.set(spawn.x, spawn.y, spawn.z);
        else if (player.pos) Object.assign(player.pos, { x: spawn.x, y: spawn.y, z: spawn.z });
        player.yaw = Number.isFinite(Number(spawn.yawRad))
          ? Number(spawn.yawRad)
          : num(spawn.yaw) * Math.PI / 180;
        player.pitch = 0;
        player.crouching = false;
        player.health = record.health;
        player.armor = record.armor;
        player.helmet = !!record.helmet;
        player.vel?.set?.(0, 0, 0);
      }
      player.name = record.name;
      player.kills = record.kills;
      player.deaths = record.deaths;
      player.alive = true;
      player.onGround = true;
      if (spawned) {
        record.health = player.health;
        record.armor = player.armor;
      }
      record.alive = player.alive;
    }
  }

  _spawnRemote(record, spawn) {
    const avatar = this._ensureRemotePlayer(record.id);
    if (!avatar) return;
    avatar.setTarget(
      spawn,
      spawn.yawRad,
      0,
      false,
      true,
      record.weaponId,
      true,
      0,
    );
    avatar.snapToTarget();
    avatar.respawn();
  }

  _applyLocalDeath() {
    const player = this.game?.player;
    if (!player || !player.alive) return;
    player.alive = false;
    player.health = 0;
    player.armor = 0;
    player.deathTime = 0;
    if (player.vel) {
      player.vel.x *= 0.2;
      player.vel.z *= 0.2;
    }
    this.game?.audio?.play?.('death');
    if (this.isDeathmatch) {
      this.game?.ui?.showCenterMessage?.(`RESPAWN EN ${DEATHMATCH_RESPAWN_SECONDS.toFixed(1)} S`, 1300);
      this.game?.ui?.toast?.('Deathmatch · respawn rápido');
    } else {
      this.game?.ui?.showCenterMessage?.('HAS MUERTO', 1800);
      this.game?.ui?.toast?.('Esperando el cierre de la ronda');
    }
  }

  /* ------------------------------------------------------------------ */
  /* State / snapshots                                                   */
  /* ------------------------------------------------------------------ */

  _sendNetwork(step, now) {
    this._stateAccum += step;
    if (this._stateAccum >= STATE_INTERVAL) {
      this._stateAccum = 0;
      this._sendState();
    }
    if (this.isHost) {
      this._snapshotAccum += step;
      if (this._snapshotAccum >= SNAPSHOT_INTERVAL) {
        this._snapshotAccum = 0;
        this._sendSnapshot(now);
      }
    }
    this._pingAccum += step;
    if (this._pingAccum >= PING_INTERVAL) {
      this._pingAccum = 0;
      if (this.isHost) this._broadcast('ping', { t: now });
      else this._sendToHost('ping', { t: now });
    }
  }

  _sendState(force = false) {
    if (!force && (this._disposed || !this._started)) return;
    const player = this.game?.player;
    if (!player?.pos) return;
    const payload = {
      playerId: this.localId,
      team: player.team,
      characterId: CHARACTER_IDS[player.team],
      jumpHeld: !!player._jumpHeld,
      jumpCount: Math.max(0, Math.floor(num(player._jumpCount))),
      pos: { x: round3(player.pos.x), y: round3(player.pos.y), z: round3(player.pos.z) },
      yaw: round3(player.yaw),
      pitch: round3(player.pitch),
      crouch: !!player.crouching,
      onGround: player.onGround !== false,
      moveSpeed: round3(player.getVelocity2D?.() ?? player.speed ?? 0),
      velocity: {
        x: round3(player.vel?.x),
        y: round3(player.vel?.y),
        z: round3(player.vel?.z),
      },
      jumpState: player.onGround !== false ? 'ground' : (num(player.vel?.y) > 0.12 ? 'rise' : 'fall'),
      physicsTick: Math.max(0, Math.round(num(player._physicsTick))),
      sentAt: Date.now(),
      hostTime: this.isHost ? Date.now() : undefined,
      movementPreset: player.movementPresetId || null,
      weaponId: this.game?.weapons?.currentId || 'knife',
      reloading: !!this.game?.weapons?.reloading,
      weaponTime: this.game?.weapons?.time,
      reloadRemaining: this.game?.weapons?.reloadTimer,
      scoped:!!this.game?.weapons?.isScoped?.(),
      alive: player.alive !== false,
      inventory: this.game?.weapons?.getInventorySnapshot?.() || null,
    };
    if (this.isHost) {
      this._acceptState(this.localId, payload);
      this._broadcast('state', payload, this.localId);
    } else {
      this._sendToHost('state', payload);
    }
  }

  _acceptState(playerId, payload) {
    const record = this.players.get(playerId);
    if (!record || !payload || !isVec(payload.pos)) return;
    const claimedWeaponId = typeof payload.weaponId === 'string' ? payload.weaponId : record.weaponId;
    const acceptedWeaponId = recordOwnsWeapon(record, claimedWeaponId) ? claimedWeaponId : record.weaponId;
    record.lastState = {
      team: record.team,
      characterId: CHARACTER_IDS[record.team],
      jumpHeld: !!payload.jumpHeld,
      jumpCount: Math.max(0, Math.floor(num(payload.jumpCount))),
      pos: {
        x: num(payload.pos.x),
        y: num(payload.pos.y),
        z: num(payload.pos.z),
      },
      yaw: num(payload.yaw),
      pitch: num(payload.pitch),
      crouch: !!payload.crouch,
      onGround: payload.onGround !== false,
      moveSpeed: Math.max(0, num(payload.moveSpeed)),
      velocity: isVec(payload.velocity)
        ? {
            x: clamp(num(payload.velocity.x), -50, 50),
            y: clamp(num(payload.velocity.y), -50, 50),
            z: clamp(num(payload.velocity.z), -50, 50),
          }
        : { x: 0, y: 0, z: 0 },
      jumpState: payload.jumpState === 'rise' || payload.jumpState === 'fall' ? payload.jumpState : 'ground',
      physicsTick: Math.max(0, Math.round(num(payload.physicsTick))),
      sentAt: Number.isFinite(Number(payload.sentAt)) ? Number(payload.sentAt) : Date.now(),
      hostTime: this.isHost ? Date.now() : num(payload.hostTime),
      movementPreset: typeof payload.movementPreset === 'string' ? payload.movementPreset : null,
      weaponId: acceptedWeaponId,
      reloading: !!payload.reloading,
      scoped:!!payload.scoped,
      alive: payload.alive !== false,
    };
    record.lastStateAt = Date.now();
    if (
      this.isDeathmatch &&
      record.alive &&
      record.lastState.alive &&
      !this._isDeathmatchOutOfBoundsPosition(record.lastState.pos)
    ) {
      record.lastSafeState = {
        ...record.lastState,
        pos: { ...record.lastState.pos },
      };
    }
    if(this.isHost && playerId!==this.localId) {
      this._advanceHostReload(record);
      const w=weaponInfo(record.lastState.weaponId);
      const entry=w?.slot===1?record.inventory?.primary:record.inventory?.secondary;
      if(record.reloadId && record.reloadId!==record.lastState.weaponId){record.reloadReadyAt=0;record.reloadClientReadyAt=null;record.reloadId=null;}
      if(payload.reloading && !record.reloadReadyAt && entry?.magazine<w?.magazine && entry.reserve>0) {
        record.reloadId=w.id;record.reloadReadyAt=Date.now()+1000*w.reloadTime;
        record.reloadClientReadyAt=Number.isFinite(payload.weaponTime)&&Number.isFinite(payload.reloadRemaining)
          ? 1000*(payload.weaponTime+clamp(payload.reloadRemaining,Math.max(0,w.reloadTime-.15),w.reloadTime)) : null;
      }
    }
    record.weaponId = record.lastState.weaponId;
    if (payload.inventory && typeof payload.inventory === 'object') {
      const incoming = cloneInventory(payload.inventory);
      if (incoming) {
        if (this.isHost && playerId !== this.localId) {
          // Online slot ownership is host-authoritative. Guest state may refresh ammo for
          // the weapon already in a slot, but it cannot resurrect a dropped weapon or
          // replace a slot while a host drop/pickup decision is in flight.
          if (!record.inventory) record.inventory = onlineLoadoutInventory(record.team);
          for (const slot of ['primary', 'secondary']) {
            const current = record.inventory[slot];
            const next = incoming[slot];
            if (current && next && current.id === next.id) {
              // Ammo is consumed and replenished by host shots/reload deadlines.
            }
          }
          if (recordOwnsWeapon(record, incoming.currentId)) record.inventory.currentId = incoming.currentId;
          if (recordOwnsWeapon(record, incoming.lastId)) record.inventory.lastId = incoming.lastId;
        } else {
          record.inventory = incoming;
        }
      }
    }
    if (playerId !== this.localId) {
      const avatar = this._ensureRemotePlayer(playerId);
      avatar?.setTarget?.(
        record.lastState.pos,
        record.lastState.yaw,
        record.lastState.pitch,
        record.lastState.crouch,
        record.alive && record.lastState.alive,
        record.weaponId,
        record.lastState.onGround,
        record.lastState.moveSpeed,
        record.lastState.reloading,
        record.lastState.velocity,
        record.lastState.jumpState,
        record.lastState.sentAt,
        record.lastState.physicsTick,
        record.lastState.hostTime,
      );
    }
  }

  _syncAuthorityFromLocal(now) {
    if (!this.isHost || !this.local) return;
    const player = this.game?.player;
    if (!player) return;
    const waitingRespawn = this.isDeathmatch && !this.local.alive && !!this.local.respawnAt;
    this.local.health = waitingRespawn ? 0 : Math.max(0, Math.ceil(num(player.health)));
    this.local.armor = waitingRespawn ? 0 : Math.max(0, Math.ceil(num(player.armor)));
    this.local.helmet = !!player.helmet;
    this.local.alive = waitingRespawn ? false : player.alive !== false && this.local.health > 0;
    this.local.weaponId = this.game?.weapons?.currentId || this.local.weaponId;
    this.local.inventory = this.game?.weapons?.getInventorySnapshot?.() || this.local.inventory;
    this.local.lastStateAt = now;
  }

  _sendSnapshot(now) {
    if (!this.isHost) return;
    this._syncAuthorityFromLocal(now);
    this._syncAuthoritativeDrops();
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      health: p.health,
      armor: p.armor,
      helmet: !!p.helmet,
      alive: !!p.alive,
      kills: p.kills,
      deaths: p.deaths,
      lifeSeq: p.lifeSeq,
      weaponId: p.weaponId,
      connected: p.connected !== false,
      respawnIn: this.isDeathmatch && p.respawnAt
        ? round1(Math.max(0, (p.respawnAt - now) / 1000))
        : 0,
      state: p.lastState ? {
        pos: p.lastState.pos ? { ...p.lastState.pos } : null,
        yaw: num(p.lastState.yaw),
        pitch: num(p.lastState.pitch),
        crouch: !!p.lastState.crouch,
        onGround: p.lastState.onGround !== false,
        moveSpeed: Math.max(0, num(p.lastState.moveSpeed)),
        hostTime: num(p.lastState.hostTime),
        weaponId: p.weaponId,
        reloading: !!p.lastState.reloading,
        alive: !!p.alive,
      } : null,
    }));
    this._broadcast('snapshot', {
      authoritySeq: this._nextAuthoritySeq(),
      phase: this.phase,
      roundNumber: this.roundNumber,
      roundResetIn: this.roundResetAt ? round1(Math.max(0, (this.roundResetAt - now) / 1000)) : 0,
      teamScores: { ...this.teamScores },
      players,
      drops: [...this.drops.values()],
    });
  }

  /* ------------------------------------------------------------------ */
  /* Incoming protocol                                                  */
  /* ------------------------------------------------------------------ */

  handleMessage(type, payload = {}, senderId = null) {
    if (this._disposed || !this._started) return;
    const from = String(senderId || payload?._from || payload?.senderId || '');
    try {
      switch (type) {
        case 'state':
          this._handleState(payload, from);
          break;
        case 'snapshot':
          if (!this.isHost) this._handleSnapshot(payload);
          break;
        case 'shot':
          if (this.isHost) this._handleGuestShot(payload, from);
          break;
        case 'shotFx':
          this._handleShotFx(payload);
          break;
        case 'damage':
          this._handleDamage(payload);
          break;
        case 'hitConfirm':
          this._handleHitConfirm(payload);
          break;
        case 'playerHit':
          this._handlePlayerHit(payload);
          break;
        case 'kill':
          this._handleKill(payload);
          break;
        case 'selfDeath':
          if (this.isHost && this.isDeathmatch && from) this._hostHandleSelfDeath(from, payload, false);
          break;
        case 'environmentDeath':
          if (!this.isHost) this._handleEnvironmentDeath(payload);
          break;
        case 'respawn':
          if (!this.isHost) this._handleDeathmatchRespawn(payload);
          break;
        case 'roundEnd':
          if (!this.isHost) this._handleRoundEnd(payload);
          break;
        case 'roundStart':
          if (!this.isHost) this._handleRoundStart(payload);
          break;
        case 'matchEnd':
          if (!this.isHost) this._handleMatchEnd(payload);
          break;
        case 'weaponDropRequest':
          if (this.isHost) this._hostDropRequest(from, payload);
          break;
        case 'dmBuy':
          if (this.isHost && this.isDeathmatch && from) this._hostAuthorizeDeathmatchPurchase(from, payload, false);
          break;
        case 'dmBuyResult':
          if (!this.isHost) this._handleDeathmatchBuyResult(payload);
          break;
        case 'weaponDropAdd':
          if (!this.isHost) this._applyDropAdd(payload?.drop);
          break;
        case 'weaponDropRemove':
          if (!this.isHost) this._applyDropRemove(payload?.dropId);
          break;
        case 'weaponDropAccepted':
          if (!this.isHost) this._handleDropAccepted(payload);
          break;
        case 'weaponDropsReset':
          if (!this.isHost) this._applyDropSnapshot([]);
          break;
        case 'weaponPickupRequest':
          if (this.isHost) this._hostPickupRequest(from, payload);
          break;
        case 'weaponPickupGranted':
          if (!this.isHost) this._applyPickupGrant(payload);
          break;
        case 'playerSync':
          if (!this.isHost) this._handlePlayerSync(payload);
          break;
        case 'ping':
          if (!this.isHost) this._sendToHost('pong', { t: num(payload.t) });
          else if (from) this._sendTo(from, 'pong', { t: num(payload.t) });
          break;
        case 'pong':
          this._handlePong(payload, from);
          break;
        case 'playerDisconnected':
          this.setPlayerConnected(payload?.playerId || from, false);
          break;
        case 'playerReconnected':
          this.setPlayerConnected(payload?.playerId || from, true);
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('[online] message', type, err);
    }
  }

  _handleState(payload, senderId) {
    const claimed = String(payload?.playerId || '');
    if (this.isHost) {
      const id = senderId || claimed;
      if (!id || id === this.localId || !this.players.has(id)) return;
      const state={...payload,playerId:id,hostTime:Date.now()};
      this._acceptState(id,state);
      this._broadcast('state',state,id);
      return;
    }
    const id = claimed || senderId;
    if (!id || id === this.localId || !this.players.has(id)) return;
    this._acceptState(id, payload);
  }

  _handleSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (!this._acceptAuthoritySeq(payload)) return;
    if (payload.phase) this.phase = payload.phase;
    if (Number.isFinite(Number(payload.roundNumber))) this.roundNumber = Math.max(1, Math.round(Number(payload.roundNumber)));
    if (payload.teamScores) {
      this.teamScores.CT = Math.max(0, Math.round(num(payload.teamScores.CT)));
      this.teamScores.T = Math.max(0, Math.round(num(payload.teamScores.T)));
    }
    for (const state of Array.isArray(payload.players) ? payload.players : []) {
      const record = this.players.get(String(state.id));
      if (!record) continue;
      const incomingLifeSeq = Math.max(0, Math.floor(num(state.lifeSeq, record.lifeSeq)));
      if (incomingLifeSeq < record.lifeSeq) continue;
      record.lifeSeq = incomingLifeSeq;
      record.health = clamp(num(state.health, record.health), 0, 100);
      record.armor = clamp(num(state.armor, record.armor), 0, 100);
      record.helmet = !!state.helmet;
      record.alive = state.alive !== false;
      record.kills = Math.max(0, Math.round(num(state.kills, record.kills)));
      record.deaths = Math.max(0, Math.round(num(state.deaths, record.deaths)));
      if (this.isDeathmatch) {
        record.respawnAt = state.respawnIn > 0
          ? Date.now() + num(state.respawnIn) * 1000
          : 0;
      }
      record.weaponId = typeof state.weaponId === 'string' ? state.weaponId : record.weaponId;
      record.connected = state.connected !== false;
      this._reconcileAuthoritativeLife(record, state.state);
    }
    if (Array.isArray(payload.drops)) this._applyDropSnapshot(payload.drops);
  }

  _spawnFromAuthoritativeState(state) {
    if (!state || !isVec(state.pos)) return null;
    if (this.isDeathmatch && this._isDeathmatchOutOfBoundsPosition(state.pos)) return null;
    const yawRad = num(state.yaw);
    return {
      x: num(state.pos.x),
      y: num(state.pos.y, 0.05),
      z: num(state.pos.z),
      yaw: yawRad * 180 / Math.PI,
      yawRad,
    };
  }

  _reconcileAuthoritativeLife(record, authoritativeState = null) {
    if (!record) return;
    const spawn = this._spawnFromAuthoritativeState(authoritativeState || record.lastState);
    if (record.id === this.localId) {
      const player = this.game?.player;
      if (!player) return;
      if (record.alive) {
        if (this._pendingSelfDeath) {
          const pending = this._pendingSelfDeath;
          const expired = Date.now() - pending.at >= SELF_DEATH_PENDING_TIMEOUT_MS;
          if (record.lifeSeq > pending.lifeSeq || expired) this._pendingSelfDeath = null;
          else if (!player.alive) return;
        }
        if (!player.alive && spawn) {
          if (this.isDeathmatch) {
            record.inventory = onlineLoadoutInventory(record.team);
    record.recoilStates=new Map();record.nextShotAt=0;record.reloadReadyAt=0;record.acceptedShotSeq=0;
    record.shotClock=null;record.reloadClientReadyAt=null;this._shotHistory?.delete(record.id);
            record.weaponId = record.inventory.currentId;
          }
          this._spawnLocal(record, spawn);
        }
        player.health = record.health;
        player.armor = record.armor;
        player.helmet = record.helmet;
        player.kills = record.kills;
        player.deaths = record.deaths;
      } else if (player.alive) {
        this._applyLocalDeath();
      }
      return;
    }

    const avatar = this._ensureRemotePlayer(record.id);
    if (record.alive) {
      if (avatar && !avatar.alive && spawn) this._spawnRemote(record, spawn);
    } else if (avatar?.alive) {
      avatar.playDeath();
    }
  }

  _handleGuestShot(payload, senderId) {
    if (!senderId || !this.players.has(senderId) || !isVec(payload?.origin) || !isVec(payload?.dir)) return;
    const origin = vec3(payload.origin, new THREE.Vector3());
    const dir = vec3(payload.dir, new THREE.Vector3());
    if (!origin || !dir || dir.lengthSq() < 1e-8) return;
    dir.normalize();
    this._hostResolveShot(
      senderId,
      origin,
      dir,
      typeof payload.weaponId === 'string' ? payload.weaponId : 'ak47',
      null,
      num(payload.seq),
      payload,
    );
  }

  _handleShotFx(payload) {
    if (!payload || payload.shooterId === this.localId || !isVec(payload.origin) || !isVec(payload.dir)) return;
    const origin = vec3(payload.origin, new THREE.Vector3());
    const dir = vec3(payload.dir, new THREE.Vector3());
    const point = isVec(payload.point)
      ? vec3(payload.point, new THREE.Vector3())
      : null;
    if (!origin || !dir) return;
    dir.normalize();
    this.avatars.get(String(payload.shooterId || ''))?.playShoot?.();
    this._remoteShotFx(origin, dir, payload.weaponId, point, !!payload.world);
  }

  _handleDamage(payload) {
    if (!payload || payload.targetId !== this.localId || this.isHost) return;
    const record = this.local;
    if (!record) return;
    record.health = clamp(num(payload.health, record.health), 0, 100);
    record.armor = clamp(num(payload.armor, record.armor), 0, 100);
    const player = this.game?.player;
    if (player) {
      const previousHealth = player.health;
      const previousArmor = player.armor;
      player.health = record.health;
      player.armor = record.armor;
      this.game?.classicUI?.hud?.notifyDamage?.(
        Math.max(0, previousHealth - player.health),
        Math.max(0, previousArmor - player.armor),
      );
      player.damageFlash = 1;
      const damage = Math.max(0, num(payload.damage));
      player.addShake?.(clamp(damage / 65, 0.07, 0.43));
      this.game?.audio?.play?.(previousArmor > player.armor ? 'armor_hit' : 'hurt', { volume: clamp(damage / 55, 0.32, 0.85) });
      this.game?.ui?.flashDamage?.(clamp(damage / 130, 0.04, 0.21));
    }
    if (record.health <= 0 && record.alive) {
      record.alive = false;
      this._applyLocalDeath();
    }
  }

  _handleHitConfirm(payload) {
    if (!payload || payload.miss) return;
    const damage = Math.max(0, num(payload.damage));
    this.game?.ui?.showHitmarker?.(!!payload.headshot, damage);
    // Escopeta: varios perdigones confirmados no deben superponer sonidos.
    const now = performance.now();
    if (this.game?.settings?.hitSound !== false && now - (this._lastHitFeedbackAt ?? -1000) > 65) {
      this._lastHitFeedbackAt = now;
      this.game?.audio?.play?.('hit', {
        volume: Math.min(0.78, 0.32 + damage / 130),
        rate: payload.headshot ? 1.1 : 0.97,
      });
    }
  }

  _handlePlayerHit(payload) {
    const targetId = String(payload?.targetId || '');
    if (!targetId || targetId === this.localId) return;
    this.avatars.get(targetId)?.playHit?.();
  }

  _handleKill(payload) {
    if (!payload) return;
    if (!this._acceptAuthoritySeq(payload)) return;
    const killer = this.players.get(String(payload.killerId));
    const victim = this.players.get(String(payload.victimId));
    if (!killer || !victim) return;
    const incomingLifeSeq = Math.max(0, Math.floor(num(payload.lifeSeq, victim.lifeSeq)));
    if (incomingLifeSeq < victim.lifeSeq) return;
    victim.lifeSeq = incomingLifeSeq;
    if (!this.isHost) {
      killer.kills = Math.max(killer.kills, Math.round(num(payload.kills, killer.kills + 1)));
      if (this.isDeathmatch && payload.killReward === true && killer.id !== victim.id) {
        killer.health = clamp(num(payload.killerHealth, DEATHMATCH_KILL_REWARD_HEALTH), 0, DEATHMATCH_KILL_REWARD_HEALTH);
        killer.armor = clamp(num(payload.killerArmor, DEATHMATCH_KILL_REWARD_ARMOR), 0, DEATHMATCH_KILL_REWARD_ARMOR);
        if (killer.id === this.localId && this.game?.player?.alive) {
          this.game.player.health = killer.health;
          this.game.player.armor = killer.armor;
        }
      }
      victim.deaths = Math.max(victim.deaths, Math.round(num(payload.deaths, victim.deaths + 1)));
      victim.alive = false;
      victim.health = 0;
      if (this.isDeathmatch) {
        victim.respawnAt = Date.now() + Math.max(0, num(payload.respawnIn, DEATHMATCH_RESPAWN_SECONDS)) * 1000;
      }
      if (killer.id === this.localId && this.game?.player) this.game.player.kills = killer.kills;
      if (victim.id === this.localId && this.game?.player) this.game.player.deaths = victim.deaths;
      if (victim.id === this.localId) this._applyLocalDeath();
      else this.avatars.get(victim.id)?.playDeath?.();
    }
    this._handleKillVisual(payload);
  }

  _handleEnvironmentDeath(payload) {
    if (!this.isDeathmatch || !payload || !this._acceptAuthoritySeq(payload)) return;
    const record = this.players.get(String(payload.playerId || ''));
    if (!record) return;
    const incomingLifeSeq = Math.max(0, Math.floor(num(payload.lifeSeq, record.lifeSeq)));
    if (incomingLifeSeq < record.lifeSeq) return;
    record.lifeSeq = incomingLifeSeq;
    if (record.id === this.localId && this._pendingSelfDeath && record.lifeSeq > this._pendingSelfDeath.lifeSeq) {
      this._pendingSelfDeath = null;
    }
    record.alive = false;
    record.health = 0;
    record.deaths = Math.max(record.deaths, Math.round(num(payload.deaths, record.deaths + 1)));
    record.respawnAt = Date.now() + Math.max(0, num(payload.respawnIn, DEATHMATCH_RESPAWN_SECONDS)) * 1000;
    if (record.lastState) record.lastState.alive = false;
    if (record.id === this.localId) {
      if (this.game?.player) this.game.player.deaths = record.deaths;
      this._applyLocalDeath();
    } else {
      this.avatars.get(record.id)?.playDeath?.();
    }
  }

  _handleDeathmatchRespawn(payload) {
    if (!this.isDeathmatch || !payload) return;
    if (!this._acceptAuthoritySeq(payload)) return;
    const record = this.players.get(String(payload.playerId || ''));
    if (!record) return;
    const incomingLifeSeq = Math.max(0, Math.floor(num(payload.lifeSeq, record.lifeSeq)));
    if (incomingLifeSeq < record.lifeSeq) return;
    record.lifeSeq = incomingLifeSeq;
    if (record.id === this.localId && this._pendingSelfDeath && record.lifeSeq > this._pendingSelfDeath.lifeSeq) {
      this._pendingSelfDeath = null;
    }
    const yaw = num(payload.yaw);
    const spawn = {
      x: num(payload.x),
      y: num(payload.y, 0.05),
      z: num(payload.z),
      yaw,
      yawRad: Number.isFinite(Number(payload.yawRad))
        ? Number(payload.yawRad)
        : yaw * Math.PI / 180,
    };
    record.health = clamp(num(payload.health, 100), 0, 100);
    record.armor = clamp(num(payload.armor, 100), 0, 100);
    record.helmet = false;
    record.alive = true;
    record.respawnAt = 0;
    record.spawnProtectionUntil = Date.now() + Math.max(0, num(payload.protectionMs, 1000));
    record.inventory = onlineLoadoutInventory(record.team);
    record.recoilStates=new Map();record.nextShotAt=0;record.reloadReadyAt=0;record.acceptedShotSeq=0;
    record.shotClock=null;record.reloadClientReadyAt=null;this._shotHistory?.delete(record.id);
    record.weaponId = record.inventory.currentId;
    record.lastState = {
      pos: { x: spawn.x, y: spawn.y, z: spawn.z },
      yaw: spawn.yawRad,
      pitch: 0,
      crouch: false,
      onGround: true,
      moveSpeed: 0,
      weaponId: record.weaponId,
      reloading: false,
      alive: true,
    };
    record.lastSafeState = {
      ...record.lastState,
      pos: { ...record.lastState.pos },
    };
    record.lastStateAt = Date.now();
    if (record.id === this.localId) this._spawnLocal(record, spawn);
    else this._spawnRemote(record, spawn);
  }

  _handleKillVisual(payload) {
    const killer = this.players.get(String(payload.killerId));
    const victim = this.players.get(String(payload.victimId));
    if (!killer || !victim) return;
    const weaponId = payload.weapon || 'unknown';
    const weaponName = this.game?.weapons?.getName?.(weaponId) || weaponInfo(weaponId)?.name || weaponId;
    this.game?.addKillFeed?.({
      killer: killer.name,
      victim: victim.name,
      weapon: weaponName,
      headshot: !!payload.headshot,
      teamKill: this.isDeathmatch ? false : killer.team === victim.team,
      killerTeam: killer.team,
      victimTeam: victim.team,
      isPlayerKiller: killer.id === this.localId,
      isPlayerVictim: victim.id === this.localId,
    });
    if (killer.id === this.localId) this.game?.ui?.showKillConfirm?.(!!payload.headshot);
    this.game?.audio?.play?.('bodyfall', { volume: 0.55 });
  }

  _handleRoundEnd(payload) {
    if (!payload) return;
    if (payload.teamScores) {
      this.teamScores.CT = Math.max(0, Math.round(num(payload.teamScores.CT)));
      this.teamScores.T = Math.max(0, Math.round(num(payload.teamScores.T)));
    }
    this.phase = 'roundover';
    this.roundWinner = payload.winnerTeam === 'T' ? 'T' : 'CT';
    this.roundResetAt = Date.now() + Math.max(0, num(payload.nextRoundIn, ROUND_RESET_MS / 1000)) * 1000;
    this._showRoundEnd(payload);
  }

  _handleRoundStart(payload) {
    if (!payload) return;
    this.phase = 'countdown';
    this.roundNumber = Math.max(1, Math.round(num(payload.roundNumber, this.roundNumber + 1)));
    this.startAt = Number.isFinite(Number(payload.startAt)) ? Number(payload.startAt) : Date.now() + 900;
    if (payload.teamScores) {
      this.teamScores.CT = Math.max(0, Math.round(num(payload.teamScores.CT)));
      this.teamScores.T = Math.max(0, Math.round(num(payload.teamScores.T)));
    }
    for (const item of Array.isArray(payload.respawns) ? payload.respawns : []) {
      const record = this.players.get(String(item.playerId));
      if (!record) continue;
      record.health = 100;
      record.armor = 100;
      record.alive = true;
      record.weaponId = record.team === 'CT' ? 'm4a1' : 'ak47';
      const spawn = {
        x: num(item.x),
        y: num(item.y, 0.05),
        z: num(item.z),
        yaw: num(item.yaw),
        yawRad: num(item.yawRad, num(item.yaw) * Math.PI / 180),
      };
      if (record.id === this.localId) this._spawnLocal(record, spawn);
      else this._spawnRemote(record, spawn);
    }
    this._applyDropSnapshot([]);
  }

  _handleMatchEnd(payload) {
    if (!payload || this._over) return;
    if (payload.teamScores) {
      this.teamScores.CT = Math.max(0, Math.round(num(payload.teamScores.CT)));
      this.teamScores.T = Math.max(0, Math.round(num(payload.teamScores.T)));
    }
    this._finish(payload.winnerTeam === 'T' ? 'T' : 'CT', true);
  }

  _handlePong(payload, senderId) {
    const sent = num(payload?.t);
    if (!sent) return;
    const rtt = clamp(Date.now() - sent, 0, 5000);
    if (this.isHost && senderId && this.players.has(senderId)) {
      this.players.get(senderId).ping = rtt;
    } else {
      this._rtt = this._rtt ? this._rtt * 0.7 + rtt * 0.3 : rtt;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Deathmatch purchases / drops / pickups                              */
  /* ------------------------------------------------------------------ */

  notifyLocalPurchase(id) {
    if (!this.isDeathmatch || this._disposed || !this._started || this.phase !== 'live') return false;
    if (!this.local?.alive || typeof id !== 'string' || !id) return false;
    const seq = ++this._purchaseSeq;
    if (this.isHost) return this._hostAuthorizeDeathmatchPurchase(this.localId, { id, seq }, true);
    return this._sendToHost('dmBuy', { id, seq });
  }

  _hostAuthorizeDeathmatchPurchase(playerId, payload, localPurchase = false) {
    if (!this.isHost || !this.isDeathmatch || this.phase !== 'live') return false;
    const record = this.players.get(String(playerId || ''));
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const seq = Math.max(1, Math.floor(num(payload?.seq, 1)));
    if (!record?.alive || record.connected === false || !id || seq <= record.lastPurchaseSeq) return false;

    const weapon = WEAPONS[id] || null;
    const equipment = EQUIPMENT[id] || null;
    const weaponAllowed = !!weapon && weapon.type !== 'c4' && weapon.slot !== 3 && [1, 2, 4].includes(weapon.slot);
    const equipmentAllowed = !!equipment && ['kevlar', 'assaultsuit', 'defusekit', 'ammo_primary', 'ammo_secondary'].includes(id);
    if (!weaponAllowed && !equipmentAllowed) {
      record.lastPurchaseSeq = seq;
      if (record.id !== this.localId) this._sendDeathmatchPurchaseResult(record, id, seq, false);
      return false;
    }

    let accepted = true;
    if (localPurchase && record.id === this.localId) {
      const incoming = cloneInventory(this.game?.weapons?.getInventorySnapshot?.());
      if (incoming) record.inventory = incoming;
      record.weaponId = this.game?.weapons?.currentId || record.inventory?.currentId || record.weaponId;
      record.armor = clamp(num(this.game?.player?.armor, record.armor), 0, 100);
      record.helmet = !!this.game?.player?.helmet;
      record.hasDefuseKit = !!this.game?.player?.hasDefuseKit;
    } else if (weaponAllowed) {
      if (!record.inventory) record.inventory = onlineLoadoutInventory(record.team);
      if (weapon.slot === 1 || weapon.slot === 2) {
        const slot = weapon.slot === 1 ? 'primary' : 'secondary';
        record.inventory[slot] = {
          id,
          magazine: Math.max(0, Math.round(num(weapon.magazine))),
          reserve: 999,
        };
        record.inventory.lastId = record.inventory.currentId;
        record.inventory.currentId = id;
        record.weaponId = id;
      } else if (weapon.slot === 4) {
        const max = DEATHMATCH_GRENADE_MAX[id] || 1;
        const current = Math.max(0, Math.round(num(record.inventory.grenades?.[id])));
        if (current >= max) accepted = false;
        else {
          record.inventory.grenades[id] = current + 1;
          record.inventory.lastId = record.inventory.currentId;
          record.inventory.currentId = id;
          record.weaponId = id;
        }
      }
    } else if (id === 'kevlar') {
      record.armor = 100;
    } else if (id === 'assaultsuit') {
      record.armor = 100;
      record.helmet = true;
    } else if (id === 'defusekit') {
      record.hasDefuseKit = true;
    } else if (id === 'ammo_primary') {
      const entry = record.inventory?.primary;
      const info = weaponInfo(entry?.id);
      if (!entry || !info) accepted = false;
      else entry.reserve = Math.max(entry.reserve, info.reserve);
    } else if (id === 'ammo_secondary') {
      const entry = record.inventory?.secondary;
      const info = weaponInfo(entry?.id);
      if (!entry || !info) accepted = false;
      else entry.reserve = Math.max(entry.reserve, info.reserve);
    }

    record.lastPurchaseSeq = seq;
    if (record.id !== this.localId) this._sendDeathmatchPurchaseResult(record, id, seq, accepted);
    return accepted;
  }

  _sendDeathmatchPurchaseResult(record, id, seq, accepted) {
    return this._sendTo(record.id, 'dmBuyResult', {
      authoritySeq: this._nextAuthoritySeq(),
      playerId: record.id,
      id,
      seq,
      accepted: !!accepted,
      weaponId: record.weaponId,
      inventory: cloneInventory(record.inventory),
      armor: clamp(num(record.armor), 0, 100),
      helmet: !!record.helmet,
      hasDefuseKit: !!record.hasDefuseKit,
    });
  }

  _handleDeathmatchBuyResult(payload) {
    if (!this.isDeathmatch || !payload || String(payload.playerId || '') !== this.localId) return;
    if (!this._acceptAuthoritySeq(payload)) return;
    const record = this.local;
    if (!record) return;
    const syncedInventory = cloneInventory(payload.inventory);
    if (syncedInventory) {
      record.inventory = syncedInventory;
      this.game?.weapons?.applyInventorySnapshot?.(syncedInventory);
    }
    if (typeof payload.weaponId === 'string' && recordOwnsWeapon(record, payload.weaponId)) {
      record.weaponId = payload.weaponId;
    }
    record.armor = clamp(num(payload.armor, record.armor), 0, 100);
    record.helmet = !!payload.helmet;
    record.hasDefuseKit = !!payload.hasDefuseKit;
    const player = this.game?.player;
    if (player) {
      player.armor = record.armor;
      player.helmet = record.helmet;
      player.hasDefuseKit = record.hasDefuseKit;
    }
  }

  requestWeaponDrop(entry, transform = {}) {
    if (!entry?.id || !weaponInfo(entry.id)) return false;
    const payload = {
      entry: {
        id: entry.id,
        magazine: Math.max(0, Math.round(num(entry.magazine))),
        reserve: Math.max(0, Math.round(num(entry.reserve))),
      },
      pos: isVec(transform.position || transform.pos) ? vecPlain(transform.position || transform.pos) : null,
      velocity: isVec(transform.velocity || transform.vel)
        ? vecPlain(transform.velocity || transform.vel)
        : { x: 0, y: 0, z: 0 },
      yaw: round3(num(transform.yaw)),
    };
    if (this.isHost) {
      return !!this._hostCreateDrop(this.localId, payload);
    }
    this._sendToHost('weaponDropRequest', payload);
    return true;
  }

  _hostDropRequest(senderId, payload) {
    if (!senderId || !this.players.has(senderId)) return;
    this._hostCreateDrop(senderId, payload);
  }

  _hostCreateDrop(ownerId, payload) {
    const owner = this.players.get(ownerId);
    const entry = payload?.entry;
    const weapon = weaponInfo(entry?.id);
    if (!owner?.alive || !weapon || weapon.slot === 3 || weapon.type === 'grenade' || weapon.type === 'c4') return null;
    if (ownerId === this.localId) this._syncAuthorityFromLocal(Date.now());
    const inventory = owner.inventory || {};
    const inventoryEntry = weapon.slot === 1 ? inventory.primary : weapon.slot === 2 ? inventory.secondary : null;
    if (inventoryEntry?.id !== entry.id) return null;
    const statePos = ownerId === this.localId
      ? this.game?.player?.pos
      : owner.lastState?.pos;
    const pos = isVec(payload?.pos) ? payload.pos : statePos;
    if (!isVec(pos)) return null;
    const id = 'drop-' + Date.now().toString(36) + '-' + (++this._dropSeq).toString(36);
    const drop = {
      id,
      ownerId,
      entry: {
        id: entry.id,
        magazine: Math.max(0, Math.round(num(inventoryEntry.magazine))),
        reserve: Math.max(0, Math.round(num(inventoryEntry.reserve))),
      },
      weaponId: entry.id,
      ammo: {
        magazine: Math.max(0, Math.round(num(inventoryEntry.magazine))),
        reserve: Math.max(0, Math.round(num(inventoryEntry.reserve))),
      },
      pos: { x: round3(pos.x), y: round3(pos.y), z: round3(pos.z) },
      position: [round3(pos.x), round3(pos.y), round3(pos.z)],
      velocity: isVec(payload?.velocity)
        ? [round3(payload.velocity.x), round3(payload.velocity.y), round3(payload.velocity.z)]
        : [0, 0, 0],
      yaw: round3(num(payload?.yaw)),
      createdAt: Date.now(),
      pickableAt: Date.now() / 1000 + 0.55,
      armed: true,
      grounded: false,
    };
    if (weapon.slot === 1 && owner.inventory) owner.inventory.primary = null;
    if (weapon.slot === 2 && owner.inventory) owner.inventory.secondary = null;
    owner.weaponId =
      owner.inventory?.primary?.id ||
      owner.inventory?.secondary?.id ||
      'knife';
    if (owner.inventory) owner.inventory.currentId = owner.weaponId;
    this.drops.set(id, drop);
    this._applyDropAdd(drop);
    this._broadcast('weaponDropAdd', { drop });
    if (ownerId === this.localId) {
      this.game?.weapons?.removeWeapon?.(entry.id);
      owner.weaponId = this.game?.weapons?.currentId || owner.weaponId;
      this.game?.ui?.toast?.('Tiraste ' + weapon.name);
    } else {
      this._sendTo(ownerId, 'weaponDropAccepted', {
        playerId: ownerId,
        dropId: id,
        weaponId: entry.id,
      });
    }
    return drop;
  }

  requestWeaponPickup(dropId) {
    const id = String(dropId || '');
    if (!id) return false;
    if (this.isHost) return this._hostGrantPickup(this.localId, id);
    this._sendToHost('weaponPickupRequest', { dropId: id });
    return true;
  }

  _hostPickupRequest(senderId, payload) {
    if (!senderId) return;
    this._hostGrantPickup(senderId, String(payload?.dropId || ''));
  }

  _hostGrantPickup(playerId, dropId) {
    this._syncAuthoritativeDrops();
    const record = this.players.get(playerId);
    const drop = this.drops.get(dropId);
    if (!record?.alive || !drop || Date.now() / 1000 < num(drop.pickableAt)) return false;
    const playerPos = playerId === this.localId ? this.game?.player?.pos : record.lastState?.pos;
    if (!isVec(playerPos) || !isVec(drop.pos)) return false;
    const dx = num(playerPos.x) - num(drop.pos.x);
    const dz = num(playerPos.z) - num(drop.pos.z);
    const dy = num(playerPos.y) - num(drop.pos.y);
    if (dx * dx + dz * dz > 1.55 * 1.55 || Math.abs(dy) > 1.7) return false;
    const weapon = weaponInfo(drop.entry?.id);
    if (!weapon) return false;
    const inv = record.inventory || {};
    if (weapon.slot === 1 && inv.primary) return false;
    if (weapon.slot === 2 && inv.secondary) return false;

    this.drops.delete(dropId);
    this._applyDropRemove(dropId);
    this._broadcast('weaponDropRemove', { dropId });
    const grant = { playerId, dropId, entry: { ...drop.entry } };
    if (!record.inventory) record.inventory = { primary: null, secondary: null, grenades: {} };
    if (weapon.slot === 1) record.inventory.primary = { ...drop.entry };
    if (weapon.slot === 2) record.inventory.secondary = { ...drop.entry };
    record.weaponId = drop.entry.id;
    record.inventory.currentId = drop.entry.id;
    if (playerId === this.localId) this._applyPickupGrant(grant);
    else this._sendTo(playerId, 'weaponPickupGranted', grant);
    return true;
  }

  _applyDropAdd(drop) {
    if (!drop?.id) return;
    this.drops.set(drop.id, drop);
    this.game?.weapons?.spawnNetworkDrop?.(drop);
  }

  _applyDropRemove(dropId) {
    if (!dropId) return;
    this.drops.delete(String(dropId));
    this.game?.weapons?.removeNetworkDrop?.(String(dropId));
  }

  _applyDropSnapshot(list) {
    if (!Array.isArray(list)) return;
    this.drops.clear();
    for (const drop of list) if (drop?.id) this.drops.set(drop.id, drop);
    if (this.game?.weapons?.applyDroppedWeaponsSnapshot) {
      this.game.weapons.applyDroppedWeaponsSnapshot(list);
    } else if (this.game?.weapons?.applyNetworkDrops) {
      this.game.weapons.applyNetworkDrops(list);
    }
  }

  _applyPickupGrant(payload) {
    if (!payload || payload.playerId !== this.localId || !payload.entry) return;
    const weapons = this.game?.weapons;
    if (weapons?.acceptPickup) {
      weapons.acceptPickup(payload.entry);
    } else if (weapons?.giveWeapon) {
      weapons.giveWeapon(payload.entry.id, { silent: false });
      const slot = weaponInfo(payload.entry.id)?.slot;
      const inv = slot === 1 ? weapons.inventory?.primary : weapons.inventory?.secondary;
      if (inv) {
        inv.magazine = Math.max(0, Math.round(num(payload.entry.magazine, inv.magazine)));
        inv.reserve = Math.max(0, Math.round(num(payload.entry.reserve, inv.reserve)));
      }
    }
    // The host already removed the authoritative drop before applying its grant.
    if (!this.isHost) this._applyDropRemove(payload.dropId);
  }

  _handleDropAccepted(payload) {
    if (!payload || payload.playerId !== this.localId) return;
    const weaponId = String(payload.weaponId || '');
    if (!weaponId) return;
    const weapon = weaponInfo(weaponId);
    this.game?.weapons?.removeWeapon?.(weaponId);
    if (weapon) this.game?.ui?.toast?.('Tiraste ' + weapon.name);
  }

  _clearAuthoritativeDrops() {
    if (!this.isHost) return;
    this.drops.clear();
    this._applyDropSnapshot([]);
    this._broadcast('weaponDropsReset', { drops: [] });
  }

  _syncAuthoritativeDrops() {
    if (!this.isHost) return;
    const snapshot = this.game?.weapons?.serializeDroppedWeapons?.();
    if (!Array.isArray(snapshot)) return;
    const next = new Map();
    for (const row of snapshot) {
      if (!row?.id) continue;
      const previous = this.drops.get(row.id);
      const weaponId = row.weaponId || previous?.weaponId || previous?.entry?.id;
      const ammo = row.ammo || previous?.ammo || previous?.entry;
      if (!weaponId || !ammo) continue;
      const position = row.position || row.pos;
      const pos = Array.isArray(position) && position.length >= 3
        ? { x: num(position[0]), y: num(position[1]), z: num(position[2]) }
        : isVec(position) ? vecPlain(position) : previous?.pos;
      next.set(row.id, {
        ...(previous || {}),
        ...row,
        weaponId,
        pos,
        ammo: { ...ammo },
        entry: {
          id: weaponId,
          magazine: Math.max(0, Math.round(num(ammo.magazine))),
          reserve: Math.max(0, Math.round(num(ammo.reserve))),
        },
      });
    }
    this.drops = next;
  }

  /* ------------------------------------------------------------------ */
  /* Session / disconnection                                            */
  /* ------------------------------------------------------------------ */

  _sendPlayerSync(record) {
    if (!this.isHost || !record || record.id === this.localId) return false;
    this._syncAuthoritativeDrops();
    const now = Date.now();
    const state = record.lastState ? {
      ...record.lastState,
      pos: record.lastState.pos ? { ...record.lastState.pos } : null,
    } : null;
    return this._sendTo(record.id, 'playerSync', {
      authoritySeq: this._nextAuthoritySeq(),
      playerId: record.id,
      phase: this.phase,
      roundNumber: this.roundNumber,
      winnerTeam: this.phase === 'over' ? this.roundWinner : null,
      startIn: this.startAt ? Math.max(0, (this.startAt - now) / 1000) : 0,
      roundResetIn: this.roundResetAt ? Math.max(0, (this.roundResetAt - now) / 1000) : 0,
      teamScores: { ...this.teamScores },
      player: {
        health: record.health,
        armor: record.armor,
        helmet: !!record.helmet,
        alive: !!record.alive,
        kills: record.kills,
        deaths: record.deaths,
        lifeSeq: record.lifeSeq,
        respawnIn: this.isDeathmatch && record.respawnAt
          ? Math.max(0, (record.respawnAt - now) / 1000)
          : 0,
        weaponId: record.weaponId,
        inventory: cloneInventory(record.inventory),
        state,
      },
      drops: [...this.drops.values()],
    });
  }

  _handlePlayerSync(payload) {
    if (!payload || String(payload.playerId || '') !== this.localId) return;
    if (!this._acceptAuthoritySeq(payload)) return;
    const record = this.local;
    const authoritative = payload.player;
    if (!record || !authoritative || typeof authoritative !== 'object') return;
    const incomingLifeSeq = Math.max(0, Math.floor(num(authoritative.lifeSeq, record.lifeSeq)));
    if (incomingLifeSeq < record.lifeSeq) return;
    record.lifeSeq = incomingLifeSeq;

    if (payload.phase === 'countdown' || payload.phase === 'live' || payload.phase === 'roundover' || payload.phase === 'over') {
      this.phase = payload.phase;
    }
    if (Number.isFinite(Number(payload.roundNumber))) {
      this.roundNumber = Math.max(1, Math.round(Number(payload.roundNumber)));
    }
    if (payload.teamScores) {
      this.teamScores.CT = Math.max(0, Math.round(num(payload.teamScores.CT)));
      this.teamScores.T = Math.max(0, Math.round(num(payload.teamScores.T)));
    }
    if (this.phase === 'countdown') this.startAt = Date.now() + Math.max(0, num(payload.startIn)) * 1000;
    if (this.phase === 'roundover') this.roundResetAt = Date.now() + Math.max(0, num(payload.roundResetIn)) * 1000;

    record.health = clamp(num(authoritative.health, record.health), 0, 100);
    record.armor = clamp(num(authoritative.armor, record.armor), 0, 100);
    record.helmet = !!authoritative.helmet;
    record.alive = authoritative.alive !== false;
    record.kills = Math.max(0, Math.round(num(authoritative.kills, record.kills)));
    record.deaths = Math.max(0, Math.round(num(authoritative.deaths, record.deaths)));
    if (this.isDeathmatch) {
      record.respawnAt = authoritative.respawnIn > 0
        ? Date.now() + num(authoritative.respawnIn) * 1000
        : 0;
    }
    if (recordOwnsWeapon({ ...record, inventory: authoritative.inventory || record.inventory }, authoritative.weaponId)) {
      record.weaponId = authoritative.weaponId;
    }
    const syncedInventory = cloneInventory(authoritative.inventory);
    if (syncedInventory) {
      record.inventory = syncedInventory;
      this.game?.weapons?.applyInventorySnapshot?.(syncedInventory);
      if (recordOwnsWeapon(record, authoritative.weaponId)) record.weaponId = authoritative.weaponId;
    }

    const state = authoritative.state;
    if (state && isVec(state.pos)) {
      record.lastState = {
        pos: { x: num(state.pos.x), y: num(state.pos.y), z: num(state.pos.z) },
        yaw: num(state.yaw),
        pitch: num(state.pitch),
        crouch: !!state.crouch,
        onGround: state.onGround !== false,
        moveSpeed: Math.max(0, num(state.moveSpeed)),
        weaponId: record.weaponId,
        reloading: !!state.reloading,
        alive: record.alive,
      };
      record.lastStateAt = Date.now();
      const player = this.game?.player;
      if (player?.pos && player.alive && record.alive) {
        if (typeof player.pos.set === 'function') player.pos.set(record.lastState.pos.x, record.lastState.pos.y, record.lastState.pos.z);
        else Object.assign(player.pos, record.lastState.pos);
        player.yaw = record.lastState.yaw;
        player.pitch = record.lastState.pitch;
        player.crouching = record.lastState.crouch;
        player.onGround = record.lastState.onGround;
        player.vel?.set?.(0, 0, 0);
      }
    }

    this._reconcileAuthoritativeLife(record, record.lastState);
    if (Array.isArray(payload.drops)) this._applyDropSnapshot(payload.drops);
    if (this.phase === 'over' && !this._over) {
      this._finish(payload.winnerTeam === 'T' ? 'T' : 'CT', true);
    }
  }

  setPlayerConnected(playerId, connected) {
    const record = this.players.get(String(playerId || ''));
    if (!record) return false;
    record.connected = !!connected;
    if (connected && this.isHost && record.id !== this.localId) {
      if (this.isDeathmatch && !record.alive) record.respawnAt = Date.now() + 250;
      this._sendPlayerSync(record);
    }
    if (!connected && record.alive) {
      record.alive = false;
      record.health = 0;
      record.respawnAt = 0;
      if (record.id === this.localId) this._applyLocalDeath();
      else this.avatars.get(record.id)?.playDeath?.();
      if (this.isHost && this.phase === 'live' && !this.isDeathmatch) {
        const aliveTeam = [...this.players.values()].some(
          (p) => p.connected !== false && p.team === record.team && p.alive,
        );
        if (!aliveTeam) this._hostEndRound(record.team === 'CT' ? 'T' : 'CT');
      }
    }
    return true;
  }

  syncRoster(roster = []) {
    for (const item of roster) {
      const id = String(item?.id || item?.playerId || '');
      if (!id) continue;
      let record = this.players.get(id);
      if (!record) {
        record = {
          id,
          name: String(item.name || 'Jugador').slice(0, 16),
          team: item.team === 'T' ? 'T' : 'CT',
          slot: Math.max(0, Math.floor(num(item.slot))),
          isHost: !!item.isHost,
          connected: item.connected !== false,
          health: 100,
          armor: 100,
          helmet: false,
          hasDefuseKit: false,
          alive: true,
          kills: 0,
          deaths: 0,
          lifeSeq: 0,
          respawnAt: 0,
          spawnProtectionUntil: 0,
          lastState: null,
          lastSafeState: null,
          lastStateAt: 0,
          weaponId: item.team === 'T' ? 'ak47' : 'm4a1',
          inventory: onlineLoadoutInventory(item.team),
          ping: 0,
          lastShotAt: 0,
          lastPurchaseSeq: 0,
        };
        this.players.set(id, record);
        if (id !== this.localId) this._ensureRemotePlayer(id);
      } else {
        record.connected = item.connected !== false;
        record.name = String(item.name || record.name).slice(0, 16);
        if (item.team === 'CT' || item.team === 'T') record.team = item.team;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Match end / rematch                                                */
  /* ------------------------------------------------------------------ */

  _finish(winnerTeam, remote = false) {
    if (this._over) return;
    const team = winnerTeam === 'T' ? 'T' : 'CT';
    this._over = true;
    this.phase = 'over';
    const winners = [...this.players.values()].filter((p) => p.team === team);
    const data = {
      winnerTeam: team,
      winner: team,
      winnerName: team,
      winners: winners.map((p) => p.name),
      youWon: this.myTeam === team,
      teamScores: { ...this.teamScores },
      scoreCT: this.teamScores.CT,
      scoreT: this.teamScores.T,
      // Legacy UI aliases: left=host team, right=opposite team.
      scoreHost: this.teamScores[this.players.get(this.hostId)?.team || 'CT'],
      scoreGuest: this.teamScores[(this.players.get(this.hostId)?.team || 'CT') === 'CT' ? 'T' : 'CT'],
      targetKills: this.targetRounds,
      targetRounds: this.targetRounds,
      mode: this.mode,
      players: this.getRoster(),
      role: this.role,
      matchOver: true,
      reason: 'rounds',
    };
    this._lastMatchEndData = data;
    if (this.isHost && !remote) this._broadcast('matchEnd', data);
    this.game?.input?.exitPointerLock?.();
    this.game?.audio?.play?.(data.youWon ? 'round_win' : 'round_lose', { volume: 0.9 });
    this.game?.onOnlineMatchEnd?.(data);
  }

  requestRematch() {
    if (!this.isHost || this._disposed || this._rematchRequested) return false;
    this._rematchRequested = true;
    const ok = !!this.session?.resetToLobby?.();
    if (!ok) this._rematchRequested = false;
    return ok;
  }

  /* ------------------------------------------------------------------ */
  /* HUD / scoreboard / spawns                                          */
  /* ------------------------------------------------------------------ */

  _spawnForRecord(record, roll = null) {
    const spawns = this.game?.map?.spawns?.[record.team] || [];
    if (!spawns.length) {
      return { x: 0, y: 0.05, z: 0, yaw: 0, yawRad: 0 };
    }
    const startRoll = this.startPayload.spawnRolls?.[record.id];
    let index;
    if (Number.isFinite(Number(roll))) index = Math.floor(clamp(Number(roll), 0, 0.999999) * spawns.length);
    else if (Number.isFinite(Number(startRoll))) index = Math.floor(clamp(Number(startRoll), 0, 0.999999) * spawns.length);
    else if (Number.isFinite(Number(this.startPayload.spawnRolls?.[record.team])) && this.mode === '1v1') {
      index = Math.floor(clamp(Number(this.startPayload.spawnRolls[record.team]), 0, 0.999999) * spawns.length);
    } else {
      index = Math.max(0, Math.floor(num(record.slot))) % spawns.length;
    }
    const spawn = spawns[index] || spawns[0];
    const yaw = num(spawn.yaw);
    return {
      x: num(spawn.x),
      y: num(spawn.y, 0.05),
      z: num(spawn.z),
      yaw,
      yawRad: yaw * Math.PI / 180,
    };
  }

  // Compatibility with older map/tests helpers that only pass team + roll.
  _spawnFor(team, roll = Math.random()) {
    const normalizedTeam = team === 'T' ? 'T' : 'CT';
    const spawns = this.game?.map?.spawns?.[normalizedTeam] || [];
    if (!spawns.length) return { x: 0, y: 0.05, z: 0, yaw: 0, yawRad: 0 };
    const random = Number.isFinite(Number(roll)) ? clamp(Number(roll), 0, 0.999999) : Math.random();
    const spawn = spawns[Math.floor(random * spawns.length)] || spawns[0];
    const yaw = num(spawn.yaw);
    return {
      x: num(spawn.x),
      y: num(spawn.y, 0.05),
      z: num(spawn.z),
      yaw,
      yawRad: yaw * Math.PI / 180,
    };
  }

  getHudState() {
    const player = this.game?.player;
    const hostTeam = this.players.get(this.hostId)?.team || 'CT';
    const guestTeam = hostTeam === 'CT' ? 'T' : 'CT';
    const localAlive = !!player?.alive;
    const ranked = [...this.players.values()]
      .filter((record) => record.connected !== false)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.slot - b.slot);
    const leader = ranked[0] || this.local;
    const roundResetIn = this.roundResetAt
      ? Math.max(0, (this.roundResetAt - Date.now()) / 1000)
      : 0;
    const deathmatchRespawnIn = this.isDeathmatch && this.local?.respawnAt
      ? Math.max(0, (this.local.respawnAt - Date.now()) / 1000)
      : 0;
    return {
      phase: this.phase,
      round: this.roundNumber,
      roundNumber: this.roundNumber,
      mode: this.mode,
      scoreCT: this.isDeathmatch ? (this.local?.kills || 0) : this.teamScores.CT,
      scoreT: this.isDeathmatch ? (leader?.kills || 0) : this.teamScores.T,
      scoreHost: this.teamScores[hostTeam],
      scoreGuest: this.teamScores[guestTeam],
      scoreYou: this.isDeathmatch ? (this.local?.kills || 0) : this.teamScores[this.myTeam],
      scoreThem: this.isDeathmatch ? (leader?.kills || 0) : this.teamScores[this.myTeam === 'CT' ? 'T' : 'CT'],
      scoreLeader: leader?.kills || 0,
      leaderId: leader?.id || null,
      leaderName: leader?.name || '',
      targetKills: this.targetKills,
      targetRounds: this.targetRounds,
      health: Math.max(0, Math.ceil(num(player?.health))),
      armor: Math.max(0, Math.ceil(num(player?.armor))),
      alive: localAlive,
      respawnIn: localAlive ? 0 : round1(this.isDeathmatch ? deathmatchRespawnIn : roundResetIn),
      objective: this.isDeathmatch
        ? (localAlive ? 'DEATHMATCH · BAJAS LIBRES' : `RESPAWN ${round1(deathmatchRespawnIn).toFixed(1)}s`)
        : undefined,
      ping: Math.round(this._rtt) || 0,
      role: this.role,
      playerId: this.localId,
      team: this.myTeam,
      players: this.getRoster(),
      teamScores: { ...this.teamScores },
    };
  }

  getScoreboardData() {
    const teams = { CT: [], T: [] };
    const ffa = [];
    for (const record of this.players.values()) {
      const row = {
        id: record.id,
        name: record.name,
        team: record.team,
        isPlayer: record.id === this.localId,
        alive: record.id === this.localId ? !!this.game?.player?.alive : !!record.alive,
        kills: record.kills,
        deaths: record.deaths,
        money: 0,
        ping: record.id === this.localId ? 0 : Math.round(record.ping || this._rtt || 0),
        connected: record.connected !== false,
        hasBomb: false,
        hasKit: false,
      };
      teams[record.team].push(row);
      ffa.push({ ...row });
    }
    for (const key of ['CT', 'T']) teams[key].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    ffa.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || String(a.name).localeCompare(String(b.name)));
    return {
      online: true,
      mode: this.mode,
      mapName: onlineMapLabel(this.game?.map?.id || this.startPayload.map),
      phase: this.phase,
      round: this.roundNumber,
      scoreCT: this.isDeathmatch ? (this.local?.kills || 0) : this.teamScores.CT,
      scoreT: this.isDeathmatch ? (ffa[0]?.kills || 0) : this.teamScores.T,
      targetKills: this.targetKills,
      targetRounds: this.targetRounds,
      teamScores: { ...this.teamScores },
      players: this.getRoster(),
      role: this.role,
      teams,
      freeForAll: this.isDeathmatch,
      ffa,
      leader: ffa[0] || null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Visual/network helpers                                             */
  /* ------------------------------------------------------------------ */

  _remoteShotFx(origin, dir, weaponId, endPoint, worldPoint) {
    const w = weaponInfo(weaponId);
    try {
      this.game?.audio?.play?.(w?.sound || 'gun_rifle', {
        volume: (w?.volume || 1) * 0.85,
        pan: this._panFor(origin),
      });
      this.game?.effects?.muzzleFlash?.(origin, dir, w?.flashScale || 1);
      if (endPoint) this.game?.effects?.tracer?.(origin, endPoint);
      if (worldPoint && endPoint) this.game?.effects?.bulletImpact?.(endPoint, this._tmpUp, 'concrete');
    } catch (err) {
      console.warn('[online] remote shot fx', err);
    }
  }

  _panFor(position) {
    const player = this.game?.player;
    if (!player?.pos || !position) return 0;
    const dx = position.x - player.pos.x;
    const dz = position.z - player.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const rightX = Math.cos(num(player.yaw));
    const rightZ = -Math.sin(num(player.yaw));
    return clamp(((dx * rightX + dz * rightZ) / len) * 0.75, -1, 1);
  }

  _sendToHost(type, payload) {
    if (this.isHost) return false;
    if (typeof this.session?.sendToHost === 'function') return !!this.session.sendToHost(type, payload);
    return !!this.session?.send?.(type, payload);
  }

  _sendTo(playerId, type, payload) {
    if(playerId===this.localId && type==='hitConfirm'){this._handleHitConfirm(payload);return true;}
    if (!playerId || playerId === this.localId) return false;
    if (typeof this.session?.sendTo === 'function') return !!this.session.sendTo(playerId, type, payload);
    return !!this.session?.send?.(type, payload);
  }

  _broadcast(type, payload, exceptId = null) {
    if (!this.isHost) return false;
    if (typeof this.session?.broadcast === 'function') {
      return !!this.session.broadcast(type, payload, exceptId);
    }
    return !!this.session?.send?.(type, payload);
  }
}
