import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp, expDamp, DEG, distance2D } from './utils.js';
import {
  DEFAULT_MATCH_MOVEMENT_PRESET,
  movementPreset,
  movementPresetForGame,
} from './movement-presets.js';

const UP = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _eye = new THREE.Vector3();

const DEFAULT_RUN_SPEED = 6.25; // 250 GoldSrc units/s at ~40 u per world meter.

export class Player {
  constructor(game) {
    this.game = game;
    this.isPlayer = true;
    this.isBot = false;
    this.name = 'Jugador';
    this.team = 'CT';

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.radius = 0.38;
    this.height = 1.8;
    this.standHeight = 1.8;
    this.crouchHeight = 1.32;
    this.eyeStand = 1.62;
    this.eyeCrouch = 1.12;
    this.stepHeight = 0.5;
    this.onGround = false;
    this.crouching = false;
    this.walking = false;
    this.crouchAmount = 0;

    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.viewRoll = 0;
    this.shake = 0;
    this.bobTime = 0;
    this.bobAmount = 0;
    this.stepDistance = 0;

    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.alive = false;
    this.deathTime = 0;
    this.lastDamageTime = -10;
    this.lastAttacker = null;
    this.damageFlash = 0;

    this.money = 800;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.roundKills = 0;
    this.score = 0;
    this.hasDefuseKit = false;
    this.hasBomb = false;
    this.teamKills = 0;
    this.speed = 0;
    this.moveSpeed = DEFAULT_RUN_SPEED;

    this.spawnProtection = 0;
    this._jumpBuffer = 0;
    this._jumpHeld = false;
    this._jumpCount = 0;
    this._physicsTick = 0;
    this._physicsAccumulator = 0;
    this._jumpPressedLatched = false;
    this._movementPreset = movementPresetForGame(game);
    this.movementPresetId = this._movementPreset.id || DEFAULT_MATCH_MOVEMENT_PRESET;
    this.stepHeight = this._movementPreset.stepHeight;
    this._tmp = new THREE.Vector3();
  }

  reset(team = this.team, spawn = null) {
    this.team = team;
    this.pos.set(spawn?.x ?? 0, spawn?.y ?? 0.05, spawn?.z ?? 0);
    this.vel.set(0, 0, 0);
    this.yaw = (spawn?.yaw ?? 0) * DEG;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.health = 100;
    this.alive = true;
    this.deathTime = 0;
    this.height = this.standHeight;
    this.crouchAmount = 0;
    this.crouching = false;
    this.onGround = false;
    this.damageFlash = 0;
    this.lastDamageTime = -10;
    this.spawnProtection = 1.0;
    this._jumpBuffer = 0;
    this._jumpHeld = false;
    this._jumpCount = 0;
    this._physicsAccumulator = 0;
    this._jumpPressedLatched = false;
    this._movementPreset = movementPresetForGame(this.game);
    this.movementPresetId = this._movementPreset.id || DEFAULT_MATCH_MOVEMENT_PRESET;
    this.stepHeight = this._movementPreset.stepHeight;
    this.roundKills = 0;
    this.hasBomb = false;
    this.updateCamera(0, true);
  }

  respawn(team, spawn) {
    this.reset(team, spawn);
  }

  get eyeHeight() {
    return lerp(this.eyeStand, this.eyeCrouch, this.crouchAmount);
  }

