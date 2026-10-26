import { aimDirection, shotDirections } from './combat/shot.js';
/**
 * CS 1.6 inspired weapon system: data table, hitscan shooting, recoil/spread, reloads,
 * weapon switching, grenades (physics + HE/flash/smoke effects), C4 slot and the buy menu.
 *
 * Only depends on the public Game API described in CONTRACTS.md / GAMEPLAY_API.md.
 * The first person model lives in ./viewmodel.js (also owned by combat-weapons).
 */
import * as THREE from '../vendor/three.module.js';
import { clamp, expDamp, rand, DEG } from './core/utils.js';
import { ViewModel } from './viewmodel.js';
import { DroppedWeaponSystem } from './world/dropped-weapons.js';

import { RecoilState, accuracyRadius } from './combat/recoil.js';
import { CS2_PROFILES } from './combat/cs2-data.js';
import { rangedDamage, CS_UNITS_PER_WORLD } from './combat/ballistics.js';

const UP = new THREE.Vector3(0, 1, 0);
const GRENADE_IDS = ['he', 'flash', 'smoke'];
const GRENADE_MAX = { he: 1, flash: 2, smoke: 1 };
const GRENADE_COLORS = { he: 0x44583c, flash: 0x777c82, smoke: 0x8d7d5e };
const AMMO_PRICE = { primary: 60, secondary: 30 };
const RELOAD_TIME = 2.0;
const RELOAD_SOUND = 'reload_start';
const MOVE_SPEED = {
  knife: 6.25,
  glock: 6.25,
  usp: 6.25,
  deagle: 6.25,
  mp5: 6.25,
  ak47: 5.525,
  m4a1: 5.75,
  awp: 5.25,
  scout: 6.5,
  m3: 5.75,
  xm1014: 6.0,
  m249: 5.5,
  he: 6.25,
  flash: 6.25,
  smoke: 6.25,
  c4: 6.25,
};

/**
 * Weapon data. Approximate CS 1.6 values.
 * `fireRate` is shots per second (use `fireInterval` for seconds between shots).
 * `spread` / `moveSpread` / recoil are degrees; `range` is meters.
 */
export const WEAPONS = {
  knife: {
    id: 'knife',
    name: 'Cuchillo',
    slot: 3,
    type: 'knife',
    price: 0,
    team: 'both',
    damage: 55,
    fireRate: 1.8,
    auto: false,
    magazine: 0,
    reserve: 0,
    reloadTime: 0,
    spread: 0.4,
    moveSpread: 0,
    recoil: 1.1,
    range: 2.4,
    killReward: 1500,
    headshotMult: 4,
    icon: 'knife',
    sound: 'knife_swing',
    volume: 1,
    flashScale: 0.4,
    description: 'Silencioso y letal por la espalda.',
  },
  glock: {
    id: 'glock',
    name: 'Glock-18',
    slot: 2,
    type: 'pistol',
    price: 400,
    team: 'T',
    damage: 25,
    fireRate: 5.6,
    auto: false,
    magazine: 20,
    reserve: 120,
    reloadTime: 2.0,
    spread: 1.15,
    moveSpread: 1.6,
    recoil: 1.0,
    range: 60,
    killReward: 300,
    headshotMult: 4,
    icon: 'pistol',
    sound: 'gun_pistol',
    volume: 0.95,
    flashScale: 0.8,
    description: 'Pistola inicial terrorista, cargador amplio.',
  },
  usp: {
    id: 'usp',
    name: 'USP .45',
    slot: 2,
    type: 'pistol',
    price: 500,
    team: 'CT',
    damage: 34,
    fireRate: 5.6,
    auto: false,
    magazine: 12,
    reserve: 100,
    reloadTime: 2.0,
    spread: 0.95,
    moveSpread: 1.5,
    recoil: 1.1,
    range: 65,
    killReward: 300,
    headshotMult: 4,
    icon: 'pistol',
    sound: 'gun_pistol',
    volume: 0.95,
    flashScale: 0.8,
    description: 'Pistola inicial antiterrorista, precisa y potente.',
  },
  deagle: {
    id: 'deagle',
    name: 'Desert Eagle',
    slot: 2,
    type: 'pistol',
    price: 650,
    team: 'both',
    damage: 53,
    fireRate: 4.0,
    auto: false,
    magazine: 7,
    reserve: 35,
    reloadTime: 2.0,
    spread: 1.25,
    moveSpread: 1.9,
    recoil: 2.7,
    range: 80,
    killReward: 300,
    headshotMult: 4,
    icon: 'pistol',
    sound: 'gun_pistol',
    volume: 1.2,
    flashScale: 1.1,
    description: 'Máximo daño de pistola, retroceso brutal.',
  },
  mp5: {
    id: 'mp5',
    name: 'MP5 Navy',
    slot: 1,
    type: 'smg',
    price: 1500,
    team: 'both',
    damage: 26,
    fireRate: 12.5,
    auto: true,
    magazine: 30,
    reserve: 120,
    reloadTime: 2.0,
    spread: 1.35,
    moveSpread: 1.15,
    recoil: 0.9,
    range: 90,
    killReward: 600,
    headshotMult: 4,
    icon: 'smg',
    sound: 'gun_smg',
    volume: 0.95,
    spreadPerShot: 0.16,
    maxSpread: 3.2,
    flashScale: 0.9,
    description: 'Subfusil preciso y fácil de controlar.',
  },
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    slot: 1,
    type: 'rifle',
    price: 2500,
    team: 'T',
    damage: 36,
    fireRate: 10,
    auto: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.0,
    spread: 0.85,
    moveSpread: 2.7,
    recoil: 2.6,
    range: 120,
    killReward: 300,
    headshotMult: 4,
    icon: 'rifle',
    sound: 'gun_rifle',
    volume: 1.1,
    spreadPerShot: 0.42,
    maxSpread: 5.5,
    flashScale: 1.2,
    description: 'Rifle terrorista: un tiro a la cabeza y adiós.',
  },
  m4a1: {
    id: 'm4a1',
    name: 'M4A1',
    slot: 1,
    type: 'rifle',
    price: 3100,
    team: 'CT',
    damage: 32,
    fireRate: 11.1,
    auto: true,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.0,
    spread: 0.8,
    moveSpread: 2.4,
    recoil: 2.0,
    range: 120,
    killReward: 300,
    headshotMult: 4,
    icon: 'rifle',
    sound: 'gun_rifle',
    volume: 1.05,
    spreadPerShot: 0.34,
    maxSpread: 4.6,
    flashScale: 1.05,
    description: 'Rifle antiterrorista, control de retroceso superior.',
  },
  awp: {
    id: 'awp',
    name: 'AWP',
    slot: 1,
    type: 'sniper',
    price: 4750,
    team: 'both',
    damage: 115,
    fireRate: 0.7,
    auto: false,
    magazine: 10,
    reserve: 30,
    reloadTime: 2.0,
    spread: 5.5,
    moveSpread: 5.5,
    recoil: 4.6,
    range: 200,
    killReward: 100,
    headshotMult: 4,
    icon: 'sniper',
    sound: 'gun_sniper',
    volume: 1.35,
    zoomFov: 25,
    flashScale: 1.6,
    description: 'Un disparo, una muerte. Usá el zoom con clic derecho.',
  },
  scout: {
    id: 'scout',
    name: 'Steyr Scout',
    slot: 1,
    type: 'sniper',
    price: 2750,
    team: 'both',
    damage: 75,
    fireRate: 0.8,
    auto: false,
    magazine: 10,
    reserve: 90,
    reloadTime: 2.0,
    spread: 4.2,
    moveSpread: 4.2,
    recoil: 3.0,
    range: 200,
    killReward: 300,
    headshotMult: 4,
    icon: 'sniper',
    sound: 'gun_sniper',
    volume: 1.2,
    zoomFov: 40,
    flashScale: 1.25,
    description: 'Francotirador liviano y rápido de apuntar.',
  },
  xm1014: {
    id: 'xm1014',
    name: 'XM1014',
    slot: 1,
    type: 'shotgun',
    price: 3000,
    team: 'both',
    damage: 20,
    pellets: 6,
    fireRate: 4.0,
    auto: false,
    magazine: 7,
    reserve: 32,
    reloadTime: 2.0,
    spread: 2.4,
    moveSpread: 1.8,
    recoil: 2.2,
    range: 40,
    killReward: 900,
    headshotMult: 4,
    icon: 'shotgun',
    sound: 'gun_shotgun',
    volume: 1.25,
    flashScale: 1.4,
    description: 'Escopeta semiautomática, letal de cerca.',
  },
  m3: {
    id: 'm3',
    name: 'Benelli M3',
    slot: 1,
    type: 'shotgun',
    price: 1700,
    team: 'both',
    damage: 26,
    pellets: 9,
    fireRate: 1.2,
    auto: false,
    magazine: 8,
    reserve: 32,
    reloadTime: 2.0,
    spread: 3.3,
    moveSpread: 2.0,
    recoil: 3.0,
    range: 35,
    killReward: 900,
    headshotMult: 4,
    icon: 'shotgun',
    sound: 'gun_shotgun',
    volume: 1.2,
    flashScale: 1.45,
    description: 'Escopeta de bombeo: devastadora a corta distancia.',
  },
  m249: {
    id: 'm249',
    name: 'M249',
    slot: 1,
    type: 'lmg',
    price: 5750,
    team: 'both',
    damage: 32,
    fireRate: 10,
    auto: true,
    magazine: 100,
    reserve: 200,
    reloadTime: 2.0,
    spread: 1.55,
    moveSpread: 3.1,
    recoil: 2.3,
    range: 120,
    killReward: 600,
    headshotMult: 4,
    icon: 'mg',
    sound: 'gun_lmg',
    volume: 1.3,
    spreadPerShot: 0.3,
    maxSpread: 5.4,
    flashScale: 1.35,
    description: 'Ametralladora de 100 balas para negar zonas.',
  },
  he: {
    id: 'he',
    name: 'Granada HE',
    slot: 4,
    type: 'grenade',
    price: 300,
    team: 'both',
    damage: 98,
    fireRate: 0.7,
    auto: false,
    magazine: 1,
    reserve: 0,
    reloadTime: 0,
    spread: 0,
    moveSpread: 0,
    recoil: 0.8,
    range: 20,
    killReward: 300,
    headshotMult: 4,
    icon: 'grenade',
    sound: 'knife_swing',
    volume: 0.4,
    fuse: 2.6,
    radius: 9.5,
    throwSpeed: 17,
    description: 'Daño radial. Rebota y explota a los 2.6 s.',
  },
  flash: {
    id: 'flash',
    name: 'Flashbang',
    slot: 4,
    type: 'grenade',
    price: 200,
    team: 'both',
    damage: 0,
    fireRate: 0.7,
    auto: false,
    magazine: 1,
    reserve: 0,
    reloadTime: 0,
    spread: 0,
    moveSpread: 0,
    recoil: 0.5,
    range: 20,
    killReward: 300,
    headshotMult: 4,
    icon: 'grenade',
    sound: 'knife_swing',
    volume: 0.4,
    fuse: 1.6,
    radius: 14,
    throwSpeed: 16,
    description: 'Ciega a los que la miren. Máximo 2.',
  },
  smoke: {
    id: 'smoke',
    name: 'Granada de Humo',
    slot: 4,
    type: 'grenade',
    price: 300,
    team: 'both',
    damage: 0,
    fireRate: 0.7,
    auto: false,
    magazine: 1,
    reserve: 0,
    reloadTime: 0,
    spread: 0,
    moveSpread: 0,
    recoil: 0.5,
    range: 20,
    killReward: 300,
    headshotMult: 4,
    icon: 'grenade',
    sound: 'knife_swing',
    volume: 0.4,
    fuse: 1.5,
    radius: 4,
    throwSpeed: 15,
    description: 'Nube de humo durante 16 s. Máximo 1.',
  },
  c4: {
    id: 'c4',
    name: 'C4',
    slot: 5,
    type: 'c4',
    price: 0,
    team: 'T',
    damage: 0,
    fireRate: 0,
    auto: false,
    magazine: 0,
    reserve: 0,
    reloadTime: 0,
    spread: 0,
    moveSpread: 0,
    recoil: 0,
    range: 0,
    killReward: 300,
    headshotMult: 4,
    icon: 'c4',
    sound: null,
    description: 'Colocá la bomba con E dentro de un sitio.',
  },
};

