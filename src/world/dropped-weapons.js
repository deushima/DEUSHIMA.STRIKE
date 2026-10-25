import * as THREE from '../../vendor/three.module.js';

const DEFAULT_PICKUP_RADIUS = 1.35;
const DEFAULT_ARM_DISTANCE = 1.9;
const DEFAULT_PICKUP_DELAY = 0.5;
const MAX_DROPS = 10;
const DROP_HALF_HEIGHT = 0.07;
const GRAVITY = 18;
const UP = new THREE.Vector3(0, 1, 0);

let instanceCounter = 0;

function randomIdPart() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid.slice(0, 8);
  } catch {
    /* fall back below */
  }
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function vectorFrom(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      finite(value[0], fallback?.x || 0),
      finite(value[1], fallback?.y || 0),
      finite(value[2], fallback?.z || 0),
    );
  }
  if (value && typeof value === 'object') {
    return new THREE.Vector3(
      finite(value.x, fallback?.x || 0),
      finite(value.y, fallback?.y || 0),
      finite(value.z, fallback?.z || 0),
    );
  }
  return fallback?.clone?.() || new THREE.Vector3();
}

function copyAmmo(ammo = {}) {
  return {
    magazine: Math.max(0, Math.floor(finite(ammo.magazine, 0))),
    reserve: Math.max(0, Math.floor(finite(ammo.reserve, 0))),
  };
}

function timestampSeconds(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1e10 ? n / 1000 : n;
}

/**
 * World primitive for locally simulated dropped guns.
 *
 * Network code can treat serializeSnapshot()/applySnapshot() as the boundary:
 * a host owns spawn/pickup decisions while guests only reconcile visual state.
 */
export class DroppedWeaponSystem {
  constructor(game, opts = {}) {
    this.game = game;
    this.items = [];
    // Epoch seconds make pickableAt portable between host/guest snapshots.
    this.time = Date.now() / 1000;
    this.pickupRadius = finite(opts.pickupRadius, DEFAULT_PICKUP_RADIUS);
    this.armDistance = finite(opts.armDistance, DEFAULT_ARM_DISTANCE);
    this.pickupDelay = finite(opts.pickupDelay, DEFAULT_PICKUP_DELAY);
    this.maxDrops = Math.max(1, Math.floor(finite(opts.maxDrops, MAX_DROPS)));
    this.getWeaponInfo = typeof opts.getWeaponInfo === 'function' ? opts.getWeaponInfo : () => null;
    this.canPickup = typeof opts.canPickup === 'function' ? opts.canPickup : () => true;
    this.onPickup = typeof opts.onPickup === 'function' ? opts.onPickup : () => false;
    this.localPickupEnabled = opts.localPickupEnabled !== false;
    this._idPrefix =
      `drop-${Date.now().toString(36)}-${(++instanceCounter).toString(36)}-${randomIdPart()}`;
    this._nextId = 1;
    this._bodyGeo = null;
    this._barrelGeo = null;
    this._magGeo = null;
    this._material = null;
    this._move = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  createId() {
    return `${this._idPrefix}-${(this._nextId++).toString(36)}`;
  }

  setLocalPickupEnabled(enabled) {
    this.localPickupEnabled = enabled !== false;
  }

  spawn(payload = {}) {
    const weaponId = String(payload.weaponId || payload.weapon || payload.entry?.id || '');
    if (!weaponId || !this.getWeaponInfo(weaponId)) return null;

    const position = vectorFrom(payload.position, this.game?.player?.pos);
    const velocity = vectorFrom(payload.velocity);
    const ammo = copyAmmo(payload.ammo || payload.entry);
    const explicitId = typeof payload.id === 'string' && payload.id ? payload.id : null;
    const id = explicitId || this.createId();
    if (explicitId) this.remove(id);
    const rawPickableIn = Number(payload.pickableIn);
    const item = {
      id,
      weaponId,
      ownerId: payload.ownerId == null ? null : String(payload.ownerId),
      ammo,
      pos: position,
      vel: velocity,
      yaw: finite(payload.yaw, 0),
      angularVelocity: finite(payload.angularVelocity, 1.8),
      pickableAt: Number.isFinite(rawPickableIn)
        ? this.time + Math.max(0, rawPickableIn)
        : Number.isFinite(Number(payload.pickableAt))
          ? timestampSeconds(payload.pickableAt, this.time)
          : this.time + Math.max(0, finite(payload.pickupDelay, this.pickupDelay)),
      armed: payload.armed === true,
      grounded: payload.grounded === true,
      mesh: null,
    };
    item.mesh = this._createMesh(item);
    this.items.push(item);
    while (this.items.length > this.maxDrops) this.remove(this.items[0]?.id);
    return item;
  }

  remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [item] = this.items.splice(index, 1);
    item.mesh?.removeFromParent?.();
    return true;
  }

