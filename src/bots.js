/**
 * bots.js ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â CS 1.6 Browser Edition
 * BotManager: bots low-poly procedurales, navegaciÃƒÆ’Ã‚Â³n por waypoints (A*), IA por objetivos
 * (bomba / rehenes), combate con LOS y perfiles de dificultad, animaciones y cadÃƒÆ’Ã‚Â¡veres.
 *
 * API pÃƒÆ’Ã‚Âºblica (ver CONTRACTS.md / GAMEPLAY_API.md):
 *   new BotManager(game)
 *   spawnAll({ botsCT, botsT, difficulty, teamSize })
 *   resetRound(roundNumber)
 *   setBombCarrier(bot)
 *   update(dt)
 *   getBots() / getBotHitboxes(bot) / aliveCount(team)
 *   damageBot(bot, amount, source, part, weaponId) -> daÃƒÆ’Ã‚Â±o aplicado
 *   onRoundEnd(winner) / dispose()
 *
 * Reglas de integraciÃƒÆ’Ã‚Â³n:
 *  - game.notifyKill es el ÃƒÆ’Ã…Â¡NICO que suma kills/deaths y avisa a rondas.
 *  - game.damagePlayer/damageBot aplican el multiplicador por zona; acÃƒÆ’Ã‚Â¡ se manda daÃƒÆ’Ã‚Â±o BASE.
 *  - rounds.js es dueÃƒÆ’Ã‚Â±o de bot.money: resetRound NO toca dinero, kills ni deaths.
 *  - rounds.js auto-planta (portador T quieto en sitio), auto-desfusea (CT <=1.9m) y
 *    auto-escolta rehenes (CT <=2m). El bot solo camina al objetivo y se detiene.
 */

import * as THREE from '../vendor/three.module.js';
import {
  clamp,
  lerp,
  rand,
  randInt,
  chance,
  expDamp,
  angleDiff,
  approachAngle,
  distance2D,
  DEG,
  TAU,
} from './core/utils.js';

/* ------------------------------------------------------------------------------------------------
 * Nombres estilo Counter-Strike
 * ---------------------------------------------------------------------------------------------- */

const BOT_NAMES = [
  'Cliffe', 'Gooseman', 'Minh', 'Ido', 'Jess', 'Barking', 'Shadow', 'Gunner',
  'Vitaliy', 'Wolf', 'Steel', 'Rex', 'Ash', 'Cobra', 'Dexter', 'Eagle',
  'Fang', 'Ghost', 'Hawk', 'Jester', 'Kane', 'Lynx', 'Maverick', 'Nova',
  'Orion', 'Puma', 'Raven', 'Saber', 'Talon', 'Viper', 'Wraith', 'Yeti',
  'Zeus', 'Ace', 'Bolt', 'Crank', 'Duke', 'Frost', 'Grim', 'Hex',
  'Iceman', 'Joker', 'Kilo', 'Loki', 'Mace', 'Nitro', 'Onyx', 'Pike',
];

/* ------------------------------------------------------------------------------------------------
 * Paletas de equipo (CT azul oscuro/gris, T marrÃƒÆ’Ã‚Â³n/oliva)
 * ---------------------------------------------------------------------------------------------- */

const TEAM_PALETTE = {
  CT: {
    shirts: [0x506a84, 0x415568, 0x5d7690],
    pants: [0x3b4550, 0x454f59],
    vest: 0x2b3a49,
    pouches: 0x6a7f95,
    pack: 0x304050,
    boots: 0x1d2329,
    helmet: 0x566b80,
  },
  T: {
    shirts: [0x8a7447, 0x77653b, 0x978250],
    pants: [0x596347, 0x4d563c],
    vest: 0x5f5233,
    pouches: 0xa48b50,
    pack: 0x4e432a,
    boots: 0x352d1e,
    helmet: 0x687347,
  },
};

/* ------------------------------------------------------------------------------------------------
 * Perfiles de dificultad
 *   reaction   segundos antes de disparar tras ver un enemigo
 *   aimError   error angular base (rad) a ~10m, escala con distancia/movimiento
 *   turnSpeed  rad/s de giro
 *   headChance probabilidad de apuntar a la cabeza
 *   scanCone   medio ÃƒÆ’Ã‚Â¡ngulo de detecciÃƒÆ’Ã‚Â³n (rad) respecto a la mirada
 *   spreadMult multiplicador de dispersiÃƒÆ’Ã‚Â³n del arma
 *   burstMult  multiplicador de pausa entre rÃƒÆ’Ã‚Â¡fagas
 *   strafeFreq frecuencia de strafeo en combate
 *   coverChance probabilidad de buscar cobertura con vida baja
 *   leadScale  anticipaciÃƒÆ’Ã‚Â³n de movimiento del objetivo
 *   engageRange distancia a la que se detiene a pelear
 * ---------------------------------------------------------------------------------------------- */

const DIFFICULTY = {
  easy: {
    reaction: 0.35, aimError: 0.075, turnSpeed: 4.2, headChance: 0.05,
    moveSpeed: 4.6, sightRange: 48, scanCone: 1.35, spreadMult: 1.5,
    burstMult: 0.85, strafeFreq: 1.5, strafeSpeed: 0.5, coverChance: 0.05,
    leadScale: 0.0, engageRange: 20, skill: 0.25,
  },
  normal: {
    reaction: 0.22, aimError: 0.045, turnSpeed: 7.0, headChance: 0.15,
    moveSpeed: 5.0, sightRange: 58, scanCone: 1.6, spreadMult: 1.15,
    burstMult: 1.0, strafeFreq: 2.0, strafeSpeed: 0.55, coverChance: 0.18,
    leadScale: 0.25, engageRange: 26, skill: 0.5,
  },
  hard: {
    reaction: 0.13, aimError: 0.028, turnSpeed: 10.0, headChance: 0.28,
    moveSpeed: 5.3, sightRange: 68, scanCone: 1.85, spreadMult: 0.92,
    burstMult: 1.1, strafeFreq: 2.5, strafeSpeed: 0.6, coverChance: 0.38,
    leadScale: 0.5, engageRange: 30, skill: 0.72,
  },
  expert: {
    reaction: 0.07, aimError: 0.016, turnSpeed: 14.0, headChance: 0.42,
    moveSpeed: 5.45, sightRange: 78, scanCone: 2.05, spreadMult: 0.75,
    burstMult: 1.2, strafeFreq: 2.9, strafeSpeed: 0.65, coverChance: 0.55,
    leadScale: 0.75, engageRange: 34, skill: 0.9,
  },
};

/* ------------------------------------------------------------------------------------------------
 * Perfiles de armas de bots (ids compartidos con weapons.js; daÃƒÆ’Ã‚Â±o BASE, el game aplica zona)
 * ---------------------------------------------------------------------------------------------- */

const BOT_WEAPONS = {
  glock: {
    name: 'Glock-18', damage: 25, range: 55, fireRate: 0.15,
    burst: [2, 3], burstPause: [0.2, 0.42], spread: 0.02, moveSpread: 0.045,
    reload: 2.1, magazine: 20, reserve: 120, sound: 'gun_pistol',
    len: 0.24, barrel: 0.1, scope: false, mag: true, stock: false, flash: 0.8,
  },
  usp: {
    name: 'USP', damage: 34, range: 60, fireRate: 0.16,
    burst: [2, 3], burstPause: [0.22, 0.45], spread: 0.018, moveSpread: 0.04,
    reload: 2.2, magazine: 12, reserve: 100, sound: 'gun_pistol',
    len: 0.26, barrel: 0.14, scope: false, mag: true, stock: false, flash: 0.85,
  },
  deagle: {
    name: 'Desert Eagle', damage: 53, range: 70, fireRate: 0.26,
    burst: [1, 2], burstPause: [0.35, 0.7], spread: 0.016, moveSpread: 0.05,
    reload: 2.4, magazine: 7, reserve: 35, sound: 'gun_pistol',
    len: 0.3, barrel: 0.18, scope: false, mag: true, stock: false, flash: 1.1,
  },
  mp5: {
    name: 'MP5 Navy', damage: 27, range: 65, fireRate: 0.085,
    burst: [3, 5], burstPause: [0.22, 0.5], spread: 0.026, moveSpread: 0.06,
    reload: 2.6, magazine: 30, reserve: 120, sound: 'gun_smg',
    len: 0.44, barrel: 0.16, scope: false, mag: true, stock: true, flash: 0.9,
  },
  ak47: {
    name: 'AK-47', damage: 36, range: 95, fireRate: 0.1,
    burst: [2, 4], burstPause: [0.28, 0.6], spread: 0.024, moveSpread: 0.075,
    reload: 2.5, magazine: 30, reserve: 90, sound: 'gun_rifle',
    len: 0.62, barrel: 0.24, scope: false, mag: true, stock: true, flash: 1.05,
  },
  m4a1: {
    name: 'M4A1', damage: 33, range: 95, fireRate: 0.09,
    burst: [3, 5], burstPause: [0.25, 0.55], spread: 0.022, moveSpread: 0.07,
    reload: 3.1, magazine: 30, reserve: 90, sound: 'gun_rifle',
    len: 0.6, barrel: 0.2, scope: false, mag: true, stock: true, flash: 1.0,
  },
  awp: {
    name: 'AWP', damage: 115, range: 140, fireRate: 1.45,
    burst: [1, 1], burstPause: [0.8, 1.4], spread: 0.004, moveSpread: 0.09,
    reload: 3.6, magazine: 10, reserve: 30, sound: 'gun_sniper',
    len: 0.7, barrel: 0.34, scope: true, mag: true, stock: true, flash: 1.2,
  },
  scout: {
    name: 'Steyr Scout', damage: 75, range: 120, fireRate: 1.1,
    burst: [1, 1], burstPause: [0.7, 1.2], spread: 0.006, moveSpread: 0.08,
    reload: 3.0, magazine: 10, reserve: 40, sound: 'gun_sniper',
    len: 0.64, barrel: 0.3, scope: true, mag: true, stock: true, flash: 1.05,
  },
};

const HIT_MULT = { head: 4.0, chest: 1.0, stomach: 1.25, legs: 0.75 };
const HIT_PARTS = ['head', 'chest', 'stomach', 'legs'];

/* ------------------------------------------------------------------------------------------------
 * Utilidades locales
 * ---------------------------------------------------------------------------------------------- */

