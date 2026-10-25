/**
 * RoundManager — flujo de rondas de Counter-Strike 1.6 (browser).
 *
 * Dueño: round-modes. Este archivo contiene TODO el estado de ronda:
 *  - fases freeze (6 s) -> live (115 s) -> over (5 s de intermission) -> matchover
 *  - economía CS 1.6 (ronda ganada, bonus de derrota acumulado, planta, defuse, rescate)
 *  - bomba C4: asignación al portador, plantación (jugador con E / bot automático),
 *    cuenta atrás de 40 s con beeps, defuse (jugador con E / bot automático) y explosión radial
 *  - rehenes de cs_office: creación, escolta (jugador con E / bot automático), seguimiento
 *    con física, zona de rescate y victoria CT
 *  - chequeo de victoria, resultado de ronda y fin de partida
 *  - HUD exacto según GAMEPLAY_API.md / UI_API.md
 *
 * Contrato con bot-ai (solo lectura desde bots.js):
 *   rounds.phase, rounds.roundNumber, rounds.bomb, rounds.siteTarget,
 *   rounds.bombCarrier, rounds.hostages.
 * La detección de plantar/defusear/escoltar vive acá; bots.js solo necesita navegar.
 *
 * No toca game.js, bots.js, weapons.js, mapas, UI ni core.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, choice, distance2D, pointInCircle, pointInRect, disposeObject } from './core/utils.js';

// --- Economía (CS 1.6) -------------------------------------------------------
const START_MONEY = 800;
const WIN_MONEY = 3250;
const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];
const PLANT_REWARD = 300;
const PLANT_LOSS_BONUS = 800;
const DEFUSE_REWARD = 300;
const RESCUE_REWARD = 1000;
const MAX_MONEY = 16000;

// --- Tiempos / reglas --------------------------------------------------------
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const BOT_PLANT_TIME = 1.0;
const PLANT_BOT_SPEED = 0.75;
const DEFUSE_TIME = 10;
const DEFUSE_TIME_KIT = 5;
const DEFUSE_RANGE = 1.9;
const HOSTAGE_COUNT = 2;
const HOSTAGE_FOLLOW_DIST = 1.5;
const HOSTAGE_PICKUP_RANGE = 2.2;
const HOSTAGE_BOT_RANGE = 2.0;
const HOSTAGE_PICKUP_TIME = 0.6;
const HOSTAGE_SPEED = 4.6;
const EXPLOSION_RADIUS = 14;
const EXPLOSION_DAMAGE = 240;
const INTERMISSION_TIME = 5;
const MAX_ROUNDS = 30;

const _tmpVec = new THREE.Vector3();

export class RoundManager {
  constructor(game) {
    this.game = game;

    // --- Campos públicos del contrato ---
    this.phase = 'freeze';
    this.roundNumber = 0;
    this.scoreCT = 0;
    this.scoreT = 0;
    this.bomb = this._makeBombState();
    this.hostages = [];
    this.siteTarget = 'A';
    this.bombCarrier = null;
    this.matchOver = false;
    this.buyTimeLeft = 0;

    // --- Tiempos de la ronda ---
    this.freezeLeft = 0;
    this.timeLeft = 0;
    this.intermissionLeft = 0;
    this.freezeTime = 6;
    this.buyTime = 15;
    this.roundTime = 115;
    this.roundsToWin = 8;
    this.maxRounds = MAX_ROUNDS;
    this.mode = 'bomb';
    this.playerTeam = 'CT';
    this.lossStreak = { CT: 0, T: 0 };

    // --- Estado interno de bomba / rehenes / acciones ---
    this._tPlantBonus = false;
    this._bombBeepTimer = 0;
    this._ledPulse = 0;
    this._beepInterval = 1;
    this._botPlantTimers = new Map();
    this._botDefuseTimers = new Map();
    this._defusingBy = null;
    this._plantingBy = null;
    this._useAction = null;
    this._useTarget = null;
    this._useProgress = 0;
    this._useHold = 0;
    this._useLabel = '';
    this._barVisible = false;
    this._suspendedCheck = false;
    this._roundEnded = false;
    this._roundResult = null;
    this._pendingMatchEnd = false;
    this._matchEndData = null;
    this._rescueZoneCache = null;
    this._lastSiteWarn = false;

    // --- Props 3D (C4 y rehenes) ---
    this._propRoot = new THREE.Group();
    this._propRoot.name = 'round-props';
    if (game.scene?.add) game.scene.add(this._propRoot);
    this._bombMesh = null;
    this._bombLedMat = null;

    this._tmp = new THREE.Vector3();
  }

  // ===========================================================================
  // API pública
  // ===========================================================================

  /** Prepara el marcador, la economía inicial y arranca la primera ronda. */
  startMatch(config = {}) {
    if (!this.game) return;
    const g = this.game;
    const map = g.map;
    const cfg = config || {};
    this.config = cfg;

    this.mode = (cfg.mode || map?.mode) === 'hostage' ? 'hostage' : 'bomb';
    this.roundsToWin = clamp(Math.floor(Number(cfg.roundsToWin) || 8), 1, this.maxRounds);
    this.freezeTime = Math.max(1, Number(cfg.freezeTime) || 6);
    this.buyTime = Math.max(0, Number(cfg.buyTime) || 15);
    this.roundTime = Math.max(30, Number(cfg.roundTime) || 115);
    this.playerTeam = g.player?.team || cfg.team || 'CT';

    this.scoreCT = 0;
    this.scoreT = 0;
    this.roundNumber = 1;
    this.matchOver = false;
    this._pendingMatchEnd = false;
    this._matchEndData = null;
    this._roundResult = null;
    this.lossStreak = { CT: 0, T: 0 };

    // Economía inicial: $800 para todos.
    if (g.player) {
      try {
        g.player.money = START_MONEY;
      } catch {
        /* ignore */
      }
    }
    for (const bot of this._getBots()) bot.money = START_MONEY;

    g.log?.(
      `Partida: ${map?.displayName || map?.id || '??'} · modo ${this.mode} · primera a ${this.roundsToWin}`,
    );
    this.startRound();
  }

  /** Resetea todo y comienza una nueva ronda en fase freeze. */
  startRound() {
    if (!this.game || this.matchOver) return;
    const g = this.game;

    this._clearRoundProps();
    this._hideActionBar();
    this._resetUseState();

    this.phase = 'freeze';
    this.freezeLeft = this.freezeTime;
    this.buyTimeLeft = this.buyTime;
    this.timeLeft = this.roundTime;
    this.intermissionLeft = 0;
    this._roundEnded = false;
    this._roundResult = null;
    this._pendingMatchEnd = false;
    this.bomb = this._makeBombState();
    this.bombCarrier = null;
    this.hostages = [];
    this.siteTarget = this._pickSiteTarget();
    this._tPlantBonus = false;
    this._bombBeepTimer = 0;
    this._ledPulse = 0;
    this._beepInterval = 1;
    this._defusingBy = null;
    this._plantingBy = null;
    this._botPlantTimers.clear();
    this._botDefuseTimers.clear();
    this._rescueZoneCache = this._computeRescueZone();

    const player = g.player;
    const team = player?.team === 'T' || player?.team === 'CT' ? player.team : this.playerTeam;
    this.playerTeam = team;

    // 1) Respawn del jugador.
    if (player) {
      const spawn = this._pickSpawn(team);
      try {
        g.spawnPlayer?.(team, spawn);
      } catch (err) {
        console.warn('[rounds] spawnPlayer', err);
        player.pos?.set?.(spawn.x, spawn.y, spawn.z);
        player.alive = true;
        player.hasBomb = false;
      }
    }

    // 2) Armas: conserva si sobrevivió; si murió ya se hizo dropAll.
    try {
      g.weapons?.resetForRound?.(team);
    } catch (err) {
      console.warn('[rounds] weapons.resetForRound', err);
    }

    // 3) Bots (limpia hasBomb/hasKit/muerte).
    try {
      g.bots?.resetRound?.(this.roundNumber);
    } catch (err) {
      console.warn('[rounds] bots.resetRound', err);
    }
    for (const bot of this._getBots()) bot.hasBomb = false;

    // 4) Bomba / rehenes.
    if (this.mode === 'hostage') this._spawnHostages();
    else this._assignBomb();

    // 5) Avisar al juego (banner de ronda, HUD, audio).
    try {
      g.onRoundStarted?.({
        round: this.roundNumber,
        mode: this.mode,
        scoreCT: this.scoreCT,
        scoreT: this.scoreT,
        freezeTime: this.freezeTime,
      });
    } catch (err) {
      console.error('[rounds] onRoundStarted', err);
    }
    g.log?.(`Ronda ${this.roundNumber} · ${this.mode === 'hostage' ? 'rescate de rehenes' : 'bomba C4'}`);
  }

  /** Tick principal. */
  update(dt) {
    if (!this.game) return;
    if (this.phase === 'matchover') return;

    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    // --- Intermission / fin de partida ---
    if (this.phase === 'over') {
      this.intermissionLeft = Math.max(0, this.intermissionLeft - step);
      if (this.intermissionLeft <= 0) {
        if (this._pendingMatchEnd) this._showMatchEnd();
        else {
          this.roundNumber++;
          this.startRound();
        }
      }
      return;
    }

    const player = this.game.player;
    this.playerTeam = player?.team === 'CT' || player?.team === 'T' ? player.team : this.playerTeam;

    // Tiempo de compra (corre desde el inicio de la ronda).
    if (this.buyTimeLeft > 0) this.buyTimeLeft = Math.max(0, this.buyTimeLeft - step);

    // --- Freeze ---
    if (this.phase === 'freeze') {
      this.freezeLeft = Math.max(0, this.freezeLeft - step);
      this._syncBombCarrierPos();
      if (this.freezeLeft <= 0) {
        this.phase = 'live';
        this.game.toast?.('¡Ronda en vivo!');
      }
      return;
    }

    if (this.phase !== 'live') return;

    // --- Ronda en vivo ---
    // Flags de acción: cada sistema los vuelve a marcar si corresponde.
    this.bomb.planting = false;
    this.bomb.plantProgress = 0;
    this.bomb.defusing = false;
    this.bomb.defuseProgress = 0;

    if (this.bomb.planted) this.timeLeft = Math.max(0, this.bomb.timeLeft);
    else this.timeLeft = Math.max(0, this.timeLeft - step);

    if (!this.bomb.planted && this.bombCarrier && !this.bombCarrier.alive) this._reassignBomb();
    this._syncBombCarrierPos();

    this._updateBombTimers(step);
    if (this.phase !== 'live') return;

    this._updatePlayerUse(step);
    if (this.phase !== 'live') return;

    this._updateHostages(step);
    if (this.phase !== 'live') return;

    this._checkRoundEnd();
    if (this.phase !== 'live') return;

    this._checkTimeout();
  }

  /** HUD de ronda exacto según el contrato. */
  getHudState() {
    const g = this.game;
    let counts = { CT: 0, T: 0 };
    try {
      const c = g?.getAliveCounts?.();
      if (c) counts = { CT: Number(c.CT) || 0, T: Number(c.T) || 0 };
      else counts = this._countAlive();
    } catch {
      counts = this._countAlive();
    }

    const bomb = this.bomb || this._makeBombState();
    const total = this.hostages?.length || 0;
    const rescued = this.hostages?.filter((h) => h.rescued).length || 0;
    const carrying =
      this.hostages?.filter((h) => !h.rescued && h.following && h.carrier).length || 0;

    return {
      phase: this.phase,
      round: this.roundNumber,
      roundNumber: this.roundNumber,
      timeLeft: Math.max(0, this.timeLeft),
      freezeLeft: Math.max(0, this.freezeLeft),
      buyTimeLeft: Math.max(0, this.buyTimeLeft),
      scoreCT: this.scoreCT,
      scoreT: this.scoreT,
      objective: this._getObjective(),
      teamAlive: counts,
      bomb: {
        planted: !!bomb.planted,
        site: bomb.site || null,
        timeLeft: Math.max(0, bomb.timeLeft || 0),
        x: Number.isFinite(bomb.x) ? bomb.x : 0,
        z: Number.isFinite(bomb.z) ? bomb.z : 0,
        defusing: !!bomb.defusing,
        defuseProgress: clamp(bomb.defuseProgress || 0, 0, 1),
        planting: !!bomb.planting,
        plantProgress: clamp(bomb.plantProgress || 0, 0, 1),
        plantedBy: bomb.plantedBy || null,
        exploded: !!bomb.exploded,
        defused: !!bomb.defused,
      },
      hostages: { total, rescued, carrying },
      message: this._getMessage(),
      // Extra (la UI lo ignora si no lo necesita).
      mode: this.mode,
      scores: { CT: this.scoreCT, T: this.scoreT },
    };
  }

  getScoreboardData() {
    try {
      return this.game?.getScoreboardData?.() || null;
    } catch {
      return null;
    }
  }

  /** El jugador solo controla en ronda viva y estando vivo. */
  canControlPlayer() {
    return (
      !!this.game &&
      this.phase === 'live' &&
      !this.matchOver &&
      !!this.game.player &&
      this.game.player.alive === true
    );
  }

  /** game.notifyKill() ya sumó kills/deaths; acá solo chequeamos la ronda. */
  onPlayerKilled() {
    if (!this.game || this.phase !== 'live' || this._roundEnded) return;
    for (const h of this.hostages) {
      if (h.carrier === this.game.player) {
        h.carrier = null;
        h.following = false;
        h.carrierId = null;
      }
    }
    this._reassignBomb();
    this._checkRoundEnd();
  }

  onBotKilled(bot) {
    if (!this.game || this.phase !== 'live' || this._roundEnded || !bot) return;
    if (bot === this.bombCarrier) {
      bot.hasBomb = false;
      this.bombCarrier = null;
    }
    for (const h of this.hostages) {
      if (h.carrier === bot) {
        h.carrier = null;
        h.following = false;
        h.carrierId = null;
      }
    }
    this._reassignBomb();
    this._checkRoundEnd();
  }

  // Hooks opcionales del contrato (por si bots.js prefiere avisar explícitamente).
  notifyBombPlanted(site) {
    if (!this.game || this.phase !== 'live' || this.bomb.planted) return;
    const planter = this.bombCarrier || this.game.player;
    let siteObj = null;
    if (typeof site === 'string') siteObj = this._getSiteByName(site) || { name: site };
    else if (site && typeof site === 'object') siteObj = site;
    if (!siteObj) siteObj = this._getSiteByName(this.siteTarget) || { name: this.siteTarget };
    this._plantBomb(planter, siteObj);
  }

  notifyBombDefused() {
    if (!this.game || !this.bomb.planted || this.bomb.defused) return;
    if (this.game.player?.team !== 'CT') return;
    this._defuseBomb(this._defusingBy || this.game.player);
  }

  notifyHostageRescued(hostage) {
    if (!this.game) return;
    const h =
      hostage && typeof hostage === 'object' ? hostage : this.hostages.find((x) => x.id === hostage);
    if (h) this._rescueHostage(h);
  }

  /** Libera mallas, timers y referencias. */
  dispose() {
    if (!this.game) return;
    this._cancelUse();
    this._hideActionBar();
    this._clearRoundProps();
    if (this._propRoot) {
      disposeObject(this._propRoot);
      this._propRoot = null;
    }
    this._bombMesh = null;
    this._bombLedMat = null;
    this._botPlantTimers.clear();
    this._botDefuseTimers.clear();
    this.hostages = [];
    this.bomb = this._makeBombState();
    this.bombCarrier = null;
    this._pendingMatchEnd = false;
    this._matchEndData = null;
    this.phase = 'matchover';
    this.game = null;
  }

  // ===========================================================================
  // Arranque de ronda: spawns, bomba y rehenes
  // ===========================================================================

  _assignBomb() {
    const g = this.game;
    const player = g.player;
    if (!player) {
      this.bombCarrier = null;
      return;
    }
    if (player.team === 'T' && player.alive) {
      player.hasBomb = true;
      this.bombCarrier = player;
      return;
    }
    const tBots = this._getBots().filter((b) => b.alive && b.team === 'T');
    if (!tBots.length) {
      this.bombCarrier = null;
      return;
    }
    const bot = choice(tBots);
    bot.hasBomb = true;
    this.bombCarrier = bot;
    try {
      g.bots?.setBombCarrier?.(bot);
    } catch (err) {
      console.warn('[rounds] setBombCarrier', err);
    }
  }

  /** Si el portador muere y la bomba no está plantada, se la lleva otro T vivo. */
  _reassignBomb() {
    if (!this.game || this.mode === 'hostage' || this.bomb.planted) return;
    const prev = this.bombCarrier;
    if (prev && prev.alive && prev.hasBomb) return;
    if (prev) prev.hasBomb = false;
    this.bombCarrier = null;

    const g = this.game;
    const player = g.player;
    if (player?.alive && player.team === 'T') {
      player.hasBomb = true;
      this.bombCarrier = player;
      return;
    }
    const tBots = this._getBots().filter((b) => b.alive && b.team === 'T' && b !== prev);
    if (!tBots.length) return;
    const bot = choice(tBots);
    bot.hasBomb = true;
    this.bombCarrier = bot;
    try {
      g.bots?.setBombCarrier?.(bot);
    } catch {
      /* ignore */
    }
    g.log?.('La C4 cambió de portador');
  }

  _syncBombCarrierPos() {
    const bomb = this.bomb;
    if (!bomb || bomb.planted) return;
    const carrier = this.bombCarrier;
    if (carrier?.pos) {
      bomb.x = carrier.pos.x;
      bomb.z = carrier.pos.z;
    }
  }

  _pickSpawn(team) {
    const spawns = this.game?.map?.spawns?.[team] || this.game?.map?.spawns?.CT;
    if (Array.isArray(spawns) && spawns.length) {
      const s = spawns[Math.floor(Math.random() * spawns.length)] || spawns[0];
      return { x: s.x ?? 0, y: s.y ?? 0.05, z: s.z ?? 0, yaw: s.yaw ?? 0 };
    }
    return { x: 0, y: 0.05, z: 0, yaw: 0 };
  }

  _pickSiteTarget() {
    const sites = this.game?.map?.bombsites;
    if (Array.isArray(sites) && sites.length) {
      const s = sites[Math.floor(Math.random() * sites.length)];
      if (s?.name) return s.name;
    }
    return Math.random() < 0.5 ? 'A' : 'B';
  }

  _computeRescueZone() {
    const map = this.game?.map;
    if (map?.rescueZone && typeof map.rescueZone.x === 'number') return map.rescueZone;
    const spawn = map?.spawns?.CT?.[0];
    if (spawn) return { x: spawn.x, z: spawn.z, radius: 4 };
    return null;
  }

  _spawnHostages() {
    const g = this.game;
    const map = g?.map;
    let spots = Array.isArray(map?.hostageSpawns) ? map.hostageSpawns.slice() : [];
    if (!spots.length && Array.isArray(map?.waypoints)) {
      spots = map.waypoints.filter((w) => (w.tags || []).includes('hostage')).slice(0, HOSTAGE_COUNT);
    }
    if (!spots.length) {
      // Fallback: cerca del centro del mapa para no romper el modo si el mapa aún no expone spawns.
      const b = map?.bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      spots = [
        { id: 'h1', x: cx - 3, z: cz },
        { id: 'h2', x: cx + 3, z: cz },
      ];
    }

    for (let i = 0; i < HOSTAGE_COUNT; i++) {
      const spot = spots[i % spots.length] || { x: 0, z: 0 };
      const offsetX = i >= spots.length ? i * 1.4 : 0;
      const pos = new THREE.Vector3(
        (spot.x ?? 0) + offsetX,
        spot.y ?? 0.05,
        spot.z ?? 0,
      );
      const body = {
        pos,
        vel: new THREE.Vector3(),
        radius: 0.32,
        height: 1.7,
        standHeight: 1.7,
        stepHeight: 0.4,
        onGround: false,
      };
      const h = {
        id: spot.id ?? `h${i + 1}`,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        pos,
        body,
        rescued: false,
        following: false,
        carrier: null,
        carrierId: null,
        speed: 0,
        trail: [],
        _lastCarrier: null,
        _stuckTimer: 0,
        mesh: null,
      };
      this._createHostageMesh(h);
      this.hostages.push(h);
    }
  }

  // ===========================================================================
  // Bomba C4
  // ===========================================================================

  _makeBombState() {
    return {
      planted: false,
      plantedBy: null,
      site: null,
      x: 0,
      y: 0.05,
      z: 0,
      timeLeft: 0,
      defusing: false,
      defuseProgress: 0,
      planting: false,
      plantProgress: 0,
      exploded: false,
      defused: false,
    };
  }

  _getSiteByName(name) {
    const sites = this.game?.map?.bombsites;
    if (!Array.isArray(sites)) return null;
    return sites.find((s) => s.name === name) || null;
  }

  /** Devuelve el bombsite que contiene (x,z) o null. */
  _siteAt(x, z) {
    const sites = this.game?.map?.bombsites;
    if (!Array.isArray(sites) || !sites.length) {
      // Mapa aún sin bombsites: permitir plantar en cualquier lado (fallback).
      if (!this._lastSiteWarn) {
        this._lastSiteWarn = true;
        console.warn('[rounds] El mapa no expone bombsites; se permite plantar en cualquier lugar.');
      }
      return { name: this.siteTarget, x, z, radius: 99999 };
    }
    for (const s of sites) {
      if (s.min && s.max) {
        if (pointInRect(x, z, s.min, s.max)) return s;
      }
      if (pointInCircle(x, z, s.x ?? 0, s.z ?? 0, s.radius ?? 5)) return s;
    }
    return null;
  }

  _updateBombTimers(dt) {
    const bomb = this.bomb;
    if (bomb.planted) {
      bomb.timeLeft = Math.max(0, bomb.timeLeft - dt);
      this.timeLeft = bomb.timeLeft;
      this._updateBeeps(dt);
      this._updateBotDefuse(dt);
      if (this.phase !== 'live') return;
      if (bomb.timeLeft <= 0) this._explodeBomb();
      return;
    }
    this._updateBotPlant(dt);
  }

  /** Plantación automática de un bot T portador quieto dentro del sitio (1 s). */
  _updateBotPlant(dt) {
    const bomb = this.bomb;
    if (bomb.planted) return;
    const carrier = this.bombCarrier;
    if (!carrier || carrier.isPlayer || !carrier.alive || carrier.team !== 'T') return;
    if (!carrier.hasBomb) return;

    const site = this._siteAt(carrier.pos.x, carrier.pos.z);
    const speed = Math.hypot(carrier.vel?.x || 0, carrier.vel?.z || 0);
    const key = carrier.id ?? 'bot';
    if (site && speed < PLANT_BOT_SPEED) {
      const t = (this._botPlantTimers.get(key) || 0) + dt;
      this._botPlantTimers.set(key, t);
      bomb.planting = true;
      bomb.plantProgress = Math.max(bomb.plantProgress || 0, clamp(t / BOT_PLANT_TIME, 0, 1));
      if (t >= BOT_PLANT_TIME) this._plantBomb(carrier, site);
    } else {
      this._botPlantTimers.delete(key);
    }
  }

  _plantBomb(planter, site) {
    if (!this.game || this.phase !== 'live' || this.bomb.planted) return;
    const bomb = this.bomb;
    const pos = planter?.pos || this.game.player?.pos || { x: 0, z: 0 };
    const siteName = (site && site.name) || this.siteTarget;

    bomb.planted = true;
    bomb.plantedBy = planter?.name || '???';
    bomb.site = siteName;
    bomb.x = pos.x;
    bomb.y = 0.05;
    bomb.z = pos.z;
    bomb.timeLeft = BOMB_TIME;
    bomb.planting = false;
    bomb.plantProgress = 1;
    bomb.defused = false;
    bomb.exploded = false;
    this.timeLeft = BOMB_TIME;
    this._bombBeepTimer = 0;
    this._ledPulse = 0;
    this._beepInterval = 1;
    this._tPlantBonus = true;
    this._plantingBy = null;
    this._botPlantTimers.clear();
    this._resetUseState();
    this._hideActionBar();

    if (planter) planter.hasBomb = false;
    if (this.bombCarrier === planter) this.bombCarrier = null;
    for (const bot of this._getBots()) {
      if (bot !== planter) bot.hasBomb = false;
    }

    this._createBombMesh(bomb.x, bomb.z);
    this._rewardPlanter(planter);

    try {
      this.game.audio?.play?.('bomb_plant', { volume: 1 });
    } catch {
      /* ignore */
    }
    this.game.toast?.(`La C4 fue plantada en el sitio ${siteName}`);
    this.game.ui?.showCenterMessage?.(`C4 PLANTADA · SITIO ${siteName}`, 2200);
    this.game.log?.(`C4 plantada en ${siteName} por ${bomb.plantedBy}`);
  }

  _rewardPlanter(planter) {
    if (!planter) return;
    if (planter.isPlayer) {
      this.game.player?.addMoney?.(PLANT_REWARD);
    } else {
      planter.money = clamp((planter.money || 0) + PLANT_REWARD, 0, MAX_MONEY);
    }
  }

  /** Bot CT vivo cerca de la C4 la desactiva automáticamente (10 s / 5 s con kit). */
  _updateBotDefuse(dt) {
    const bomb = this.bomb;
    if (!bomb.planted || this.phase !== 'live') return;

    let best = null;
    let bestD = Infinity;
    for (const bot of this._getBots()) {
      if (!bot.alive || bot.team !== 'CT') continue;
      const d = distance2D(bot.pos.x, bot.pos.z, bomb.x, bomb.z);
      if (d <= DEFUSE_RANGE && d < bestD) {
        best = bot;
        bestD = d;
      }
    }

    const id = best?.id ?? null;
    for (const key of [...this._botDefuseTimers.keys()]) {
      if (key !== id) this._botDefuseTimers.delete(key);
    }
    if (!best) return;

    const duration = best.hasKit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
    const t = (this._botDefuseTimers.get(id) || 0) + dt;
    this._botDefuseTimers.set(id, t);
    bomb.defusing = true;
    bomb.defuseProgress = Math.max(bomb.defuseProgress || 0, clamp(t / duration, 0, 1));
    this._defusingBy = best;
    if (t >= duration) this._defuseBomb(best);
  }

  _defuseBomb(defuser) {
    if (!this.game || this.phase !== 'live' || !this.bomb.planted || this.bomb.defused) return;
    const bomb = this.bomb;
    bomb.defused = true;
    bomb.defusing = false;
    bomb.defuseProgress = 1;
    this._defusingBy = defuser || null;
    this._botDefuseTimers.clear();
    this._resetUseState();
    this._hideActionBar();

    if (defuser) {
      if (defuser.isPlayer) this.game.player?.addMoney?.(DEFUSE_REWARD);
      else defuser.money = clamp((defuser.money || 0) + DEFUSE_REWARD, 0, MAX_MONEY);
    }
    if (this._bombLedMat) {
      this._bombLedMat.color?.setHex?.(0x3dff68);
      this._bombLedMat.emissive?.setHex?.(0x3dff68);
      this._bombLedMat.emissiveIntensity = 1.2;
    }
    try {
      this.game.audio?.play?.('bomb_defuse', { volume: 1 });
    } catch {
      /* ignore */
    }
    this.game.toast?.('¡La C4 fue desactivada!');
    this.game.log?.('C4 desactivada');
    this.endRound('CT', 'La C4 fue desactivada', 'bomb_defused', {
      defuser: defuser?.name || null,
    });
  }

  _explodeBomb() {
    if (!this.game || this.phase !== 'live' || !this.bomb.planted || this.bomb.exploded) return;
    const g = this.game;
    const bomb = this.bomb;
    bomb.exploded = true;
    bomb.defusing = false;
    bomb.defuseProgress = 0;
    this._botDefuseTimers.clear();
    this._resetUseState();
    this._hideActionBar();

    const pos = this._tmp.set(bomb.x, 0.35, bomb.z).clone();
    try {
      if (g.effects?.explosion) g.effects.explosion(pos);
      else g.audio?.play?.('explosion');
    } catch (err) {
      console.warn('[rounds] explosion effect', err);
    }

    const damageAt = (x, y, z) => {
      const d = Math.hypot(x - bomb.x, (y ?? 0) - 0.35, z - bomb.z);
      if (d >= EXPLOSION_RADIUS) return 0;
      const f = 1 - d / EXPLOSION_RADIUS;
      return Math.max(1, Math.round(EXPLOSION_DAMAGE * f * f));
    };

    // Evita que notifyKill -> onPlayerKilled/onBotKilled cierren la ronda antes de tiempo.
    this._suspendedCheck = true;
    const player = g.player;
    if (player?.alive) {
      const dmg = damageAt(player.pos.x, player.pos.y, player.pos.z);
      if (dmg > 0) {
        try {
          g.damagePlayer?.(dmg, null, 'chest', 'c4');
        } catch (err) {
          console.warn('[rounds] damagePlayer c4', err);
        }
      }
    }
    for (const bot of this._getBots()) {
      if (!bot.alive) continue;
      const dmg = damageAt(bot.pos.x, bot.pos.y, bot.pos.z);
      if (dmg > 0) {
        try {
          g.damageBot?.(bot, dmg, null, 'chest', 'c4');
        } catch (err) {
          console.warn('[rounds] damageBot c4', err);
        }
      }
    }
    this._suspendedCheck = false;

    this._removeBombMesh();
    this.game.log?.('La C4 explotó');
    this.endRound('T', 'La C4 explotó', 'bomb_exploded');
  }

  _updateBeeps(dt) {
    const bomb = this.bomb;
    this._ledPulse = Math.max(0, this._ledPulse - dt * 8);
    if (this._bombLedMat) this._bombLedMat.emissiveIntensity = 0.25 + this._ledPulse * 5;

    this._bombBeepTimer -= dt;
    if (this._bombBeepTimer > 0) return;

    const t = bomb.timeLeft;
    this._beepInterval = t < 10 ? clamp(0.12 + (t / 10) * 0.88, 0.12, 1) : 1;
    this._bombBeepTimer = this._beepInterval;
    this._ledPulse = 1;

    const player = this.game?.player;
    let pan = 0;
    if (player?.pos) {
      const dx = bomb.x - player.pos.x;
      const dz = bomb.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const rx = Math.cos(player.yaw || 0);
      const rz = -Math.sin(player.yaw || 0);
      pan = clamp((dx * rx + dz * rz) / d, -0.9, 0.9) * clamp(1 - d / 50, 0, 1);
    }
    const volume = 0.4 + clamp(1 - t / BOMB_TIME, 0, 1) * 0.6;
    try {
      this.game.audio?.play?.('bomb_beep', { volume, pan });
    } catch {
      /* ignore */
    }
    try {
      this.game.effects?.bombBeepLight?.(this._tmp.set(bomb.x, 0.25, bomb.z), 0xff2020);
    } catch {
      /* ignore */
    }
  }

  // ===========================================================================
  // Interacción del jugador (E): plantar / defusear / escoltar
  // ===========================================================================

  _updatePlayerUse(dt) {
    const g = this.game;
    const p = g?.player;
    const input = g?.input;
    if (!p || !p.alive) {
      this._cancelUse();
      return;
    }

    // 1) Elegir acción contextual.
    let action = null;
    let target = null;
    let hold = 0;
    let label = '';

    if (p.team === 'CT' && this.bomb.planted && !this.bomb.defused && !this.bomb.exploded) {
      if (distance2D(p.pos.x, p.pos.z, this.bomb.x, this.bomb.z) <= DEFUSE_RANGE) {
        action = 'defuse';
        hold = p.hasDefuseKit ? DEFUSE_TIME_KIT : DEFUSE_TIME;
        label = 'Desactivando C4';
      }
    } else if (p.team === 'T' && p.hasBomb && !this.bomb.planted) {
      const site = this._siteAt(p.pos.x, p.pos.z);
      if (site) {
        action = 'plant';
        target = site;
        hold = PLANT_TIME;
        label = 'Plantando C4';
      }
    } else if (p.team === 'CT' && this.mode === 'hostage') {
      const h = this._findFreeHostage(p.pos.x, p.pos.z, HOSTAGE_PICKUP_RANGE);
      if (h) {
        action = 'hostage';
        target = h;
        hold = HOSTAGE_PICKUP_TIME;
        label = 'Tomando rehén';
      }
    }

    if (!action) {
      this._cancelUse();
      return;
    }

    if (action !== this._useAction || target !== this._useTarget) {
      this._useAction = action;
      this._useTarget = target;
      this._useHold = hold;
      this._useLabel = label;
      this._useProgress = 0;
    }

    // 2) Mantener E.
    const holding = !!input?.isDown?.('KeyE') && input?.locked !== false;
    if (!holding) {
      this._useProgress = 0;
      this._useAction = null;
      this._useTarget = null;
      this._hideActionBar();
      if (action === 'plant') this._plantingBy = null;
      return;
    }

    this._useProgress = clamp(this._useProgress + dt / Math.max(0.05, hold), 0, 1);
    this._barVisible = true;
    try {
      g.showActionProgress?.(label, this._useProgress);
    } catch {
      /* ignore */
    }

    if (action === 'plant') {
      this._plantingBy = p;
      this.bomb.planting = true;
      this.bomb.plantProgress = Math.max(this.bomb.plantProgress || 0, this._useProgress);
    } else if (action === 'defuse') {
      this._defusingBy = p;
      this.bomb.defusing = true;
      this.bomb.defuseProgress = Math.max(this.bomb.defuseProgress || 0, this._useProgress);
    }

    if (this._useProgress < 1) return;

    // 3) Completar acción.
    const done = action;
    const tgt = target;
    this._hideActionBar();
    this._resetUseState();
    if (done === 'plant') this._plantBomb(p, tgt);
    else if (done === 'defuse') this._defuseBomb(p);
    else if (done === 'hostage') this._pickupHostage(tgt, p);
  }

  _resetUseState() {
    this._useAction = null;
    this._useTarget = null;
    this._useProgress = 0;
    this._useHold = 0;
    this._useLabel = '';
    this._plantingBy = null;
  }

  _cancelUse() {
    this._resetUseState();
    this._hideActionBar();
  }

  _hideActionBar() {
    if (!this._barVisible) return;
    this._barVisible = false;
    try {
      this.game?.hideActionProgress?.();
    } catch {
      /* ignore */
    }
  }

  _findFreeHostage(x, z, range) {
    let best = null;
    let bestD = range;
    for (const h of this.hostages) {
      if (h.rescued || h.following) continue;
      const d = distance2D(x, z, h.pos.x, h.pos.z);
      if (d <= bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  _pickupHostage(h, carrier) {
    if (!h || h.rescued || !carrier) return;
    h.following = true;
    h.carrier = carrier;
    h.carrierId = carrier.isPlayer ? 'player' : carrier.id ?? null;
    h.trail = carrier.pos ? [{ x: carrier.pos.x, z: carrier.pos.z }] : [];
    h._lastCarrier = carrier;
    try {
      this.game.audio?.play?.('hostage', { volume: 0.7 });
    } catch {
      /* ignore */
    }
    this.game.toast?.('Rehén siguiéndote · llevalo a la zona de rescate');
  }

  // ===========================================================================
  // Rehenes
  // ===========================================================================

  _getBots() {
    try {
      const list = this.game?.bots?.getBots?.();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  _resolveCarrier(h) {
    let c = h.carrier;
    if (!c && h.following && typeof h.following === 'object') c = h.following;
    if (!c) return null;
    if (typeof c === 'object') return c.pos ? c : null;
    const g = this.game;
    if (g?.player && (c === 'player' || c === g.player.id || c === g.player.name)) return g.player;
    return this._getBots().find((b) => b.id === c || b.name === c) || null;
  }

  _updateHostages(dt) {
    if (this.mode !== 'hostage' || !this.hostages.length) return;
    const g = this.game;
    const zone = this._rescueZoneCache || this._computeRescueZone();

    for (const h of this.hostages) {
      if (h.rescued) continue;

      // Normalizar escrituras externas (bot-ai puede setear following/carrier).
      if (h.following && typeof h.following === 'object' && !h.carrier) h.carrier = h.following;
      let carrier = this._resolveCarrier(h);
      if (carrier && (carrier.alive !== true || carrier.team !== 'CT')) carrier = null;
      if (!carrier) {
        // Auto-escolta: bot CT cerca de un rehén libre.
        const bot = this._nearestAliveBot('CT', h.pos.x, h.pos.z, HOSTAGE_BOT_RANGE);
        if (bot) {
          h.carrier = bot;
          h.following = true;
          h.carrierId = bot.id;
          try {
            g.audio?.play?.('hostage', { volume: 0.5 });
          } catch {
            /* ignore */
          }
        } else {
          h.carrier = null;
          h.following = false;
          h.carrierId = null;
        }
      } else {
        h.carrier = carrier;
        h.following = true;
      }

      // Seguimiento con física. Usa un "rastro" (breadcrumbs) del portador para
      // rodear esquinas/paredes en lugar de ir en línea recta contra la geometría.
      const body = h.body;
      let vx = 0;
      let vz = 0;
      if (carrier !== h._lastCarrier) {
        h._lastCarrier = carrier || null;
        h.trail = [];
      }
      if (carrier?.pos) {
        if (!h.trail) h.trail = [];
        const trail = h.trail;
        if (!trail.length) {
          trail.push({ x: carrier.pos.x, z: carrier.pos.z });
        } else {
          const last = trail[trail.length - 1];
          if (distance2D(last.x, last.z, carrier.pos.x, carrier.pos.z) > 0.4) {
            trail.push({ x: carrier.pos.x, z: carrier.pos.z });
            if (trail.length > 120) trail.splice(0, trail.length - 120);
          }
        }
        let guard = 0;
        while (
          trail.length > 1 &&
          guard++ < 8 &&
          distance2D(h.pos.x, h.pos.z, trail[0].x, trail[0].z) < 0.5
        ) {
          trail.shift();
        }
        const tgt = trail[0];
        if (tgt) {
          const dx = tgt.x - h.pos.x;
          const dz = tgt.z - h.pos.z;
          const d = Math.hypot(dx, dz);
          const dCarrier = distance2D(h.pos.x, h.pos.z, carrier.pos.x, carrier.pos.z);
          const isCarrierPoint = trail.length === 1;
          if (d > 0.4 && !(isCarrierPoint && dCarrier <= HOSTAGE_FOLLOW_DIST + 0.25)) {
            const inv = 1 / d;
            const speed = clamp(dCarrier * 1.4, 1.6, HOSTAGE_SPEED * (dCarrier > 9 ? 1.15 : 1));
            vx = dx * inv * speed;
            vz = dz * inv * speed;
          }
        }
      } else {
        h.trail = [];
      }
      body.vel.x = vx;
      body.vel.z = vz;
      body.vel.y = (body.vel.y || 0) - 18 * dt;
      if (body.onGround && body.vel.y < 0) body.vel.y = 0;
      const prevX = h.pos.x;
      const prevZ = h.pos.z;
      try {
        g.physics?.moveBody?.(body, dt);
      } catch (err) {
        console.warn('[rounds] physics.moveBody rehén', err);
      }
      if (!Number.isFinite(body.pos.y) || body.pos.y < -6) {
        body.pos.y = 0.05;
        body.vel.y = 0;
      }

      // Anti-atasco (esquinas): si el rehén no avanza, se lo recoloca detrás del portador.
      const moved = distance2D(prevX, prevZ, h.pos.x, h.pos.z);
      if (carrier?.pos && (vx !== 0 || vz !== 0) && moved < 0.008) {
        h._stuckTimer = (h._stuckTimer || 0) + dt;
      } else {
        h._stuckTimer = Math.max(0, (h._stuckTimer || 0) - dt * 2);
      }
      if (h._stuckTimer > 1.6 && carrier?.pos) this._unstuckHostage(h, carrier);

      h.x = body.pos.x;
      h.y = body.pos.y;
      h.z = body.pos.z;
      h.speed = Math.hypot(vx, vz);

      if (h.mesh) {
        h.mesh.position.set(h.pos.x, h.pos.y, h.pos.z);
        if (carrier?.pos) {
          h.mesh.rotation.y = Math.atan2(
            carrier.pos.x - h.pos.x,
            carrier.pos.z - h.pos.z,
          );
        }
      }

      // Rescate: el rehén entra en la zona, o el portador (jugador/bot) llega a la
      // zona con el rehén pegado detrás (CS 1.6: el que rescata llega a la zona).
      if (zone) {
        const r = zone.radius ?? 3;
        let shouldRescue = pointInCircle(h.pos.x, h.pos.z, zone.x, zone.z, r);
        if (
          !shouldRescue &&
          carrier?.pos &&
          pointInCircle(carrier.pos.x, carrier.pos.z, zone.x, zone.z, r) &&
          distance2D(h.pos.x, h.pos.z, carrier.pos.x, carrier.pos.z) <= 3.5
        ) {
          shouldRescue = true;
        }
        if (shouldRescue) {
          this._rescueHostage(h);
          if (this.phase !== 'live') return;
        }
      }
    }
  }

  /** Recoloca un rehén atascado detrás del portador (como hace CS 1.6). */
  _unstuckHostage(h, carrier) {
    h._stuckTimer = 0;
    h.trail = [];
    const cx = carrier?.pos?.x ?? h.pos.x;
    const cz = carrier?.pos?.z ?? h.pos.z;
    const yaw = carrier?.yaw || 0;
    let tx = cx + Math.sin(yaw) * 0.9;
    let tz = cz + Math.cos(yaw) * 0.9;
    const free = this.game?.physics?.isPositionFree?.({ x: tx, y: 0.05, z: tz }, 0.34, 1.7);
    if (free === false) {
      tx = cx;
      tz = cz;
    }
    h.pos.set(tx, 0.05, tz);
    h.body.vel.set(0, 0, 0);
    h.body.onGround = false;
    if (carrier?.pos) h.trail.push({ x: carrier.pos.x, z: carrier.pos.z });
  }

  _nearestAliveBot(team, x, z, range) {
    let best = null;
    let bestD = range;
    for (const bot of this._getBots()) {
      if (!bot.alive || bot.team !== team) continue;
      const d = distance2D(x, z, bot.pos.x, bot.pos.z);
      if (d <= bestD) {
        bestD = d;
        best = bot;
      }
    }
    return best;
  }

  _rescueHostage(h) {
    if (!this.game || !h || h.rescued) return;
    h.rescued = true;
    h.following = false;
    const carrier = h.carrier;
    h.carrier = null;
    h.carrierId = null;
    if (h.mesh) {
      disposeObject(h.mesh);
      h.mesh = null;
    }
    try {
      this.game.audio?.play?.('hostage', { volume: 1 });
    } catch {
      /* ignore */
    }

    // Recompensa al rescatista (CS 1.6: $1000 por rehén).
    if (carrier) {
      if (carrier.isPlayer) this.game.player?.addMoney?.(RESCUE_REWARD);
      else carrier.money = clamp((carrier.money || 0) + RESCUE_REWARD, 0, MAX_MONEY);
    }

    const total = this.hostages.length;
    const rescued = this.hostages.filter((x) => x.rescued).length;
    this.game.toast?.(`Rehén rescatado (${rescued}/${total})`);
    this.game.ui?.showCenterMessage?.(`REHÉN RESCATADO (${rescued}/${total})`, 1600);
    this.game.log?.(`Rehén ${h.id} rescatado (${rescued}/${total})`);

    if (total > 0 && rescued >= total) {
      this.endRound('CT', 'Todos los rehenes rescatados', 'hostages');
    }
  }

  // ===========================================================================
  // Fin de ronda / partida
  // ===========================================================================

  _countAlive() {
    const counts = { CT: 0, T: 0 };
    const player = this.game?.player;
    if (player?.alive && (player.team === 'CT' || player.team === 'T')) counts[player.team]++;
    for (const bot of this._getBots()) {
      if (bot.alive && (bot.team === 'CT' || bot.team === 'T')) counts[bot.team]++;
    }
    return counts;
  }

  _checkRoundEnd() {
    if (!this.game || this.phase !== 'live' || this._roundEnded || this._suspendedCheck) return;
    let counts;
    try {
      counts = this.game.getAliveCounts?.() || this._countAlive();
    } catch {
      counts = this._countAlive();
    }
    const ctAlive = Number(counts.CT) || 0;
    const tAlive = Number(counts.T) || 0;

    if (this.mode === 'hostage') {
      const total = this.hostages.length;
      const rescued = this.hostages.filter((h) => h.rescued).length;
      if (total > 0 && rescued >= total) {
        this.endRound('CT', 'Todos los rehenes rescatados', 'hostages');
        return;
      }
      if (ctAlive <= 0) {
        this.endRound('T', 'Todos los CT eliminados', 'elimination');
        return;
      }
      if (tAlive <= 0) {
        this.endRound('CT', 'Todos los T eliminados', 'elimination');
        return;
      }
      return;
    }

    // Bomba plantada: no termina por T muertos, hay que desactivar o esperar la explosión.
    if (this.bomb.planted) {
      if (ctAlive <= 0) this.endRound('T', 'Todos los CT eliminados', 'elimination');
      return;
    }
    if (ctAlive <= 0) {
      this.endRound('T', 'Todos los CT eliminados', 'elimination');
      return;
    }
    if (tAlive <= 0) {
      this.endRound('CT', 'Todos los T eliminados', 'elimination');
    }
  }

  _checkTimeout() {
    if (this.phase !== 'live' || this._roundEnded) return;
    if (this.mode === 'hostage') {
      if (this.timeLeft <= 0) this.endRound('T', 'Tiempo agotado', 'timeout');
      return;
    }
    if (!this.bomb.planted && this.timeLeft <= 0) {
      this.endRound('CT', 'Tiempo agotado', 'timeout');
    }
  }

  endRound(winner, reason, reasonKey = '', extra = {}) {
    if (!this.game || this.phase !== 'live' || this._roundEnded) return;
    this._roundEnded = true;
    this.phase = 'over';
    this._hideActionBar();
    this._cancelUse();

    if (winner === 'CT') this.scoreCT++;
    else if (winner === 'T') this.scoreT++;

    const bomb = this.bomb;
    this.bomb.planting = false;
    this.bomb.plantProgress = bomb.planted ? 1 : 0;
    this.bomb.defusing = false;
    this.bomb.defuseProgress = bomb.defused ? 1 : 0;
    this._plantingBy = null;
    this._defusingBy = null;
    this._botPlantTimers.clear();
    this._botDefuseTimers.clear();
    try {
      this.game.hideActionProgress?.();
    } catch {
      /* ignore */
    }

    this._applyRoundEconomy(winner);

    try {
      this.game.bots?.onRoundEnd?.(winner);
    } catch (err) {
      console.warn('[rounds] bots.onRoundEnd', err);
    }

    const scoreReached = this.scoreCT >= this.roundsToWin || this.scoreT >= this.roundsToWin;
    const roundsCap = this.roundNumber >= this.maxRounds;
    this.matchOver = scoreReached || roundsCap;
    this.intermissionLeft = INTERMISSION_TIME;
    this._roundResult = {
      winner,
      reason,
      reasonKey,
      scoreCT: this.scoreCT,
      scoreT: this.scoreT,
      round: this.roundNumber,
      playerTeam: this.playerTeam,
      matchOver: this.matchOver,
      bombPlanted: !!bomb.planted,
      bombDefused: !!bomb.defused,
      bombExploded: !!bomb.exploded,
      ...extra,
    };
    this._pendingMatchEnd = this.matchOver;
    if (this.matchOver) this._matchEndData = this._buildMatchEndData(winner, reason);

    try {
      this.game.onRoundEnded?.(winner, reason, { ...this._roundResult });
    } catch (err) {
      console.error('[rounds] onRoundEnded', err);
    }
    this.game.log?.(`Ronda ${this.roundNumber}: gana ${winner} · ${reason}`);
  }

  _applyRoundEconomy(winner) {
    if (winner !== 'CT' && winner !== 'T') return;
    const loser = winner === 'CT' ? 'T' : 'CT';
    const streak = clamp(Math.floor(this.lossStreak[loser] || 0), 0, LOSS_BONUS.length - 1);
    const lossBonus = LOSS_BONUS[streak];

    this._addTeamMoney(winner, WIN_MONEY);
    this._addTeamMoney(loser, lossBonus);

    // CS 1.6: si T plantó la C4 y pierde igual, todo T recibe un bonus extra.
    if (loser === 'T' && this.mode !== 'hostage' && this._tPlantBonus) {
      this._addTeamMoney('T', PLANT_LOSS_BONUS);
    }

    this.lossStreak[loser] = Math.min(streak + 1, LOSS_BONUS.length - 1);
    this.lossStreak[winner] = 0;
  }

  _addTeamMoney(team, amount) {
    if (!this.game || !amount) return;
    const player = this.game.player;
    if (player && player.team === team) {
      try {
        player.addMoney?.(amount);
      } catch {
        player.money = clamp((player.money || 0) + amount, 0, MAX_MONEY);
      }
    }
    for (const bot of this._getBots()) {
      if (bot.team !== team) continue;
      bot.money = clamp((bot.money || 0) + amount, 0, MAX_MONEY);
    }
  }

  _buildMatchEndData(lastWinner, reason) {
    const g = this.game;
    let sb = null;
    try {
      sb = g?.getScoreboardData?.() || null;
    } catch {
      sb = null;
    }
    const matchWinner = this.scoreCT > this.scoreT ? 'CT' : this.scoreT > this.scoreCT ? 'T' : null;
    const playerWon = matchWinner !== null && matchWinner === this.playerTeam;
    const result = matchWinner === null ? 'draw' : playerWon ? 'win' : 'lose';
    const teams = sb?.teams || { CT: [], T: [] };
    const sum = (rows) => {
      const out = { kills: 0, deaths: 0 };
      for (const row of rows || []) {
        out.kills += row.kills || 0;
        out.deaths += row.deaths || 0;
      }
      return out;
    };
    const player = g?.player;
    const stats = {
      player: player
        ? {
            name: player.name,
            team: player.team,
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            assists: player.assists || 0,
            money: Math.round(player.money || 0),
            score: player.score || 0,
          }
        : null,
      teams: { CT: sum(teams.CT), T: sum(teams.T) },
      roundsPlayed: this.roundNumber,
      scores: { CT: this.scoreCT, T: this.scoreT },
    };
    return {
      winner: matchWinner,
      matchWinner,
      result,
      draw: matchWinner === null,
      scoreCT: this.scoreCT,
      scoreT: this.scoreT,
      round: this.roundNumber,
      playerTeam: this.playerTeam,
      matchOver: true,
      teams,
      stats,
      mapName: sb?.mapName || g?.map?.displayName || g?.map?.id || '',
      mode: this.mode,
      roundsToWin: this.roundsToWin,
      reason: reason || 'Partida finalizada',
      lastWinner: lastWinner || null,
    };
  }

  _showMatchEnd() {
    if (!this.game) return;
    this._pendingMatchEnd = false;
    this.matchOver = true;
    this.phase = 'matchover';
    const data = this._matchEndData || this._buildMatchEndData(null, 'Partida finalizada');
    try {
      this.game.showMatchEnd?.(data);
    } catch (err) {
      console.error('[rounds] showMatchEnd', err);
    }
    this.game.log?.(`Fin de la partida · CT ${this.scoreCT} - ${this.scoreT} T`);
  }

  // ===========================================================================
  // Textos del HUD
  // ===========================================================================

  _getObjective() {
    const team = this.playerTeam;
    const player = this.game?.player;

    if (this.phase === 'matchover') return 'Partida finalizada';
    if (this.phase === 'over') {
      if (!this._roundResult) return 'Ronda terminada';
      const w = this._roundResult.winner === 'CT' ? 'CT' : 'T';
      return `Ganaron los ${w}`;
    }

    if (this.mode === 'hostage') {
      const total = this.hostages.length;
      const rescued = this.hostages.filter((h) => h.rescued).length;
      if (team === 'CT') {
        if (total > 0 && rescued >= total) return 'Todos los rehenes rescatados';
        return `Rescatá a los rehenes (${rescued}/${total})`;
      }
      return `Impedí el rescate de los rehenes (${rescued}/${total})`;
    }

    const bomb = this.bomb;
    if (bomb.planted) {
      return team === 'CT'
        ? `Desactivá la C4 · sitio ${bomb.site}`
        : `Protegé la C4 · sitio ${bomb.site}`;
    }
    if (team === 'T') {
      if (player && this.bombCarrier === player) {
        return `Plantá la C4 en el sitio ${this.siteTarget}`;
      }
      return `Acompañá al portador · objetivo sitio ${this.siteTarget}`;
    }
    return `Impedí la plantación · objetivo sitio ${this.siteTarget}`;
  }

  _getMessage() {
    const g = this.game;
    if (this.phase === 'over') {
      if (!this._roundResult) return '';
      const w = this._roundResult.winner === 'CT' ? 'CT' : 'T';
      return `${w}: ${this._roundResult.reason}`;
    }
    if (this.phase === 'matchover') return '';
    if (this.phase === 'freeze') {
      const cd = Math.ceil(this.freezeLeft);
      return cd > 0 ? `Congelado · la ronda empieza en ${cd}` : '¡Ya!';
    }

    if (this._useAction === 'defuse') {
      return `Desactivando la C4${g?.player?.hasDefuseKit ? ' (kit)' : ''}…`;
    }
    if (this._useAction === 'plant') return 'Plantando la C4…';
    if (this.bomb.planted) return `¡C4 PLANTADA! ${Math.ceil(this.bomb.timeLeft)}s`;
    if (this.buyTimeLeft > 0) return `Tiempo de compra · ${Math.ceil(this.buyTimeLeft)}s (B)`;
    if (this.mode === 'hostage' && this.hostages.some((h) => h.following && h.carrier === g?.player)) {
      return 'Llevá al rehén a la zona de rescate';
    }
    if (this.mode !== 'hostage' && g?.player && this.bombCarrier === g.player && g.player.hasBomb) {
      return 'Tenés la C4 · llevala al sitio';
    }
    return '';
  }

  // ===========================================================================
  // Props 3D (C4 / rehenes)
  // ===========================================================================

  _clearRoundProps() {
    this._removeBombMesh();
    if (!this._propRoot) return;
    while (this._propRoot.children.length) {
      const child = this._propRoot.children[this._propRoot.children.length - 1];
      disposeObject(child);
    }
    for (const h of this.hostages) h.mesh = null;
  }

  _createBombMesh(x, z) {
    this._removeBombMesh();
    if (!this._propRoot) return;

    const root = new THREE.Group();
    root.name = 'c4';

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.85, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.32), bodyMat);
    body.position.y = 0.09;
    root.add(body);

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.7, metalness: 0.3 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.14), panelMat);
    panel.position.set(0.1, 0.19, 0);
    root.add(panel);

    const redMat = new THREE.MeshStandardMaterial({ color: 0x9c2020, roughness: 0.6 });
    const wireA = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), redMat);
    wireA.position.set(-0.12, 0.2, 0.02);
    root.add(wireA);

    const blueMat = new THREE.MeshStandardMaterial({ color: 0x24409c, roughness: 0.6 });
    const wireB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.26), blueMat);
    wireB.position.set(-0.12, 0.2, -0.06);
    root.add(wireB);

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff2020,
      emissive: 0xff2020,
      emissiveIntensity: 1.2,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ledMat);
    led.position.set(-0.17, 0.21, 0.03);
    root.add(led);

    root.position.set(x, 0.02, z);
    root.rotation.y = Math.random() * Math.PI * 2;
    this._propRoot.add(root);
    this._bombMesh = root;
    this._bombLedMat = ledMat;
  }

  _removeBombMesh() {
    if (!this._bombMesh) {
      this._bombLedMat = null;
      return;
    }
    disposeObject(this._bombMesh);
    this._bombMesh = null;
    this._bombLedMat = null;
  }

  _createHostageMesh(h) {
    if (!this._propRoot) return;
    const root = new THREE.Group();
    root.name = `hostage-${h.id}`;

    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.9 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xe6e1d2, roughness: 0.95 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x394656, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt);
    torso.position.y = 1.12;
    root.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
    head.position.y = 1.6;
    root.add(head);

    const blind = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.02), dark);
    blind.position.set(0, 1.62, 0.17);
    root.add(blind);

    const armGeo = new THREE.BoxGeometry(0.12, 0.58, 0.12);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(-0.3, 1.1, 0);
    root.add(armL);
    const armR = new THREE.Mesh(armGeo, shirt);
    armR.position.set(0.3, 1.1, 0);
    root.add(armR);

    const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.18);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(-0.12, 0.4, 0);
    root.add(legL);
    const legR = new THREE.Mesh(legGeo, pants);
    legR.position.set(0.12, 0.4, 0);
    root.add(legR);

    root.position.set(h.pos.x, h.pos.y, h.pos.z);
    root.rotation.y = Math.random() * Math.PI * 2;
    this._propRoot.add(root);
    h.mesh = root;
  }
}

export default RoundManager;
