/**
 * aim_map.js ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â CS 1.6 Browser Ãƒâ€šÃ‚Â· arena simÃƒÆ’Ã‚Â©trica 1v1 para el modo ONLINE.
 *
 * Contrato: ver src/ONLINE_API.md (secciÃƒÆ’Ã‚Â³n `src/world/aim_map.js`).
 *
 *   export const AIM_MAP_INFO = { id:'aim_1v1', mode:'aim', ... }
 *   export function buildAimMap(game) -> MapData
 *
 * Arena cerrada de 34 ÃƒÆ’Ã¢â‚¬â€ 26 m (x ÃƒÂ¢Ã‹â€ Ã‹â€  [-17, 17], z ÃƒÂ¢Ã‹â€ Ã‹â€  [-13, 13]) con simetrÃƒÆ’Ã‚Â­a
 * rotacional de 180Ãƒâ€šÃ‚Â° respecto al centro para que ambos lados sean justos:
 *   - CT spawnea al sur (z = +10.6) mirando al norte (yaw 0).
 *   - T  spawnea al norte (z = -10.6) mirando al sur (yaw 180).
 *   - Cajas centrales, barriles, coberturas laterales, plataformas de 0.45 m
 *     (subibles), contenedores industriales y arena desÃƒÆ’Ã‚Â©rtica exterior.
 *
 * Sin bombsites, sin rehenes, sin zona de rescate y sin zona de compra real
 * (buyZones son rects fuera del mapa para que `game.buyZoneFor` siempre falle).
 *
 * Todo procedural: usa el set de materiales de `textures.js` (texturas canvas
 * compartidas) y geometrÃƒÆ’Ã‚Â­a batcheada por material para quedar bien por debajo
 * de 30k triÃƒÆ’Ã‚Â¡ngulos y 80 draw calls.
 */

import * as THREE from '../../vendor/three.module.js';
import { createMaterialSet, makeSignTexture, makeDecalTexture, disposeMaterial } from './textures.js';

export const AIM_MAP_INFO = {
  id: 'aim_1v1',
  name: 'aim_1v1',
  displayName: 'AIM_MAP 1v1',
  mode: 'aim',
  description: 'Arena simÃƒÆ’Ã‚Â©trica 1v1 para duelos online. Primero a 10 kills.',
  players: 2,
  targetKills: 10,
};

const ARENA = {
  minX: -17,
  maxX: 17,
  minZ: -13,
  maxZ: 13,
  wallHeight: 6,
  wallThickness: 0.6,
};

/* ============================================================================
 * helpers de geometrÃƒÆ’Ã‚Â­a
 * ========================================================================== */

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function scaleBoxUV(geometry, w, h, d, tile) {
  const s = 1 / Math.max(0.05, tile);
  const uv = geometry.attributes.uv;
  const n = geometry.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    let du;
    let dv;
    if (ny > 0.5) {
      du = w;
      dv = d;
    } else if (nx > 0.5) {
      du = d;
      dv = h;
    } else {
      du = w;
      dv = h;
    }
    uv.setXY(i, uv.getX(i) * du * s, uv.getY(i) * dv * s);
  }
  uv.needsUpdate = true;
}

function makeBoxGeometry(w, h, d, tile = 2) {
  const geom = new THREE.BoxGeometry(w, h, d);
  scaleBoxUV(geom, w, h, d, tile);
  return geom;
}

function makeQuad(x1, z1, x2, z2, y, tile, up = true) {
  const geom = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
  geom.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  geom.translate((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;
  const s = 1 / Math.max(0.05, tile);
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * s, pos.getZ(i) * s);
  uv.needsUpdate = true;
  return geom;
}

function mergeGeometries(list) {
  let totalVerts = 0;
  let totalIndex = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    totalVerts += count;
    totalIndex += g.index ? g.index.count : count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIndex);
  let vOffset = 0;
  let iOffset = 0;
  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    positions.set(p.array, vOffset * 3);
    if (n) normals.set(n.array, vOffset * 3);
    if (uv) uvs.set(uv.array, vOffset * 2);
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < g.index.count; i++) indices[iOffset++] = src[i] + vOffset;
    } else {
      for (let i = 0; i < p.count; i++) indices[iOffset++] = vOffset + i;
    }
    vOffset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  return out;
}

/* ============================================================================
 * ArenaBuilder ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â batcher liviano y colliders
 * ========================================================================== */

class ArenaBuilder {
  constructor(mapId, materialSet, seed) {
    this.mapId = mapId;
    this.set = materialSet;
    this.root = new THREE.Group();
    this.root.name = `map:${mapId}`;
    this.batches = new Map();
    this.colliders = [];
    this.uniqueMaterials = [];
    this.lights = [];
    this.cablePoints = [];
    this.rng = mulberry32(seed);
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._quat = new THREE.Quaternion();
    this._mat4 = new THREE.Matrix4();
    this._v3 = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._finalized = false;
  }

  tile(matKey) {
    return this.set.tiles[matKey] ?? 2;
  }

  mat(matKey) {
    const mat = this.set.materials[matKey];
    if (!mat) throw new Error(`[aim_map] material desconocido: ${matKey}`);
    return mat;
  }

  applyTRS(geom, x, y, z, rx = 0, ry = 0, rz = 0) {
    if (!rx && !ry && !rz) {
      geom.translate(x, y, z);
      return geom;
    }
    this._quat.setFromEuler(this._euler.set(rx, ry, rz, 'YXZ'));
    this._mat4.compose(this._v3.set(x, y, z), this._quat, this._one);
    geom.applyMatrix4(this._mat4);
    return geom;
  }

