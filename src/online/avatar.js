/**
 * RemoteAvatar â€” modelo procedural low-poly del rival en el modo online 1v1.
 *
 * Solo es visual: el jugador local nunca colisiona con este avatar. Las hitboxes se
 * obtienen desde `game.getPlayerHitboxes(remoteEntity)`, donde `remoteEntity` expone
 * `pos`, `height`, `radius`, `team`, `alive`, etc. (ver `OnlineMatch.getRemoteEntity`).
 *
 * Sin assets externos: todo son cajas con materiales compartidos por avatar.
 * API pÃºblica: group, pos, yaw, pitch, alive, height, radius, crouchAmount, eyeHeight,
 * setTarget(pos, yaw, pitch, crouch, alive), update(dt), playHit(), playDeath(),
 * respawn(), dispose().
 */
import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp, angleDiff } from '../core/utils.js';
import { collisionHullForMap, DEFAULT_PLAYER_STAND_HEIGHT } from '../core/player.js';

const RADIUS = 0.38;
const DEATH_DURATION = 0.55;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.08,
    roughness: opts.roughness ?? 0.78,
    emissive: new THREE.Color(color).multiplyScalar(opts.emissive ?? 0.18),
    flatShading: true,
  });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Paleta aproximada de CS 1.6 para cada equipo. */
function paletteFor(team) {
  if (team === 'T') {
    return {
      cloth: 0x5b4a30,
      clothDark: 0x40382a,
      vest: 0x4a4130,
      skin: 0xc79a72,
      boots: 0x2c251d,
      gloves: 0x3a3226,
      head: 0x6b5836,
      headgear: 0x6f5c37,
      gun: 0x6b4a2a,
      gunMetal: 0x2e3033,
      accent: 0xb03a2e,
    };
  }
  return {
    cloth: 0x33475c,
    clothDark: 0x24313f,
    vest: 0x2a3846,
    skin: 0xc8a07a,
    boots: 0x1f262d,
    gloves: 0x2a2f35,
    head: 0x2c3a47,
    headgear: 0x2a3440,
    gun: 0x3d444b,
    gunMetal: 0x2a2e33,
    accent: 0x4d7aa8,
  };
}

