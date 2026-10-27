import * as THREE from '../../vendor/three.module.js';
import { rand, canvasTexture, clamp } from './utils.js';

const SURFACE_COLORS = {
  sand: 0x8d7a56,
  stone: 0x77756e,
  wood: 0x6b4d2e,
  metal: 0x6c7074,
  dirt: 0x5f5138,
  glass: 0x9fc4c9,
  concrete: 0x8b8b82,
};

function particleTexture() {
  return canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function smokeTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 24; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.45;
      const y = s / 2 + (Math.random() - 0.5) * s * 0.45;
      const r = s * (0.12 + Math.random() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(225,222,210,0.16)');
      g.addColorStop(0.6, 'rgba(200,198,188,0.08)');
      g.addColorStop(1, 'rgba(180,180,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function flashTexture() {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.25, 'rgba(255,215,120,0.85)');
    g.addColorStop(0.55, 'rgba(255,150,40,0.35)');
    g.addColorStop(1, 'rgba(255,90,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,240,180,0.9)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * 8, s / 2 + Math.sin(a) * 8);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.45, s / 2 + Math.sin(a) * s * 0.45);
      ctx.stroke();
    }
  });
}

function decalTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(8,7,5,0.92)');
    g.addColorStop(0.16, 'rgba(20,17,12,0.8)');
    g.addColorStop(0.3, 'rgba(30,25,18,0.4)');
    g.addColorStop(0.62, 'rgba(30,25,18,0.12)');
    g.addColorStop(1, 'rgba(30,25,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(10,9,7,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const len = 14 + Math.random() * 24;
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s / 2 + Math.cos(a) * len, s / 2 + Math.sin(a) * len);
      ctx.stroke();
    }
  });
}

class ParticlePool {
  constructor(scene, max = 700, opts = {}) {
    this.max = max;
    this.scene = scene;
    this.particles = Array.from({ length: max }, () => ({
      life: 0,
      maxLife: 1,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      gravity: 0,
      color: new THREE.Color(),
      base: new THREE.Color(),
      drag: 1,
    }));
    this.cursor = 0;

    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) this.positions[i * 3 + 1] = -9999;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    this.material = new THREE.PointsMaterial({
      size: opts.size ?? 0.06,
      map: opts.texture || null,
      vertexColors: true,
      transparent: true,
      opacity: opts.opacity ?? 0.95,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
      sizeAttenuation: true,
      alphaTest: 0.01,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? 5;
    scene.add(this.points);
  }

  spawn(pos, vel, color, life, { gravity = 0, drag = 1 } = {}) {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.life = life;
    p.maxLife = life;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.gravity = gravity;
    p.drag = drag;
    p.base.set(color);
    p.color.copy(p.base);
    return p;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      const o = i * 3;
      if (p.life <= 0) {
        this.positions[o + 1] = -9999;
        continue;
      }
      any = true;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02 && p.gravity > 0) {
        p.pos.y = 0.02;
        p.vel.y *= -0.25;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      const a = clamp(p.life / p.maxLife, 0, 1);
      p.color.copy(p.base).multiplyScalar(a);
      this.positions[o] = p.pos.x;
      this.positions[o + 1] = p.pos.y;
      this.positions[o + 2] = p.pos.z;
      this.colors[o] = p.color.r;
      this.colors[o + 1] = p.color.g;
      this.colors[o + 2] = p.color.b;
    }
    if (any) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
    }
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.material.map?.dispose();
  }
}

class TracerPool {
  constructor(scene, max = 28) {
    this.max = max;
    this.tracers = Array.from({ length: max }, () => ({ life: 0, maxLife: 0.07 }));
    this.cursor = 0;
    this.positions = new Float32Array(max * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(max * 2), 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      color: 0xffcf7a,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 1,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);
  }