  addRaw(matKey, geom) {
    if (typeof matKey !== 'string' || !matKey) {
      throw new Error(`[aim_map] addRaw con material invÃƒÆ’Ã‚Â¡lido (${matKey})`);
    }
    let list = this.batches.get(matKey);
    if (!list) {
      list = [];
      this.batches.set(matKey, list);
    }
    list.push(geom);
  }

  box(matKey, cx, cy, cz, w, h, d, opts = {}) {
    if (!(w > 0 && h > 0 && d > 0)) return;
    const geom = opts.uvFit
      ? new THREE.BoxGeometry(w, h, d)
      : makeBoxGeometry(w, h, d, opts.tile ?? this.tile(matKey));
    this.applyTRS(geom, cx, cy, cz, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    this.addRaw(matKey, geom);
    if (opts.collider) {
      let ew = w;
      let ed = d;
      if (opts.ry) {
        const c = Math.abs(Math.cos(opts.ry));
        const s = Math.abs(Math.sin(opts.ry));
        ew = w * c + d * s;
        ed = w * s + d * c;
      }
      this.addCollider(
        cx - ew / 2,
        cy - h / 2,
        cz - ed / 2,
        cx + ew / 2,
        cy + h / 2,
        cz + ed / 2,
        opts.surface || this.surfaceFor(matKey),
      );
    }
  }

  boxMM(matKey, x1, y1, z1, x2, y2, z2, opts = {}) {
    this.box(
      matKey,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      (z1 + z2) / 2,
      Math.abs(x2 - x1),
      Math.abs(y2 - y1),
      Math.abs(z2 - z1),
      opts,
    );
  }

  cylinder(matKey, cx, cy, cz, rTop, rBottom, height, segments = 12, opts = {}) {
    const geom = new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1, !!opts.openEnded);
    this.applyTRS(geom, cx, cy, cz, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    this.addRaw(matKey, geom);
    if (opts.collider) {
      const r = Math.max(rTop, rBottom);
      this.addCollider(cx - r, cy - height / 2, cz - r, cx + r, cy + height / 2, cz + r, opts.surface || 'metal');
    }
  }

  quad(matKey, x1, z1, x2, z2, y, opts = {}) {
    this.addRaw(matKey, makeQuad(x1, z1, x2, z2, y, opts.tile ?? this.tile(matKey), opts.up !== false));
  }

  surfaceFor(matKey) {
    if (/metal|barrel/.test(matKey)) return 'metal';
    if (/wood|crate|door/.test(matKey)) return 'wood';
    if (/dirt|carpet|plaster/.test(matKey)) return 'dirt';
    if (/sand/.test(matKey)) return 'sand';
    return 'stone';
  }

  addCollider(minX, minY, minZ, maxX, maxY, maxZ, surface = 'stone') {
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
      new THREE.Vector3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
    );
    box.surface = surface;
    this.colliders.push(box);
    return box;
  }

  /* ------------------------------------------------ consultas de navegaciÃƒÆ’Ã‚Â³n */

  isFree(x, z, r = 0.45, y0 = 0.06, y1 = 1.8) {
    const minX = x - r;
    const maxX = x + r;
    const minZ = z - r;
    const maxZ = z + r;
    for (const c of this.colliders) {
      if (minX < c.max.x && maxX > c.min.x && y0 < c.max.y && y1 > c.min.y && minZ < c.max.z && maxZ > c.min.z) {
        return false;
      }
    }
    return true;
  }

  segmentClear(x1, z1, x2, z2, r = 0.4, step = 0.3) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    const n = Math.max(2, Math.ceil(dist / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isFree(x1 + dx * t, z1 + dz * t, r, 0.06, 1.7)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ ambiente */

  addEnvironment(ambient) {
    const hemi = new THREE.HemisphereLight(
      ambient.hemiColor ?? 0xbfd8ff,
      ambient.hemiGround ?? 0x8a7550,
      ambient.hemiIntensity ?? 0.9,
    );
    hemi.position.set(0, 30, 0);
    this.root.add(hemi);
    this.lights.push(hemi);

    const sunDir = new THREE.Vector3(
      ambient.sunDir?.x ?? 0.5,
      ambient.sunDir?.y ?? 0.75,
      ambient.sunDir?.z ?? 0.4,
    ).normalize();
    const sun = new THREE.DirectionalLight(ambient.sunColor ?? 0xfff0c8, ambient.sunIntensity ?? 2.4);
    sun.position.copy(sunDir).multiplyScalar(60);
    sun.target.position.set(0, 0, 0);
    this.root.add(sun);
    this.root.add(sun.target);
    this.lights.push(sun);

    const fill = new THREE.AmbientLight(ambient.ambientColor ?? 0x7d8898, ambient.ambientIntensity ?? 0.32);
    this.root.add(fill);
    this.lights.push(fill);
    return { sunDir, sun };
  }

  addSky(ambient, opts = {}) {
    const radius = opts.radius ?? 150;
    const top = new THREE.Color(ambient.skyTop ?? 0x3a74ad);
    const bottom = new THREE.Color(ambient.skyBottom ?? 0xdcc79b);
    const geom = new THREE.SphereGeometry(radius, 22, 12);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / radius;
      if (h >= 0) color.copy(bottom).lerp(top, Math.pow(Math.min(1, h), 0.72));
      else color.copy(bottom).multiplyScalar(0.82);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    mesh.name = 'sky';
    this.root.add(mesh);
    this.uniqueMaterials.push(mat);

    const sunDir = new THREE.Vector3(
      ambient.sunDir?.x ?? 0.5,
      ambient.sunDir?.y ?? 0.75,
      ambient.sunDir?.z ?? 0.4,
    ).normalize();
    const sunGeom = new THREE.CircleGeometry(opts.sunSize ?? 6.5, 18);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfff3cf,
      fog: false,
      transparent: true,
      opacity: 0.95,
    });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.copy(sunDir).multiplyScalar(radius * 0.9);
    sunMesh.lookAt(0, 0, 0);
    sunMesh.name = 'sun-disc';
    this.root.add(sunMesh);
    this.uniqueMaterials.push(sunMat);
  }