export class RemoteAvatar {
  /**
   * @param {object} game instancia de Game (usa game.scene)
   * @param {{name?:string, team?:'CT'|'T'}} opts
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.name = opts.name || 'Rival';
    this.team = opts.team === 'T' ? 'T' : 'CT';
    this._hull = collisionHullForMap(game?.map);
    // The community character is normalized to 1.8 before map-level scaling.
    // Its hip drop must reach the same crouch height as the physics hull.
    this._communityCrouchDrop = DEFAULT_PLAYER_STAND_HEIGHT *
      (1 - this._hull.crouchHeight / this._hull.standHeight);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.crouchAmount = 0;
    this.weaponId = this.team === 'T' ? 'glock' : 'usp';
    this.onGround = true;
    this.reloading = false;
    this.alive = true;
    this.radius = RADIUS; // The hit registration width stays independent from navigation clearance.

    this._targetPos = new THREE.Vector3(0, 0, 0);
    this._targetYaw = 0;
    this._targetPitch = 0;
    this._targetCrouch = 0;
    this._targetWeaponId = this.weaponId;
    this._targetOnGround = true;
    this._targetReloading = false;
    this._targetAlive = true;
    this._networkSpeed = null;
    this._targetVelocity = new THREE.Vector3();
    this._predictedPos = new THREE.Vector3();
    this.jumpState = 'ground';
    this._targetJumpState = 'ground';
    this._stateTick = 0;
    this._stateSentAt = 0;
    this._stateHostTime = 0;
    this.renderHostTime = 0;
    this._stateReceivedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    this._time = 0;
    this._deathTime = 0;
    this._hitFlash = 0;
    this._shootTimer = 0;
    this._walkPhase = 0;
    this._speed = 0;
    this._disposed = false;

    this._materials = [];
    const pal = paletteFor(this.team);
    const makeMat = (color, opts) => {
      const m = mat(color, opts);
      m.userData.baseEmissive = m.emissive.clone();
      m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      this._materials.push(m);
      return m;
    };
    this._mats = {
      cloth: makeMat(pal.cloth),
      clothDark: makeMat(pal.clothDark),
      vest: makeMat(pal.vest, { roughness: 0.62 }),
      skin: makeMat(pal.skin, { roughness: 0.9, emissive: 0.12 }),
      boots: makeMat(pal.boots, { roughness: 0.92 }),
      gloves: makeMat(pal.gloves, { roughness: 0.95 }),
      headgear: makeMat(pal.headgear, { roughness: 0.7 }),
      gun: makeMat(pal.gun, { roughness: 0.66 }),
      gunMetal: makeMat(pal.gunMetal, { metalness: 0.45, roughness: 0.42 }),
      accent: makeMat(pal.accent, { roughness: 0.5 }),
    };

    this.group = new THREE.Group();
    this.group.name = `remoteAvatar:${this.name}`;
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(this._hull.standHeight / DEFAULT_PLAYER_STAND_HEIGHT);

    // `_body` pivotea en los pies: sirve para agacharse y para la animaciÃ³n de muerte.
    this._body = new THREE.Group();
    this.group.add(this._body);

    this._legL = this._buildLeg(-0.11);
    this._legR = this._buildLeg(0.11);
    this._body.add(this._legL, this._legR);

    this._torso = box(0.42, 0.56, 0.25, this._mats.cloth, 0, 1.2, 0);
    this._body.add(this._torso);

    const vest = box(0.46, 0.4, 0.3, this._mats.vest, 0, 1.19, 0.01);
    this._body.add(vest);
    this._body.add(box(0.34, 0.1, 0.31, this._mats.clothDark, 0, 1.0, 0.02));

    this._armL = this._buildArm(-0.28);
    this._armR = this._buildArm(0.28);
    this._body.add(this._armL, this._armR);

    this._headGroup = new THREE.Group();
    this._headGroup.position.set(0, 1.52, 0);
    this._body.add(this._headGroup);
    this._headGroup.add(box(0.24, 0.25, 0.24, this._mats.skin, 0, 0.13, 0));
    this._headGroup.add(box(0.28, 0.12, 0.28, this._mats.headgear, 0, 0.27, 0));
    if (this.team === 'T') {
      // Gorra: visera hacia adelante (-Z).
      this._headGroup.add(box(0.26, 0.05, 0.14, this._mats.headgear, 0, 0.23, -0.17));
    } else {
      // Casco CT con detalle lateral.
      this._headGroup.add(box(0.09, 0.07, 0.18, this._mats.accent, 0.16, 0.24, 0));
    }

    // Arma: apuntando hacia -Z (frente del avatar).
    this._weaponGroup = new THREE.Group();
    this._weaponGroup.position.set(0.22, 1.28, -0.16);
    this._body.add(this._weaponGroup);
    if (this.team === 'T') {
      this._weaponGroup.add(box(0.07, 0.1, 0.58, this._mats.gun, 0, 0, -0.18));
      this._weaponGroup.add(box(0.05, 0.17, 0.16, this._mats.gunMetal, 0, -0.11, 0.06));
    } else {
      this._weaponGroup.add(box(0.07, 0.1, 0.52, this._mats.gunMetal, 0, 0, -0.16));
      this._weaponGroup.add(box(0.05, 0.16, 0.14, this._mats.gunMetal, 0, -0.1, 0.08));
    }
    this._weaponGroup.add(box(0.09, 0.03, 0.16, this._mats.gunMetal, 0, 0.07, -0.05));

    // Hombros ligeramente mÃ¡s anchos para leer la silueta.
    this._body.add(box(0.5, 0.08, 0.26, this._mats.vest, 0, 1.48, 0));

    if (game && game.scene) game.scene.add(this.group);
    this._kenney = null;
    this._attachCharacter();
  }

  async _attachCharacter() {
    const lib = this.game?.characters;
    if (!lib) return;
    try {
      await lib.load();
      if (this._disposed || !lib.ready) return;
      const character = lib.create(this.team, this.name.length + 3);
      if (!character) return;
      this._kenney = character;
      this._kenney.setWeapon?.(this.weaponId);
      this._body.visible = false;
      this.group.add(character.root);
    } catch (err) {
      console.warn('[avatar] modelo comunitario no disponible', err);
    }
  }

  get height() {
    return lerp(this._hull.standHeight, this._hull.crouchHeight, this.crouchAmount);
  }

  get eyeHeight() {
    return lerp(this._hull.eyeStand, this._hull.eyeCrouch, this.crouchAmount);
  }

  get standing() {
    return this.crouchAmount < 0.5;
  }

  _buildLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.86, 0);
    pivot.add(box(0.17, 0.8, 0.2, this._mats.clothDark, 0, -0.4, 0));
    pivot.add(box(0.19, 0.14, 0.27, this._mats.boots, 0, -0.79, -0.03));
    return pivot;
  }

  _buildArm(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    pivot.add(box(0.14, 0.5, 0.16, this._mats.cloth, 0, -0.24, 0));
    pivot.add(box(0.12, 0.12, 0.14, this._mats.gloves, 0, -0.53, -0.01));
    return pivot;
  }

  /** Copia el target y salta directo a Ã©l (spawn/respawn). */
  snapToTarget() {
    this.pos.copy(this._targetPos);
    this.renderHostTime = this._stateHostTime;
    this.yaw = this._targetYaw;
    this.pitch = this._targetPitch;
    this.crouchAmount = this._targetCrouch;
    this.weaponId = this._targetWeaponId;
    this.onGround = this._targetOnGround;
    this.jumpState = this._targetJumpState;
    this._kenney?.setWeapon?.(this.weaponId);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw + (this._kenney?.yawOffset || 0);
    this._body.rotation.x = 0;
    this._body.scale.y = 1;
    if (!this.alive) this.playDeath();
    else this.respawn();
  }