  update(dt, player = this.game?.player, { allowPickup = true } = {}) {
    dt = Math.max(0, Math.min(0.1, finite(dt, 0)));
    this.time = Date.now() / 1000;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      this._updatePhysics(item, dt);
      this._syncMesh(item, dt);
      if (!allowPickup || !this.localPickupEnabled || !player?.alive) continue;

      const dx = player.pos.x - item.pos.x;
      const dz = player.pos.z - item.pos.z;
      const dy = player.pos.y - item.pos.y;
      const horizontalSq = dx * dx + dz * dz;
      if (!item.armed) {
        if (horizontalSq > this.armDistance * this.armDistance) item.armed = true;
        continue;
      }
      if (this.time < item.pickableAt) continue;
      if (horizontalSq > this.pickupRadius * this.pickupRadius || Math.abs(dy) > 1.6) continue;
      if (!this.canPickup(item)) continue;
      if (this.onPickup(item) === false) continue;
      this.remove(item.id);
    }
  }

  serializeSnapshot() {
    return this.items.map((item) => ({
      id: item.id,
      weaponId: item.weaponId,
      ownerId: item.ownerId,
      ammo: copyAmmo(item.ammo),
      position: [item.pos.x, item.pos.y, item.pos.z],
      velocity: [item.vel.x, item.vel.y, item.vel.z],
      yaw: item.yaw,
      angularVelocity: item.angularVelocity,
      armed: !!item.armed,
      grounded: !!item.grounded,
      pickableAt: item.pickableAt,
      pickableIn: Math.max(0, item.pickableAt - this.time),
    }));
  }

  applySnapshot(snapshot) {
    const rows = Array.isArray(snapshot) ? snapshot : snapshot?.drops;
    if (!Array.isArray(rows)) return false;

    const incoming = new Set();
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id : '';
      const weaponId =
        typeof row?.weaponId === 'string'
          ? row.weaponId
          : typeof row?.weapon === 'string'
            ? row.weapon
            : '';
      if (!id || !weaponId || !this.getWeaponInfo(weaponId)) continue;
      incoming.add(id);

      let item = this.items.find((candidate) => candidate.id === id);
      if (!item) {
        item = this.spawn({
          id,
          weaponId,
          ownerId: row.ownerId,
          ammo: row.ammo,
          position: row.position || row.pos,
          velocity: row.velocity || row.vel,
          yaw: row.yaw,
          angularVelocity: row.angularVelocity,
          pickableAt: row.pickableAt,
          pickableIn: row.pickableIn,
          armed: row.armed,
          grounded: row.grounded,
        });
        if (!item) continue;
      } else {
        item.weaponId = weaponId;
        item.ownerId = row.ownerId == null ? null : String(row.ownerId);
        item.ammo = copyAmmo(row.ammo);
        item.pos.copy(vectorFrom(row.position || row.pos, item.pos));
        item.vel.copy(vectorFrom(row.velocity || row.vel, item.vel));
        item.yaw = finite(row.yaw, item.yaw);
        item.angularVelocity = finite(row.angularVelocity, item.angularVelocity);
        item.armed = row.armed === true;
        item.grounded = row.grounded === true;
        item.pickableAt = Number.isFinite(Number(row.pickableIn))
          ? this.time + Math.max(0, finite(row.pickableIn, 0))
          : Number.isFinite(Number(row.pickableAt))
            ? timestampSeconds(row.pickableAt, this.time)
            : this.time;
        this._syncMesh(item, 0);
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!incoming.has(this.items[i].id)) this.remove(this.items[i].id);
    }
    return true;
  }

  clear() {
    for (const item of this.items) item.mesh?.removeFromParent?.();
    this.items.length = 0;
  }

  dispose() {
    this.clear();
    this._bodyGeo?.dispose?.();
    this._barrelGeo?.dispose?.();
    this._magGeo?.dispose?.();
    this._material?.dispose?.();
    this._bodyGeo = null;
    this._barrelGeo = null;
    this._magGeo = null;
    this._material = null;
  }

  _createMesh(item) {
    if (!this.game?.scene) return null;
    if (!this._bodyGeo) {
      this._bodyGeo = new THREE.BoxGeometry(0.12, 0.09, 0.46);
      this._barrelGeo = new THREE.BoxGeometry(0.055, 0.055, 0.28);
      this._magGeo = new THREE.BoxGeometry(0.075, 0.14, 0.1);
      this._material = new THREE.MeshStandardMaterial({
        color: 0x2c3034,
        roughness: 0.68,
        metalness: 0.38,
      });
    }

    const info = this.getWeaponInfo(item.weaponId) || {};
    const scale = info.slot === 2 ? 0.72 : 1;
    const group = new THREE.Group();
    const body = new THREE.Mesh(this._bodyGeo, this._material);
    const barrel = new THREE.Mesh(this._barrelGeo, this._material);
    const magazine = new THREE.Mesh(this._magGeo, this._material);
    barrel.position.z = -0.34;
    magazine.position.set(0, -0.08, 0.05);
    magazine.rotation.x = -0.22;
    group.add(body, barrel, magazine);
    group.scale.setScalar(scale);
    group.position.copy(item.pos);
    group.rotation.set(0.08, item.yaw, Math.PI * 0.48);
    group.name = `dropped-weapon:${item.id}`;
    this.game.scene.add(group);
    return group;
  }

  _syncMesh(item, dt) {
    if (!item.mesh) return;
    if (!item.grounded) item.yaw += item.angularVelocity * dt;
    else item.yaw += item.angularVelocity * dt * 0.12;
    item.mesh.position.copy(item.pos);
    item.mesh.rotation.y = item.yaw;
  }

  _updatePhysics(item, dt) {
    if (item.grounded || dt <= 0) return;
    item.vel.y -= GRAVITY * dt;
    this._move.copy(item.vel).multiplyScalar(dt);
    const distance = this._move.length();
    if (distance <= 1e-5) return;

    this._dir.copy(this._move).multiplyScalar(1 / distance);
    const hit = this.game?.raycastWorld
      ? this.game.raycastWorld(item.pos, this._dir, distance + DROP_HALF_HEIGHT)
      : this.game?.physics?.raycast?.(item.pos, this._dir, distance + DROP_HALF_HEIGHT);
    if (!hit?.point) {
      item.pos.add(this._move);
      return;
    }

    const normal = hit.normal?.lengthSq?.() > 0 ? hit.normal : UP;
    item.pos.copy(hit.point).addScaledVector(normal, DROP_HALF_HEIGHT);
    const normalSpeed = item.vel.dot(normal);
    if (normalSpeed < 0) item.vel.addScaledVector(normal, -1.18 * normalSpeed);
    item.vel.multiplyScalar(normal.y > 0.55 ? 0.52 : 0.72);
    if (normal.y > 0.55 && item.vel.lengthSq() < 0.45) {
      item.vel.set(0, 0, 0);
      item.grounded = true;
      item.angularVelocity = 0;
    }
  }
}

export const DROPPED_WEAPON_PICKUP_RADIUS = DEFAULT_PICKUP_RADIUS;