  addClouds(count = 7, seed = 23) {
    const rng = mulberry32(seed);
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.5;
      const dist = 70 + rng() * 55;
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist;
      const y = 45 + rng() * 26;
      const puffs = 2 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const geom = new THREE.SphereGeometry(1, 6, 4);
        const m = new THREE.Matrix4();
        m.compose(
          new THREE.Vector3(x + (rng() - 0.5) * 12, y + (rng() - 0.5) * 2.5, z + (rng() - 0.5) * 10),
          new THREE.Quaternion(),
          new THREE.Vector3(5 + rng() * 7, 2 + rng() * 1.8, 3.5 + rng() * 5),
        );
        geom.applyMatrix4(m);
        list.push(geom);
      }
    }
    const merged = mergeGeometries(list);
    for (const g of list) g.dispose();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf3efe2,
      transparent: true,
      opacity: 0.85,
      fog: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'clouds';
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.uniqueMaterials.push(mat);
  }

  /* -------------------------------------------------------- carteles/decals */

  addSign(text, opts = {}) {
    const {
      x = 0,
      y = 3,
      z = 0,
      ry = 0,
      w = 2.6,
      h = 0.9,
      bg = '#2b2924',
      fg = '#e8c46a',
      sub = '',
      border = '#6d5a34',
      backingMat = 'metalDark',
    } = opts;
    const tex = makeSignTexture(text, { bg, fg, border, sub });
    if (!tex) return null;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
    mat.name = `sign:${text}`;
    this.uniqueMaterials.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.name = `sign:${text}`;
    this.root.add(mesh);
    this.box(backingMat, x - nx * 0.05, y, z - nz * 0.05, w + 0.16, h + 0.16, 0.07, { uvFit: true, ry });
    return mesh;
  }

  addDecal(draw, textureSize, opts = {}) {
    // Texture resolution is in pixels; size/w/h are world dimensions in metres.
    const { x = 0, z = 0, y = 0.085, rotation = 0, size = 1, w = size, h = size, name = 'decal', opacity = 1 } = opts;
    const tex = makeDecalTexture(draw, textureSize);
    if (!tex) return null;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    mat.name = name;
    this.uniqueMaterials.push(mat);
    const geom = new THREE.PlaneGeometry(w, h);
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.name = name;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    return mesh;
  }

  addCable(ax, ay, az, bx, by, bz, opts = {}) {
    const sag = opts.sag ?? 0.7;
    const segments = opts.segments ?? 9;
    let px = ax;
    let py = ay;
    let pz = az;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const y = ay + (by - ay) * t - Math.sin(t * Math.PI) * sag;
      this.cablePoints.push(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
  }

  /* --------------------------------------------------------------- cierre */

  finalize() {
    if (this._finalized) return;
    this._finalized = true;
    for (const [matKey, geoms] of this.batches) {
      if (!geoms.length) continue;
      const merged = mergeGeometries(geoms);
      for (const g of geoms) g.dispose();
      const mesh = new THREE.Mesh(merged, this.mat(matKey));
      mesh.name = `batch:${matKey}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
    }
    this.batches.clear();

    if (this.cablePoints.length) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(this.cablePoints, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x1d1a17, transparent: true, opacity: 0.88 });
      const lines = new THREE.LineSegments(geom, mat);
      lines.name = 'cables';
      this.root.add(lines);
      this.uniqueMaterials.push(mat);
      this.cablePoints = [];
    }
  }
}

/* ============================================================================
 * decoraciÃƒÆ’Ã‚Â³n / props
 * ========================================================================== */

/** Ejecuta fn(x,z) y su simÃƒÆ’Ã‚Â©trico rotado 180Ãƒâ€šÃ‚Â° (-x,-z). */
function sym(x, z, fn) {
  fn(x, z);
  if (Math.abs(x) > 1e-6 || Math.abs(z) > 1e-6) fn(-x, -z);
}

function addCrate(b, x, z, size = 1.5, opts = {}) {
  const y = opts.y ?? 0;
  b.box('crate', x, y + size / 2, z, size, size, size, {
    uvFit: true,
    collider: true,
    ry: opts.ry ?? 0,
    surface: 'wood',
  });
}

function addCrateStack(b, x, z, opts = {}) {
  const base = opts.base ?? 1.5;
  const top = opts.top ?? 1.0;
  addCrate(b, x, z, base, { ry: opts.ry ?? 0 });
  if (opts.stack !== false) {
    // centrada en la base: mantiene la simetrÃƒÆ’Ã‚Â­a 180Ãƒâ€šÃ‚Â° exacta del mapa
    b.box('crate', x, base + top / 2, z, top, top, top, {
      uvFit: true,
      collider: true,
      ry: (opts.ry ?? 0) + 0.26,
      surface: 'wood',
    });
  }
}

function addBarrel(b, x, z, opts = {}) {
  const mat = opts.mat || 'barrelA';
  const h = 1.05;
  b.cylinder(mat, x, h / 2, z, 0.4, 0.42, h, 12, { collider: true, surface: 'metal' });
  b.cylinder(mat, x, h - 0.02, z, 0.36, 0.4, 0.05, 12, {});
}

function addSandbags(b, x, z, along = 'x', count = 3) {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.64;
    if (along === 'x') {
      b.box('sandWallDark', x + off, 0.17, z, 0.62, 0.34, 0.46, { uvFit: true, surface: 'sand' });
      if (i % 2 === 0) b.box('sandWallDark', x + off + 0.1, 0.5, z - 0.02, 0.62, 0.32, 0.46, { uvFit: true, surface: 'sand' });
    } else {
      b.box('sandWallDark', x, 0.17, z + off, 0.46, 0.34, 0.62, { uvFit: true, surface: 'sand' });
      if (i % 2 === 0) b.box('sandWallDark', x - 0.02, 0.5, z + off + 0.1, 0.46, 0.32, 0.62, { uvFit: true, surface: 'sand' });
    }
  }
  if (along === 'x') {
    const w = count * 0.64;
    b.addCollider(x - w / 2, 0, z - 0.32, x + w / 2, 0.72, z + 0.32, 'sand');
  } else {
    const d = count * 0.64;
    b.addCollider(x - 0.32, 0, z - d / 2, x + 0.32, 0.72, z + d / 2, 'sand');
  }
}

function addPlatform(b, x, z, opts = {}) {
  const size = opts.size ?? 2.7;
  const height = opts.height ?? 0.45;
  b.box('concreteFloor', x, height / 2, z, size, height, size, { collider: true, surface: 'stone' });
  b.box('metalDark', x, height + 0.025, z, size + 0.1, 0.05, size + 0.1, { uvFit: true });
  b.box('sandWallDark', x, height - 0.02, z, size + 0.06, 0.04, size + 0.06, {});
}

function addBarrier(b, x, z) {
  b.box('sandWall', x, 0.58, z, 0.9, 1.16, 4.2, { collider: true, surface: 'stone' });
  b.box('sandWallDark', x, 1.2, z, 1.02, 0.12, 4.32, {});
  b.box('stoneDark', x, 0.12, z, 1.02, 0.24, 4.32, {});
}

function addContainer(b, x, z) {
  const w = 2.38;
  const h = 2.6;
  const d = 5.0;
  b.box('metalDark', x, h / 2, z, w, h, d, { uvFit: true, collider: true, surface: 'metal' });
  // costillas verticales en los laterales
  for (let i = 0; i < 7; i++) {
    const dz = -d / 2 + 0.4 + i * 0.7;
    for (const sx of [-1, 1]) {
      b.box('metal', x + sx * (w / 2 + 0.035), h / 2, z + dz, 0.07, h - 0.32, 0.16, { uvFit: true });
    }
  }
  // puertas en los extremos
  for (const sz of [-1, 1]) {
    b.box('metal', x, h / 2, z + sz * (d / 2 + 0.035), w - 0.32, h - 0.32, 0.07, { uvFit: true });
    b.box('metalDark', x - 0.28, h / 2, z + sz * (d / 2 + 0.08), 0.1, 0.5, 0.05, {});
  }
  b.box('metal', x, h + 0.04, z, w + 0.14, 0.09, d + 0.14, { uvFit: true });
  b.box('stoneDark', x, 0.1, z, w + 0.06, 0.2, d + 0.06, {});
}

function addPallet(b, x, z, ry = 0) {
  b.box('woodDark', x, 0.07, z, 1.25, 0.14, 1.05, { uvFit: true, ry });
  b.box('woodDark', x, 0.18, z, 1.25, 0.08, 1.05, { uvFit: true, ry });
}

function addWallLamp(b, x, y, z, nx, nz) {
  b.box('metalDark', x + nx * 0.1, y, z + nz * 0.1, 0.12, 0.32, 0.12, {});
  b.box('lampWarm', x + nx * 0.22, y - 0.02, z + nz * 0.22, 0.4, 0.18, 0.16, { uvFit: true });
}

function addPalm(b, x, z, height = 9, seed = 1) {
  const rng = mulberry32(seed);
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const y = (height / segments) * (i + 0.5) * 0.82;
    const r = 0.3 - i * 0.045;
    b.cylinder('wood', x + (i / segments) * 0.6, y, z, r, r + 0.05, height / segments + 0.25, 7, {});
  }
  const topX = x + 0.55;
  const topY = height * 0.84;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const len = 2.0 + rng() * 1.1;
    b.box(
      'foliageDry',
      topX + Math.cos(a) * len * 0.5,
      topY - 0.35,
      z + Math.sin(a) * len * 0.5,
      len,
      0.12,
      0.5,
      { ry: -a, rz: -0.5, uvFit: true },
    );
  }
}

function addRock(b, x, z, scale = 1, seed = 1) {
  const rng = mulberry32(seed);
  const geom = new THREE.DodecahedronGeometry(scale, 0);
  geom.scale(1, 0.6 + rng() * 0.3, 1);
  b.applyTRS(geom, x, scale * 0.3, z, 0, rng() * Math.PI, 0);
  b.addRaw('sandWallDark', geom);
}

function addBush(b, x, z, scale = 1, seed = 1) {
  const rng = mulberry32(seed);
  for (let i = 0; i < 3; i++) {
    const geom = new THREE.IcosahedronGeometry((0.32 + rng() * 0.3) * scale, 0);
    b.applyTRS(
      geom,
      x + (rng() - 0.5) * 0.8 * scale,
      (0.28 + rng() * 0.2) * scale,
      z + (rng() - 0.5) * 0.8 * scale,
    );
    b.addRaw('foliageDry', geom);
  }
}

/* ============================================================================
 * decals dibujados (canvas)
 * ========================================================================== */

function centerDecalDraw(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  const cx = s / 2;
  const cy = s / 2;
  ctx.strokeStyle = 'rgba(232,196,106,0.9)';
  ctx.lineWidth = s * 0.028;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232,196,106,0.4)';
  ctx.lineWidth = s * 0.012;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.31, 0, Math.PI * 2);
  ctx.stroke();
  // marcas cardinales
  ctx.strokeStyle = 'rgba(232,196,106,0.8)';
  ctx.lineWidth = s * 0.02;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36);
    ctx.lineTo(cx + Math.cos(a) * s * 0.44, cy + Math.sin(a) * s * 0.44);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(232,196,106,0.85)';
  ctx.font = `bold ${Math.floor(s * 0.15)}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AIM', cx, cy - s * 0.01);
}

function spawnDecalDraw(letter, color) {
  return (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color.replace('0.95', '0.16');
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(s * 0.3)}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + s * 0.02);
  };
}