// Legacy visuals retain their public IDs. M4A1 (unsuppressed) aliases CS2 M4A4.
// MP5 Navy -> MP5-SD, M3 -> Nova, Scout -> SSG08, USP -> USP-S are gameplay aliases.
for (const [id,p] of Object.entries(CS2_PROFILES)) {
  const w = WEAPONS[id]; if (!w) continue;
  Object.assign(w, { ballisticProfile:p, damage:p.baseDamage, headshotMult:p.headshotMultiplier,
    armorRatio:p.armorRatio, rangeModifier:p.rangeModifier, range:p.rangeCS/CS_UNITS_PER_WORLD,
    reloadTime:p.reloadLockout, fireRate:1/p.cycleTime[0], magazine:p.magazine, reserve:p.reserve, pellets:p.pellets, auto:p.fullAuto });
}
// Derived / default values shared by every weapon.
for (const w of Object.values(WEAPONS)) {
  w.fireInterval = w.ballisticProfile?.cycleTime[0] ?? 1 / (w.fireRate || 1);
  w.pellets = w.pellets || 1;
  w.airSpread = w.airSpread ?? (w.type === 'sniper' ? 9 : 6);
  w.spreadPerShot = w.spreadPerShot ?? 0;
  w.maxSpread = w.maxSpread ?? (w.spread + 4);
  w.crouchSpread = w.crouchSpread ?? 0.68;
  w.volume = w.volume ?? 1;
  w.flashScale = w.flashScale ?? 1;
}

/** Buy menu equipment (everything that is not a real weapon entry). */
export const EQUIPMENT = {
  kevlar: {
    id: 'kevlar',
    name: 'Chaleco Kevlar',
    price: 650,
    team: 'both',
    icon: 'armor',
    description: '100 de armadura. Absorbe parte del daño.',
  },
  assaultsuit: {
    id: 'assaultsuit',
    name: 'Kevlar + Casco',
    price: 1000,
    team: 'both',
    icon: 'armor',
    description: 'Armadura completa y casco (protege la cabeza).',
  },
  defusekit: {
    id: 'defusekit',
    name: 'Kit de desactivación',
    price: 200,
    team: 'CT',
    icon: 'kit',
    description: 'Desactivá la bomba en la mitad de tiempo.',
  },
  he: { id: 'he', name: 'Granada HE', price: 300, team: 'both', icon: 'grenade', description: 'Granada de fragmentación.' },
  flash: { id: 'flash', name: 'Flashbang', price: 200, team: 'both', icon: 'grenade', description: 'Granada cegadora.' },
  smoke: { id: 'smoke', name: 'Granada de humo', price: 300, team: 'both', icon: 'grenade', description: 'Cortina de humo.' },
  ammo_primary: {
    id: 'ammo_primary',
    name: 'Munición primaria',
    price: AMMO_PRICE.primary,
    team: 'both',
    icon: 'ammo',
    description: 'Rellená la reserva de tu arma primaria.',
  },
  ammo_secondary: {
    id: 'ammo_secondary',
    name: 'Munición secundaria',
    price: AMMO_PRICE.secondary,
    team: 'both',
    icon: 'ammo',
    description: 'Rellená la reserva de tu pistola.',
  },
};

/** CS 1.6 style buy categories (keys 1-8). */
export const BUY_CATEGORIES = [
  { key: '1', name: 'Pistolas', items: ['glock', 'usp', 'deagle'] },
  { key: '2', name: 'Escopetas', items: ['m3', 'xm1014'] },
  { key: '3', name: 'Subfusiles', items: ['mp5'] },
  { key: '4', name: 'Rifles', items: ['ak47', 'm4a1', 'scout', 'awp'] },
  { key: '5', name: 'Ametralladoras', items: ['m249'] },
  { key: '6', name: 'Munición primaria', items: ['ammo_primary'] },
  { key: '7', name: 'Munición secundaria', items: ['ammo_secondary'] },
  {
    key: '8',
    name: 'Equipamiento',
    items: ['kevlar', 'assaultsuit', 'flash', 'he', 'smoke', 'defusekit'],
  },
];

const TYPE_LABELS = {
  knife: 'Cuerpo a cuerpo',
  pistol: 'Pistola',
  smg: 'Subfusil',
  rifle: 'Rifle',
  sniper: 'Francotirador',
  shotgun: 'Escopeta',
  lmg: 'Ametralladora',
  grenade: 'Granada',
  c4: 'Explosivo',
};

function weaponDescription(w) {
  if (w.description) return w.description;
  const label = TYPE_LABELS[w.type] || 'Arma';
  const pellets = w.pellets > 1 ? ` ×${w.pellets}` : '';
  return `${label} · Daño ${w.damage}${pellets} · Cargador ${w.magazine}`;
}

