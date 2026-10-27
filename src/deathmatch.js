/** Continuous offline free-for-all with independent, fast respawns. */
export const DEATHMATCH_RESPAWN_SECONDS = 1.35;

// Recompensa parcial: conserva la supervivencia sin resetear cada duelo a 100/100.
export function rewardDeathmatchKill(killer) {
  if (!killer || killer.alive === false) return false;
  killer.health = Math.min(100, Math.max(0, Number(killer.health) || 0) + 35);
  killer.armor = Math.min(100, Math.max(0, Number(killer.armor) || 0) + 20);
  return true;
}

/** Choose the furthest feasible spawn from living opponents. */
export function chooseDeathmatchSpawn(map, opponents = [], physics = null, random = Math.random) {
  const points = map?.deathmatchSpawns?.length
    ? map.deathmatchSpawns
    : [...(map?.spawns?.CT || []), ...(map?.spawns?.T || [])];
  if (!points.length) throw new Error('Deathmatch requiere puntos de respawn');
  const living = opponents.filter((p) => p?.alive && p.pos);
  const valid = points.filter((p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
    if (!physics?.isPositionFree) return true;
    return physics.isPositionFree({ x: p.x, y: (p.y ?? 0.05) + 0.08, z: p.z }, 0.4, 1.8);
  });
  const candidates = valid.length ? valid : points;
  const scored = candidates.map((point) => {
    const nearestSq = living.reduce((distance, enemy) => {
      const dx = point.x - enemy.pos.x;
      const dz = point.z - enemy.pos.z;
      return Math.min(distance, dx * dx + dz * dz);
    }, Infinity);
    return { point, score: nearestSq };
  });
  // Pick among the top three safe spawns to avoid predictable loops.
  scored.sort((a, b) => b.score - a.score);
  const best = scored.slice(0, Math.min(3, scored.length));
  return { ...best[Math.floor(Math.min(0.99999, Math.max(0, random())) * best.length)].point };
}

export class Deathmatch {
  constructor(game) {
    this.game = game;
    this.phase = 'live';
    this.roundNumber = 1;
    this.seconds = 0;
    this.respawns = new Map();
  }

  start() {
    this.phase = 'live';
    this.game.ui.showCenterMessage?.('DEATHMATCH · TODOS CONTRA TODOS', 2600);
  }

  canControlPlayer() {
    return this.game.state === 'playing' && this.game.player.alive;
  }

  onKill(killer, victim, weaponId, headshot) {
    if (weaponId === 'fall') return;
    if (!victim || this.respawns.has(victim)) return;
    victim.deaths = (victim.deaths || 0) + 1;
    if (killer && killer !== victim) {
      killer.kills = (killer.kills || 0) + 1;
      killer.score = (killer.score || 0) + 1;
      rewardDeathmatchKill(killer);
      if (killer.isPlayer) {
        this.game.ui.showKillConfirm?.(headshot);
        if (headshot) this.game.audio.play('headshot');
      }
    }
    this.game.addKillFeed({
      killer: killer?.name || 'Mundo',
      victim: victim.name || 'Jugador',
      weapon: this.game.weapons?.getName?.(weaponId) || weaponId,
      headshot: !!headshot,
      isPlayerKiller: !!killer?.isPlayer,
      isPlayerVictim: !!victim?.isPlayer,
      killerTeam: killer?.team,
      victimTeam: victim.team,
      teamKill: false,
    });
    this.respawns.set(victim, DEATHMATCH_RESPAWN_SECONDS);
    if (victim.isPlayer) this.game.ui.showCenterMessage?.('RESPAWN EN 1.3 S', 1300);
  }

  _respawn(entity) {
    const game = this.game;
    const enemies = [game.player, ...(game.bots?.getBots?.() || [])].filter((e) => e !== entity);
    const spawn = chooseDeathmatchSpawn(game.map, enemies, game.physics);
    if (entity.isPlayer) {
      game.spawnPlayer(entity.team, spawn);
      game.setupOnlineLoadout();
      entity.spawnProtection = 1.0;
      return;
    }
    const bot = entity;
    bot.pos.set(spawn.x, spawn.y ?? 0.05, spawn.z);
    bot.vel.set(0, 0, 0);
    bot.yaw = (spawn.yaw || 0) * Math.PI / 180;
    bot.pitch = 0;
    bot.aimYaw = bot.yaw;
    bot.aimPitch = 0;
    bot.health = 100;
    bot.armor = 100;
    bot.helmet = true;
    bot.alive = true;
    bot.state = 'live';
    bot.deathTime = 0;
    bot.corpseTimer = 0;
    bot.target = null;
    bot.targetVisible = false;
    bot.path = null;
    bot.thinkTimer = 0;
    bot.reactTimer = 0.1;
    bot.reloading = 0;
    bot.fireTimer = 0;
    bot.burstLeft = 0;
    bot._hitboxes = null;
    bot.onGround = !!game.physics?.hasGroundBelow?.(bot, 0, 0, 0.3);
    bot._chkPos?.copy?.(bot.pos);
    delete bot._deathNotifiedRound;
    const weapon = bot.team === 'CT' ? 'm4a1' : 'ak47';
    game.bots?._giveBotWeapon?.(bot, weapon);
    game.bots?._syncEquipment?.(bot);
    if (bot.group) {
      bot.group.position.copy(bot.pos);
      bot.group.rotation.set(0, bot.yaw + (bot.parts?.character?.yawOffset || 0), 0);
      bot.group.visible = true;
    }
  }

  update(dt) {
    this.seconds += dt;
    for (const [entity, remaining] of this.respawns) {
      const next = remaining - dt;
      if (next > 0) this.respawns.set(entity, next);
      else {
        this.respawns.delete(entity);
        this._respawn(entity);
      }
    }
  }

  getHudState() {
    const all = [this.game.player, ...(this.game.bots?.getBots?.() || [])];
    const leader = all.reduce((best, p) => Math.max(best, p.kills || 0), 0);
    const left = this.respawns.get(this.game.player) || 0;
    return {
      phase: 'live', round: 1, timeLeft: 0, freezeLeft: 0, buyTimeLeft: 0,
      scoreCT: this.game.player.kills || 0, scoreT: leader,
      objective: left > 0 ? `RESPAWN ${left.toFixed(1)}s` : 'DEATHMATCH · BAJAS LIBRES',
      teamAlive: this.game.getAliveCounts(),
      bomb: { planted: false },
      hostages: { total: 0, rescued: 0, carrying: 0 },
    };
  }

  dispose() {
    this.respawns.clear();
  }
}