function hazardDecalDraw(ctx, s) {
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  ctx.fillStyle = 'rgba(20,18,14,0.55)';
  ctx.fillRect(0, 0, s, s);
  const stripe = s / 8;
  for (let i = -8; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(226,178,62,0.85)' : 'rgba(24,22,18,0.9)';
    ctx.beginPath();
    ctx.moveTo(i * stripe, 0);
    ctx.lineTo(i * stripe + stripe, 0);
    ctx.lineTo(i * stripe + stripe - s * 0.5, s);
    ctx.lineTo(i * stripe - s * 0.5, s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ============================================================================
 * waypoints
 * ========================================================================== */

function generateWaypoints(builder, bounds) {
  const nodes = [];
  const addNode = (x, z, tags = []) => {
    for (const n of nodes) {
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < 1.0) {
        for (const t of tags) n.tags.add(t);
        return n;
      }
    }
    const node = { x, z, tags: new Set(tags), links: new Set() };
    nodes.push(node);
    return node;
  };

  // Puntos clave simÃƒÆ’Ã‚Â©tricos
  addNode(0, 0, ['mid', 'duel']);
  addNode(0, 10.4, ['CT', 'spawn']);
  addNode(0, -10.4, ['T', 'spawn']);
  for (const sx of [-4.2, 4.2]) {
    addNode(sx, 10.2, ['CT', 'spawn']);
    addNode(sx, -10.2, ['T', 'spawn']);
    addNode(sx, 0, ['mid']);
  }
  for (const sx of [-8.5, 8.5]) {
    addNode(sx, 6.5, ['east', 'west']);
    addNode(sx, -6.5, ['east', 'west']);
  }
  addNode(13.5, 0, ['east', 'flank']);
  addNode(-13.5, 0, ['west', 'flank']);

  // Lattice sobre el piso libre (plataformas/cajas quedan excluidas por colisiÃƒÆ’Ã‚Â³n)
  const step = 2.6;
  const inset = 1.5;
  for (let z = bounds.minZ + inset; z <= bounds.maxZ - inset; z += step) {
    for (let x = bounds.minX + inset; x <= bounds.maxX - inset; x += step) {
      if (!builder.isFree(x, z, 0.48, 0.06, 1.75)) continue;
      let tags = [];
      if (Math.abs(x) < 3.4 && Math.abs(z) < 3.4) tags = ['mid'];
      else if (z > 7.5) tags = ['CT'];
      else if (z < -7.5) tags = ['T'];
      else if (x > 9) tags = ['east'];
      else if (x < -9) tags = ['west'];
      addNode(x, z, tags);
    }
  }

  // Links con lÃƒÆ’Ã‚Â­nea de vista libre
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.abs(dx) > 4.8 || Math.abs(dz) > 4.8) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > 4.8) continue;
      if (!builder.segmentClear(a.x, a.z, b.x, b.z, 0.4)) continue;
      a.links.add(b);
      b.links.add(a);
    }
  }

  // Conectar componentes si quedÃƒÆ’Ã‚Â³ alguna isla
  for (let iter = 0; iter < 50; iter++) {
    const seen = new Set();
    const comps = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const comp = [];
      const stack = [node];
      seen.add(node);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of cur.links) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) break;
    comps.sort((a, b) => b.length - a.length);
    const main = comps[0];
    let best = null;
    for (const a of main) {
      for (const b of comps[1]) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best || !builder.segmentClear(best.a.x, best.a.z, best.b.x, best.b.z, 0.36)) break;
    best.a.links.add(best.b);
    best.b.links.add(best.a);
  }

  // Si aÃƒÆ’Ã‚Âºn hay islas, quedarse con la componente mayor
  {
    const seen = new Set();
    const comps = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const comp = [];
      const stack = [node];
      seen.add(node);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of cur.links) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      comps.push(comp);
    }
    if (comps.length > 1) {
      comps.sort((a, b) => b.length - a.length);
      const keep = new Set(comps[0]);
      const kept = nodes.filter((node) => keep.has(node));
      for (const node of kept) {
        node.links = new Set([...node.links].filter((nb) => keep.has(nb)));
      }
      nodes.length = 0;
      nodes.push(...kept);
    }
  }

  nodes.forEach((node, index) => {
    node.id = index;
  });
  return nodes.map((node) => ({
    id: node.id,
    x: Number(node.x.toFixed(2)),
    y: 0,
    z: Number(node.z.toFixed(2)),
    links: [...node.links].map((n) => n.id).sort((a, b) => a - b),
    tags: [...node.tags].sort(),
  }));
}