export class WeaponSystem {
  constructor(game, testOptions = null) {
    this.game = game;
    this.testOptions = testOptions;
    this.recoilStates = new Map();
    this.shotLog = [];

    /** @type {{primary:?{id:string,magazine:number,reserve:number},secondary:?{id:string,magazine:number,reserve:number},grenades:{he:number,flash:number,smoke:number}}} */
    this.inventory = {
      primary: null,
      secondary: null,
      grenades: { he: 0, flash: 0, smoke: 0 },
    };
    this.currentId = 'knife';
    this.lastId = null;

    this.time = 0;
    this.cooldown = 0;
    this.grenadeCooldown = 0;
    this.deployTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadTotal = 0;
    this.reloadWeaponId = null;

    this.dynamicSpread = 0;
    this.shotIndex = 0;
    this.lastShotTime = -10;
    this.recoilStates.clear();this.nextShotAt=0;this._triggerHeld=false;

    this.scoped = false;
    this._baseSensitivity = null;
    this.viewmodel = null;
    this._visible = true;

    /** @type {Array<{id:string,pos:THREE.Vector3,vel:THREE.Vector3,mesh:THREE.Mesh,fuse:number,life:number}>} */
    this.grenades = [];
    this.droppedWeapons = new DroppedWeaponSystem(game, {
      getWeaponInfo: (id) => WEAPONS[id] || null,
      canPickup: (drop) => this._canPickupDrop(drop),
      onPickup: (drop) => this._pickupDrop(drop),
    });
    // Compatibility for code that inspects the local dropped list.
    this.dropped = this.droppedWeapons.items;

    this._tmpVec = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._dir2 = new THREE.Vector3();
    this._shotDir = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._unsubscribeLock = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init() {
    if (!this.game.weapons) this.game.weapons = this;
    if (!this.viewmodel && this.game.camera) {
      this.viewmodel = new ViewModel(this.game);
      this.viewmodel.init();
      this.viewmodel.setWeapon(this.currentId);
    }
    // Pause / buy menu / match end release the pointer lock without calling weapons.update(),
    // so hide the viewmodel (and drop any scope) on that event.
    if (this.game.input?.onPointerLockChange && !this._unsubscribeLock) {
      this._unsubscribeLock = this.game.input.onPointerLockChange((locked) => {
        if (!locked) {
          this._unscope();
          this.viewmodel?.setVisible(false);
        }
      });
    }
    return this;
  }

  resetForMatch(team = this.game?.player?.team || 'CT') {
    this._cancelReload();
    this._unscope();
    this._clearDropped();
    this._clearGrenadeProjectiles();
    this.inventory.primary = null;
    this.inventory.secondary = this._makeEntry(this._defaultPistol(team));
    this.inventory.grenades = { he: 0, flash: 0, smoke: 0 };
    this.lastId = null;
    this.currentId = this.inventory.secondary.id;
    this.time = 0;
    this.cooldown = 0;
    this.grenadeCooldown = 0;
    this.deployTimer = 0.05;
    this.dynamicSpread = 0;
    this.shotIndex = 0;
    this.lastShotTime = -10;
    this.recoilStates.clear();this.nextShotAt=0;this._triggerHeld=false;
    if (this.viewmodel) this.viewmodel.setWeapon(this.currentId);
  }

  resetForRound(team = this.game?.player?.team || 'CT') {
    this.recoilStates.clear();this.nextShotAt=this.time;this._triggerHeld=false;
    this._cancelReload();
    this._unscope();
    this._clearDropped();
    this._clearGrenadeProjectiles();
    this.dynamicSpread = 0;
    this.shotIndex = 0;
    this.cooldown = 0;
    this.grenadeCooldown = 0;

    if (!this.inventory.primary && !this.inventory.secondary) {
      const id = this._defaultPistol(team);
      this.inventory.secondary = this._makeEntry(id);
    }
    if (!this.inventory.primary && !this.inventory.secondary) {
      this.currentId = 'knife';
    } else {
      this.currentId = this.inventory.primary?.id || this.inventory.secondary?.id || 'knife';
    }
    if (this.currentId === 'c4' && !this.game?.player?.hasBomb) {
      this.currentId = this.inventory.primary?.id || this.inventory.secondary?.id || 'knife';
    }
    this.lastId = null;
    this.deployTimer = 0.34;
    if (this.viewmodel) this.viewmodel.setWeapon(this.currentId);
  }

  dispose() {
    this._unscope(true);
    this._clearGrenadeProjectiles();
    this._clearDropped();
    this._disposeGrenadeAssets();
    this.droppedWeapons.dispose();
    try {
      this._unsubscribeLock?.();
    } catch {
      /* ignore */
    }
    this._unsubscribeLock = null;
    if (this.viewmodel) {
      this.viewmodel.dispose();
      this.viewmodel = null;
    }
    if (this.game.camera) {
      this.game.camera.fov = this.game.settings?.fov ?? 90;
      this.game.camera.updateProjectionMatrix?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------------

  _defaultPistol(team) {
    return team === 'CT' ? 'usp' : 'glock';
  }

  _makeEntry(id) {
    const w = WEAPONS[id];
    if (!w) return null;
    return { id, magazine: w.magazine, reserve: w.reserve };
  }

  _currentWeapon() {
    return WEAPONS[this.currentId] || null;
  }

  getMoveSpeed() {
    return MOVE_SPEED[this.currentId] ?? 6.25;
  }

  _currentEntry() {
    const id = this.currentId;
    if (this.inventory.primary?.id === id) return this.inventory.primary;
    if (this.inventory.secondary?.id === id) return this.inventory.secondary;
    return null;
  }

  hasWeapon(id) {
    if (!id) return false;
    if (id === 'knife') return true;
    if (id === 'c4') return !!this.game?.player?.hasBomb;
    if (WEAPONS[id]?.type === 'grenade') return (this.inventory.grenades[id] || 0) > 0;
    return this.inventory.primary?.id === id || this.inventory.secondary?.id === id;
  }

  giveWeapon(id, opts = {}) {
    const w = WEAPONS[id];
    if (!w) return false;
    if (w.type === 'grenade') {
      const max = GRENADE_MAX[id] || 1;
      if ((this.inventory.grenades[id] || 0) >= max) return false;
      this.inventory.grenades[id] = (this.inventory.grenades[id] || 0) + 1;
      const current = this._currentWeapon();
      if (!opts.silent && current?.type !== 'grenade') this._equip(id);
      return true;
    }
    if (w.slot === 1) {
      this.inventory.primary = this._makeEntry(id);
      if (!opts.silent) this._equip(id);
      return true;
    }
    if (w.slot === 2) {
      this.inventory.secondary = this._makeEntry(id);
      if (!opts.silent) this._equip(id);
      return true;
    }
    if (w.slot === 3) return true;
    return false;
  }

  removeWeapon(id) {
    if (this.inventory.primary?.id === id) {
      this.inventory.primary = null;
      if (this.currentId === id) this._equipBest();
      return true;
    }
    if (this.inventory.secondary?.id === id) {
      this.inventory.secondary = null;
      if (this.currentId === id) this._equipBest();
      return true;
    }
    if (WEAPONS[id]?.type === 'grenade' && (this.inventory.grenades[id] || 0) > 0) {
      this.inventory.grenades[id] = 0;
      if (this.currentId === id) this._equipBest();
      return true;
    }
    return false;
  }

  dropAll() {
    this._cancelReload();
    this._unscope();
    this.inventory.primary = null;
    this.inventory.secondary = null;
    this.inventory.grenades = { he: 0, flash: 0, smoke: 0 };
    this.lastId = null;
    this.currentId = 'knife';
    this.deployTimer = 0;
    this.dynamicSpread = 0;
    if (this.viewmodel) this.viewmodel.setWeapon('knife');
  }

  selectSlot(n) {
    const slot = Number(n);
    if (slot === 1) return this.inventory.primary ? this._equip(this.inventory.primary.id) : false;
    if (slot === 2) return this.inventory.secondary ? this._equip(this.inventory.secondary.id) : false;
    if (slot === 3) return this._equip('knife');
    if (slot === 4) {
      const owned = GRENADE_IDS.filter((id) => (this.inventory.grenades[id] || 0) > 0);
      if (!owned.length) return false;
      const currentIndex = owned.indexOf(this.currentId);
      const next = owned[(currentIndex + 1) % owned.length];
      return this._equip(next);
    }
    if (slot === 5) {
      return this.game?.player?.hasBomb ? this._equip('c4') : false;
    }
    return false;
  }

  _equipBest() {
    const id = this.inventory.primary?.id || this.inventory.secondary?.id || 'knife';
    return this._equip(id, { silent: true });
  }

  _equip(id, opts = {}) {
    const w = WEAPONS[id];
    if (!w) return false;
    if (id !== 'knife' && !this.hasWeapon(id)) return false;
    if (id === this.currentId) return true;
    this._cancelReload();
    if (this.scoped) this._unscope();
    if (this.currentId && this.currentId !== id) this.lastId = this.currentId;
    this.currentId = id;
    const punch=this.recoilStates.get(id)?.sample(this.time)||{pitch:0,yaw:0};
    if(this.game.player){this.game.player.recoilPitch=punch.pitch;this.game.player.recoilYaw=punch.yaw;}
    this._triggerHeld=false;this.nextShotAt=Math.max(this.nextShotAt||0,this.time+.1);
    this.shotIndex = 0;
    this.dynamicSpread = Math.min(this.dynamicSpread, 1.4);
    this.deployTimer = opts.silent ? Math.min(this.deployTimer, 0.12) : 0.34;
    this.cooldown = Math.max(this.cooldown, 0.1);
    if (this.viewmodel) this.viewmodel.setWeapon(id);
    if (!opts.silent) this._play('weapon_switch', 0.7);
    return true;
  }

  _lastWeapon() {
    if (!this.lastId || this.lastId === this.currentId) return false;
    if (!this.hasWeapon(this.lastId)) return false;
    return this._equip(this.lastId);
  }

  _cycleWeapon(delta) {
    const list = [];
    if (this.inventory.primary) list.push(this.inventory.primary.id);
    if (this.inventory.secondary) list.push(this.inventory.secondary.id);
    list.push('knife');
    for (const id of GRENADE_IDS) if ((this.inventory.grenades[id] || 0) > 0) list.push(id);
    if (this.game?.player?.hasBomb) list.push('c4');
    if (!list.length) return;
    let index = list.indexOf(this.currentId);
    if (index < 0) index = 0;
    const step = delta >= 0 ? 1 : -1;
    const next = list[(index + step + list.length) % list.length];
    this._equip(next);
  }

  _dropCurrent() {
    const id = this.currentId;
    if (!id || id === 'knife' || id === 'c4') return false;
    const w = WEAPONS[id];
    if (!w || w.type === 'grenade') return false;
    let entry = null;
    if (this.inventory.primary?.id === id) {
      entry = this.inventory.primary;
    } else if (this.inventory.secondary?.id === id) {
      entry = this.inventory.secondary;
    }
    if (!entry) return false;

    const payload = { id: entry.id, magazine: entry.magazine, reserve: entry.reserve };
    const transform = this._dropTransform();
    if (typeof this.game?.online?.requestWeaponDrop === 'function') {
      const requested = this.game.online.requestWeaponDrop(payload, transform);
      return requested !== false;
    }

    if (this.inventory.primary?.id === id) this.inventory.primary = null;
    else if (this.inventory.secondary?.id === id) this.inventory.secondary = null;
    this._spawnDrop(payload, transform);
    this._equipBest();
    this.game?.ui?.toast?.(`Tiraste ${w.name}`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt) {
    const game = this.game;
    if (!game || !game.player) return;
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    this.deployTimer = Math.max(0, this.deployTimer - dt);

    this._updateReload(dt);
    this._updateSpread(dt);
    this._updateGrenadeProjectiles(dt);
    this._updateDropped(dt);

    const player = game.player;
    if (!player.alive) {
      if (this.scoped) this._unscope();
      this._updateVisuals(dt);
      return;
    }
    if (this.currentId === 'c4' && !player.hasBomb) this._equipBest();
    if (game.state === 'playing') this._maybeAutoReload();

    const input = game.input;
    const ui = game.ui;
    const canControl =
      game.state === 'playing' && player.alive && !!input?.locked && !ui?.isOverlayOpen;
    if (canControl && input) this._handleInput(input);

    player.updateCamera?.(0);
    this._updateVisuals(dt);
  }

  _maybeAutoReload() {
    if (this.reloading) return;
    const w = this._currentWeapon();
    const entry = this._currentEntry();
    if (!w || !entry || !w.magazine) return;
    if (entry.magazine <= 0 && entry.reserve > 0) this._startReload();
  }

  _handleInput(input) {
    const digits = [
      ['Digit1', 1],
      ['Digit2', 2],
      ['Digit3', 3],
      ['Digit4', 4],
      ['Digit5', 5],
    ];
    for (const [code, slot] of digits) {
      if (input.wasPressed(code) || input.wasPressed(code.replace('Digit', 'Numpad'))) {
        this.selectSlot(slot);
      }
    }
    if (input.wasPressed('KeyR')) this._startReload();
    if (input.wasPressed('KeyQ')) this._lastWeapon();
    if (input.wasPressed('KeyG')) this._dropCurrent();

    const wheel = input.consumeWheel?.() || 0;
    if (wheel) this._cycleWeapon(wheel);

    if (input.wasMousePressed?.(2)) this._toggleScope();

    if (!this.game.canUseWeapons?.()) return;
    if (this.reloading || this.deployTimer > 0) {this._triggerHeld=false;return;}
    const w = this._currentWeapon();
    if (!w) return;
    const wantsFire = w.auto ? input.isMouseDown?.(0) : input.wasMousePressed?.(0);
    if (!wantsFire) {this._triggerHeld=false;return;}
    if(!this._triggerHeld)this.nextShotAt=Math.max(this.time,this.nextShotAt||0);
    this._triggerHeld=true;
    for(let catchup=0;catchup<12 && this.time+1e-8>=(this.nextShotAt||0) && !this.reloading;catchup++) {
      this._scheduledShotTime=this.nextShotAt||this.time;
      this._fire();
      if(!w.auto || w.type==='knife' || w.type==='grenade')break;
    }
    this._scheduledShotTime=null;
  }

  _updateReload(dt) {
    if (!this.reloading) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer > 0) return;
    this.reloading = false;
    const entry = this._entryById(this.reloadWeaponId);
    const w = WEAPONS[this.reloadWeaponId];
    if (entry && w) {
      const need = w.magazine - entry.magazine;
      const take = Math.min(need, entry.reserve);
      entry.magazine += take;
      entry.reserve -= take;
    }
    this.reloadWeaponId = null;
  }

  _entryById(id) {
    if (!id) return null;
    if (this.inventory.primary?.id === id) return this.inventory.primary;
    if (this.inventory.secondary?.id === id) return this.inventory.secondary;
    return null;
  }

  _startReload() {
    const w = this._currentWeapon();
    if (!w || !w.magazine) return false;
    const entry = this._currentEntry();
    if (!entry || this.reloading) return false;
    if (entry.magazine >= w.magazine || entry.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = w.reloadTime || RELOAD_TIME;
    this.reloadTotal = this.reloadTimer;
    this.reloadWeaponId = w.id;
    this._play(RELOAD_SOUND, 0.9, { duration: this.reloadTotal });
    return true;
  }

  _cancelReload() {
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadTotal = 0;
    this.reloadWeaponId = null;
  }

  _updateSpread(dt) {
    const idleTime = this.time - this.lastShotTime;
    const w = this._currentWeapon();
    const state = this.recoilStates.get(this.currentId);
    if (state && CS2_PROFILES[w?.id]) {
      const punch=state.sample(this.time,this.game.player.crouching);
      this.game.player.recoilPitch=punch.pitch;this.game.player.recoilYaw=punch.yaw;
    }
    const lambda = idleTime > 0.16 ? 7.5 : 1.6;
    this.dynamicSpread = expDamp(this.dynamicSpread, 0, lambda, dt);
    if (this.dynamicSpread < 0.01) this.dynamicSpread = 0;
  }

  /** Current inaccuracy in degrees (also used by the HUD crosshair). */
  currentSpread() {
    const w = this._currentWeapon();
    if (!w || w.type === 'knife' || w.type === 'grenade' || w.type === 'c4') return 0;
    const p = this.game?.player;
    if(CS2_PROFILES[w.id]){const a=accuracyRadius(w.id,p,this.recoilStates.get(w.id),this.time,this.isScoped());return Math.atan(a.spread+a.inaccuracy)/DEG;}
    let spread = w.spread;
    const speed = p?.getVelocity2D?.() ?? 0;
    if (p?.crouching) spread *= w.crouchSpread;
    else if (p?.walking) spread *= 0.82;
    const runSpeed = Math.max(0.1, this.getMoveSpeed());
    spread += (Math.min(speed, runSpeed * 1.6) / runSpeed) * w.moveSpread;
    if (p && !p.onGround) spread += w.airSpread;
    if (this.isScoped()) spread = spread * 0.06 + 0.03;
    spread += this.dynamicSpread;
    return spread;
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------

  _fire() {
    const w = this._currentWeapon();
    if (!w) return;
    if (w.type === 'knife') return this._knifeAttack(w);
    if (w.type === 'grenade') return this._throwGrenade(w);
    if (w.type === 'c4') return;
    const entry = this._currentEntry();
    if (!entry) return;

    if (entry.magazine <= 0) {
      if (entry.reserve > 0) {
        this._startReload();
        return;
      }
      this.cooldown = 0.3;this.nextShotAt=this.time+.3;
      this._play('empty', 0.7);
      return;
    }

    const player = this.game.player;
    if(!this.recoilStates.has(w.id))this.recoilStates.set(w.id,new RecoilState(w.id,CS2_PROFILES[w.id]?.recoil.seed||1));
    const recoilState=this.recoilStates.get(w.id);
    const shotTime=this._scheduledShotTime??this.time;
    const accuracy=accuracyRadius(w.id,player,recoilState,shotTime,this.isScoped());
    const punch=recoilState.fire(shotTime,player);
    player.recoilPitch=punch.pitch;player.recoilYaw=punch.yaw;
    entry.magazine--;
    this.lastShotTime = shotTime;
    this.nextShotAt = shotTime + w.fireInterval;
    this.cooldown = Math.max(0, this.nextShotAt-this.time);
    this.deployTimer = 0;

    const spread=Math.atan((accuracy.spread||0)+(accuracy.inaccuracy||0))/DEG;
    const eye = player.getEyePosition(this._eye);
    const rawAim=aimDirection(player.yaw||0,player.pitch||0);
    const baseDir = player.getAimDirection(this._dir);
    const directions=shotDirections(w.id,rawAim,punch,accuracy,{dispersion:!this.testOptions?.disableDispersion});
    const muzzle = this._muzzleWorld(eye, baseDir, this._muzzle);
    const pellets = w.pellets || 1;
    let hitEnemy = false;
    let headshot = false;
    let remoteHit = null;

    for (let i = 0; i < pellets; i++) {
      this._shotDir.copy(directions[i]);
      const hit = this.game.raycastShot
        ? this.game.raycastShot(eye, this._shotDir, w.range, player.team)
        : null;
      if(i===0) {
        this.shotLog.push({weapon:w.id,index:punch.index,time:shotTime,yaw:punch.yaw/DEG,pitch:punch.pitch/DEG,dir:this._shotDir.toArray(),point:hit?.point?.toArray()||null,part:hit?.part||null});
        if(this.shotLog.length>120)this.shotLog.shift();
      }
      let endPoint;
      if (hit) {
        endPoint = hit.point;
        if (hit.type === 'bot' && hit.entity) {
          const enemy = hit.entity;
          const deathmatch = !!this.game?.deathmatch || this.game?.matchConfig?.mode === 'deathmatch';
          if (enemy !== player && (deathmatch || enemy.team !== player.team)) {
            const dealt = this.game.damageBot
              ? this.game.damageBot(enemy, rangedDamage(w.id, hit.t ?? eye.distanceTo(hit.point)), player, hit.part || 'chest', w.id)
              : 0;
            if (dealt > 0) {
              hitEnemy = true;
              if (hit.part === 'head') headshot = true;
              if (i === 0 || Math.random() < 0.4) {
                this.game.effects?.blood?.(hit.point, this._shotDir);
              }
            }
          }
        } else if (hit.type === 'remote' && hit.entity) {
          // Online: el host resuelve el daño autoritativo; el guest lo pide al host.
          if (!remoteHit) {
            remoteHit = {
              entity: hit.entity,
              part: hit.part || 'chest',
              point: hit.point.clone(),
              dir: this._shotDir.clone(),
            };
          }
          hitEnemy = true;
          if (hit.part === 'head') headshot = true;
          if (i === 0 || Math.random() < 0.4) {
            this.game.effects?.blood?.(hit.point, this._shotDir);
          }
        } else if (hit.type === 'world') {
          this.game.effects?.bulletImpact?.(
            hit.point,
            hit.normal || UP,
            hit.collider?.surface || 'stone',
          );
        }
      } else {
        endPoint = this._end.copy(eye).addScaledVector(this._shotDir, w.range);
      }
      if (Math.random() < (pellets > 1 ? 0.45 : 1)) {
        this.game.effects?.tracer?.(muzzle, endPoint);
      }
    }

    this._applyRecoil(w);
    this.dynamicSpread = Math.min(w.maxSpread, this.dynamicSpread + w.spreadPerShot);
    this.shotIndex++;

    this._play(w.sound, w.volume);
    this.game.effects?.muzzleFlash?.(muzzle, baseDir, w.flashScale);
    this.game.effects?.shellEject?.(
      this._right.copy(muzzle).addScaledVector(baseDir, -0.02),
      baseDir,
    );
    this.game.setCameraShake?.(0.05 + w.recoil * 0.012);
    this.viewmodel?.onFire();

    this.game.online?.notifyLocalShot?.({
      origin: eye.clone(),
      dir: rawAim.clone(),
      shotTime,
      scoped:this.isScoped(),
      weaponId: w.id,
      hit: remoteHit,
    });

    if (hitEnemy && !this.game.online) {
      this.game.ui?.showHitmarker?.(headshot);
      this._play('hit', headshot ? 0.9 : 0.6);
    }

    // Recarga automática en cuanto el cargador queda vacío.
    if (entry.magazine <= 0 && entry.reserve > 0) this._startReload();
  }

  _knifeAttack(w) {
    const player = this.game.player;
    this.lastShotTime = this.time;
    this.cooldown = 1 / (w.fireRate || 1.8);
    this.nextShotAt=this.time+this.cooldown;
    this.shotIndex = 0;
    const eye = player.getEyePosition(this._eye);
    const dir = player.getAimDirection(this._dir);
    this._applySpread(dir, 1.6, this._shotDir);
    const hit = this.game.raycastShot
      ? this.game.raycastShot(eye, this._shotDir, w.range, player.team)
      : null;
    this._play('knife_swing', 1);
    this.viewmodel?.onKnife();
    player.addRecoil(rand(0.35, 0.9) * DEG, rand(-0.4, 0.4) * DEG);
    this.game.setCameraShake?.(0.05);

    if (!hit) return;
    if (hit.type === 'world') {
      this.game.effects?.bulletImpact?.(hit.point, hit.normal || UP, hit.collider?.surface || 'metal');
      return;
    }
    const target = hit.entity;
    const deathmatch = !!this.game?.deathmatch || this.game?.matchConfig?.mode === 'deathmatch';
    if (!target || target === player || (!deathmatch && target.team === player.team)) return;
    let damage = w.damage;
    if (target.isBot || target.isRemote) {
      const yaw = target.yaw || 0;
      const facingX = -Math.sin(yaw);
      const facingZ = -Math.cos(yaw);
      const dx = player.pos.x - target.pos.x;
      const dz = player.pos.z - target.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const dot = (dx / len) * facingX + (dz / len) * facingZ;
      if (dot < -0.55) damage *= 2.2; // legacy back attack; CS2 knife parity unverified
    }
    if (target.isRemote) {
      this.game.online?.notifyLocalShot?.({
        origin: eye.clone(),
        dir: this._shotDir.clone(),
        weaponId: 'knife',
        hit: {
          entity: target,
          part: hit.part || 'chest',
          point: hit.point.clone(),
          dir: this._shotDir.clone(),
          damage,
        },
      });
      this._play('knife_hit', 1);
      this.game.effects?.blood?.(hit.point, dir);
      return;
    }
    const dealt = this.game.damageBot
      ? this.game.damageBot(target, damage, player, hit.part || 'chest', 'knife')
      : 0;
    if (dealt > 0) {
      this._play('knife_hit', 1);
      this.game.effects?.blood?.(hit.point, dir);
      this.game.ui?.showHitmarker?.(hit.part === 'head');
    }
  }

  _applySpread(baseDir, spreadDeg, out) {
    const max = Math.max(0.0001, spreadDeg) * DEG;
    const radius = Math.tan(max) * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    this._right.crossVectors(baseDir, UP);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._right.normalize();
    this._up.crossVectors(this._right, baseDir).normalize();
    out
      .copy(baseDir)
      .addScaledVector(this._right, Math.cos(angle) * radius)
      .addScaledVector(this._up, Math.sin(angle) * radius)
      .normalize();
    return out;
  }

  _applyRecoil(w) {
    const p = this.game.player;
    if (CS2_PROFILES[w.id] || !p?.addRecoil) return;
    const pattern = this.shotIndex + 1;
    const pitch = w.recoil * (0.75 + Math.random() * 0.5) * DEG;
    const yaw =
      (Math.sin(pattern * 0.62) * w.recoil * 0.28 + (Math.random() - 0.5) * w.recoil * 0.22) * DEG;
    p.addRecoil(pitch, yaw);
  }

  _muzzleWorld(eye, dir, out) {
    this._right.crossVectors(dir, UP);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._right.normalize();
    this._up.crossVectors(this._right, dir).normalize();
    return out
      .copy(eye)
      .addScaledVector(this._right, 0.13)
      .addScaledVector(this._up, -0.09)
      .addScaledVector(dir, 0.5);
  }

  // ---------------------------------------------------------------------------
  // Scopes / viewmodel
  // ---------------------------------------------------------------------------

  isScoped() {
    return this.scoped && !!this._currentWeapon()?.zoomFov;
  }

  _toggleScope() {
    const w = this._currentWeapon();
    if (!w) return;
    if (!this.game.canUseWeapons?.()) return;
    if (!w.zoomFov) {
      if (this.scoped) this._unscope();
      return;
    }
    this.scoped = !this.scoped;
    const camera = this.game.camera;
    if (camera) {
      camera.fov = this.scoped ? w.zoomFov : this.game.settings?.fov ?? 90;
      camera.updateProjectionMatrix?.();
    }
    if (this.scoped) this._applyScopeSensitivity(w);
    else this._restoreSensitivity();
    this.viewmodel?.setScoped?.(this.scoped);
    this._play('scope', 0.9);
  }

  // CS scales mouse sensitivity with the zoom level. player.js reads game.settings.sensitivity
  // every frame, so temporarily scale it while scoped and restore it on unscope.
  _applyScopeSensitivity(w) {
    const settings = this.game.settings;
    if (!settings || !w?.zoomFov) return;
    if (this._baseSensitivity == null) {
      this._baseSensitivity = settings.sensitivity ?? 1;
    }
    const fov = Math.max(10, settings.fov || 90);
    const mult = clamp(w.zoomFov / fov, 0.15, 1);
    settings.sensitivity = this._baseSensitivity * mult;
  }

  _restoreSensitivity() {
    if (this._baseSensitivity == null) return;
    if (this.game.settings) this.game.settings.sensitivity = this._baseSensitivity;
    this._baseSensitivity = null;
  }

  _unscope(restoreFov = true) {
    if (this.scoped) {
      this.scoped = false;
      if (restoreFov && this.game.camera) {
        this.game.camera.fov = this.game.settings?.fov ?? 90;
        this.game.camera.updateProjectionMatrix?.();
      }
    }
    this._restoreSensitivity();
    this.viewmodel?.setScoped?.(false);
  }

  setVisible(v) {
    this._visible = !!v;
    this._updateVisuals(0);
  }

  _shouldShowViewmodel() {
    const game = this.game;
    const p = game?.player;
    if (!p || !p.alive) return false;
    if (this.isScoped()) return false;
    if (game.state !== 'playing' && game.state !== 'roundover') return false;
    if (game.ui?.isOverlayOpen) return false;
    return this._visible !== false;
  }

  _updateVisuals(dt) {
    if (!this.viewmodel) return;
    const p = this.game?.player;
    const reloadProgress = this.reloadTotal
      ? clamp(1 - this.reloadTimer / this.reloadTotal, 0, 1)
      : 0;
    this.viewmodel.update(dt, {
      team: p?.team,
      reloading: this.reloading,
      reloadProgress,
      speed: p?.getVelocity2D?.() ?? 0,
      scoped: this.isScoped(),
    });
    this.viewmodel.setVisible(this._shouldShowViewmodel());
    this.viewmodel.setScoped(this.isScoped());
  }

  // ---------------------------------------------------------------------------
  // Grenades
  // ---------------------------------------------------------------------------

  _throwGrenade(w) {
    const count = this.inventory.grenades[w.id] || 0;
    if (count <= 0) {
      this._equipBest();
      return;
    }
    if (this.grenadeCooldown > 0) return;
    const player = this.game.player;
    this.inventory.grenades[w.id] = count - 1;
    this.grenadeCooldown = 0.85;
    this.cooldown = 0.55;
    this.nextShotAt=this.time+.55;
    this.lastShotTime = this.time;

    const eye = player.getEyePosition(this._eye);
    const dir = player.getAimDirection(this._dir);
    const speed = w.throwSpeed || 16;
    const vel = new THREE.Vector3()
      .copy(dir)
      .multiplyScalar(speed)
      .addScaledVector(player.vel, 0.35);
    vel.y += 1.7;
    const pos = eye.clone().addScaledVector(dir, 0.35);
    const mesh = this._spawnGrenadeMesh(w.id);
    if (mesh) mesh.position.copy(pos);
    this.grenades.push({
      id: w.id,
      pos: pos.clone(),
      vel,
      mesh,
      fuse: w.fuse || 2.5,
      life: 0,
    });

    this._play('knife_swing', 0.55);
    this.viewmodel?.onThrow();
    player.addRecoil(rand(0.4, 1.1) * DEG, rand(-0.3, 0.3) * DEG);
    this.game.setCameraShake?.(0.08);

    if ((this.inventory.grenades[w.id] || 0) <= 0) {
      const next = GRENADE_IDS.find((id) => (this.inventory.grenades[id] || 0) > 0);
      if (next) this._equip(next, { silent: true });
      else this._equipBest();
    }
  }

  _spawnGrenadeMesh(id) {
    if (!this.game.scene) return null;
    if (!this._grenadeGeo) {
      this._grenadeGeo = new THREE.SphereGeometry(0.075, 10, 8);
      this._grenadeMats = {};
      for (const key of GRENADE_IDS) {
        this._grenadeMats[key] = new THREE.MeshStandardMaterial({
          color: GRENADE_COLORS[key],
          roughness: 0.7,
          metalness: 0.3,
        });
      }
    }
    const mesh = new THREE.Mesh(this._grenadeGeo, this._grenadeMats[id] || this._grenadeMats.he);
    mesh.castShadow = false;
    this.game.scene.add(mesh);
    return mesh;
  }

  _disposeGrenadeAssets() {
    if (this._grenadeGeo) {
      this._grenadeGeo.dispose?.();
      this._grenadeGeo = null;
    }
    if (this._grenadeMats) {
      for (const mat of Object.values(this._grenadeMats)) mat.dispose?.();
      this._grenadeMats = null;
    }
  }

  _updateGrenadeProjectiles(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.life += dt;
      g.vel.y -= 18 * dt;
      const move = this._tmpVec.copy(g.vel).multiplyScalar(dt);
      const dist = move.length();
      if (dist > 1e-5) {
        const dir = this._dir.copy(move).multiplyScalar(1 / dist);
        const hit = this.game.raycastWorld
          ? this.game.raycastWorld(g.pos, dir, dist + 0.08)
          : this.game.physics?.raycast?.(g.pos, dir, dist + 0.08);
        if (hit && hit.point) {
          g.pos.copy(hit.point).addScaledVector(hit.normal || UP, 0.08);
          const normal = hit.normal || UP;
          const vn = g.vel.dot(normal);
          if (vn < 0) g.vel.addScaledVector(normal, -2 * vn);
          g.vel.multiplyScalar(0.42);
          if (Math.abs(vn) > 1.2) {
            this._play('land', clamp(Math.abs(vn) / 12, 0.12, 0.55));
          }
        } else {
          g.pos.add(move);
        }
      }
      if (g.mesh) {
        g.mesh.position.copy(g.pos);
        g.mesh.rotation.x += dt * 7;
        g.mesh.rotation.z += dt * 5;
      }
      if (g.life >= g.fuse) {
        this._detonateGrenade(g);
        this.grenades.splice(i, 1);
      }
    }
  }

  _detonateGrenade(g) {
    g.mesh?.removeFromParent?.();
    const pos = g.pos.clone();
    pos.y = Math.max(pos.y, 0.1);
    if (g.id === 'he') this._explodeHE(pos);
    else if (g.id === 'flash') this._explodeFlash(pos);
    else this._explodeSmoke(pos);
  }

  _explodeHE(pos) {
    const w = WEAPONS.he;
    this.game.effects?.explosion?.(pos);
    this.game.setCameraShake?.(1.15);
    const player = this.game.player;
    const radius = w.radius || 9.5;
    const top = this._muzzle.set(pos.x, pos.y + 0.25, pos.z);

    const candidates = [];
    const bots = this.game.getAliveBots?.() || this.game.bots?.getBots?.() || [];
    for (const bot of bots) {
      if (!bot?.alive || !bot.pos) continue;
      if (player && !this.game?.deathmatch && this.game?.matchConfig?.mode !== 'deathmatch' && bot.team === player.team) continue;
      candidates.push(bot);
    }
    for (const bot of candidates) {
      const centerY = bot.pos.y + (bot.height || 1.8) * 0.5;
      const dx = bot.pos.x - pos.x;
      const dz = bot.pos.z - pos.z;
      const dist = Math.hypot(dx, centerY - pos.y, dz);
      if (dist > radius) continue;
      const los = this.game.hasLineOfSight
        ? this.game.hasLineOfSight(top, new THREE.Vector3(bot.pos.x, centerY, bot.pos.z))
        : true;
      let damage = w.damage * Math.pow(1 - dist / radius, 1.5);
      if (!los) damage *= 0.25;
      if (damage <= 1) continue;
      this.game.damageBot?.(bot, damage, player, 'chest', 'he');
    }

    if (player?.alive) {
      const dx = player.pos.x - pos.x;
      const dz = player.pos.z - pos.z;
      const dist = Math.hypot(dx, player.pos.y + 0.9 - pos.y, dz);
      if (dist < radius) {
        const los = this.game.hasLineOfSight
          ? this.game.hasLineOfSight(top, player.getEyePosition(this._eye))
          : true;
        let damage = w.damage * Math.pow(1 - dist / radius, 1.5) * 0.6;
        if (!los) damage *= 0.25;
        if (damage > 1) this.game.damagePlayer?.(damage, null, 'chest', 'he');
      }
    }
  }

  _explodeFlash(pos) {
    const w = WEAPONS.flash;
    const player = this.game.player;
    const eye = player?.getEyePosition?.(this._eye);
    let volume = 0.9;
    if (player?.alive && eye) {
      const dist = eye.distanceTo(pos);
      volume = clamp(1.25 - dist / 22, 0.2, 1.25);
      if (dist < (w.radius || 14)) {
        const los = this.game.hasLineOfSight ? this.game.hasLineOfSight(eye, pos) : true;
        if (los) {
          const to = this._dir.copy(pos).sub(eye).normalize();
          const view = player.getAimDirection(this._dir2);
          const facing = to.dot(view);
          if (facing > -0.35) {
            const distFactor = 1 - dist / (w.radius || 14);
            const angleFactor = clamp((facing + 0.25) / 1.25, 0, 1);
            let alpha = clamp((0.3 + 0.7 * distFactor) * angleFactor * 1.15, 0, 1);
            if (facing < 0) alpha *= 0.35;
            if (alpha > 0.03) this.game.flashPlayer?.(alpha);
          }
        }
      }
    }
    this._play('flashbang', volume);
    this.game.effects?.muzzleFlash?.(pos, UP, 4.5);
  }

  _explodeSmoke(pos) {
    this.game.effects?.smokeCloud?.(pos, 16);
  }

  _clearGrenadeProjectiles() {
    for (const g of this.grenades) g.mesh?.removeFromParent?.();
    this.grenades.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Dropped weapons (G)
  // ---------------------------------------------------------------------------

  _dropTransform() {
    const player = this.game.player;
    const yaw = player?.yaw || 0;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    return {
      position: {
        x: (player?.pos.x || 0) + forwardX * 0.45,
        y: (player?.pos.y || 0) + 0.34,
        z: (player?.pos.z || 0) + forwardZ * 0.45,
      },
      velocity: { x: forwardX * 1.15, y: 0.5, z: forwardZ * 1.15 },
      yaw: -yaw,
    };
  }

  _spawnDrop(entry, transform = null) {
    const w = WEAPONS[entry.id];
    if (!w) return null;
    const dropTransform = transform || this._dropTransform();
    return this.droppedWeapons.spawn({
      weaponId: entry.id,
      ammo: { magazine: entry.magazine, reserve: entry.reserve },
      ...dropTransform,
    });
  }

  _updateDropped(dt) {
    this.droppedWeapons.update(dt, this.game.player);
  }

  _canPickupDrop(drop) {
    const w = WEAPONS[drop?.weaponId];
    if (!w || (w.slot !== 1 && w.slot !== 2)) return false;
    if (w.slot === 1) return !this.inventory.primary;
    return !this.inventory.secondary;
  }

  _pickupDrop(drop) {
    const w = WEAPONS[drop?.weaponId];
    if (!w) return false;
    if (typeof this.game?.online?.requestWeaponPickup === 'function') {
      const lastRequest = Number(drop.pickupRequestAt);
      if (!Number.isFinite(lastRequest) || this.droppedWeapons.time - lastRequest >= 0.35) {
        drop.pickupRequestAt = this.droppedWeapons.time;
        this.game.online.requestWeaponPickup(drop.id);
      }
      return false;
    }
    return this.acceptPickup({
      id: drop.weaponId,
      magazine: drop.ammo.magazine,
      reserve: drop.ammo.reserve,
    });
  }

  _clearDropped() {
    this.droppedWeapons.clear();
  }

  serializeDroppedWeapons() {
    return this.droppedWeapons.serializeSnapshot();
  }

  applyDroppedWeaponsSnapshot(snapshot) {
    return this.droppedWeapons.applySnapshot(snapshot);
  }

  setDroppedWeaponPickupEnabled(enabled) {
    this.droppedWeapons.setLocalPickupEnabled(enabled);
  }

  spawnNetworkDrop(drop) {
    if (!drop || typeof drop !== 'object') return null;
    const id = typeof drop.id === 'string' ? drop.id : null;
    if (id) this.droppedWeapons.remove(id);
    const rawPickableIn = Number(drop.pickableIn);
    const rawPickableAt = Number(drop.pickableAt);
    const rawCreatedAt = Number(drop.createdAt);
    const createdAtSeconds = Number.isFinite(rawCreatedAt)
      ? (rawCreatedAt > 1e10 ? rawCreatedAt / 1000 : rawCreatedAt)
      : NaN;
    const pickableAtSeconds = Number.isFinite(rawPickableAt)
      ? (rawPickableAt > 1e10 ? rawPickableAt / 1000 : rawPickableAt)
      : NaN;
    const pickableIn = Number.isFinite(rawPickableIn)
      ? Math.max(0, rawPickableIn)
      : Number.isFinite(createdAtSeconds) && Number.isFinite(pickableAtSeconds)
        ? Math.max(0, pickableAtSeconds - createdAtSeconds)
        : null;
    return this.droppedWeapons.spawn({
      id,
      weaponId: drop.weaponId || drop.weapon || drop.entry?.id,
      ownerId: drop.ownerId,
      ammo: drop.ammo || drop.entry,
      position: drop.position || drop.pos,
      velocity: drop.velocity || drop.vel,
      yaw: drop.yaw,
      angularVelocity: drop.angularVelocity,
      pickableAt: pickableIn == null ? drop.pickableAt : undefined,
      pickableIn,
      pickupDelay: pickableIn == null ? drop.pickupDelay : undefined,
      armed: drop.armed,
      grounded: drop.grounded,
    });
  }

  removeNetworkDrop(id) {
    return this.droppedWeapons.remove(id);
  }

  applyNetworkDrops(list) {
    return this.droppedWeapons.applySnapshot(list);
  }

  acceptPickup(entry, opts = {}) {
    const id = String(entry?.id || entry?.weaponId || entry?.weapon || '');
    const w = WEAPONS[id];
    if (!w || (w.slot !== 1 && w.slot !== 2)) return false;
    const accepted = {
      id,
      magazine: Math.max(0, Math.floor(Number(entry?.magazine ?? entry?.ammo?.magazine ?? w.magazine) || 0)),
      reserve: Math.max(0, Math.floor(Number(entry?.reserve ?? entry?.ammo?.reserve ?? w.reserve) || 0)),
    };
    this._cancelReload();
    if (this.scoped) this._unscope();
    if (w.slot === 1) this.inventory.primary = accepted;
    else this.inventory.secondary = accepted;
    if (opts.equip !== false) this._equip(id, { silent: !!opts.silent });
    if (!opts.silent) this.game.ui?.toast?.(`Recogiste ${w.name}`);
    return true;
  }

  getInventorySnapshot() {
    return {
      primary: this.inventory.primary ? { ...this.inventory.primary } : null,
      secondary: this.inventory.secondary ? { ...this.inventory.secondary } : null,
      grenades: { ...this.inventory.grenades },
      currentId: this.currentId,
      lastId: this.lastId,
    };
  }

  applyInventorySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const normalizeEntry = (entry, slot) => {
      const id = String(entry?.id || '');
      const w = WEAPONS[id];
      if (!w || w.slot !== slot) return null;
      return {
        id,
        magazine: Math.max(0, Math.floor(Number(entry.magazine) || 0)),
        reserve: Math.max(0, Math.floor(Number(entry.reserve) || 0)),
      };
    };
    this._cancelReload();
    this._unscope();
    this.inventory.primary = normalizeEntry(snapshot.primary, 1);
    this.inventory.secondary = normalizeEntry(snapshot.secondary, 2);
    for (const id of GRENADE_IDS) {
      this.inventory.grenades[id] = Math.min(
        GRENADE_MAX[id] || 1,
        Math.max(0, Math.floor(Number(snapshot.grenades?.[id]) || 0)),
      );
    }
    const requested = typeof snapshot.currentId === 'string' ? snapshot.currentId : null;
    const nextId = requested && this.hasWeapon(requested)
      ? requested
      : this.inventory.primary?.id || this.inventory.secondary?.id || 'knife';
    this.lastId =
      typeof snapshot.lastId === 'string' && this.hasWeapon(snapshot.lastId) ? snapshot.lastId : null;
    this.currentId = nextId;
    this.dynamicSpread = 0;
    this.deployTimer = 0.08;
    this.viewmodel?.setWeapon(nextId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Buying
  // ---------------------------------------------------------------------------

  getKillReward(weaponId) {
    return WEAPONS[weaponId]?.killReward ?? 300;
  }

  getName(weaponId) {
    if (!weaponId) return 'Mundo';
    return WEAPONS[weaponId]?.name || weaponId;
  }

  _equipOwned(id) {
    const p = this.game?.player;
    if (!p) return false;
    if (id === 'kevlar') return p.armor >= 100;
    if (id === 'assaultsuit') return p.armor >= 100 && p.helmet;
    if (id === 'defusekit') return !!p.hasDefuseKit;
    if (WEAPONS[id]?.type === 'grenade') return (this.inventory.grenades[id] || 0) >= (GRENADE_MAX[id] || 1);
    if (id === 'ammo_primary') {
      const entry = this.inventory.primary;
      return !!entry && entry.reserve >= WEAPONS[entry.id].reserve;
    }
    if (id === 'ammo_secondary') {
      const entry = this.inventory.secondary;
      return !!entry && entry.reserve >= WEAPONS[entry.id].reserve;
    }
    return this.hasWeapon(id);
  }

  _isDeathmatchArsenal() {
    return !!this.game?.deathmatch || this.game?.matchConfig?.mode === 'deathmatch';
  }

  _buyItemInfo(id, team, money) {
    const deathmatch = this._isDeathmatchArsenal();
    const equipment = EQUIPMENT[id];
    if (equipment) {
      const owned = this._equipOwned(id);
      const teamOk = deathmatch || equipment.team === 'both' || equipment.team === team;
      let available = teamOk && !owned;
      if (id === 'ammo_primary') available = teamOk && !!this.inventory.primary && !owned;
      if (id === 'ammo_secondary') available = teamOk && !!this.inventory.secondary && !owned;
      return {
        id,
        name: equipment.name,
        price: deathmatch ? 0 : equipment.price,
        team: equipment.team,
        available,
        owned,
        affordable: deathmatch || money >= equipment.price,
        description: equipment.description,
        icon: equipment.icon,
      };
    }
    const w = WEAPONS[id];
    if (!w || w.type === 'c4' || w.slot === 3) return null;
    const teamOk = deathmatch || w.team === 'both' || w.team === team;
    const owned = this.hasWeapon(id);
    let slotOk = true;
    if (w.slot === 1) slotOk = deathmatch || !this.inventory.primary;
    if (w.slot === 2) slotOk = deathmatch || !this.inventory.secondary;
    if (w.slot === 4) slotOk = (this.inventory.grenades[id] || 0) < (GRENADE_MAX[id] || 1);
    return {
      id,
      name: w.name,
      price: deathmatch ? 0 : w.price,
      team: w.team,
      available: teamOk && !owned && slotOk,
      owned,
      affordable: deathmatch || money >= w.price,
      description: weaponDescription(w),
      icon: w.icon,
    };
  }

  getBuyMenuData() {
    const player = this.game?.player;
    const team = player?.team || 'CT';
    const money = Math.round(player?.money || 0);
    const categories = BUY_CATEGORIES.map((category) => ({
      key: category.key,
      name: category.name,
      items: category.items
        .map((id) => this._buyItemInfo(id, team, money))
        .filter(Boolean),
    }));
    return { money, team, categories };
  }

  _fail(message) {
    return { ok: false, message };
  }

  buyItem(id) {
    const player = this.game?.player;
    if (!player) return this._fail('No hay jugador');
    if (!id || typeof id !== 'string') return this._fail('Ítem inválido');
    const deathmatch = this._isDeathmatchArsenal();

    const equipment = EQUIPMENT[id];
    if (equipment) return this._buyEquipment(equipment);

    const w = WEAPONS[id];
    if (!w || w.type === 'c4' || w.slot === 3) return this._fail('Ese ítem no está en venta');
    const team = player.team;
    if (!deathmatch && w.team !== 'both' && w.team !== team) {
      return this._fail(`Solo disponible para ${w.team === 'CT' ? 'CT' : 'T'}`);
    }
    if (this.hasWeapon(id)) return this._fail(`Ya tenés ${w.name}`);
    if (!deathmatch && w.slot === 1 && this.inventory.primary) {
      return this._fail(`Ya tenés ${WEAPONS[this.inventory.primary.id].name}. Tirala con G`);
    }
    if (!deathmatch && w.slot === 2 && this.inventory.secondary) {
      return this._fail(`Ya tenés ${WEAPONS[this.inventory.secondary.id].name}. Tirala con G`);
    }
    if (w.slot === 4) {
      const max = GRENADE_MAX[id] || 1;
      if ((this.inventory.grenades[id] || 0) >= max) return this._fail(`Máximo de ${w.name}`);
    }
    if (!deathmatch && player.money < w.price) {
      return this._fail(`Te faltan $${Math.ceil(w.price - player.money)}`);
    }

    if (!deathmatch) player.addMoney(-w.price);
    if (w.slot === 4) {
      this.inventory.grenades[id] = (this.inventory.grenades[id] || 0) + 1;
      if (!this._currentWeapon() || this._currentWeapon().type !== 'grenade') {
        this._equip(id, { silent: true });
      }
    } else if (w.slot === 2) {
      this.inventory.secondary = this._makeEntry(id);
      if (deathmatch) this.inventory.secondary.reserve = 999;
      this._equip(id, { silent: true });
    } else {
      this.inventory.primary = this._makeEntry(id);
      if (deathmatch) this.inventory.primary.reserve = 999;
      this._equip(id, { silent: true });
    }
    return { ok: true, message: `Compraste ${w.name}` };
  }

  _buyEquipment(equipment) {
    const player = this.game.player;
    const id = equipment.id;
    const deathmatch = this._isDeathmatchArsenal();
    if (!deathmatch && equipment.team !== 'both' && equipment.team !== player.team) {
      return this._fail(`Solo disponible para ${equipment.team === 'CT' ? 'CT' : 'T'}`);
    }
    if (WEAPONS[id]?.type === 'grenade') {
      const max = GRENADE_MAX[id] || 1;
      if ((this.inventory.grenades[id] || 0) >= max) return this._fail(`Máximo de ${equipment.name}`);
    } else if (id === 'ammo_primary') {
      if (!this.inventory.primary) return this._fail('No tenés arma primaria');
      const w = WEAPONS[this.inventory.primary.id];
      if (this.inventory.primary.reserve >= w.reserve) return this._fail('Reserva completa');
    } else if (id === 'ammo_secondary') {
      if (!this.inventory.secondary) return this._fail('No tenés arma secundaria');
      const w = WEAPONS[this.inventory.secondary.id];
      if (this.inventory.secondary.reserve >= w.reserve) return this._fail('Reserva completa');
    } else if (this._equipOwned(id)) {
      return this._fail(`Ya tenés ${equipment.name}`);
    }
    if (!deathmatch && player.money < equipment.price) {
      return this._fail(`Te faltan $${Math.ceil(equipment.price - player.money)}`);
    }

    if (!deathmatch) player.addMoney(-equipment.price);
    if (id === 'kevlar') {
      player.armor = 100;
    } else if (id === 'assaultsuit') {
      player.armor = 100;
      player.helmet = true;
    } else if (id === 'defusekit') {
      player.hasDefuseKit = true;
    } else if (WEAPONS[id]?.type === 'grenade') {
      this.inventory.grenades[id] = (this.inventory.grenades[id] || 0) + 1;
    } else if (id === 'ammo_primary') {
      this.inventory.primary.reserve = WEAPONS[this.inventory.primary.id].reserve;
    } else if (id === 'ammo_secondary') {
      this.inventory.secondary.reserve = WEAPONS[this.inventory.secondary.id].reserve;
    }
    return { ok: true, message: `Compraste ${equipment.name}` };
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  getHudState() {
    const player = this.game?.player;
    const w = this._currentWeapon();
    const entry = this._currentEntry();
    const grenadesOwned = GRENADE_IDS.filter((id) => (this.inventory.grenades[id] || 0) > 0);

    let ammo = 0;
    let reserve = 0;
    if (w?.type === 'grenade') {
      ammo = this.inventory.grenades[w.id] || 0;
    } else if (entry) {
      ammo = entry.magazine;
      reserve = entry.reserve;
    }

    const slots = [];
    if (this.inventory.primary) {
      const pw = WEAPONS[this.inventory.primary.id];
      slots.push({
        slot: 1,
        id: this.inventory.primary.id,
        name: pw.name,
        ammo: this.inventory.primary.magazine,
        reserve: this.inventory.primary.reserve,
        active: this.currentId === this.inventory.primary.id,
      });
    }
    if (this.inventory.secondary) {
      const sw = WEAPONS[this.inventory.secondary.id];
      slots.push({
        slot: 2,
        id: this.inventory.secondary.id,
        name: sw.name,
        ammo: this.inventory.secondary.magazine,
        reserve: this.inventory.secondary.reserve,
        active: this.currentId === this.inventory.secondary.id,
      });
    }
    slots.push({
      slot: 3,
      id: 'knife',
      name: WEAPONS.knife.name,
      ammo: 0,
      reserve: 0,
      active: this.currentId === 'knife',
    });
    if (grenadesOwned.length) {
      const activeGrenade =
        w?.type === 'grenade' ? w.id : grenadesOwned[0];
      slots.push({
        slot: 4,
        id: activeGrenade,
        name: WEAPONS[activeGrenade].name,
        ammo: this.inventory.grenades[activeGrenade] || 0,
        reserve: 0,
        active: this.currentId === activeGrenade,
      });
    }
    const hasC4 = !!player?.hasBomb;
    if (hasC4) {
      slots.push({
        slot: 5,
        id: 'c4',
        name: WEAPONS.c4.name,
        ammo: 0,
        reserve: 0,
        active: this.currentId === 'c4',
      });
    }

    return {
      name: w ? w.name : 'DESARMADO',
      weaponId: w ? w.id : 'none',
      ammo,
      reserve,
      slot: w ? w.slot : 3,
      slots,
      grenades: GRENADE_IDS.filter((id) => (this.inventory.grenades[id] || 0) > 0).map((id) => ({
        id,
        name: WEAPONS[id].name,
        count: this.inventory.grenades[id] || 0,
      })),
      hasC4,
      hasKit: !!player?.hasDefuseKit,
      spread: this.currentSpread(),
      scoped: this.isScoped(),
    };
  }

  // ---------------------------------------------------------------------------
  // Audio helper
  // ---------------------------------------------------------------------------

  _play(name, volume = 1, opts = {}) {
    if (!name) return;
    this.game.audio?.play?.(name, { volume, weaponId: this.currentId || null, ...opts });
  }
}