function normalizeYaw(yaw) {
  return ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/* ------------------------------------------------------------------------------------------------
 * BotManager
 * ---------------------------------------------------------------------------------------------- */

export class BotManager {
  constructor(game) {
    this.game = game;
    this.bots = [];
    this.difficultyName = 'normal';
    this.profile = DIFFICULTY.normal;
    this.teamSize = 5;

    this._nextBotId = 1;
    this._time = 0;
    this._namePool = [];
    this._mapId = null;
    this.nav = { nodes: [], byId: new Map(), mapId: null };

    // Scratches reutilizados (single-threaded, llamadas no anidadas).
    this._sEye = new THREE.Vector3();
    this._sTarget = new THREE.Vector3();
    this._sMid = new THREE.Vector3();
    this._sDir = new THREE.Vector3();
    this._sEnd = new THREE.Vector3();
    this._sMuzzle = new THREE.Vector3();
    this._sBlood = new THREE.Vector3();
    this._sBloodDir = new THREE.Vector3();
    this._sLosA = new THREE.Vector3();
    this._sLosB = new THREE.Vector3();
    this._sFwd = new THREE.Vector3();
    this._sAim = new THREE.Vector3();
    this._sSep = new THREE.Vector3();
    this._sSepA = new THREE.Vector3();
    this._sSepB = new THREE.Vector3();
    this._enemyScratch = [];

    this._geos = [];
    this._mats = [];
    this.assets = this._createAssets();
  }

  /* ----------------------------------------------------------------------------------------------
   * Assets compartidos (una sola geometrÃƒÆ’Ã‚Â­a de caja + materiales de equipo)
   * -------------------------------------------------------------------------------------------- */

  _createAssets() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    this._geos.push(box, cyl);

    const mk = (color) => {
      const base = new THREE.Color(color);
      const m = new THREE.MeshLambertMaterial({
        color: base,
        emissive: base.clone().multiplyScalar(0.16),
        flatShading: true,
      });
      this._mats.push(m);
      return m;
    };
    const arr = (colors) => colors.map(mk);

    const mats = {
      skin: arr([0xd2ab84, 0xbb9168, 0x8e6547, 0x6f4f38]),
      gun: [mk(0x23252b)],
      gunDark: [mk(0x15161a)],
      gunAccent: [mk(0x3b3e45)],
      bomb: [mk(0x71541c)],
      kit: [mk(0x8b8b8b)],
    };

    for (const team of ['CT', 'T']) {
      const p = TEAM_PALETTE[team];
      mats[`${team}Shirt`] = arr(p.shirts);
      mats[`${team}Pants`] = arr(p.pants);
      mats[`${team}Vest`] = [mk(p.vest)];
      mats[`${team}Pouch`] = [mk(p.pouches)];
      mats[`${team}Pack`] = [mk(p.pack)];
      mats[`${team}Boots`] = [mk(p.boots)];
      mats[`${team}Helmet`] = [mk(p.helmet)];
    }

    return { geo: { box, cyl }, mats };
  }

  /* ----------------------------------------------------------------------------------------------
   * Spawn / creaciÃƒÆ’Ã‚Â³n
   * -------------------------------------------------------------------------------------------- */

  spawnAll(config = {}) {
    const diff = DIFFICULTY[config.difficulty] ? config.difficulty : 'normal';
    this.difficultyName = diff;
    this.profile = DIFFICULTY[diff];
    this.teamSize = clamp(Number(config.teamSize) || 5, 2, 8);

    this._clearBots();
    this._namePool = BOT_NAMES.slice();
    // Barajado Fisher-Yates simple.
    for (let i = this._namePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = this._namePool[i];
      this._namePool[i] = this._namePool[j];
      this._namePool[j] = t;
    }

    const botsCT = clamp(Number(config.botsCT) || 0, 0, 8);
    const botsT = clamp(Number(config.botsT) || 0, 0, 8);

    for (let i = 0; i < botsCT; i++) this.bots.push(this._createBot('CT', i));
    for (let i = 0; i < botsT; i++) this.bots.push(this._createBot('T', i));

    this._buildNavGraph();
    this.resetRound(1);
  }

  _createBot(team, roleIndex) {
    const profile = this.profile;
    const bot = {
      isBot: true,
      isPlayer: false,
      id: this._nextBotId++,
      name: this._nextName(),
      team,
      roleIndex,
      skill: clamp(profile.skill + rand(-0.1, 0.1), 0.05, 1),

      pos: new THREE.Vector3(0, 0.05, 0),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      aimYaw: 0,
      aimPitch: 0,
      radius: 0.38,
      height: 1.8,
      stepHeight: 0.4,
      onGround: false,
      speed: 0,
      _moving: false,
      _wishX: 0,
      _wishZ: 0,

      health: 100,
      armor: 0,
      helmet: false,
      alive: false,
      deathTime: 0,
      corpseTimer: 0,
      fallSign: 1,
      fallTilt: 0,

      weaponId: 'glock',
      magazine: 20,
      ammo: 20,
      reserve: 120,
      reloading: 0,

      kills: 0,
      deaths: 0,
      assists: 0,
      roundKills: 0,
      money: 800,
      score: 0,
      ping: randInt(8, 85),

      hasBomb: false,
      hasKit: false,

      target: null,
      targetVisible: false,
      lastSeen: new THREE.Vector3(),
      lastSeenTimer: 99,
      lastDamageTime: -99,
      lastAttacker: null,

      fireTimer: 0,
      burstLeft: 0,
      burstPause: 0,
      reactTimer: 0,
      thinkTimer: rand(0, 0.25),
      visTimer: 0,
      combatStrafeTimer: 0,
      combatStop: false,
      strafeDir: 1,
      coverTimer: 0,
      coverCheckTimer: 0,
      coverX: 0,
      coverZ: 0,
      avoidTimer: 0,
      avoidX: 0,
      avoidZ: 0,
      detourTimer: 0,
      detourX: 0,
      detourZ: 0,
      hostageTryTimer: 0,
      stepDist: 0,

      path: null,
      pathIndex: 0,
      repathTimer: 0,
      _goalPathX: 0,
      _goalPathZ: 0,

      state: 'freeze',
      seed: Math.random(),
      animPhase: rand(0, TAU),
      freezeYaw: 0,
      _holdYaw: null,
      _chkPos: new THREE.Vector3(0, 0.05, 0),
      stuckCheckTimer: rand(0, 0.4),
      stuckCount: 0,

      group: null,
      parts: null,
      _hitboxes: null,
      _deathNotifiedRound: undefined,
    };

    this._createModel(bot);
    return bot;
  }

  _nextName() {
    if (this._namePool.length) return this._namePool.pop();
    return `Bot${this._nextBotId}`;
  }

  _clearBots() {
    for (const bot of this.bots) this._destroyBotModel(bot);
    this.bots.length = 0;
  }

  /* ----------------------------------------------------------------------------------------------
   * Modelo low-poly procedural
   * -------------------------------------------------------------------------------------------- */

  _createModel(bot) {
    const character = this.game.characters?.ready
      ? this.game.characters.create(bot.team, bot.seed)
      : null;
    if (character) {
      this._attachCharacterModel(bot, character);
      return;
    }
    const A = this.assets;
    const team = bot.team;
    const pick = (list) => list[bot.roleIndex % list.length];
    const skin = A.mats.skin[Math.floor(bot.seed * A.mats.skin.length) % A.mats.skin.length];
    const shirt = pick(A.mats[`${team}Shirt`]);
    const pants = pick(A.mats[`${team}Pants`]);
    const vestMat = A.mats[`${team}Vest`][0];
    const pouchMat = A.mats[`${team}Pouch`][0];
    const packMat = A.mats[`${team}Pack`][0];
    const bootsMat = A.mats[`${team}Boots`][0];
    const helmetMat = A.mats[`${team}Helmet`][0];
    const gunMat = A.mats.gun[0];
    const gunDark = A.mats.gunDark[0];
    const gunAccent = A.mats.gunAccent[0];

    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const visual = new THREE.Group();
    root.add(visual);

    const mk = (mat, sx, sy, sz, x, y, z, parent = visual) => {
      const m = new THREE.Mesh(A.geo.box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = false;
      parent.add(m);
      return m;
    };

    const parts = {};

    // Piernas (pivote en la cadera).
    const legL = new THREE.Group();
    legL.position.set(-0.115, 0.92, 0);
    visual.add(legL);
    mk(pants, 0.17, 0.9, 0.2, 0, -0.45, 0, legL);
    mk(bootsMat, 0.19, 0.12, 0.28, 0, -0.86, -0.04, legL);

    const legR = new THREE.Group();
    legR.position.set(0.115, 0.92, 0);
    visual.add(legR);
    mk(pants, 0.17, 0.9, 0.2, 0, -0.45, 0, legR);
    mk(bootsMat, 0.19, 0.12, 0.28, 0, -0.86, -0.04, legR);
    parts.legL = legL;
    parts.legR = legR;

    // Cadera / torso / chaleco.
    mk(pants, 0.38, 0.22, 0.26, 0, 0.93, 0);
    mk(shirt, 0.42, 0.6, 0.25, 0, 1.27, 0);
    mk(vestMat, 0.46, 0.46, 0.28, 0, 1.28, 0);
    mk(pouchMat, 0.12, 0.12, 0.08, -0.13, 1.16, -0.16);
    mk(pouchMat, 0.12, 0.12, 0.08, 0.13, 1.16, -0.16);

    // Mochila, C4 y kit.
    mk(packMat, 0.3, 0.34, 0.16, 0, 1.28, 0.2);
    parts.bomb = mk(A.mats.bomb[0], 0.26, 0.18, 0.13, 0, 1.22, 0.28);
    parts.bomb.visible = false;
    parts.kit = mk(A.mats.kit[0], 0.14, 0.12, 0.09, 0.2, 0.96, -0.16);
    parts.kit.visible = false;

    // Brazos (pivote en el hombro, rotados hacia el arma).
    const armL = new THREE.Group();
    armL.position.set(-0.3, 1.5, 0);
    armL.rotation.x = -1.05;
    armL.rotation.z = 0.34;
    visual.add(armL);
    mk(shirt, 0.12, 0.52, 0.13, 0, -0.25, 0, armL);
    mk(skin, 0.1, 0.12, 0.11, 0, -0.54, 0, armL);

    const armR = new THREE.Group();
    armR.position.set(0.3, 1.5, 0);
    armR.rotation.x = -1.18;
    armR.rotation.z = -0.38;
    visual.add(armR);
    mk(shirt, 0.12, 0.52, 0.13, 0, -0.25, 0, armR);
    mk(skin, 0.1, 0.12, 0.11, 0, -0.54, 0, armR);
    parts.armL = armL;
    parts.armR = armR;

    // Cabeza + casco de CT / gorra de T.
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.56, 0);
    visual.add(headGroup);
    mk(skin, 0.24, 0.24, 0.24, 0, 0.12, 0, headGroup);
    parts.helmet = mk(helmetMat, 0.31, 0.13, 0.31, 0, 0.26, 0.01, headGroup);
    mk(helmetMat, 0.33, 0.035, 0.12, 0, 0.2, -0.16, headGroup);
    parts.cap = mk(helmetMat, 0.29, 0.1, 0.3, 0, 0.25, 0, headGroup);
    mk(helmetMat, 0.3, 0.03, 0.15, 0, 0.2, -0.16, headGroup);
    parts.headGroup = headGroup;

    // Arma en las manos.
    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.12, 1.3, -0.3);
    visual.add(weaponGroup);
    parts.weaponGroup = weaponGroup;
    parts.gunBody = mk(gunMat, 0.08, 0.11, 0.5, 0, 0, -0.2, weaponGroup);
    const gunBarrel = new THREE.Mesh(A.geo.cyl, gunDark);
    gunBarrel.rotation.x = Math.PI / 2;
    weaponGroup.add(gunBarrel);
    parts.gunBarrel = gunBarrel;
    parts.gunMag = mk(gunDark, 0.05, 0.16, 0.09, 0, -0.12, -0.16, weaponGroup);
    parts.gunScope = mk(gunAccent, 0.06, 0.07, 0.26, 0, 0.1, -0.18, weaponGroup);
    parts.gunStock = mk(gunMat, 0.06, 0.09, 0.2, 0, -0.01, 0.08, weaponGroup);

    bot.group = root;
    bot.parts = parts;
    this.game.scene?.add(root);
    root.position.copy(bot.pos);
    root.rotation.set(0, bot.yaw, 0);
    this._equipWeaponVisual(bot);
  }

  _attachCharacterModel(bot, character) {
    const root = character.root;
    root.rotation.order = 'YXZ';
    root.position.copy(bot.pos);
    root.rotation.set(0, bot.yaw + (character.yawOffset || 0), 0);
    bot.height = character.targetHeight || 1.8;
    this.game.scene?.add(root);
    bot.group = root;
    bot.parts = {
      character,
      weaponGroup: null,
      // props de objetivo (C4/kit) sobre el modelo Quaternius
      bomb: null,
      kit: null,
    };
    this._equipWeaponVisual(bot);
  }

  _destroyBotModel(bot) {
    bot.parts?.character?.mixer?.stopAllAction();
    bot.parts?.character?.dispose?.();
    if (bot.group) bot.group.removeFromParent();
    bot.group = null;
    bot.parts = null;
  }

  _equipWeaponVisual(bot) {
    const p = bot.parts;
    if (!p) return;
    if (p.character) {
      p.character.setWeapon?.(bot.weaponId);
      return;
    }
    const w = this._weapon(bot);
    const len = w.len;
    p.gunBody.scale.set(0.08, 0.11, len);
    p.gunBody.position.set(0, 0, -len * 0.45);
    p.gunBarrel.scale.set(0.045, w.barrel, 0.045);
    p.gunBarrel.position.set(0, 0.015, -0.95 * len - w.barrel * 0.5);
    p.gunMag.visible = !!w.mag;
    p.gunMag.position.set(0, -0.12, -0.28 * len);
    p.gunScope.visible = !!w.scope;
    p.gunScope.position.set(0, 0.1, -0.3 * len);
    p.gunStock.visible = !!w.stock;
    p.gunStock.position.set(0, -0.01, 0.05 * len + 0.1);
  }

  _syncEquipment(bot) {
    const p = bot.parts;
    if (!p) return;
    if (p.character) return;
    if (p.helmet) p.helmet.visible = !!bot.helmet;
    if (p.cap) p.cap.visible = !bot.helmet;
    if (p.bomb) p.bomb.visible = !!bot.hasBomb;
    if (p.kit) p.kit.visible = !!bot.hasKit;
  }

  /* ----------------------------------------------------------------------------------------------
   * Reset de ronda
   * -------------------------------------------------------------------------------------------- */

  resetRound(roundNumber = 1) {
    if (!this.game.map) return;
    const map = this.game.map;
    const bounds = map.bounds;
    const counters = { CT: 0, T: 0 };
    const skipped = {
      CT: this._playerSpawnIndex('CT'),
      T: this._playerSpawnIndex('T'),
    };

    for (const bot of this.bots) {
      const idx = counters[bot.team]++;
      const spawns = Array.isArray(map.spawns?.[bot.team]) ? map.spawns[bot.team] : [];
      // Spawns libres: no pisar el spawn que ocupa el jugador humano.
      const available = [];
      for (let i = 0; i < spawns.length; i++) {
        if (i !== skipped[bot.team]) available.push(i);
      }
      const spawnIndex = available.length
        ? available[Math.floor(Math.random() * available.length)]
        : 0;
      const spawn = spawns.length
        ? spawns[spawnIndex] || spawns[0]
        : { x: 0, y: 0.05, z: 0, yaw: 0 };
      // Si hay menos spawns que bots, se reutiliza el spawn con un pequeÃƒÆ’Ã‚Â±o anillo.
      const reuse = spawns.length <= 1 || idx >= available.length;
      const layer = available.length ? Math.floor(idx / available.length) : idx;
      let x = spawn.x || 0;
      let z = spawn.z || 0;
      if (reuse) {
        const offAngle = bot.seed * TAU + layer * 0.9;
        const offR = 0.7 + layer * 0.85;
        x += Math.cos(offAngle) * offR;
        z += Math.sin(offAngle) * offR;
      } else {
        x += rand(-0.15, 0.15);
        z += rand(-0.15, 0.15);
      }
      if (bounds) {
        x = clamp(x, bounds.minX + 1, bounds.maxX - 1);
        z = clamp(z, bounds.minZ + 1, bounds.maxZ - 1);
      }

      bot.pos.set(x, spawn.y ?? 0.05, z);
      bot.vel.set(0, 0, 0);
      bot.yaw = normalizeYaw(((spawn.yaw || 0) * DEG) + rand(-0.12, 0.12));
      bot.pitch = 0;
      bot.aimYaw = bot.yaw;
      bot.aimPitch = 0;
      bot.height = bot.parts?.character?.targetHeight || 1.8;
      bot.onGround = false;
      bot.speed = 0;
      bot._moving = false;
      bot._wishX = 0;
      bot._wishZ = 0;

      bot.health = 100;
      bot.alive = true;
      bot.deathTime = 0;
      bot.corpseTimer = 0;
      bot.armor = 0;
      bot.helmet = false;
      bot.hasBomb = false;
      bot.hasKit = false;
      bot.roundKills = 0;

      bot.target = null;
      bot.targetVisible = false;
      bot.lastSeenTimer = 99;
      bot.lastAttacker = null;
      bot.thinkTimer = rand(0, 0.25);
      bot.visTimer = 0;
      bot.reactTimer = 0;
      bot.fireTimer = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.reloading = 0;
      bot.combatStrafeTimer = 0;
      bot.combatStop = false;
      bot.strafeDir = Math.random() < 0.5 ? 1 : -1;
      bot.coverTimer = 0;
      bot.coverCheckTimer = 0;
      bot.avoidTimer = 0;
      bot.avoidX = 0;
      bot.avoidZ = 0;
      bot.detourTimer = 0;
      bot.detourX = 0;
      bot.detourZ = 0;
      bot.hostageTryTimer = 0;
      bot.stepDist = 0;
      bot.path = null;
      bot.pathIndex = 0;
      bot.repathTimer = 0;
      bot._goalPathX = 0;
      bot._goalPathZ = 0;
      bot._holdYaw = null;
      bot._chkPos.copy(bot.pos);
      bot.stuckCheckTimer = rand(0, 0.4);
      bot.stuckCount = 0;
      bot.animPhase = rand(0, TAU);
      bot.state = 'freeze';

      // Loadout de ronda (armas/armadura/kit) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â rounds.js es dueÃƒÆ’Ã‚Â±o del dinero.
      const gear = this._rollGear(bot.team, roundNumber);
      bot.armor = gear.armor;
      bot.helmet = gear.helmet;
      bot.hasKit = gear.kit;
      this._giveBotWeapon(bot, gear.weaponId);

      // Mirada inicial en freeze: hacia el spawn enemigo / centro.
      const enemyTeam = bot.team === 'T' ? 'CT' : 'T';
      const enemySpawn = Array.isArray(map.spawns?.[enemyTeam]) ? map.spawns[enemyTeam][0] : null;
      if (enemySpawn) {
        bot.freezeYaw = Math.atan2(-(enemySpawn.x - bot.pos.x), -(enemySpawn.z - bot.pos.z));
      } else if (bounds) {
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cz = (bounds.minZ + bounds.maxZ) / 2;
        bot.freezeYaw = Math.atan2(-(cx - bot.pos.x), -(cz - bot.pos.z));
      } else {
        bot.freezeYaw = bot.yaw;
      }

      delete bot._deathNotifiedRound;
      bot._hitboxes = null;
      if (bot.group) {
        bot.group.visible = true;
        bot.group.position.copy(bot.pos);
        bot.group.rotation.set(0, bot.yaw + (bot.parts?.character?.yawOffset || 0), 0);
      }
      this._syncEquipment(bot);
      this._equipWeaponVisual(bot);
    }
  }

  /** ÃƒÆ’Ã‚Ândice del spawn del equipo que estÃƒÆ’Ã‚Â¡ ocupando el jugador humano (-1 si no aplica). */
  _playerSpawnIndex(team) {
    const player = this.game.player;
    const spawns = this.game.map?.spawns?.[team];
    if (!player || !player.alive || player.team !== team || !Array.isArray(spawns)) return -1;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      if (!s) continue;
      const d = distance2D(player.pos.x, player.pos.z, s.x || 0, s.z || 0);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  _rollGear(team, roundNumber) {
    const r = Math.random();
    const rifle = team === 'T' ? 'ak47' : 'm4a1';
    const pistol = team === 'T' ? 'glock' : 'usp';
    let weaponId;

    if (roundNumber <= 1) {
      weaponId = pistol;
    } else if (roundNumber === 2) {
      weaponId = r < 0.45 ? 'mp5' : pistol;
    } else if (roundNumber <= 4) {
      if (r < 0.5) weaponId = 'mp5';
      else if (r < 0.72) weaponId = rifle;
      else if (r < 0.88) weaponId = pistol;
      else weaponId = 'deagle';
    } else {
      if (r < 0.16) weaponId = 'mp5';
      else if (r < 0.24) weaponId = 'awp';
      else if (r < 0.3) weaponId = 'scout';
      else if (r < 0.38) weaponId = 'deagle';
      else weaponId = rifle;
    }

    let armor = 0;
    let helmet = false;
    if (roundNumber >= 2 && Math.random() < (roundNumber >= 4 ? 0.75 : 0.5)) {
      armor = 100;
      helmet = Math.random() < (roundNumber >= 4 ? 0.7 : 0.35);
    }
    const kit = team === 'CT' && roundNumber >= 2 && Math.random() < 0.45;
    return { weaponId, armor, helmet, kit };
  }

  _giveBotWeapon(bot, weaponId) {
    const w = BOT_WEAPONS[weaponId] ? BOT_WEAPONS[weaponId] : BOT_WEAPONS.glock;
    bot.weaponId = BOT_WEAPONS[weaponId] ? weaponId : 'glock';
    bot.magazine = w.magazine;
    bot.ammo = w.magazine;
    bot.reserve = w.reserve;
    bot.reloading = 0;
    bot.fireTimer = 0;
    bot.burstLeft = 0;
    bot.burstPause = 0;
    this._equipWeaponVisual(bot);
  }

  setBombCarrier(bot) {
    for (const b of this.bots) {
      b.hasBomb = !!bot && b === bot;
      this._syncEquipment(b);
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Consultas
   * -------------------------------------------------------------------------------------------- */

  getBots() {
    return this.bots;
  }

  aliveCount(team) {
    let n = 0;
    for (const b of this.bots) {
      if (!b.alive) continue;
      if (team && b.team !== team) continue;
      n++;
    }
    return n;
  }

  getBotHitboxes(bot) {
    if (!bot || !bot.alive) return [];
    if (!bot._hitboxes) {
      bot._hitboxes = [];
      for (const part of HIT_PARTS) {
        bot._hitboxes.push({
          part,
          box: new THREE.Box3(),
          damageMult: HIT_MULT[part],
        });
      }
    }
    const p = bot.pos;
    const h = bot.height || 1.8;
    const r = bot.radius || 0.38;
    const boxes = bot._hitboxes;
    const set = (i, part, y0, y1, width) => {
      const e = boxes[i];
      e.part = part;
      e.damageMult = HIT_MULT[part];
      e.box.min.set(p.x - width / 2, p.y + y0, p.z - width / 2);
      e.box.max.set(p.x + width / 2, p.y + y1, p.z + width / 2);
    };
    // Igual geometrÃƒÆ’Ã‚Â­a que game.getPlayerHitboxes para que el hitscan sea consistente.
    set(0, 'head', h - 0.3, h, 0.28);
    set(1, 'chest', h * 0.56, h - 0.3, Math.max(0.4, r * 1.15));
    set(2, 'stomach', h * 0.42, h * 0.56, Math.max(0.38, r * 1.1));
    set(3, 'legs', 0.02, h * 0.42, Math.max(0.34, r));
    return boxes;
  }

  _weapon(bot) {
    return BOT_WEAPONS[bot.weaponId] || BOT_WEAPONS.glock;
  }

  /* ----------------------------------------------------------------------------------------------
   * DaÃƒÆ’Ã‚Â±o / muerte
   * -------------------------------------------------------------------------------------------- */

  damageBot(bot, amount, source, part = 'chest', weaponId = 'unknown') {
    if (!bot || !bot.alive) return 0;
    let dmg = Math.max(0, Number(amount) || 0);
    if (dmg <= 0) return 0;
    if (!HIT_MULT[part]) part = 'chest';

    // Armadura/chaleco (helmet sÃƒÆ’Ã‚Â³lo protege cabeza).
    if (bot.armor > 0) {
      const blocked = part === 'head' ? (bot.helmet ? 0.5 : 0) : 0.5;
      const healthPortion = dmg * (1 - blocked);
      const armorLoss =
        part === 'head' && !bot.helmet ? 0 : Math.min(bot.armor, dmg * 0.5);
      bot.armor = Math.max(0, bot.armor - armorLoss);
      dmg = healthPortion;
    }
    dmg = Math.max(1, Math.round(dmg));
    bot.health -= dmg;
    bot.lastDamageTime = this._time;
    bot.lastAttacker = source || null;

    // ReacciÃƒÆ’Ã‚Â³n al atacante aunque no lo estuviera viendo.
    if (source && source !== bot && source.team && source.team !== bot.team && source.alive) {
      if (!bot.target || !bot.targetVisible) {
        bot.target = source;
        bot.reactTimer = Math.min(bot.reactTimer || 0.3, 0.25);
      }
      bot.lastSeen.copy(source.pos);
      bot.lastSeenTimer = 0;
    }

    const effects = this.game.effects;
    if (effects?.blood) {
      const y = part === 'head' ? 1.66 : part === 'chest' ? 1.28 : part === 'stomach' ? 1.02 : 0.5;
      this._sBlood.set(bot.pos.x + rand(-0.12, 0.12), bot.pos.y + y, bot.pos.z + rand(-0.12, 0.12));
      if (source?.pos) {
        this._sBloodDir
          .set(bot.pos.x - source.pos.x, 0.25, bot.pos.z - source.pos.z)
          .normalize();
      } else {
        this._sBloodDir.set(0, 1, 0);
      }
      effects.blood(this._sBlood, this._sBloodDir);
    }

    const dist = this._distToPlayer(bot.pos);
    if (dist < 28) {
      this.game.audio?.play('hurt', {
        volume: clamp(1 - dist / 28, 0.12, 0.7) * 0.5,
        pan: this._panForPos(bot.pos),
      });
    }

    if (bot.health <= 0) {
      bot.health = 0;
      this._killBot(bot, source, weaponId, part === 'head');
    }
    return dmg;
  }

  _killBot(bot, source, weaponId, headshot) {
    if (!bot.alive) return;
    bot.alive = false;
    bot.health = 0;
    bot.deathTime = 0;
    bot.corpseTimer = rand(5.5, 8);
    bot.state = 'dead';
    bot.target = null;
    bot.targetVisible = false;
    bot.path = null;
    bot.vel.set(0, 0, 0);
    bot._moving = false;

    // CaÃƒÆ’Ã‚Â­da lateral aleatoria (sesgada por la direcciÃƒÆ’Ã‚Â³n del disparo).
    let sign = Math.random() < 0.5 ? 1 : -1;
    if (source?.pos) {
      const cross = Math.sin(bot.yaw) * (source.pos.x - bot.pos.x) + Math.cos(bot.yaw) * (source.pos.z - bot.pos.z);
      sign = cross >= 0 ? 1 : -1;
    }
    bot.fallSign = sign;
    bot.fallTilt = rand(-0.22, 0.22);

    const dist = this._distToPlayer(bot.pos);
    const vol = clamp(1 - dist / 50, 0.12, 1);
    this.game.audio?.play('death', { volume: vol * 0.8, pan: this._panForPos(bot.pos) });
    this.game.audio?.play('bodyfall', { volume: vol * 0.7, pan: this._panForPos(bot.pos) });

    // game.notifyKill es el ÃƒÆ’Ã‚Âºnico lugar que suma deaths/kills y avisa a rounds.
    this.game.notifyKill?.(source || null, bot, weaponId || 'unknown', !!headshot);
  }

  /* ----------------------------------------------------------------------------------------------
   * Update principal
   * -------------------------------------------------------------------------------------------- */

  update(dt) {
    const game = this.game;
    if (!game || !game.map || !this.bots.length) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this._time += dt;

    // Reconstruir nav si cambiÃƒÆ’Ã‚Â³ el mapa o la cantidad de waypoints.
    const wpCount = Array.isArray(game.map.waypoints) ? game.map.waypoints.length : 0;
    if (this._mapId !== (game.map.id || null) || this.nav.nodes.length !== wpCount) {
      this._buildNavGraph();
    }

    const rounds = game.rounds;
    const phase = rounds?.phase || (game.state === 'playing' ? 'live' : 'freeze');
    const live = phase === 'live' && game.state !== 'roundover' && game.state !== 'matchover';

    for (const bot of this.bots) {
      if (!bot.alive) {
        this._updateDeath(bot, dt);
        continue;
      }
      this._timers(bot, dt);
      if (!live) {
        this._idle(bot, dt, phase);
        continue;
      }
      this._acquireTarget(bot, dt);
      this._updateCombatAim(bot, dt);
      const goal = this._computeGoal(bot);
      this._maybeTakeCover(bot);
      this._updateMovement(bot, dt, goal);
      this._updateFacing(bot, dt, goal);
      this._animate(bot, dt);
      this._checkStuck(bot, dt);
    }

    this._separateBodies();
  }

  /**
   * Los bots no colisionan con el jugador en el motor AABB (solo con el mapa), asÃƒÆ’Ã‚Â­ que
   * empujamos suavemente los cuerpos para no quedar dentro de la cÃƒÆ’Ã‚Â¡mara del jugador.
   */
  _separateBodies() {
    const game = this.game;
    const physics = game?.physics;
    if (!physics) return;
    const alive = this.bots.filter((b) => b.alive);
    const player = game.player;

    const pushAway = (bot, ox, oz, minDist) => {
      let dx = bot.pos.x - ox;
      let dz = bot.pos.z - oz;
      let d = Math.hypot(dx, dz);
      if (d < 1e-5) {
        const a = Math.random() * TAU;
        dx = Math.cos(a);
        dz = Math.sin(a);
        d = 1;
      }
      if (d >= minDist) return;
      const nx = bot.pos.x + (dx / d) * (minDist - d + 0.02);
      const nz = bot.pos.z + (dz / d) * (minDist - d + 0.02);
      const candidate = this._sSep;
      candidate.set(nx, bot.pos.y + 0.02, nz);
      if (physics.isPositionFree(candidate, bot.radius, bot.height)) {
        bot.pos.x = nx;
        bot.pos.z = nz;
      }
    };

    if (player?.alive) {
      for (const bot of alive) pushAway(bot, player.pos.x, player.pos.z, 0.86);
    }
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-5 && d < 0.78) {
          const push = (0.78 - d) * 0.5;
          const ux = dx / d;
          const uz = dz / d;
          const pa = this._sSepA.set(a.pos.x - ux * push, a.pos.y + 0.02, a.pos.z - uz * push);
          const pb = this._sSepB.set(b.pos.x + ux * push, b.pos.y + 0.02, b.pos.z + uz * push);
          if (physics.isPositionFree(pa, a.radius, a.height)) { a.pos.x = pa.x; a.pos.z = pa.z; }
          if (physics.isPositionFree(pb, b.radius, b.height)) { b.pos.x = pb.x; b.pos.z = pb.z; }
        }
      }
    }
  }

  _timers(bot, dt) {
    bot.thinkTimer -= dt;
    bot.visTimer -= dt;
    bot.reactTimer = Math.max(0, bot.reactTimer - dt);
    bot.fireTimer = Math.max(0, bot.fireTimer - dt);
    bot.burstPause = Math.max(0, bot.burstPause - dt);
    bot.repathTimer -= dt;
    bot.combatStrafeTimer -= dt;
    bot.avoidTimer -= dt;
    bot.detourTimer = Math.max(0, bot.detourTimer - dt);
    bot.coverTimer = Math.max(0, bot.coverTimer - dt);
    bot.coverCheckTimer -= dt;
    bot.hostageTryTimer -= dt;
    if (!bot.targetVisible) bot.lastSeenTimer = Math.min(999, bot.lastSeenTimer + dt);

    const w = this._weapon(bot);
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0) {
        bot.reloading = 0;
        bot.ammo = bot.magazine;
      }
    } else if (bot.ammo <= 0) {
      bot.reloading = w.reload;
      bot.burstLeft = 0;
    } else if (!bot.targetVisible && bot.ammo < bot.magazine * 0.35) {
      bot.reloading = w.reload;
      bot.burstLeft = 0;
    }

    if (
      bot.burstLeft <= 0 &&
      bot.targetVisible &&
      bot.burstPause <= 0 &&
      bot.reloading <= 0 &&
      bot.fireTimer <= 0
    ) {
      bot.burstLeft = randInt(w.burst[0], w.burst[1]);
    }

    if (bot._moving && bot.onGround) {
      bot.stepDist += bot.speed * dt;
      if (bot.stepDist > 1.9) {
        bot.stepDist = 0;
        this._footstep(bot);
      }
    }
  }

  _idle(bot, dt, phase) {
    bot.state = phase === 'freeze' ? 'freeze' : 'idle';
    const scan = bot.freezeYaw + Math.sin(this._time * 0.45 + bot.seed * TAU) * 0.22;
    bot.yaw = normalizeYaw(approachAngle(bot.yaw, scan, this.profile.turnSpeed * 0.45 * dt));
    bot.pitch = expDamp(bot.pitch, 0, 6, dt);
    this._applyMove(bot, 0, 0, 0, dt);
    this._animate(bot, dt);
  }

  /* ----------------------------------------------------------------------------------------------
   * Sentidos / combate
   * -------------------------------------------------------------------------------------------- */

  _gatherEnemies(bot) {
    const list = this._enemyScratch;
    list.length = 0;
    const player = this.game.player;
    if (player && player.alive && player.team !== bot.team) list.push(player);
    for (const b of this.bots) {
      if (b !== bot && b.alive && b.team !== bot.team) list.push(b);
    }
    return list;
  }

  _eyePos(bot, out = this._sEye) {
    return out.set(bot.pos.x, bot.pos.y + 1.62, bot.pos.z);
  }

  _eyeOfEntity(entity, out) {
    if (!entity || !entity.pos) return out.set(0, 1.5, 0);
    const y = entity.isPlayer
      ? entity.pos.y + (entity.eyeHeight ?? 1.6)
      : entity.pos.y + 1.45;
    return out.set(entity.pos.x, y, entity.pos.z);
  }

  _canSee(bot, target) {
    if (!target || !target.alive) return false;
    this._eyePos(bot, this._sLosA);
    this._eyeOfEntity(target, this._sLosB);
    return !!this.game.hasLineOfSight?.(this._sLosA, this._sLosB);
  }

  _acquireTarget(bot, dt) {
    const profile = this.profile;
    const current = bot.target;
    const currentVisible = !!(current && current.alive && this._canSee(bot, current));

    if (currentVisible) {
      bot.targetVisible = true;
      bot.lastSeen.copy(current.pos);
      bot.lastSeenTimer = 0;
      if (bot.thinkTimer > 0) return;
    } else {
      bot.targetVisible = false;
      if (current && (!current.alive || bot.lastSeenTimer > 2.5)) bot.target = null;
    }
    if (bot.thinkTimer > 0) return;
    bot.thinkTimer = 0.16 + rand(0, 0.16);

    const enemies = this._gatherEnemies(bot);
    let best = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dist = distance2D(bot.pos.x, bot.pos.z, e.pos.x, e.pos.z);
      if (dist > profile.sightRange) continue;
      const known = bot.lastAttacker === e;
      if (!known) {
        const dirYaw = Math.atan2(-(e.pos.x - bot.pos.x), -(e.pos.z - bot.pos.z));
        if (Math.abs(angleDiff(bot.yaw, dirYaw)) > profile.scanCone) continue;
      }
      if (!this._canSee(bot, e)) continue;
      let score = 120 / (dist + 8);
      if (e === current) score += 2;
      if (known) score += 2.5;
      if (e.isPlayer) score += 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }

    if (best) {
      if (best !== current) {
        bot.target = best;
        bot.reactTimer = Math.max(0.04, profile.reaction * rand(0.85, 1.2));
        bot.burstLeft = 0;
        bot.burstPause = rand(0.04, 0.18);
        bot.visTimer = 0;
      }
      bot.targetVisible = true;
      bot.lastSeen.copy(best.pos);
      bot.lastSeenTimer = 0;
    } else if (!currentVisible) {
      bot.target = null;
    }
  }

  _aimErrorAmount(bot, dist) {
    const p = this.profile;
    const skillScale = 1.3 - bot.skill * 0.45;
    const distScale = 0.55 + Math.min(dist, 80) / 55;
    const moveScale = bot._moving ? 1.2 : 1;
    return p.aimError * skillScale * distScale * moveScale;
  }

  _headChance(bot, dist) {
    const p = this.profile;
    return clamp(p.headChance + (dist < 18 ? 0.06 : 0) - dist / 400, 0.02, 0.85);
  }

  _updateCombatAim(bot, dt) {
    const t = bot.target;
    if (!t || !t.alive) {
      bot.target = null;
      bot.targetVisible = false;
      return;
    }
    if (!bot.targetVisible) return;

    const eye = this._eyePos(bot, this._sEye);
    const dist = distance2D(bot.pos.x, bot.pos.z, t.pos.x, t.pos.z);
    const head = Math.random() < this._headChance(bot, dist);
    const aimY = t.pos.y + (head ? 1.66 : 1.15) + rand(-0.04, 0.04);
    const lead = (dist / 900) * this.profile.leadScale;
    const tx = t.pos.x + (t.vel?.x || 0) * lead;
    const tz = t.pos.z + (t.vel?.z || 0) * lead;
    const dx = tx - eye.x;
    const dy = aimY - eye.y;
    const dz = tz - eye.z;
    const horiz = Math.hypot(dx, dz);
    const baseYaw = Math.atan2(-dx, -dz);
    const basePitch = Math.atan2(dy, Math.max(0.001, horiz));
    const err = this._aimErrorAmount(bot, dist);
    const nA =
      Math.sin(this._time * 2.3 + bot.seed * 11.7) +
      0.5 * Math.sin(this._time * 4.9 + bot.seed * 3.1);
    const nB =
      Math.cos(this._time * 1.7 + bot.seed * 7.3) +
      0.4 * Math.sin(this._time * 3.3 + bot.seed * 5.9);
    bot.aimYaw = baseYaw + nA * err * 0.55;
    bot.aimPitch = clamp(basePitch + nB * err * 0.45, -1.2, 1.2);

    this._tryFire(bot, dist);
  }

  _tryFire(bot, dist) {
    const w = this._weapon(bot);
    if (bot.reloading > 0 || bot.fireTimer > 0 || bot.ammo <= 0) return;
    if (bot.reactTimer > 0) return;
    if (dist > w.range * 0.98) return;
    if (!bot.targetVisible) return;

    dirFromYawPitch(bot.yaw, bot.pitch, this._sFwd);
    dirFromYawPitch(bot.aimYaw, bot.aimPitch, this._sAim);
    if (this._sFwd.dot(this._sAim) < 0.975) return; // todavÃƒÆ’Ã‚Â­a girando

    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) return;
      bot.burstLeft = randInt(w.burst[0], w.burst[1]);
    }
    this._fire(bot, w);
  }

  _fire(bot, w) {
    const eye = this._eyePos(bot, this._sEye);
    const spread = (w.spread + (bot._moving ? w.moveSpread : 0)) * this.profile.spreadMult;
    const yaw = bot.aimYaw + (Math.random() - 0.5) * spread * 2;
    const pitch = clamp(bot.aimPitch + (Math.random() - 0.5) * spread * 2, -1.25, 1.25);
    const dir = dirFromYawPitch(yaw, pitch, this._sDir);

    const hit = this.game.raycastShot?.(eye, dir, w.range, bot.team) || null;
    const muzzle = this._sMuzzle.copy(eye).addScaledVector(dir, 0.42);
    muzzle.y -= 0.05;
    const effects = this.game.effects;
    effects?.muzzleFlash?.(muzzle, dir, w.flash ?? 1);

    let end;
    if (hit) end = hit.point;
    else end = this._sEnd.copy(eye).addScaledVector(dir, w.range);
    effects?.tracer?.(muzzle, end, 0xffd27a);

    this._playGun(bot, w);

    if (hit) {
      const falloff = clamp(1 - Math.max(0, hit.t - 10) / (w.range * 2.2), 0.55, 1);
      const damage = w.damage * falloff;
      if (hit.type === 'player') {
        this.game.damagePlayer?.(damage, bot, hit.part, bot.weaponId);
      } else if (hit.type === 'bot') {
        const victim = hit.entity;
        if (victim && victim !== bot && victim.team !== bot.team) {
          this.game.damageBot?.(victim, damage, bot, hit.part, bot.weaponId);
        }
      } else if (effects?.bulletImpact) {
        effects.bulletImpact(hit.point, hit.normal, hit.collider?.surface || 'stone');
      }
    }

    bot.ammo = Math.max(0, bot.ammo - 1);
    bot.fireTimer = w.fireRate * rand(0.94, 1.08);
    bot.burstLeft = Math.max(0, bot.burstLeft - 1);
    if (bot.burstLeft <= 0) {
      bot.burstPause = rand(w.burstPause[0], w.burstPause[1]) * this.profile.burstMult;
    }
    if (bot.ammo <= 0) {
      bot.reloading = w.reload;
      bot.burstLeft = 0;
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Objetivos
   * -------------------------------------------------------------------------------------------- */

  _bombsite(name) {
    const sites = this.game.map?.bombsites;
    if (!Array.isArray(sites) || !sites.length) return null;
    if (!name) return sites[0];
    const wanted = String(name).toUpperCase();
    for (const s of sites) {
      if (String(s.name || '').toUpperCase() === wanted) return s;
    }
    return sites[0];
  }

  _otherSiteName(name) {
    return String(name).toUpperCase() === 'B' ? 'A' : 'B';
  }

  _ringPoint(bot, cx, cz, radius, spread, phase = 0) {
    const a = bot.seed * TAU + bot.roleIndex * 2.399963 + phase;
    const r = radius + (bot.roleIndex % 3) * spread;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  }

  _snapToWaypoint(x, z, maxDist) {
    const n = this._nearestNode(x, z, maxDist);
    return n ? { x: n.x, z: n.z } : { x, z };
  }

  _nearestEnemySpawnPoint(team) {
    const spawns = this.game.map?.spawns?.[team];
    return Array.isArray(spawns) && spawns.length ? spawns[0] : null;
  }

  _fallbackGoal(bot) {
    const b = this.game.map?.bounds;
    const cx = b ? (b.minX + b.maxX) / 2 : 0;
    const cz = b ? (b.minZ + b.maxZ) / 2 : 0;
    const p = this._ringPoint(bot, cx, cz, 4, 1.5);
    return {
      kind: 'hold',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist: 2,
      face: { x: cx, z: cz },
    };
  }

  _computeGoal(bot) {
    const map = this.game.map;
    const rounds = this.game.rounds;
    if (!map) return this._fallbackGoal(bot);
    const mode = map.mode || 'bomb';
    const planted = !!rounds?.bomb?.planted;

    if (bot.team === 'T') {
      if (mode === 'hostage') return this._tHostageGoal(bot);
      if (planted) return this._tDefendBombGoal(bot);
      if (bot.hasBomb) return this._carrierGoal(bot);
      return this._escortGoal(bot);
    }
    if (mode === 'hostage') return this._ctHostageGoal(bot);
    if (planted) return this._ctDefuseGoal(bot);
    return this._ctSiteGoal(bot);
  }

  _carrierGoal(bot) {
    const rounds = this.game.rounds;
    const site = rounds?.siteTarget === 'B' ? 'B' : 'A';
    const bs = this._bombsite(site);
    if (!bs) return this._fallbackGoal(bot);
    const off = this._ringPoint(bot, bs.x, bs.z, 0, 0.4);
    const ctSpawn = this._nearestEnemySpawnPoint('CT');
    return {
      kind: 'plant',
      x: off.x,
      z: off.z,
      hold: true,
      holdDist: Math.max(1.1, Math.min(2.2, (bs.radius || 6) * 0.55)),
      face: ctSpawn ? { x: ctSpawn.x, z: ctSpawn.z } : { x: bs.x, z: bs.z },
    };
  }

  _tSiteGoal(bot, siteName, ringR = 4.5, spread = 1.4, holdDist = 1.6) {
    const bs = this._bombsite(siteName);
    if (!bs) return this._fallbackGoal(bot);
    const ring = this._ringPoint(bot, bs.x, bs.z, ringR, spread);
    const p = this._snapToWaypoint(ring.x, ring.z, 8);
    const ctSpawn = this._nearestEnemySpawnPoint('CT');
    return {
      kind: 'hold',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist,
      face: ctSpawn ? { x: ctSpawn.x, z: ctSpawn.z } : { x: bs.x, z: bs.z },
    };
  }

  _escortGoal(bot) {
    const rounds = this.game.rounds;
    const player = this.game.player;
    const site = rounds?.siteTarget === 'B' ? 'B' : 'A';

    if (rounds?.bombCarrier === player && player && player.alive) {
      // El jugador lleva la bomba: los T lo escoltan hasta el sitio.
      if (bot.roleIndex >= 3) return this._tSiteGoal(bot, site, 6, 1.6);
      const ring = this._ringPoint(bot, player.pos.x, player.pos.z, 3.2, 1.0);
      return {
        kind: 'escort',
        x: ring.x,
        z: ring.z,
        hold: false,
        holdDist: 2,
        face: { x: player.pos.x, z: player.pos.z },
      };
    }

    if (bot.roleIndex >= 3) {
      // Lurkers: el otro sitio / flanqueo.
      const other = this._otherSiteName(site);
      return this._tSiteGoal(bot, other, 6.5, 2.0, 1.8);
    }
    return this._tSiteGoal(bot, site, 4.5, 1.4, 1.6);
  }

  _tDefendBombGoal(bot) {
    const bomb = this.game.rounds?.bomb;
    if (!bomb) return this._fallbackGoal(bot);
    const r = 6.5 + (bot.roleIndex % 3) * 2.2;
    const ring = this._ringPoint(bot, bomb.x, bomb.z, r, 1.3);
    const p = this._snapToWaypoint(ring.x, ring.z, 9);
    const ctSpawn = this._nearestEnemySpawnPoint('CT');
    return {
      kind: 'defend',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist: 2,
      face: ctSpawn ? { x: ctSpawn.x, z: ctSpawn.z } : { x: bomb.x, z: bomb.z },
    };
  }

  _tHostageGoal(bot) {
    const rounds = this.game.rounds;
    const map = this.game.map;
    const hostages = Array.isArray(rounds?.hostages) ? rounds.hostages : [];
    const rescue = map?.rescueZone;

    const carried = hostages.find((h) => h && !h.rescued && h.following);
    if (carried) {
      // Interceptar entre el rehÃƒÆ’Ã‚Â©n y la zona de rescate.
      let ix = carried.x;
      let iz = carried.z;
      if (rescue) {
        const dx = rescue.x - carried.x;
        const dz = rescue.z - carried.z;
        const l = Math.hypot(dx, dz) || 1;
        ix = carried.x + (dx / l) * 7;
        iz = carried.z + (dz / l) * 7;
      }
      const p = this._snapToWaypoint(ix, iz, 9);
      return {
        kind: 'intercept',
        x: p.x,
        z: p.z,
        hold: true,
        holdDist: 2.2,
        face: { x: carried.x, z: carried.z },
      };
    }

    const spawns = Array.isArray(map?.hostageSpawns) ? map.hostageSpawns : [];
    const base = spawns.length
      ? spawns[bot.roleIndex % spawns.length]
      : { x: 0, z: 0 };
    const ring = this._ringPoint(bot, base.x, base.z, 4.2, 1.4);
    const p = this._snapToWaypoint(ring.x, ring.z, 8);
    return {
      kind: 'defend',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist: 1.8,
      face: rescue ? { x: rescue.x, z: rescue.z } : { x: base.x, z: base.z },
    };
  }

  _ctSiteGoal(bot) {
    const rounds = this.game.rounds;
    const target = rounds?.siteTarget === 'B' ? 'B' : 'A';
    const other = this._otherSiteName(target);
    const siteName = bot.roleIndex % 2 === 0 ? target : other;
    const bs = this._bombsite(siteName);
    if (!bs) return this._fallbackGoal(bot);
    const ring = this._ringPoint(bot, bs.x, bs.z, 5.5, 1.5);
    const p = this._snapToWaypoint(ring.x, ring.z, 9);
    return {
      kind: 'hold',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist: 1.8,
      face: { x: bs.x, z: bs.z },
    };
  }

  _ctDefuseGoal(bot) {
    const rounds = this.game.rounds;
    const bomb = rounds?.bomb;
    const player = this.game.player;
    if (!bomb || !bomb.planted) return this._ctSiteGoal(bot);

    // Los 2 CT mÃƒÆ’Ã‚Â¡s cercanos van directo a la bomba (rounds auto-desfusea <=1.9m).
    const alive = this.bots.filter((b) => b.alive && b.team === 'CT');
    alive.sort(
      (a, b) =>
        distance2D(a.pos.x, a.pos.z, bomb.x, bomb.z) -
        distance2D(b.pos.x, b.pos.z, bomb.x, bomb.z),
    );
    const rank = alive.indexOf(bot);
    const playerNear =
      player && player.alive && player.team === 'CT' &&
      distance2D(player.pos.x, player.pos.z, bomb.x, bomb.z) < 3;
    const defuseCount = playerNear ? 1 : 2;

    if (rank >= 0 && rank < defuseCount) {
      // Quedarse bien pegado a la bomba: rounds.js auto-desfusea a <=1.9m 2D.
      const off = this._ringPoint(bot, bomb.x, bomb.z, 0.15, 0.3);
      return {
        kind: 'defuse',
        x: off.x,
        z: off.z,
        hold: true,
        holdDist: 0.9,
        face: { x: bomb.x, z: bomb.z },
      };
    }

    const ring = this._ringPoint(bot, bomb.x, bomb.z, 6, 1.6);
    const p = this._snapToWaypoint(ring.x, ring.z, 8);
    const tSpawn = this._nearestEnemySpawnPoint('T');
    return {
      kind: 'defend',
      x: p.x,
      z: p.z,
      hold: true,
      holdDist: 1.8,
      face: tSpawn ? { x: tSpawn.x, z: tSpawn.z } : { x: bomb.x, z: bomb.z },
    };
  }

  _ctHostageGoal(bot) {
    const rounds = this.game.rounds;
    const map = this.game.map;
    const hostages = Array.isArray(rounds?.hostages) ? rounds.hostages : [];
    const rescue = map?.rescueZone || { x: 0, z: 0, radius: 4 };

    if (!hostages.length) {
      return {
        kind: 'rescue',
        x: rescue.x,
        z: rescue.z,
        hold: true,
        holdDist: 2.5,
        face: { x: rescue.x, z: rescue.z },
      };
    }

    // RehÃƒÆ’Ã‚Â©n que este bot ya estÃƒÆ’Ã‚Â¡ escoltando (rounds asigna automÃƒÆ’Ã‚Â¡ticamente <=2m).
    const mine = hostages.find(
      (h) =>
        h && !h.rescued &&
        (h.following === bot || h.carrier === bot || h.carrierId === bot.id),
    );
    if (mine) {
      return {
        kind: 'rescue',
        x: rescue.x,
        z: rescue.z,
        hold: true,
        holdDist: Math.max(1.5, (rescue.radius || 4) * 0.5),
        face: { x: rescue.x, z: rescue.z },
      };
    }

    const free = hostages.filter((h) => h && !h.rescued && !h.following);
    if (!free.length) {
      // Otro CT lo lleva: cubrir la zona de rescate.
      return {
        kind: 'rescue',
        x: rescue.x,
        z: rescue.z,
        hold: true,
        holdDist: 2.5,
        face: { x: rescue.x, z: rescue.z },
      };
    }

    let best = free[0];
    let bestD = Infinity;
    for (const h of free) {
      const d = distance2D(bot.pos.x, bot.pos.z, h.x, h.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    // rounds.js toma el rehÃƒÆ’Ã‚Â©n automÃƒÆ’Ã‚Â¡ticamente si un CT estÃƒÆ’Ã‚Â¡ a <=2m: nos acercamos y esperamos.
    return {
      kind: 'getHostage',
      x: best.x,
      z: best.z,
      hold: bestD <= 2.0,
      holdDist: 1.3,
      face: { x: best.x, z: best.z },
    };
  }

  _maybeTakeCover(bot) {
    const profile = this.profile;
    if (profile.coverChance <= 0 || bot.coverTimer > 0 || bot.coverCheckTimer > 0) return;
    if (!bot.target || !bot.targetVisible || bot.health > 55) return;
    const tDist = distance2D(bot.pos.x, bot.pos.z, bot.target.pos.x, bot.target.pos.z);
    if (tDist < 12) return;
    bot.coverCheckTimer = 1.1;
    if (!chance(profile.coverChance)) return;

    const cands = [];
    for (const n of this.nav.nodes) {
      const d = distance2D(bot.pos.x, bot.pos.z, n.x, n.z);
      if (d > 1.2 && d < 10) cands.push({ n, d });
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.d - b.d);

    this._eyeOfEntity(bot.target, this._sTarget);
    const from = this._sLosA;
    const to = this._sLosB;
    const count = Math.min(10, cands.length);
    for (let i = 0; i < count; i++) {
      const node = cands[i].n;
      from.set(node.x, node.y + 1.2, node.z);
      to.copy(this._sTarget);
      if (!this.game.hasLineOfSight?.(from, to)) {
        bot.coverX = node.x;
        bot.coverZ = node.z;
        bot.coverTimer = rand(1.4, 2.6);
        bot.coverCheckTimer = 2.0;
        return;
      }
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Movimiento
   * -------------------------------------------------------------------------------------------- */

  _updateMovement(bot, dt, goal) {
    const profile = this.profile;

    if (bot.coverTimer > 0) {
      bot.state = 'cover';
      this._moveToward(bot, bot.coverX, bot.coverZ, profile.moveSpeed * 1.02, dt);
      return;
    }

    const hasTarget = !!(bot.target && bot.target.alive && bot.targetVisible);
    const tDist = hasTarget
      ? distance2D(bot.pos.x, bot.pos.z, bot.target.pos.x, bot.target.pos.z)
      : Infinity;
    const gDist = distance2D(bot.pos.x, bot.pos.z, goal.x, goal.z);
    const arrived = gDist <= (goal.holdDist ?? 1.5);
    const objective = goal.kind === 'plant' || goal.kind === 'defuse';

    if (hasTarget && tDist < profile.engageRange) {
      // Prioridad de objetivo: plantar/desfusear quieto salvo enemigo muy cerca.
      if (objective && arrived && tDist > 7) {
        bot.vel.x = 0;
        bot.vel.z = 0;
        bot.state = goal.kind;
        this._applyMove(bot, 0, 0, 0, dt);
        return;
      }
      // Si el portador/desfuseador todavÃƒÆ’Ã‚Â­a no llegÃƒÆ’Ã‚Â³, sigue avanzando bajo fuego lejano;
      // de lo contrario puede quedar trabado en un tiroteo y nunca completar el objetivo.
      if (objective && !arrived && tDist > 6) {
        bot.state = 'objective';
        this._moveToward(bot, goal.x, goal.z, profile.moveSpeed * (goal.speedMult || 1), dt);
        return;
      }
      bot.state = 'combat';
      if (bot.combatStrafeTimer <= 0) {
        bot.combatStrafeTimer = rand(0.3, 0.95) / Math.max(0.6, profile.strafeFreq * 0.5);
        bot.strafeDir = chance(0.5) ? 1 : -1;
        bot.combatStop = chance(0.32);
      }
      if (bot.combatStop) {
        this._applyMove(bot, 0, 0, 0, dt);
      } else {
        const dx = bot.target.pos.x - bot.pos.x;
        const dz = bot.target.pos.z - bot.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this._applyMove(
          bot,
          (-dz / l) * bot.strafeDir,
          (dx / l) * bot.strafeDir,
          profile.moveSpeed * profile.strafeSpeed,
          dt,
        );
      }
      return;
    }

    if (goal.hold && arrived) {
      bot.state = goal.kind;
      if (objective) {
        bot.vel.x = 0;
        bot.vel.z = 0;
      }
      this._applyMove(bot, 0, 0, 0, dt);
      return;
    }

    bot.state = 'move';
    this._moveToward(bot, goal.x, goal.z, profile.moveSpeed * (goal.speedMult || 1), dt);
  }

  _moveToward(bot, tx, tz, speed, dt) {
    // DesvÃƒÆ’Ã‚Â­o anti-atasco en curso: ir directo al punto de desvÃƒÆ’Ã‚Â­o.
    if (bot.detourTimer > 0) {
      const ddx = bot.detourX - bot.pos.x;
      const ddz = bot.detourZ - bot.pos.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd < 0.7) {
        bot.detourTimer = 0;
        bot.path = null;
      } else {
        this._applyMove(bot, ddx / dd, ddz / dd, Math.max(2.4, speed * 0.8), dt);
        return;
      }
    }

    const dist = distance2D(bot.pos.x, bot.pos.z, tx, tz);
    if (dist < 0.35) {
      this._applyMove(bot, 0, 0, 0, dt);
      return;
    }

    let dirX;
    let dirZ;
    if (this._canWalkDirect(bot, tx, tz)) {
      bot.path = null;
      dirX = (tx - bot.pos.x) / dist;
      dirZ = (tz - bot.pos.z) / dist;
    } else {
      if (this._needsPath(bot, tx, tz)) this._computePath(bot, tx, tz);
      const node =
        bot.path && bot.pathIndex < bot.path.length ? bot.path[bot.pathIndex] : null;
      if (node) {
        let nd = distance2D(bot.pos.x, bot.pos.z, node.x, node.z);
        if (nd < 1.0) {
          bot.pathIndex++;
          const next =
            bot.pathIndex < bot.path.length ? bot.path[bot.pathIndex] : null;
          if (next) {
            nd = Math.max(0.001, distance2D(bot.pos.x, bot.pos.z, next.x, next.z));
            dirX = (next.x - bot.pos.x) / nd;
            dirZ = (next.z - bot.pos.z) / nd;
          } else {
            dirX = (tx - bot.pos.x) / dist;
            dirZ = (tz - bot.pos.z) / dist;
          }
        } else {
          dirX = (node.x - bot.pos.x) / nd;
          dirZ = (node.z - bot.pos.z) / nd;
        }
      } else {
        // Camino agotado y la lÃƒÆ’Ã‚Â­nea directa estÃƒÆ’Ã‚Â¡ bloqueada: forzar recÃƒÆ’Ã‚Â¡lculo en el prÃƒÆ’Ã‚Â³ximo tick.
        bot.path = null;
        dirX = (tx - bot.pos.x) / dist;
        dirZ = (tz - bot.pos.z) / dist;
      }
    }

    if (bot.avoidTimer > 0) {
      dirX = dirX * 0.35 + bot.avoidX * 0.65;
      dirZ = dirZ * 0.35 + bot.avoidZ * 0.65;
    }

    const l = Math.hypot(dirX, dirZ);
    if (l < 0.01) {
      this._applyMove(bot, 0, 0, 0, dt);
      return;
    }
    this._applyMove(bot, dirX / l, dirZ / l, speed, dt);
  }

  _canWalkDirect(bot, tx, tz) {
    const dist = distance2D(bot.pos.x, bot.pos.z, tx, tz);
    if (dist < 1.2) return true;
    if (dist > 26) return false;
    const from = this._sLosA.set(bot.pos.x, bot.pos.y + 1.0, bot.pos.z);
    const to = this._sLosB.set(tx, bot.pos.y + 1.0, tz);
    return !!this.game.hasLineOfSight?.(from, to);
  }

  _needsPath(bot, tx, tz) {
    if (!bot.path) return true;
    if (bot.repathTimer <= 0) return true;
    return distance2D(bot._goalPathX, bot._goalPathZ, tx, tz) > 2.5;
  }

  _computePath(bot, tx, tz) {
    const nodes = this.nav.nodes;
    bot._goalPathX = tx;
    bot._goalPathZ = tz;
    bot.repathTimer = rand(1.6, 2.8);
    if (!nodes.length) {
      bot.path = null;
      return;
    }
    const startN =
      this._nearestNode(bot.pos.x, bot.pos.z, 10) ||
      this._nearestNode(bot.pos.x, bot.pos.z);
    const goalN = this._nearestNode(tx, tz);
    if (!startN || !goalN) {
      bot.path = null;
      return;
    }
    const idxs = this._astar(startN.index, goalN.index);
    if (!idxs || !idxs.length) {
      bot.path = [goalN];
      bot.pathIndex = 0;
      return;
    }
    bot.path = idxs.map((i) => nodes[i]);
    bot.pathIndex =
      distance2D(bot.pos.x, bot.pos.z, startN.x, startN.z) < 1.5 ? 1 : 0;
    if (bot.pathIndex >= bot.path.length) {
      bot.pathIndex = Math.max(0, bot.path.length - 1);
    }
  }

  _applyMove(bot, dirX, dirZ, speed, dt) {
    const len = Math.hypot(dirX, dirZ);

    // FricciÃƒÆ’Ã‚Â³n SIEMPRE antes de acelerar (igual que Player.applyFriction): sin esto,
    // al rotar la direcciÃƒÆ’Ã‚Â³n deseada la velocidad acumulada crece sin lÃƒÆ’Ã‚Â­mite.
    const sp = Math.hypot(bot.vel.x, bot.vel.z);
    if (sp > 0.05) {
      const drop = Math.max(sp, 1.6) * 9.5 * dt;
      const scale = Math.max(0, sp - drop) / sp;
      bot.vel.x *= scale;
      bot.vel.z *= scale;
    } else {
      bot.vel.x = 0;
      bot.vel.z = 0;
    }

    if (len > 0.001 && speed > 0.05) {
      dirX /= len;
      dirZ /= len;
      bot._wishX = dirX;
      bot._wishZ = dirZ;
      bot._moving = true;
      const current = bot.vel.x * dirX + bot.vel.z * dirZ;
      const add = speed - current;
      if (add > 0) {
        const a = Math.min(12 * speed * dt, add);
        bot.vel.x += dirX * a;
        bot.vel.z += dirZ * a;
      }
      // Tope duro de velocidad horizontal.
      const maxSpeed = speed * 1.15 + 0.4;
      const s2 = Math.hypot(bot.vel.x, bot.vel.z);
      if (s2 > maxSpeed) {
        const k = maxSpeed / s2;
        bot.vel.x *= k;
        bot.vel.z *= k;
      }
    } else {
      bot._wishX = 0;
      bot._wishZ = 0;
      bot._moving = false;
    }

    bot.vel.y -= 18 * dt;
    this.game.physics?.moveBody?.(bot, dt);
    bot.speed = Math.hypot(bot.vel.x, bot.vel.z);
  }

  _updateFacing(bot, dt, goal) {
    const profile = this.profile;
    let desiredYaw = bot.yaw;
    let desiredPitch = 0;

    if (bot.target && bot.targetVisible) {
      desiredYaw = bot.aimYaw;
      desiredPitch = bot.aimPitch;
      bot._holdYaw = null;
    } else if (bot.target && bot.lastSeenTimer < 2.2) {
      const dx = bot.target.pos.x - bot.pos.x;
      const dz = bot.target.pos.z - bot.pos.z;
      desiredYaw = Math.atan2(-dx, -dz);
      desiredPitch = 0.05;
    } else if (bot._moving) {
      const l = Math.hypot(bot._wishX, bot._wishZ);
      if (l > 0.05) desiredYaw = Math.atan2(-bot._wishX, -bot._wishZ);
      bot._holdYaw = null;
    } else if (goal.face) {
      const dx = goal.face.x - bot.pos.x;
      const dz = goal.face.z - bot.pos.z;
      if (Math.hypot(dx, dz) > 0.4) {
        bot._holdYaw = Math.atan2(-dx, -dz);
      }
    }

    if (!bot.target && !bot._moving && bot._holdYaw !== null) {
      desiredYaw = bot._holdYaw + Math.sin(this._time * 0.5 + bot.seed * TAU) * 0.5;
    }

    const maxTurn = profile.turnSpeed * dt;
    bot.yaw = normalizeYaw(approachAngle(bot.yaw, desiredYaw, maxTurn));
    bot.pitch = clamp(
      bot.pitch + clamp(desiredPitch - bot.pitch, -maxTurn * 0.8, maxTurn * 0.8),
      -1.0,
      1.0,
    );
  }

  /* ----------------------------------------------------------------------------------------------
   * AnimaciÃƒÆ’Ã‚Â³n / muerte
   * -------------------------------------------------------------------------------------------- */

  _animate(bot, dt) {
    const p = bot.parts;
    if (!p) return;
    const moving = bot._moving && bot.onGround && bot.speed > 0.6;
    if (p.character) {
      const bob = moving ? Math.abs(Math.sin(bot.animPhase)) * 0.02 : Math.sin(this._time * 1.7 + bot.seed * TAU) * 0.004;
      bot.group.position.set(bot.pos.x, bot.pos.y + bob, bot.pos.z);
      bot.group.rotation.set(0, bot.yaw + (p.character?.yawOffset || 0), 0);
      p.character.update(dt, bot, moving);
      return;
    }
    bot.animPhase += dt * (moving ? 6 + bot.speed * 1.15 : 0.9);
    const swing = moving ? Math.sin(bot.animPhase) * clamp(bot.speed / 5, 0.35, 1) : 0;
    const idleSway = Math.sin(this._time * 1.6 + bot.seed * TAU) * 0.035;

    p.legL.rotation.x = swing * 0.72;
    p.legR.rotation.x = -swing * 0.72;
    p.armL.rotation.x = -1.12 - swing * 0.26 + idleSway;
    p.armR.rotation.x = -1.2 + swing * 0.2 - idleSway;

    const bob = moving ? Math.abs(Math.sin(bot.animPhase)) * 0.035 : Math.sin(this._time * 1.7 + bot.seed * TAU) * 0.006;
    bot.group.position.set(bot.pos.x, bot.pos.y + bob, bot.pos.z);
    bot.group.rotation.set(0, bot.yaw, 0);

    if (p.headGroup) {
      p.headGroup.rotation.x = clamp(bot.pitch * 0.7, -0.55, 0.55);
      p.headGroup.rotation.y = bot.target ? 0 : Math.sin(this._time * 0.55 + bot.seed * TAU) * 0.42;
    }
    if (p.weaponGroup) {
      p.weaponGroup.rotation.x = clamp(bot.pitch * 0.85, -0.9, 0.9);
      p.weaponGroup.rotation.y = -0.06;
    }
    if (p.helmet) p.helmet.visible = !!bot.helmet;
    if (p.cap) p.cap.visible = !bot.helmet;
    if (p.bomb) p.bomb.visible = !!bot.hasBomb;
    if (p.kit) p.kit.visible = !!bot.hasKit;
  }

  _updateDeath(bot, dt) {
    if (!bot.group) return;
    bot.deathTime += dt;
    const t = Math.min(1, bot.deathTime / 0.7);
    const e = 1 - Math.pow(1 - t, 3);
    const p = bot.parts;
    bot.group.visible = bot.corpseTimer > 0;
    bot.group.position.set(bot.pos.x, bot.pos.y + 0.16 * e, bot.pos.z);
    bot.group.rotation.set(bot.fallSign * e * 1.45, bot.yaw + (p?.character?.yawOffset || 0), bot.fallTilt * e);

    if (p) {
      if (p.character) {
        p.character.mixer?.update(0);
        bot.corpseTimer = Math.max(0, bot.corpseTimer - dt);
        if (bot.corpseTimer <= 0) bot.group.visible = false;
        return;
      }
      const relax = Math.min(1, bot.deathTime / 0.6);
      p.legL.rotation.x = lerp(p.legL.rotation.x, 0.25, relax * 0.25);
      p.legR.rotation.x = lerp(p.legR.rotation.x, -0.15, relax * 0.25);
      p.armL.rotation.x = lerp(p.armL.rotation.x, -0.35, relax * 0.25);
      p.armR.rotation.x = lerp(p.armR.rotation.x, -0.5, relax * 0.25);
      if (p.weaponGroup) p.weaponGroup.rotation.x = lerp(p.weaponGroup.rotation.x, 0, relax * 0.2);
    }

    bot.corpseTimer = Math.max(0, bot.corpseTimer - dt);
    if (bot.corpseTimer <= 0) bot.group.visible = false;
  }

  _checkStuck(bot, dt) {
    bot.stuckCheckTimer += dt;
    if (bot.stuckCheckTimer < 0.7) return;
    const moved = distance2D(bot.pos.x, bot.pos.z, bot._chkPos.x, bot._chkPos.z);
    if (bot._moving && moved < 0.18) {
      bot.stuckCount++;
      // Esquivar perpendicular a la direcciÃƒÆ’Ã‚Â³n deseada (deslizarse por la pared).
      let ax = -(bot._wishZ || 0);
      let az = bot._wishX || 0;
      const sign = Math.random() < 0.5 ? 1 : -1;
      ax *= sign;
      az *= sign;
      if (Math.hypot(ax, az) < 0.1) {
        const a = rand(0, TAU);
        ax = Math.cos(a);
        az = Math.sin(a);
      }
      bot.avoidX = ax;
      bot.avoidZ = az;
      bot.avoidTimer = rand(0.5, 1.0);
      if (bot.onGround && bot.stuckCount % 2 === 1) {
        bot.vel.y = 4.6;
        bot.onGround = false;
      }
      if (bot.stuckCount >= 2) {
        bot.stuckCount = 0;
        bot.path = null;
        bot.repathTimer = 0;
        // Punto de desvÃƒÆ’Ã‚Â­o corto y lateral; al terminar se recalcula el camino.
        let dx = bot.pos.x + ax * rand(3.5, 5.5);
        let dz = bot.pos.z + az * rand(3.5, 5.5);
        const b = this.game.map?.bounds;
        if (b) {
          dx = clamp(dx, b.minX + 1, b.maxX - 1);
          dz = clamp(dz, b.minZ + 1, b.maxZ - 1);
        }
        bot.detourX = dx;
        bot.detourZ = dz;
        bot.detourTimer = 1.0;
      }
    } else {
      bot.stuckCount = 0;
    }
    bot._chkPos.copy(bot.pos);
    bot.stuckCheckTimer = 0;
  }

  /* ----------------------------------------------------------------------------------------------
   * NavegaciÃƒÆ’Ã‚Â³n: grafo + A*
   * -------------------------------------------------------------------------------------------- */

  _buildNavGraph() {
    const map = this.game.map;
    const wps = Array.isArray(map?.waypoints) ? map.waypoints : [];
    const nodes = [];
    const byId = new Map();

    for (let i = 0; i < wps.length; i++) {
      const w = wps[i];
      if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.z)) continue;
      const node = {
        index: nodes.length,
        id: w.id ?? i,
        x: w.x,
        y: Number.isFinite(w.y) ? w.y : 0,
        z: w.z,
        tags: Array.isArray(w.tags) ? w.tags : [],
        links: Array.isArray(w.links) ? w.links : [],
        neighbors: [],
      };
      nodes.push(node);
      if (!byId.has(node.id)) byId.set(node.id, node);
    }

    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!a.neighbors.includes(b)) a.neighbors.push(b);
      if (!b.neighbors.includes(a)) b.neighbors.push(a);
    };

    for (const n of nodes) {
      for (const lid of n.links) link(n, byId.get(lid));
    }

    // Fallback: nodos aislados se conectan a los mÃƒÆ’Ã‚Â¡s cercanos.
    for (const n of nodes) {
      if (n.neighbors.length) continue;
      const cands = [];
      for (const o of nodes) {
        if (o === n) continue;
        const d = distance2D(n.x, n.z, o.x, o.z);
        if (d <= 9) cands.push({ o, d });
      }
      cands.sort((a, b) => a.d - b.d);
      for (let i = 0; i < Math.min(2, cands.length); i++) link(n, cands[i].o);
    }

    // Conectar componentes separados (mapas a medio hacer).
    const comp = new Map();
    let compCount = 0;
    for (const n of nodes) {
      if (comp.has(n)) continue;
      const queue = [n];
      comp.set(n, compCount);
      while (queue.length) {
        const c = queue.pop();
        for (const o of c.neighbors) {
          if (!comp.has(o)) {
            comp.set(o, compCount);
            queue.push(o);
          }
        }
      }
      compCount++;
    }
    if (compCount > 1) {
      for (const n of nodes) {
        let best = null;
        let bd = Infinity;
        for (const o of nodes) {
          if (comp.get(o) === comp.get(n)) continue;
          const d = distance2D(n.x, n.z, o.x, o.z);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (best && bd < 30) link(n, best);
      }
    }

    this.nav = { nodes, byId, mapId: map?.id || null };
    this._mapId = map?.id || null;
  }

  _nearestNode(x, z, maxDist = Infinity) {
    let best = null;
    let bd = maxDist;
    for (const n of this.nav.nodes) {
      const d = distance2D(x, z, n.x, n.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  _astar(startIndex, goalIndex) {
    const nodes = this.nav.nodes;
    const start = nodes[startIndex];
    const goal = nodes[goalIndex];
    if (!start || !goal) return null;
    if (start === goal) return [startIndex];

    const n = nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const fScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const open = [start];
    const inOpen = new Uint8Array(n);
    inOpen[startIndex] = 1;
    gScore[startIndex] = 0;
    fScore[startIndex] = distance2D(start.x, start.z, goal.x, goal.z);

    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i].index] < fScore[open[bi].index]) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      inOpen[cur.index] = 0;

      if (cur === goal) {
        const path = [];
        let c = goal;
        while (c) {
          path.push(c.index);
          const prev = came[c.index];
          if (prev < 0) break;
          c = nodes[prev];
        }
        path.reverse();
        return path;
      }

      for (const nb of cur.neighbors) {
        const step = Math.max(0.05, distance2D(cur.x, cur.z, nb.x, nb.z));
        const tentative = gScore[cur.index] + step;
        if (tentative < gScore[nb.index] - 1e-9) {
          came[nb.index] = cur.index;
          gScore[nb.index] = tentative;
          fScore[nb.index] = tentative + distance2D(nb.x, nb.z, goal.x, goal.z);
          if (!inOpen[nb.index]) {
            inOpen[nb.index] = 1;
            open.push(nb);
          }
        }
      }
    }
    return null;
  }

  /* ----------------------------------------------------------------------------------------------
   * Audio / utilidades
   * -------------------------------------------------------------------------------------------- */

  _distToPlayer(pos) {
    const p = this.game.player;
    if (!p || !p.pos) return 999;
    return distance2D(pos.x, pos.z, p.pos.x, p.pos.z);
  }

  _panForPos(pos) {
    const p = this.game.player;
    if (!p || !p.pos) return 0;
    const dx = pos.x - p.pos.x;
    const dz = pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return 0;
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    return clamp((dx * rx + dz * rz) / d, -1, 1) * 0.75;
  }

  _playGun(bot, w) {
    const dist = this._distToPlayer(bot.pos);
    if (dist > 75) return;
    const vol = clamp(1 - dist / 80, 0.06, 0.95);
    this.game.audio?.play(w.sound, { volume: vol * 0.9, pan: this._panForPos(bot.pos) });
  }

  _footstep(bot) {
    if (this._distToPlayer(bot.pos) > 22) return;
    this.game.audio?.play('footstep', {
      volume: 0.16,
      pan: this._panForPos(bot.pos),
    });
  }

  /* ----------------------------------------------------------------------------------------------
   * Fin de ronda / dispose
   * -------------------------------------------------------------------------------------------- */

  onRoundEnd() {
    for (const bot of this.bots) {
      bot.target = null;
      bot.targetVisible = false;
      bot.vel.x = 0;
      bot.vel.z = 0;
      bot._moving = false;
      bot.path = null;
      if (bot.state !== 'dead') bot.state = 'idle';
    }
  }

  dispose() {
    this._clearBots();
    for (const g of this._geos) g.dispose?.();
    for (const m of this._mats) m.dispose?.();
    this._geos = [];
    this._mats = [];
    this.assets = { geo: {}, mats: {} };
    this.nav = { nodes: [], byId: new Map(), mapId: null };
    this._mapId = null;
  }
}