  /**
   * Estado de red recibido del otro peer.
   * @param {{x:number,y:number,z:number}|THREE.Vector3} pos
   */
  setTarget(
    pos,
    yaw = 0,
    pitch = 0,
    crouch = false,
    alive = true,
    weaponId = null,
    onGround = true,
    moveSpeed = null,
    reloading = false,
    velocity = null,
    jumpState = null,
    sentAt = 0,
    physicsTick = 0,
    hostTime = 0,
  ) {
    if (this._disposed) return;
    if (pos) {
      const x = Number(pos.x);
      const y = Number(pos.y);
      const z = Number(pos.z);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        this._targetPos.set(x, y, z);
      }
    }
    const nextYaw = Number(yaw);
    if (Number.isFinite(nextYaw)) this._targetYaw = nextYaw;
    const nextPitch = Number(pitch);
    if (Number.isFinite(nextPitch)) this._targetPitch = clamp(nextPitch, -1.45, 1.45);
    this._targetCrouch = crouch ? 1 : 0;
    if (typeof weaponId === 'string' && weaponId) this._targetWeaponId = weaponId;
    this._targetOnGround = onGround !== false;
    this._targetReloading = !!reloading;
    const nextSpeed = Number(moveSpeed);
    this._networkSpeed = Number.isFinite(nextSpeed) && nextSpeed >= 0 ? nextSpeed : null;
    if (velocity && typeof velocity === 'object') {
      const vx = Number(velocity.x);
      const vy = Number(velocity.y);
      const vz = Number(velocity.z);
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
        this._targetVelocity.set(vx, vy, vz);
      }
    }
    this._targetJumpState = jumpState === 'rise' || jumpState === 'fall'
      ? jumpState
      : (this._targetOnGround ? 'ground' : this._targetVelocity.y > 0.12 ? 'rise' : 'fall');
    this._stateTick = Math.max(this._stateTick, Math.round(Number(physicsTick) || 0));
    this._stateSentAt = Number.isFinite(Number(sentAt)) ? Number(sentAt) : 0;
    this._stateHostTime = Number.isFinite(hostTime) ? hostTime : 0;
    if(!this.renderHostTime)this.renderHostTime=this._stateHostTime;
    this._stateReceivedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const nextAlive = alive !== false;
    this._targetAlive = nextAlive;
    if (nextAlive !== this.alive) {
      this.alive = nextAlive;
      if (nextAlive) this.respawn();
      else this.playDeath();
    }
  }

  update(dt) {
    if (this._disposed) return;
    const step = clamp(Number(dt) || 0, 0, 0.1);
    this._time += step;

    const prevX = this.pos.x;
    const prevZ = this.pos.z;

    // Posición: interpolación + una predicción corta por velocidad. El estado
    // llega a ~20 Hz; 80 ms de dead-reckoning reduce el jitter en bhops rápidos
    // sin convertir la velocidad declarada por red en autoridad de gameplay.
    const posLambda = 18;
    const k = 1 - Math.exp(-posLambda * step);
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const age = clamp((nowMs - this._stateReceivedAt) / 1000, 0, 0.08);
    this._predictedPos.copy(this._targetPos).addScaledVector(this._targetVelocity, age);
    this.pos.lerp(this._predictedPos, k);
    if(this._stateHostTime>0)this.renderHostTime=lerp(this.renderHostTime||this._stateHostTime,this._stateHostTime+age*1000,k);
    if (this.pos.distanceToSquared(this._predictedPos) < 1e-6) this.pos.copy(this._predictedPos);

    // Yaw por el camino mÃ¡s corto.
    const yawDiff = angleDiff(this.yaw, this._targetYaw);
    this.yaw += yawDiff * (1 - Math.exp(-16 * step));
    this.pitch = lerp(this.pitch, this._targetPitch, 1 - Math.exp(-14 * step));
    this.crouchAmount = lerp(this.crouchAmount, this._targetCrouch, 1 - Math.exp(-12 * step));
    this.weaponId = this._targetWeaponId;
    this.onGround = this._targetOnGround;
    this.reloading = this._targetReloading;
    this.jumpState = this._targetJumpState;
    this._shootTimer = Math.max(0, this._shootTimer - step);

    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    const instantSpeed = step > 0 ? moved / step : 0;
    const targetSpeed = this._networkSpeed ?? instantSpeed;
    this._speed = lerp(this._speed, targetSpeed, 1 - Math.exp(-10 * step));

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw + (this._kenney?.yawOffset || 0);
    this.group.rotation.x = 0;

    // Agachado: comprimir el cuerpo desde los pies.
    this._body.scale.y = lerp(1, this._hull.crouchHeight / this._hull.standHeight, this.crouchAmount);
    this._headGroup.rotation.x = this.pitch * 0.75;
    this._weaponGroup.rotation.x = this.pitch * 0.9;

    if (!this.alive) {
      this._deathTime = Math.min(DEATH_DURATION + 0.3, this._deathTime + step);
      const t = clamp(this._deathTime / DEATH_DURATION, 0, 1);
      const ease = t * t * (3 - 2 * t);
      // Caer hacia adelante, pivotando en los pies.
      this._body.rotation.x = -ease * 1.37;
      this._body.position.y = -0.02 * ease;
      this._legL.rotation.x = 0.2 * ease;
      this._legR.rotation.x = -0.15 * ease;
      this._armL.rotation.x = -0.8 * ease;
      this._armR.rotation.x = -0.6 * ease;
    } else {
      this._body.rotation.x = lerp(this._body.rotation.x, 0, 1 - Math.exp(-14 * step));
      this._body.position.y = lerp(this._body.position.y, 0, 1 - Math.exp(-14 * step));

      const moveFactor = clamp(this._speed / 5.6, 0, 1.2);
      this._walkPhase += step * (3.4 + moveFactor * 8.5);
      const swing = Math.sin(this._walkPhase) * 0.62 * moveFactor;
      this._legL.rotation.x = swing;
      this._legR.rotation.x = -swing;
      this._armL.rotation.x = -swing * 0.75;
      this._armR.rotation.x = swing * 0.35;
    }

    // Modelo Quaternius (si estÃ¡ disponible) reemplaza el cuerpo procedural.
    if (this._kenney) {
      const moving = this.alive && this._speed > 0.45;
      this._kenney.update(step, {
        alive: this.alive,
        onGround: this.onGround,
        crouching: this.crouchAmount > 0.5,
        crouchDrop: this._communityCrouchDrop,
        pitch: this.pitch,
        yaw: this.yaw,
        weaponId: this.weaponId,
        speed: this._speed,
        velocity: this._targetVelocity,
        jumpState: this.jumpState,
        reloading: this.reloading,
        shooting: this._shootTimer > 0,
      }, moving);
      const t = this.alive ? 0 : clamp(this._deathTime / DEATH_DURATION, 0, 1);
      this._kenney.root.rotation.x = -t * 1.37;
    }

    // Flash de impacto.
    if (this._hitFlash > 0) {
      this._hitFlash = Math.max(0, this._hitFlash - step * 5.5);
    }
    const flash = this._hitFlash;
    for (const m of this._materials) {
      m.emissive.copy(m.userData.baseEmissive);
      if (flash > 0) m.emissive.lerp(new THREE.Color(0xff2a1e), Math.min(1, flash));
      m.emissiveIntensity = m.userData.baseEmissiveIntensity + flash * 0.9;
    }
  }

  playHit() {
    if (this._disposed) return;
    this._hitFlash = 1;
  }

  playShoot(duration = 0.16) {
    if (this._disposed || !this.alive) return;
    this._shootTimer = Math.max(this._shootTimer, Math.max(0.06, Number(duration) || 0.16));
  }

  playDeath() {
    if (this._disposed) return;
    this.alive = false;
    this._targetAlive = false;
    this._deathTime = 0;
  }

  respawn() {
    if (this._disposed) return;
    this.alive = true;
    this._targetAlive = true;
    this._deathTime = 0;
    this._hitFlash = 0;
    this.jumpState = 'ground';
    this._targetJumpState = 'ground';
    this._targetVelocity.set(0, 0, 0);
    this._body.rotation.x = 0;
    this._body.position.y = 0;
    if (this._kenney) {
      this._kenney.root.rotation.x = 0;
      this._kenney.setWeapon?.(this.weaponId);
    }
    this._legL.rotation.x = 0;
    this._legR.rotation.x = 0;
    this._armL.rotation.x = 0;
    this._armR.rotation.x = 0;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._kenney?.dispose?.();
    this._kenney?.root?.removeFromParent();
    this._kenney = null;
    this.group.removeFromParent();
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
    });
    for (const m of this._materials) m.dispose?.();
    this._materials.length = 0;
    this.group.clear?.();
  }
}