/* ============================================================================
 * construcciÃƒÆ’Ã‚Â³n de la arena
 * ========================================================================== */

function buildArena(builder) {
  const B = ARENA;
  const bounds = { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ };

  const ambient = {
    skyTop: 0x2f669f,
    skyBottom: 0xdecba4,
    fog: 0xd9c8a3,
    fogNear: 42,
    fogFar: 150,
    sunColor: 0xffe4b0,
    sunIntensity: 2.45,
    hemiColor: 0xbfd8ff,
    hemiGround: 0x8a7550,
    hemiIntensity: 0.9,
    ambientColor: 0x7d8898,
    ambientIntensity: 0.32,
    sunDir: { x: 0.5, y: 0.74, z: 0.42 },
  };

  /* --------------------------------------------------------------- piso */

  builder.boxMM('concreteFloor', B.minX, -0.8, B.minZ, B.maxX, 0.02, B.maxZ, { collider: true, surface: 'stone' });
  // Capa de piso sÃ³lida y continua: evita costuras/caras faltantes y el borde
  // de cielo que se veÃ­a en Ã¡ngulos rasantes.
  builder.boxMM('sandFloor', B.minX, 0.02, B.minZ, B.maxX, 0.065, B.maxZ);
  // pad central algo mÃ¡s claro
  builder.boxMM('concreteFloor', -4.5, 0.02, -4.5, 4.5, 0.075, 4.5);

  /* -------------------------------------------------------------- muros */

  const wh = B.wallHeight;
  const wt = B.wallThickness;
  const walls = [
    [B.minX - wt, B.minZ - wt, B.maxX + wt, B.minZ], // norte
    [B.minX - wt, B.maxZ, B.maxX + wt, B.maxZ + wt], // sur
    [B.minX - wt, B.minZ, B.minX, B.maxZ], // oeste
    [B.maxX, B.minZ, B.maxX + wt, B.maxZ], // este
  ];
  for (const [x1, z1, x2, z2] of walls) {
    builder.boxMM('sandWall', x1, 0, z1, x2, wh, z2, { collider: true, surface: 'sand' });
    // zÃƒÆ’Ã‚Â³calo y remate
    if (x2 - x1 > z2 - z1) {
      builder.boxMM('stoneDark', x1, 0, z1 - 0.03, x2, 0.55, z2 + 0.03, { surface: 'stone' });
      builder.boxMM('sandWallDark', x1 - 0.05, wh - 0.3, z1 - 0.06, x2 + 0.05, wh, z2 + 0.06, { surface: 'sand' });
    } else {
      builder.boxMM('stoneDark', x1 - 0.03, 0, z1, x2 + 0.03, 0.55, z2, { surface: 'stone' });
      builder.boxMM('sandWallDark', x1 - 0.06, wh - 0.3, z1 - 0.05, x2 + 0.06, wh, z2 + 0.05, { surface: 'sand' });
    }
  }
  // CordÃƒÂ³n perimetral: tapa la costura piso/muro y el borde de cielo.
  builder.boxMM('stoneDark', B.minX, 0.02, B.minZ, B.minX + 0.45, 0.3, B.maxZ, { uvFit: true, collider: true, surface: 'stone' });
  builder.boxMM('stoneDark', B.maxX - 0.45, 0.02, B.minZ, B.maxX, 0.3, B.maxZ, { uvFit: true, collider: true, surface: 'stone' });
  builder.boxMM('stoneDark', B.minX, 0.02, B.minZ, B.maxX, 0.3, B.minZ + 0.45, { uvFit: true, collider: true, surface: 'stone' });
  builder.boxMM('stoneDark', B.minX, 0.02, B.maxZ - 0.45, B.maxX, 0.3, B.maxZ, { uvFit: true, collider: true, surface: 'stone' });
  // pilastras decorativas en la cara interior (sin collider, sobresalen 0.14 m)
  for (const px of [-13.6, -6.8, 0, 6.8, 13.6]) {
    for (const pz of [B.minZ + 0.12, B.maxZ - 0.12]) {
      builder.box('sandWallDark', px, wh / 2, pz, 0.5, wh, 0.28, { uvFit: true });
    }
  }
  for (const pz of [-8, -2.7, 2.7, 8]) {
    for (const px of [B.minX + 0.12, B.maxX - 0.12]) {
      builder.box('sandWallDark', px, wh / 2, pz, 0.28, wh, 0.5, { uvFit: true });
    }
  }
  // esquinas
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      builder.box('brickWall', sx * (Math.abs(B.maxX) - 0.5), wh / 2, sz * (Math.abs(B.maxZ) - 0.5), 1.1, wh, 1.1, {
        uvFit: true,
      });
    }
  }

  /* ------------------------------------------------ coberturas centrales */

  // cajas grandes a los lados del centro (dejan libre la lÃƒÆ’Ã‚Â­nea central)
  sym(3.3, 0, (x, z) => addCrateStack(builder, x, z, { base: 1.6, top: 1.05 }));
  // pilas de cajas en diagonal (4 esquinas del centro)
  sym(7.8, 3.6, (x, z) => addCrateStack(builder, x, z, { base: 1.5, top: 0.95, ry: 0.1 }));
  sym(-7.8, 3.6, (x, z) => addCrateStack(builder, x, z, { base: 1.5, top: 0.95, ry: -0.14 }));
  // caja de cobertura en el carril principal de spawn (evita spawn-to-spawn directo
  // en el respawn 1v1, sin bloquear la vista al centro)
  sym(-4.2, 4.6, (x, z) => addCrateStack(builder, x, z, { base: 1.3, top: 0.85, ry: 0.12 }));
  // barriles alrededor del centro
  sym(5.6, 1.8, (x, z) => addBarrel(builder, x, z, { mat: 'barrelA' }));
  sym(-5.6, 1.8, (x, z) => addBarrel(builder, x, z, { mat: 'barrelB' }));

  /* ------------------------------------------------ coberturas laterales */

  // barreras de hormigÃƒÆ’Ã‚Â³n junto a los muros este/oeste
  sym(11.2, 0, (x, z) => addBarrier(builder, x, z));
  // contenedores industriales
  sym(14.2, 3.0, (x, z) => addContainer(builder, x, z));
  // plataformas subibles en las cuatro esquinas
  sym(12.2, 8.2, (x, z) => addPlatform(builder, x, z));
  sym(12.2, -8.2, (x, z) => addPlatform(builder, x, z));
  // barriles junto a las plataformas
  sym(14.2, -6.2, (x, z) => addBarrel(builder, x, z, { mat: 'barrelB' }));
  sym(-14.2, -6.2, (x, z) => addBarrel(builder, x, z, { mat: 'barrelA' }));
  // sacos de arena cerca de los spawns
  sym(9, 10.8, (x, z) => addSandbags(builder, x, z, 'x', 3));
  sym(-9, 10.8, (x, z) => addSandbags(builder, x, z, 'x', 3));
  // pilas de cajas detrÃƒÆ’Ã‚Â¡s de los spawns
  sym(0, 12.0, (x, z) => addCrateStack(builder, x, z, { base: 1.3, top: 0.9, ry: 0.08 }));
  // pallets decorativos junto a los contenedores
  sym(16.1, 7.6, (x, z) => addPallet(builder, x, z, 0.1));
  sym(16.1, -7.6, (x, z) => addPallet(builder, x, z, -0.12));

  /* --------------------------------------------------------- decoraciÃƒÆ’Ã‚Â³n */

  // lÃƒÆ’Ã‚Â¡mparas de pared
  for (const pz of [-5, 5]) {
    addWallLamp(builder, B.minX + 0.08, 4.4, pz, 1, 0);
    addWallLamp(builder, B.maxX - 0.08, 4.4, pz, -1, 0);
  }
  for (const px of [-8, 8]) {
    addWallLamp(builder, px, 4.4, B.minZ + 0.08, 0, 1);
    addWallLamp(builder, px, 4.4, B.maxZ - 0.08, 0, -1);
  }
  // cables por encima de la arena
  builder.addCable(B.minX, 5.35, -5.2, B.maxX, 5.2, -5.2, { sag: 0.85 });
  builder.addCable(B.minX, 5.2, 5.2, B.maxX, 5.35, 5.2, { sag: 0.85 });
  builder.addCable(-8.2, 5.4, B.minZ, -8.2, 5.15, B.maxZ, { sag: 1.05 });
  builder.addCable(8.2, 5.15, B.minZ, 8.2, 5.4, B.maxZ, { sag: 1.05 });

  // carteles
  builder.addSign('AIM 1V1', { x: 0, y: 4.3, z: B.minZ + 0.34, ry: 0, w: 3.2, h: 1.0 });
  builder.addSign('CS 1.6', {
    x: 0,
    y: 4.3,
    z: B.maxZ - 0.34,
    ry: Math.PI,
    w: 2.4,
    h: 0.85,
    bg: '#1e2b38',
    fg: '#cfe2ee',
    border: '#42596c',
  });

  // calcomanÃƒÆ’Ã‚Â­as de piso
  builder.addDecal(centerDecalDraw, 256, { x: 0, z: 0, size: 6, name: 'aim-center' });
  builder.addDecal(spawnDecalDraw('CT', 'rgba(90,170,255,0.95)'), 256, {
    x: 0,
    z: 11.7,
    size: 3.4,
    name: 'spawn-CT',
  });
  builder.addDecal(spawnDecalDraw('T', 'rgba(245,170,70,0.95)'), 256, {
    x: 0,
    z: -11.7,
    size: 3.4,
    rotation: Math.PI,
    name: 'spawn-T',
  });
  builder.addDecal(hazardDecalDraw, 256, { x: 0, z: 8.9, w: 7.2, h: 0.9, name: 'line-CT' });
  builder.addDecal(hazardDecalDraw, 256, { x: 0, z: -8.9, w: 7.2, h: 0.9, name: 'line-T' });

  /* --------------------------------------------------- ambiente exterior */

  builder.boxMM('sandFloor', -140, -0.3, -140, 140, 0.03, 140, { uvFit: true });
  builder.addEnvironment(ambient);
  builder.addSky(ambient, { radius: 150, sunSize: 6.5 });
  builder.addClouds(7, 23);

  // palmeras / rocas / arbustos fuera de la arena
  addPalm(builder, 21.5, 8.5, 9.5, 3);
  addPalm(builder, -21.5, -8.5, 9.5, 7);
  addPalm(builder, 22.5, -14.5, 10.5, 11);
  addPalm(builder, -22.5, 14.5, 10.5, 13);
  addPalm(builder, 4, 19, 8.5, 17);
  addPalm(builder, -4, -19, 8.5, 19);
  addRock(builder, 24, 2.5, 2.4, 29);
  addRock(builder, -24, -2.5, 2.4, 31);
  addRock(builder, 19.5, 16.5, 1.7, 37);
  addRock(builder, -19.5, -16.5, 1.7, 41);
  addBush(builder, 20, 11.5, 1.4, 43);
  addBush(builder, -20, -11.5, 1.4, 47);
  addBush(builder, -20, 11.5, 1.2, 53);
  addBush(builder, 20, -11.5, 1.2, 59);

  /* ----------------------------------------------------------- waypoints */

  const waypoints = generateWaypoints(builder, bounds);

  /* --------------------------------------------------------------- datos */

  const spawnFace = (x, z, yaw) => ({ x, y: 0.05, z, yaw });
  const spawns = {
    CT: [
      spawnFace(-4.2, 10.6, 0),
      spawnFace(-1.4, 10.6, 0),
      spawnFace(1.4, 10.6, 0),
      spawnFace(4.2, 10.6, 0),
    ],
    T: [
      spawnFace(-4.2, -10.6, 180),
      spawnFace(-1.4, -10.6, 180),
      spawnFace(1.4, -10.6, 180),
      spawnFace(4.2, -10.6, 180),
    ],
  };

  // Rects de compra fuera del mapa: nunca se puede comprar en online.
  const emptyBuyZone = { min: { x: -1000, z: -1000 }, max: { x: -999, z: -999 } };

  const callouts = [
    { name: 'T Spawn', min: { x: -6, z: -12.4 }, max: { x: 6, z: -8.6 } },
    { name: 'CT Spawn', min: { x: -6, z: 8.6 }, max: { x: 6, z: 12.4 } },
    { name: 'Mid', min: { x: -3.6, z: -3.6 }, max: { x: 3.6, z: 3.6 } },
    { name: 'East Lane', min: { x: 9, z: -12.4 }, max: { x: 16.2, z: 12.4 } },
    { name: 'West Lane', min: { x: -16.2, z: -12.4 }, max: { x: -9, z: 12.4 } },
  ];

  return {
    id: AIM_MAP_INFO.id,
    name: AIM_MAP_INFO.name,
    displayName: AIM_MAP_INFO.displayName,
    mode: AIM_MAP_INFO.mode,
    description: AIM_MAP_INFO.description,
    bounds,
    ambient,
    spawns,
    buyZones: { CT: emptyBuyZone, T: emptyBuyZone },
    bombsites: [],
    hostageSpawns: [],
    rescueZone: null,
    waypoints,
    callouts,
    menuCamera: {
      pos: { x: 13.6, y: 9.4, z: 11.2 },
      lookAt: { x: 0, y: 0.9, z: -1.2 },
    },
  };
}