  spawn(from, to) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 6;
    this.positions[o] = from.x;
    this.positions[o + 1] = from.y;
    this.positions[o + 2] = from.z;
    this.positions[o + 3] = to.x;
    this.positions[o + 4] = to.y;
    this.positions[o + 5] = to.z;
    this.tracers[i].life = 0.07;
    this.tracers[i].maxLife = 0.07;
    this.geometry.attributes.position.needsUpdate = true;
    this.updateDrawRange();
  }

  updateDrawRange() {
    // Submit only live segments. Moving one endpoint offscreen stretches the
    // expired shot through the world instead of removing it from the renderer.
    const index = this.geometry.index;
    let count = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.tracers[i].life <= 0) continue;
      index.array[count++] = i * 2;
      index.array[count++] = i * 2 + 1;
    }
    index.needsUpdate = true;
    this.geometry.setDrawRange(0, count);
  }

  update(dt) {
    let changed = false;
    for (let i = 0; i < this.max; i++) {
      const t = this.tracers[i];
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) {
          changed = true;
        }
      }
    }
    if (changed) {
      this.updateDrawRange();
      this.material.opacity = 0.55;
    }
  }

  dispose() {
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

class DecalPool {
  constructor(scene, max = 72) {
    this.max = max;
    this.cursor = 0;
    this.texture = decalTexture();
    this.geometry = new THREE.PlaneGeometry(0.22, 0.22);
    this.materials = {};
    for (const [key, color] of Object.entries(SURFACE_COLORS)) {
      this.materials[key] = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
        color,
      });
    }
    this.decals = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.geometry, this.materials.stone);
      m.visible = false;
      m.renderOrder = 4;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
  }

  spawn(point, normal, surface = 'stone') {
    const d = this.decals[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    const n = normal.lengthSq() > 0.1 ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
    d.mesh.position.copy(point).addScaledVector(n, 0.012);
    d.mesh.lookAt(d.mesh.position.clone().add(n));
    d.mesh.rotateZ(Math.random() * Math.PI * 2);
    d.mesh.scale.setScalar(0.65 + Math.random() * 0.7);
    d.mesh.material = this.materials[surface] || this.materials.stone;
    d.mesh.visible = true;
    d.life = 34;
  }

  update(dt) {
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  dispose() {
    for (const d of this.decals) d.mesh.removeFromParent();
    this.geometry.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.texture.dispose();
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.particleTex = particleTexture();
    this.smokeTex = smokeTexture();
    this.flashTex = flashTexture();
    this.sparks = new ParticlePool(this.scene, 700, {
      size: 0.07,
      texture: this.particleTex,
      blending: THREE.AdditiveBlending,
      renderOrder: 6,
    });
    this.smokeParticles = new ParticlePool(this.scene, 380, {
      size: 0.55,
      texture: this.smokeTex,
      opacity: 0.55,
      blending: THREE.NormalBlending,
      renderOrder: 3,
    });
    this.tracers = new TracerPool(this.scene, 32);
    this.decals = new DecalPool(this.scene, 72);
    this.shells = [];
    this.muzzleSprites = [];
    this.muzzleLights = [];
    this.explosions = [];
    this.smokeClouds = [];
    this._initMuzzlePool();
    this._initShellPool();
    this._smokeCloudSeq = 0;
    this._tmpVec = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();
  }

  _initMuzzlePool() {
    this.flashMaterial = new THREE.SpriteMaterial({
      map: this.flashTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95,
    });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(this.flashMaterial.clone());
      s.visible = false;
      s.renderOrder = 7;
      this.scene.add(s);
      this.muzzleSprites.push({ sprite: s, life: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffbb55, 0, 9, 2);
      this.scene.add(l);
      this.muzzleLights.push({ light: l, life: 0 });
    }
  }

  _initShellPool() {
    const geo = new THREE.BoxGeometry(0.018, 0.018, 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb58a3c, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = false;
      this.scene.add(m);
      this.shells.push({
        mesh: m,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        grounded: false,
      });
    }
    this._shellCursor = 0;
    this._shellGeo = geo;
    this._shellMat = mat;
  }

  bulletImpact(point, normal, surface = 'stone') {
    const color = SURFACE_COLORS[surface] || SURFACE_COLORS.stone;
    this.decals.spawn(point, normal, surface);
    const metal = surface === 'metal';
    const glass = surface === 'glass';
    const fragments = metal ? 6 : glass ? 3 : surface === 'wood' ? 1 : 2;
    const n = normal.normalize();
    for (let i = 0; i < fragments; i++) {
      const v = n.clone().multiplyScalar(rand(0.8, 3.4));
      v.x += (Math.random() - 0.5) * 3.2;
      v.y += Math.random() * 2.4;
      v.z += (Math.random() - 0.5) * 3.2;
      this.sparks.spawn(point, v, new THREE.Color(metal ? 0xffc675 : color), rand(0.10, 0.23), { gravity: 12, drag: 0.96 });
    }
    for (let i = 0; i < (metal || glass ? 1 : 3); i++) {
      const v = n.clone().multiplyScalar(rand(0.2, 0.9));
      v.x += (Math.random() - 0.5) * 0.6;
      v.y += rand(0.1, 0.5);
      v.z += (Math.random() - 0.5) * 0.6;
      this.smokeParticles.spawn(
        point,
        v,
        new THREE.Color(color).lerp(new THREE.Color(0xd8d2bd), 0.55),
        rand(0.35, 0.9),
        { gravity: -0.4, drag: 0.95 },
      );
    }
    if (metal && Math.random() < 0.24) this.game.audio.play('ricochet', { volume: 0.35, pan: rand(-0.6, 0.6) });
  }

  blood(point, direction = null) {
    const dir = direction ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 12; i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 3.2));
      v.x += (Math.random() - 0.5) * 2.4;
      v.y += Math.random() * 2;
      v.z += (Math.random() - 0.5) * 2.4;
      this.sparks.spawn(point, v, new THREE.Color(0x8e0b0b), rand(0.18, 0.5), { gravity: 15, drag: 0.97 });
    }
  }

  tracer(from, to, color = 0xffcf7a) {
    this.tracers.spawn(from, to);
  }

  muzzleFlash(position, dir, scale = 1) {
    const p = this.muzzleSprites.find((m) => m.life <= 0) || this.muzzleSprites[0];
    p.life = 0.055;
    p.sprite.visible = true;
    p.sprite.position.copy(position).addScaledVector(dir, 0.12);
    p.sprite.scale.setScalar((0.55 + Math.random() * 0.25) * scale);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.material.opacity = 0.95;
    const l = this.muzzleLights.find((x) => x.life <= 0) || this.muzzleLights[0];
    l.life = 0.055;
    l.light.position.copy(position);
    l.light.intensity = 4.5 * scale;
  }

  shellEject(position, dir) {
    const s = this.shells[this._shellCursor];
    this._shellCursor = (this._shellCursor + 1) % this.shells.length;
    s.mesh.visible = true;
    s.mesh.position.copy(position);
    s.vel.set(dir.x * rand(1, 2) + rand(-0.5, 0.5), rand(1.5, 2.8), dir.z * rand(1, 2) + rand(-0.5, 0.5));
    s.spin.set(rand(-14, 14), rand(-14, 14), rand(-14, 14));
    s.life = 3.5;
    s.grounded = false;
  }

  explosion(position) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.copy(position);
    this.scene.add(mesh);
    const light = new THREE.PointLight(0xff9a3c, 25, 26, 2);
    light.position.copy(position);
    light.position.y += 1;
    this.scene.add(light);
    this.explosions.push({ mesh, light, life: 0, maxLife: 0.8 });

    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(rand(-7, 7), rand(1, 10), rand(-7, 7));
      this.sparks.spawn(position, v, rand(0.55, 1) * 0xffffff, rand(0.4, 1.1), { gravity: 10, drag: 0.96 });
    }
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3(rand(-2.8, 2.8), rand(0.4, 4.4), rand(-2.8, 2.8));
      this.smokeParticles.spawn(
        position,
        v,
        new THREE.Color(0x4b4740).lerp(new THREE.Color(0x9a9487), Math.random() * 0.6),
        rand(1.2, 2.8),
        { gravity: -0.6, drag: 0.94 },
      );
    }
    this.game.setCameraShake?.(1.2);
    this.game.audio.play('explosion');
    // Fade UI if close.
    const player = this.game.player;
    if (player && player.alive) {
      const d = player.pos.distanceTo(position);
      if (d < 16) this.game.ui?.flash?.(clamp(1 - d / 16, 0, 1) * 0.8);
    }
  }

  smokeCloud(position, duration = 14) {
    const group = new THREE.Group();
    group.position.copy(position);
    const mat = new THREE.SpriteMaterial({
      map: this.smokeTex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      color: 0xc8c8bd,
    });
    const sprites = [];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 2.4;
      sp.position.set(Math.cos(a) * r, rand(0.2, 3.4), Math.sin(a) * r);
      sp.scale.setScalar(rand(1.6, 3.4));
      sp.userData.base = sp.position.clone();
      sp.userData.phase = Math.random() * Math.PI * 2;
      sp.userData.speed = rand(0.12, 0.35);
      group.add(sp);
      sprites.push(sp);
    }
    this.scene.add(group);
    this.smokeClouds.push({ group, mat, sprites, life: duration, maxLife: duration, age: 0 });
    this.game.audio.play('smoke');
  }

  update(dt) {
    this.sparks.update(dt);
    this.smokeParticles.update(dt);
    this.tracers.update(dt);
    this.decals.update(dt);

    for (const p of this.muzzleSprites) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.sprite.material.opacity = clamp(p.life / 0.055, 0, 1) * 0.95;
      if (p.life <= 0) p.sprite.visible = false;
    }
    for (const l of this.muzzleLights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity = Math.max(0, l.light.intensity - dt * 90);
      if (l.life <= 0) l.light.intensity = 0;
    }

    for (const s of this.shells) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      if (!s.grounded) {
        s.vel.y -= 14 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        if (s.mesh.position.y < 0.02) {
          s.mesh.position.y = 0.02;
          s.vel.multiplyScalar(0.2);
          s.grounded = true;
        }
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life += dt;
      const t = e.life / e.maxLife;
      e.mesh.scale.setScalar(1 + t * 8);
      e.mesh.material.opacity = Math.max(0, 0.85 * (1 - t));
      e.light.intensity = Math.max(0, 25 * (1 - t) ** 2);
      if (e.life >= e.maxLife) {
        e.mesh.removeFromParent();
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        e.light.removeFromParent();
        this.explosions.splice(i, 1);
      }
    }

    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      c.age += dt;
      c.life -= dt;
      const fadeIn = clamp(c.age / 0.9, 0, 1);
      const fadeOut = clamp(c.life / 3.2, 0, 1);
      c.mat.opacity = fadeIn * fadeOut * 0.7;
      for (const sp of c.sprites) {
        sp.position.x = sp.userData.base.x + Math.sin(c.age * sp.userData.speed + sp.userData.phase) * 0.5;
        sp.position.y = sp.userData.base.y + Math.sin(c.age * 0.25 + sp.userData.phase) * 0.22;
        sp.position.z = sp.userData.base.z + Math.cos(c.age * sp.userData.speed * 0.8 + sp.userData.phase) * 0.5;
      }
      c.group.rotation.y += dt * 0.03;
      if (c.life <= 0) {
        c.group.removeFromParent();
        c.mat.dispose();
        for (const sp of c.sprites) sp.geometry?.dispose?.();
        this.smokeClouds.splice(i, 1);
      }
    }
  }

  dispose() {
    this.sparks.dispose();
    this.smokeParticles.dispose();
    this.tracers.dispose();
    this.decals.dispose();
    for (const s of this.shells) s.mesh.removeFromParent();
    this._shellGeo.dispose();
    this._shellMat.dispose();
    for (const m of this.muzzleSprites) {
      m.sprite.material.dispose();
      m.sprite.removeFromParent();
    }
    for (const l of this.muzzleLights) l.light.removeFromParent();
    this.flashMaterial.dispose();
    for (const e of this.explosions) {
      e.mesh.removeFromParent();
      e.light.removeFromParent();
    }
    for (const c of this.smokeClouds) c.group.removeFromParent();
    this.particleTex.dispose();
    this.smokeTex.dispose();
    this.flashTex.dispose();
  }
}