  getEyePosition(target = new THREE.Vector3()) {
    return target.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  getVelocity2D() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  getAimDirection(target = new THREE.Vector3()) {
    const pitch = this.pitch + this.recoilPitch;
    const yaw = this.yaw + this.recoilYaw;
    return target
      .set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
      .normalize();
  }

  addRecoil(pitchKick, yawKick) {
    this.recoilPitch += pitchKick;
    this.recoilYaw += yawKick;
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  addMoney(amount) {
    this.money = clamp(this.money + amount, 0, 16000);
    return this.money;
  }

  applyInputLook(dt) {
    const input = this.game.input;
    if (!input.locked) return;
    const look = input.consumeLook();
    const sens = 0.0021 * (this.game.settings.sensitivity ?? 1);
    const invert = this.game.settings.invertY ? -1 : 1;
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens * invert;
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.pitch = clamp(this.pitch, -89 * DEG, 89 * DEG);
  }

  accelerate(wishDir, wishSpeed, accel, dt) {
    if (wishDir.lengthSq() < 1e-8 || wishSpeed <= 0) return;
    const current = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * dt, add);
    this.vel.x += wishDir.x * accelSpeed;
    this.vel.z += wishDir.z * accelSpeed;
  }

  applyFriction(dt, friction = this._movementPreset.friction) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.05) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }
    const control = Math.max(speed, this._movementPreset.stopSpeed);
    const drop = control * friction * dt;
    const newSpeed = Math.max(0, speed - drop);
    const scale = newSpeed / speed;
    this.vel.x *= scale;
    this.vel.z *= scale;
  }

  airAccelerate(wishDir, wishSpeed, dt) {
    if (wishDir.lengthSq() < 1e-8 || wishSpeed <= 0) return;
    const preset = this._movementPreset;
    const cappedWish = Math.min(wishSpeed, preset.airWishCap);
    const current = this.vel.x * wishDir.x + this.vel.z * wishDir.z;
    const add = cappedWish - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(preset.airAccelerate * wishSpeed * dt, add);
    this.vel.x += wishDir.x * accelSpeed;
    this.vel.z += wishDir.z * accelSpeed;
  }

  setMovementPreset(id) {
    this._movementPreset = movementPreset(id);
    this.movementPresetId = this._movementPreset.id;
    this.stepHeight = this._movementPreset.stepHeight;
    this._physicsAccumulator = 0;
    return this._movementPreset;
  }

  refreshMovementPreset() {
    const next = movementPresetForGame(this.game);
    if (next.id !== this.movementPresetId) this.setMovementPreset(next.id);
    return this._movementPreset;
  }

  getMovementDebugState() {
    return {
      preset: this.movementPresetId,
      horizontalSpeed: this.getVelocity2D(),
      verticalSpeed: this.vel.y,
      grounded: this.onGround,
      tick: this._physicsTick,
      wishSpeed: this.moveSpeed,
      airAcceleration: this._movementPreset.airAccelerate,
      jumpCount: this._jumpCount,
      jumpHeld: this._jumpHeld,
      autoBhopEnabled: !!this._movementPreset.autoBhopEnabled,
      fixedStep: this._movementPreset.fixedStep,
    };
  }

  wishDirection() {
    const input = this.game.input;
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.set(0, 0, 0).addScaledVector(_forward, f).addScaledVector(_right, s);
    if (_wish.lengthSq() > 1) _wish.normalize();
    return _wish;
  }

  _simulateMovementStep(dt, canMove) {
    const game = this.game;
    const input = game.input;
    const preset = this._movementPreset;
    this._physicsTick++;

    this.walking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const wantsCrouch = canMove && (input.isDown('ControlLeft') || input.isDown('ControlRight'));
    const canStand = wantsCrouch || this.height >= this.standHeight - 0.005
      ? true
      : (game.physics?.canFitBody?.(this, this.standHeight) ?? true);
    this.crouching = wantsCrouch || !canStand;

    const targetHeight = this.crouching ? this.crouchHeight : this.standHeight;
    this.height = targetHeight; // Collision hull changes only after clearance; eyes ease separately.
    this.crouchAmount = expDamp(this.crouchAmount, this.crouching ? 1 : 0, 16, dt);

    // Weapon speed is wishspeed/ground acceleration target, never an absolute
    // clamp on accumulated horizontal bhop velocity.
    const weaponRunSpeed = clamp(
      Number(game.weapons?.getMoveSpeed?.() ?? DEFAULT_RUN_SPEED) || DEFAULT_RUN_SPEED,
      4.6,
      6.6,
    );
    if (this.crouching) this.moveSpeed = weaponRunSpeed * preset.crouchSpeedFactor;
    else if (this.walking) this.moveSpeed = weaponRunSpeed * preset.walkSpeedFactor;
    else this.moveSpeed = weaponRunSpeed;

    if (this._jumpPressedLatched) {
      this._jumpBuffer = preset.jumpBuffer;
      this._jumpPressedLatched = false;
    }
    this._jumpHeld = input.isDown('Space');

    const wish = this.wishDirection();
    if (canMove) {
      if (this.onGround) {
        const autoJump = preset.autoBhopEnabled && preset.jumpWhileHeldOnLanding && this._jumpHeld;
        if (this._jumpBuffer > 0 || autoJump) {
          this._beginJump();
        } else {
          let friction = preset.friction;
          const horizontalSpeed = this.getVelocity2D();
          if (horizontalSpeed > 0.05 && game.physics?.hasGroundBelow) {
            const ahead = preset.edgeProbeForward / horizontalSpeed;
            const supported = game.physics.hasGroundBelow(
              this,
              this.vel.x * ahead,
              this.vel.z * ahead,
              preset.edgeProbeDrop,
            );
            if (!supported) friction *= preset.edgeFriction;
          }
          this.applyFriction(dt, friction);
          this.accelerate(wish, this.moveSpeed, preset.accelerate, dt);
        }
      }
      // A jump changes movement mode immediately: the takeoff tick uses air acceleration.
      if (!this.onGround && preset.airStrafeEnabled) this.airAccelerate(wish, this.moveSpeed, dt);
    } else if (this.onGround) {
      this.applyFriction(dt, Math.max(10, preset.friction));
    }

    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);

    // GoldSrc applies gravity around movement. Splitting it in half keeps the
    // integration stable at the fixed tick without changing horizontal bhop.
    if (!this.onGround || this.vel.y > 0) this.vel.y -= preset.gravity * 0.5 * dt;
    const maxVelocity = preset.maxVelocity;
    this.vel.x = clamp(this.vel.x, -maxVelocity, maxVelocity);
    this.vel.y = clamp(this.vel.y, -maxVelocity, maxVelocity);
    this.vel.z = clamp(this.vel.z, -maxVelocity, maxVelocity);

    const wasOnGround = this.onGround;
    const fallSpeed = this.vel.y;
    game.physics.moveBody(this, dt);
    if (!this.onGround) this.vel.y -= preset.gravity * 0.5 * dt;

    if (!wasOnGround && this.onGround) {
      if (fallSpeed < -8.2) {
        const dmg = Math.min(90, Math.floor((-fallSpeed - 8.2) * 10));
        if (dmg > 0) this.takeDamage(dmg, null, 'legs', 'fall');
      }
      game.audio.play('land', { volume: clamp(fallSpeed / -12, 0.25, 1) });
      this.addShake(0.08);
      // Held Space is consumed on the landing tick itself, before any ground friction.
      if (canMove && preset.autoBhopEnabled && preset.jumpWhileHeldOnLanding && this._jumpHeld) this._beginJump();
    }
  }

  _beginJump() {
    const preset = this._movementPreset;
    if (!preset.removeClassicBhopSpeedPenalty) {
      const speed = this.getVelocity2D();
      if (speed > this.moveSpeed * 1.2) {
        this.vel.x *= this.moveSpeed * .96 / speed;
        this.vel.z *= this.moveSpeed * .96 / speed;
      }
    }
    this.vel.y = preset.jumpVelocity;
    this.onGround = false;
    this._jumpBuffer = 0;
    this._jumpCount++;
    this.game.audio.play('jump');
  }

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      this.deathTime += dt;
      this.applyInputLook(dt);
      this.updateCamera(dt);
      return;
    }

    this.applyInputLook(dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);
    this.spawnProtection = Math.max(0, this.spawnProtection - dt);

    const input = game.input;
    const canMove = game.canMove();
    this.refreshMovementPreset();
    if (input.wasPressed('Space')) this._jumpPressedLatched = true;
    const wheelJump = input.consumeWheelJump?.({
      up: game.settings.jumpWheelUp === true,
      down: game.settings.jumpWheelDown === true,
    });
    if (canMove && wheelJump) this._jumpPressedLatched = true;
    this._jumpHeld = input.isDown('Space');

    const preset = this._movementPreset;
    const frameDt = Math.min(preset.maxFrameCatchup, Math.max(0, Number(dt) || 0));
    this._physicsAccumulator = Math.min(
      preset.maxFrameCatchup,
      this._physicsAccumulator + frameDt,
    );
    let steps = 0;
    while (
      this._physicsAccumulator + 1e-9 >= preset.fixedStep &&
      steps < preset.maxPhysicsStepsPerFrame
    ) {
      this._simulateMovementStep(preset.fixedStep, canMove);
      this._physicsAccumulator -= preset.fixedStep;
      steps++;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.updateBobAndSteps(dt);
    this.decayRecoil(dt);
    this.updateCamera(dt);
  }


  updateBobAndSteps(dt) {
    const game = this.game;
    const moving = this.onGround && this.speed > 0.4;
    if (moving) {
      this.bobTime += dt * (this.walking ? 7 : 10.5);
      this.bobAmount = expDamp(this.bobAmount, this.walking ? 0.25 : 1, 8, dt);
      this.stepDistance += this.speed * dt;
      const interval = this.walking ? 2.15 : 1.75;
      if (this.stepDistance > interval) {
        this.stepDistance = 0;
        game.audio.play('footstep', {
          volume: this.walking ? 0.22 : 0.48,
          pan: (Math.random() - 0.5) * 0.2,
        });
      }
    } else {
      this.bobAmount = expDamp(this.bobAmount, 0, 8, dt);
      this.stepDistance = 0;
    }
  }

  decayRecoil(dt) {
    this.recoilPitch = expDamp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = expDamp(this.recoilYaw, 0, 9, dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  updateCamera(dt, instant = false) {
    const cam = this.game.camera;
    if (!cam) return;
    const bob = this.bobAmount * Math.sin(this.bobTime) * 0.015;
    const bobSide = this.bobAmount * Math.cos(this.bobTime * 0.5) * 0.012;
    const shakeX = (Math.random() - 0.5) * this.shake * 0.026;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.026;
    const crouchOffset = 0;
    if (!this.alive) {
      const t = Math.min(1, this.deathTime / 0.7);
      cam.position.set(this.pos.x, this.pos.y + lerp(this.eyeHeight, 0.28, t), this.pos.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(this.pitch + this.recoilPitch - 0.18 * t, this.yaw + this.recoilYaw, 0.42 * t);
      return;
    }
    _eye.set(
      this.pos.x + bobSide + shakeX,
      this.pos.y + this.eyeHeight + bob + crouchOffset + shakeY,
      this.pos.z,
    );
    if (instant) cam.position.copy(_eye);
    else cam.position.lerp(_eye, 1 - Math.exp(-28 * dt));
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, this.viewRoll);
  }

  takeDamage(amount, source, part = 'chest', weaponId = 'unknown') {
    if (!this.alive) return 0;
    const game = this.game;
    let dmg = Math.max(0, amount);
    if (dmg <= 0) return 0;

    let armorDamage = 0;
    if (this.armor > 0) {
      const blocked = part === 'head' ? (this.helmet ? 0.5 : 0) : 0.5;
      const healthPortion = dmg * (1 - blocked);
      armorDamage = part === 'head' && !this.helmet ? 0 : Math.min(this.armor, dmg * 0.5);
      this.armor = Math.max(0, this.armor - armorDamage);
      dmg = healthPortion;
    }

    if (this.spawnProtection > 0) dmg *= 0.5;
    dmg = Math.max(1, Math.round(dmg));
    this.health -= dmg;
    this.lastDamageTime = game.time;
    this.lastAttacker = source;
    this.damageFlash = 1;
    this.addShake(clamp(dmg / 45, 0.08, 0.6));

    if (source && source.pos) {
      const ang = Math.atan2(source.pos.x - this.pos.x, source.pos.z - this.pos.z);
      game.ui?.showDamage(ang * (180 / Math.PI));
    }
    game.audio.play('hurt', { volume: clamp(dmg / 45, 0.35, 1) });
    game.ui?.flashDamage?.(clamp(dmg / 80, 0.05, 0.35));

    if (this.health <= 0) {
      this.health = 0;
      this.die(source, weaponId, part === 'head');
    }
    return dmg;
  }

  die(killer, weaponId = 'unknown', headshot = false) {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = 0;
    this.vel.x *= 0.2;
    this.vel.z *= 0.2;
    this.game.audio.play('death');
    this.armor = 0;
    this.helmet = false;
    this.hasDefuseKit = false;
    this.game.notifyKill(killer, this, weaponId, headshot);
    this.game.weapons?.dropAll?.();
  }
}