/* ============================================================================
 * buildAimMap ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â entrada del contrato
 * ========================================================================== */

export function buildAimMap(game) {
  const info = AIM_MAP_INFO;
  const materialSet = createMaterialSet('de_dust2');
  const builder = new ArenaBuilder(info.id, materialSet, hashString(info.id));

  let data;
  try {
    data = buildArena(builder);
    builder.finalize();
  } catch (err) {
    materialSet.dispose();
    throw err;
  }

  let triangles = 0;
  let drawCalls = 0;
  let meshes = 0;
  builder.root.traverse((obj) => {
    if (!obj.isMesh && !obj.isLine) return;
    drawCalls++;
    if (obj.isMesh) meshes++;
    const geom = obj.geometry;
    if (!geom) return;
    triangles += geom.index ? geom.index.count / 3 : (geom.attributes.position?.count || 0) / 3;
  });

  const stats = {
    triangles: Math.round(triangles),
    drawCalls,
    meshes,
    lights: builder.lights.length,
    colliders: builder.colliders.length,
    waypoints: data.waypoints.length,
    links: data.waypoints.reduce((sum, wp) => sum + wp.links.length, 0) / 2,
  };

  const root = builder.root;
  root.name = `map:${info.id}`;

  data.root = root;
  data.colliders = builder.colliders;
  data.stats = stats;
  data.dispose = () => {
    root.removeFromParent();
    root.traverse((obj) => {
      if ((obj.isMesh || obj.isLine) && obj.geometry) obj.geometry.dispose();
    });
    for (const mat of builder.uniqueMaterials) disposeMaterial(mat);
    builder.uniqueMaterials.length = 0;
    for (const light of builder.lights) light.dispose?.();
    builder.lights.length = 0;
    materialSet.dispose();
    builder.colliders.length = 0;
    data.colliders = [];
  };

  game.scene.add(root);
  if (typeof game.log === 'function') {
    game.log(
      `Mapa ${info.id}: ${stats.triangles} tris Ãƒâ€šÃ‚Â· ${stats.drawCalls} draw calls Ãƒâ€šÃ‚Â· ` +
        `${stats.colliders} colliders Ãƒâ€šÃ‚Â· ${stats.waypoints} waypoints Ãƒâ€šÃ‚Â· ${stats.links} links`,
    );
  }
  return data;
}

export { ArenaBuilder };





