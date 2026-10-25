/**
 * maps.js — CS 1.6 Browser · mapas procedurales de_dust2 y cs_office.
 *
 * Todo se construye con geometría y materiales procedurales del propio engine:
 *   - Layout: pinta zonas transitables sobre una grilla de 0.5 m y genera muros
 *     automáticamente en el borde (sin huecos por donde caerse), con puertas,
 *     ventanas y techos.
 *   - MapBuilder: batchea geometría por material (pocos draw calls), registra
 *     colliders THREE.Box3 con `.surface` y arma el root del mapa.
 *   - Waypoints: lattice denso sobre el área transitable + puntos clave en puertas
 *     y esquinas, links con test de línea de vista contra colliders, grafo conexo
 *     y tags de gameplay (T, CT, A, B, mid, long, tunnels, catwalk, rescue,
 *     hostage, defend).
 *
 * Contrato: buildMap(game, mapId) -> MapData (ver src/CONTRACTS.md).
 */

import * as THREE from '../../vendor/three.module.js';
import { createMaterialSet, makeSignTexture, makeDecalTexture, disposeMaterial } from './textures.js';

const CELL = 0.5;
const UP = new THREE.Vector3(0, 1, 0);

/* ============================================================================
 * utilidades matemáticas / geometría
 * ========================================================================== */

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
  const w = x2 - x1;
  const d = z2 - z1;
  const geom = new THREE.PlaneGeometry(w, d);
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
 * MapBuilder — geometría batcheada, colliders y decoración
 * ========================================================================== */

class MapBuilder {
  constructor(mapId, materialSet, seed) {
    this.mapId = mapId;
    this.set = materialSet;
    this.root = new THREE.Group();
    this.root.name = `map:${mapId}`;
    this.batches = new Map(); // materialKey -> BufferGeometry[]
    this.colliders = [];
    this.uniqueMaterials = [];
    this.lights = [];
    this.cablePoints = [];
    this.rng = mulberry32(seed);
    this._grid = null;
    this._gridSize = 2;
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
    if (!mat) throw new Error(`[maps] material desconocido: ${matKey}`);
    return mat;
  }

  /* --------------------------------------------------------------- visual */

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
      throw new Error(`[maps] addRaw con material inválido (${matKey})\n${new Error().stack}`);
    }
    let list = this.batches.get(matKey);
    if (!list) {
      list = [];
      this.batches.set(matKey, list);
    }
    list.push(geom);
  }

  /**
   * Caja centrada. opts: { rx, ry, rz, tile, uvFit, collider, surface }
   */
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

  /** Caja por extremos (min/max). */
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
      this.addCollider(
        cx - r,
        cy - height / 2,
        cz - r,
        cx + r,
        cy + height / 2,
        cz + r,
        opts.surface || this.surfaceFor(matKey),
      );
    }
  }

  surfaceFor(matKey) {
    if (/metal|barrel/.test(matKey)) return 'metal';
    if (/wood|crate|door/.test(matKey)) return 'wood';
    if (/glass/.test(matKey)) return 'glass';
    if (/dirt|carpet|plaster/.test(matKey)) return 'dirt';
    if (/sand/.test(matKey)) return 'sand';
    if (/tile|concrete|stone|brick|ceiling|trim/.test(matKey)) return 'stone';
    return 'stone';
  }

  /* ------------------------------------------------------------ colliders */

  addCollider(minX, minY, minZ, maxX, maxY, maxZ, surface = 'stone') {
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
      new THREE.Vector3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
    );
    box.surface = surface;
    this.colliders.push(box);
    return box;
  }

  /** Índice espacial 2D de colliders para consultas rápidas de navegación. */
  buildSpatialIndex() {
    const size = this._gridSize;
    const grid = new Map();
    const key = (ix, iz) => `${ix},${iz}`;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const ix0 = Math.floor(c.min.x / size);
      const ix1 = Math.floor(c.max.x / size);
      const iz0 = Math.floor(c.min.z / size);
      const iz1 = Math.floor(c.max.z / size);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = key(ix, iz);
          let list = grid.get(k);
          if (!list) {
            list = [];
            grid.set(k, list);
          }
          list.push(i);
        }
      }
    }
    this._grid = grid;
  }

  _overlapsCollider(minX, minY, minZ, maxX, maxY, maxZ) {
    if (!this._grid) return false;
    const size = this._gridSize;
    const ix0 = Math.floor(minX / size);
    const ix1 = Math.floor(maxX / size);
    const iz0 = Math.floor(minZ / size);
    const iz1 = Math.floor(maxZ / size);
    const seen = this._querySeen || (this._querySeen = new Set());
    seen.clear();
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this._grid.get(`${ix},${iz}`);
        if (!list) continue;
        for (const idx of list) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const c = this.colliders[idx];
          if (
            minX < c.max.x &&
            maxX > c.min.x &&
            minY < c.max.y &&
            maxY > c.min.y &&
            minZ < c.max.z &&
            maxZ > c.min.z
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** ¿Hay espacio libre para un cuerpo de radio `r` entre y0..y1? */
  isFree(x, z, r = 0.45, y0 = 0.06, y1 = 1.8) {
    return !this._overlapsCollider(x - r, y0, z - r, x + r, y1, z + r);
  }

  /** Línea de vista/tránsito a nivel de pecho, muestreada. */
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

  /* ------------------------------------------------------------- decoración */

  addCable(ax, ay, az, bx, by, bz, opts = {}) {
    const sag = opts.sag ?? 0.8;
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

  addPointLight(x, y, z, color = 0xffd9a0, intensity = 8, distance = 14, decay = 1.7) {
    const light = new THREE.PointLight(color, intensity, distance, decay);
    light.position.set(x, y, z);
    this.root.add(light);
    this.lights.push(light);
    return light;
  }

  addEnvironment(ambient) {
    const hemi = new THREE.HemisphereLight(
      ambient.hemiColor ?? 0xbcd8ff,
      ambient.hemiGround ?? 0x6b5a3e,
      ambient.hemiIntensity ?? 0.9,
    );
    hemi.position.set(0, 40, 0);
    this.root.add(hemi);
    this.lights.push(hemi);

    const sunDir = new THREE.Vector3(
      ambient.sunDir?.x ?? 0.55,
      ambient.sunDir?.y ?? 0.78,
      ambient.sunDir?.z ?? 0.3,
    ).normalize();
    const sun = new THREE.DirectionalLight(ambient.sunColor ?? 0xfff0c8, ambient.sunIntensity ?? 2.2);
    sun.position.copy(sunDir).multiplyScalar(80);
    sun.target.position.set(0, 0, 0);
    this.root.add(sun);
    this.root.add(sun.target);
    this.lights.push(sun);

    const fill = new THREE.AmbientLight(ambient.ambientColor ?? 0x6b7380, ambient.ambientIntensity ?? 0.35);
    this.root.add(fill);
    this.lights.push(fill);

    return { sunDir, sun };
  }

  addSky(ambient, opts = {}) {
    const radius = opts.radius ?? 190;
    const top = new THREE.Color(ambient.skyTop ?? 0x3a6ea5);
    const bottom = new THREE.Color(ambient.skyBottom ?? 0xd9c8a3);
    const geom = new THREE.SphereGeometry(radius, 24, 14);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / radius;
      if (h >= 0) {
        color.copy(bottom).lerp(top, Math.pow(Math.min(1, h), 0.72));
      } else {
        color.copy(bottom).multiplyScalar(0.82);
      }
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      vertexColors: true,
      fog: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    mesh.name = 'sky';
    this.root.add(mesh);
    this.uniqueMaterials.push(mat);

    // Sol: disco simple recortado sobre el cielo.
    const sunDir = new THREE.Vector3(
      ambient.sunDir?.x ?? 0.55,
      ambient.sunDir?.y ?? 0.78,
      ambient.sunDir?.z ?? 0.3,
    ).normalize();
    const sunPos = sunDir.clone().multiplyScalar(radius * 0.9);
    const sunGeom = new THREE.CircleGeometry(opts.sunSize ?? 7, 20);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff3cf, fog: false, transparent: true, opacity: 0.95 });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.copy(sunPos);
    sunMesh.lookAt(0, 0, 0);
    sunMesh.name = 'sun-disc';
    this.root.add(sunMesh);
    this.uniqueMaterials.push(sunMat);
    return mesh;
  }

  addClouds(count = 8, seed = 7) {
    const rng = mulberry32(seed);
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.6;
      const dist = 80 + rng() * 70;
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist;
      const y = 55 + rng() * 38;
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const geom = new THREE.SphereGeometry(1, 7, 5);
        const sx = 6 + rng() * 9;
        const sy = 2.4 + rng() * 2.2;
        const sz = 4 + rng() * 6;
        const m = new THREE.Matrix4();
        m.compose(
          new THREE.Vector3(x + (rng() - 0.5) * 16, y + (rng() - 0.5) * 3, z + (rng() - 0.5) * 12),
          new THREE.Quaternion(),
          new THREE.Vector3(sx, sy, sz),
        );
        geom.applyMatrix4(m);
        list.push(geom);
      }
    }
    if (!list.length) return;
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

  addSign(text, opts = {}) {
    const {
      x = 0,
      y = 2.4,
      z = 0,
      ry = 0,
      w = 1.6,
      h = 0.8,
      bg = '#2b2924',
      fg = '#e8c46a',
      sub = '',
      border = '#6d5a34',
      backingMat = 'wood',
      backing = true,
    } = opts;
    const tex = makeSignTexture(text, { bg, fg, border, sub });
    if (!tex) return null;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.FrontSide });
    mat.name = `sign:${text}`;
    this.uniqueMaterials.push(mat);
    const geom = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geom, mat);
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.name = `sign:${text}`;
    this.root.add(mesh);
    if (backing) {
      this.box(backingMat, x - nx * 0.045, y, z - nz * 0.045, w + 0.14, h + 0.14, 0.07, { uvFit: true, ry });
    }
    return mesh;
  }

  addDecal(texture, opts = {}) {
    if (!texture) return null;
    const { x = 0, z = 0, y = 0.02, size = 4, rotation = 0, opacity = 1, name = 'decal' } = opts;
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
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
    const geom = new THREE.PlaneGeometry(size, size);
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.name = name;
    mesh.renderOrder = 2;
    this.root.add(mesh);
    return mesh;
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
 * Layout — zonas transitables, muros, pisos y techos
 * ========================================================================== */

class Layout {
  constructor(builder, bounds, opts = {}) {
    this.b = builder;
    this.bounds = bounds;
    this.cells = new Map(); // "ix,iz" -> { ix, iz, wall, height, surface, floor }
    this.windows = [];
    this.rng = opts.rng || Math.random;
    this.wallThickness = opts.wallThickness ?? 0.5;
    this.baseMat = opts.baseMat || null;
    this.baseHeight = opts.baseHeight ?? 0.42;
    this.capMat = opts.capMat || null;
    this.capHeight = opts.capHeight ?? 0.3;
    this.ribs = !!opts.ribs;
    this.ribMat = opts.ribMat || null;
  }

  key(ix, iz) {
    return `${ix},${iz}`;
  }

  ix(v) {
    return Math.round(v / CELL);
  }

  iz(v) {
    return Math.round(v / CELL);
  }

  cell(ix, iz) {
    return this.cells.get(this.key(ix, iz));
  }

  addWalk(minX, minZ, maxX, maxZ, opts = {}) {
    const ix0 = this.ix(minX);
    const iz0 = this.iz(minZ);
    const ix1 = this.ix(maxX);
    const iz1 = this.iz(maxZ);
    for (let iz = iz0; iz < iz1; iz++) {
      for (let ix = ix0; ix < ix1; ix++) {
        this.cells.set(this.key(ix, iz), {
          ix,
          iz,
          wall: opts.wall || 'sandWall',
          height: opts.height ?? 8,
          surface: opts.surface || this.b.surfaceFor(opts.wall || 'sandWall'),
          floor: opts.floor || 'sandFloor',
        });
      }
    }
  }

  paintFloor(minX, minZ, maxX, maxZ, floorMat) {
    const ix0 = this.ix(minX);
    const iz0 = this.iz(minZ);
    const ix1 = this.ix(maxX);
    const iz1 = this.iz(maxZ);
    for (let iz = iz0; iz < iz1; iz++) {
      for (let ix = ix0; ix < ix1; ix++) {
        const cell = this.cell(ix, iz);
        if (cell) cell.floor = floorMat;
      }
    }
  }

  addWindow(spec) {
    this.windows.push(spec);
  }

  isWalkableAt(x, z) {
    return !!this.cell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  /* ---------------------------------------------------------------- pisos */

  buildFloors() {
    const rows = new Map();
    for (const cell of this.cells.values()) {
      let row = rows.get(cell.iz);
      if (!row) {
        row = [];
        rows.set(cell.iz, row);
      }
      row.push(cell);
    }
    for (const [iz, row] of rows) {
      row.sort((a, b) => a.ix - b.ix);
      let run = null;
      for (const cell of row) {
        if (run && run.floor === cell.floor && run.endIx === cell.ix) {
          run.endIx = cell.ix + 1;
        } else {
          if (run) this._emitFloorRun(run);
          run = { floor: cell.floor, startIx: cell.ix, endIx: cell.ix + 1, iz };
        }
      }
      if (run) this._emitFloorRun(run);
    }
  }

  _emitFloorRun(run) {
    const x1 = run.startIx * CELL;
    const x2 = run.endIx * CELL;
    const z1 = run.iz * CELL;
    const z2 = z1 + CELL;
    const tile = this.b.tile(run.floor);
    this.b.addRaw(run.floor, makeQuad(x1, z1, x2, z2, 0, tile, true));
  }

  buildCeilingRect(minX, minZ, maxX, maxZ, y, matKey, opts = {}) {
    const tile = this.b.tile(matKey);
    this.b.addRaw(matKey, makeQuad(minX, minZ, maxX, maxZ, y, tile, false));
    if (opts.top !== false) {
      this.b.addRaw(opts.topMat || matKey, makeQuad(minX, minZ, maxX, maxZ, y + (opts.thickness ?? 0.4), tile, true));
    }
    if (opts.collider !== false) {
      this.b.addCollider(minX, y, minZ, maxX, y + (opts.thickness ?? 0.4), maxZ, opts.surface || 'stone');
    }
  }

  /**
   * Tejados de los bloques no transitables (llenan el "pueblo" entre calles).
   * Se mergean por fila para no generar cientos de mallas.
   */
  buildVoidRoofs(y, matKey, opts = {}) {
    const b = this.bounds;
    const ix0 = Math.floor(b.minX / CELL);
    const ix1 = Math.ceil(b.maxX / CELL);
    const iz0 = Math.floor(b.minZ / CELL);
    const iz1 = Math.ceil(b.maxZ / CELL);
    const altMat = opts.altMat || matKey;
    let runIndex = 0;
    for (let iz = iz0; iz < iz1; iz++) {
      let runStart = null;
      for (let ix = ix0; ix <= ix1; ix++) {
        const solid = ix < ix1 && !this.cell(ix, iz);
        if (solid && runStart === null) runStart = ix;
        if (!solid && runStart !== null) {
          const x1 = runStart * CELL;
          const x2 = ix * CELL;
          const z1 = iz * CELL;
          const z2 = z1 + CELL;
          const mat = (runIndex + iz) % 5 === 0 ? altMat : matKey;
          this.b.addRaw(mat, makeQuad(x1, z1, x2, z2, y, this.b.tile(mat), true));
          runStart = null;
          runIndex++;
        }
      }
    }
  }

  /** Tapa superior sobre zonas techadas (para que desde el menú no se vean huecos). */
  buildRoofTops(rects, y, matKey = 'roofStone') {
    for (const [minX, minZ, maxX, maxZ] of rects) {
      const ix0 = Math.round(minX / CELL);
      const iz0 = Math.round(minZ / CELL);
      const ix1 = Math.round(maxX / CELL);
      const iz1 = Math.round(maxZ / CELL);
      for (let iz = iz0; iz < iz1; iz++) {
        let runStart = null;
        for (let ix = ix0; ix <= ix1; ix++) {
          const solid = ix < ix1 && !!this.cell(ix, iz);
          if (solid && runStart === null) runStart = ix;
          if (!solid && runStart !== null) {
            const tile = this.b.tile(matKey);
            this.b.addRaw(matKey, makeQuad(runStart * CELL, iz * CELL, ix * CELL, (iz + 1) * CELL, y, tile, true));
            runStart = null;
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- muros */

  buildWalls() {
    const edges = [];
    for (const cell of this.cells.values()) {
      const { ix, iz, wall, height, surface } = cell;
      const x0 = ix * CELL;
      const x1 = x0 + CELL;
      const z0 = iz * CELL;
      const z1 = z0 + CELL;
      const base = { wall, height, surface, mat: wall, h: height };
      if (!this.cell(ix, iz - 1)) edges.push({ ...base, axis: 'z', line: z0, dir: -1, a: x0, b: x1 });
      if (!this.cell(ix, iz + 1)) edges.push({ ...base, axis: 'z', line: z1, dir: 1, a: x0, b: x1 });
      if (!this.cell(ix - 1, iz)) edges.push({ ...base, axis: 'x', line: x0, dir: -1, a: z0, b: z1 });
      if (!this.cell(ix + 1, iz)) edges.push({ ...base, axis: 'x', line: x1, dir: 1, a: z0, b: z1 });
    }

    const groups = new Map();
    for (const edge of edges) {
      const key = `${edge.axis}|${edge.line.toFixed(2)}|${edge.dir}|${edge.mat}|${edge.h}|${edge.surface}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(edge);
    }

    for (const group of groups.values()) {
      group.sort((a, b) => a.a - b.a);
      let run = null;
      for (const edge of group) {
        if (run && edge.a <= run.b + 1e-6) {
          run.b = Math.max(run.b, edge.b);
        } else {
          if (run) this._emitRun(run);
          run = { ...edge };
        }
      }
      if (run) this._emitRun(run);
    }
  }

  _emitRun(run) {
    const { axis, line, dir, a, b, mat, height, surface } = run;
    this._runHeight = height;
    const wins = this.windows
      .filter((w) => w.axis === axis && Math.abs(w.line - line) < 0.01 && w.b > a && w.a < b)
      .sort((p, q) => p.a - q.a);

    let cur = a;
    for (const w of wins) {
      const wa = Math.max(a, w.a);
      const wb = Math.min(b, w.b);
      if (wb <= cur + 1e-6) continue;
      if (wa > cur + 1e-6) this._addSolid(axis, line, dir, cur, wa, 0, height, mat, surface);
      const y0 = Math.max(0, Math.min(w.y0 ?? 1, height - 0.1));
      const y1 = Math.min(height, Math.max(y0 + 0.2, w.y1 ?? height - 0.4));
      if (y0 > 1e-3) this._addSolid(axis, line, dir, wa, wb, 0, y0, mat, surface);
      if (y1 < height - 1e-3) this._addSolid(axis, line, dir, wa, wb, y1, height, mat, surface);
      this._addGlass(axis, line, dir, wa, wb, y0, y1);
      cur = wb;
    }
    if (cur < b - 1e-3) this._addSolid(axis, line, dir, cur, b, 0, height, mat, surface);

    // Refuerzos verticales de piedra en paños largos (relieve).
    if (this.ribs && this.ribMat && b - a > 5) {
      for (let s = a + 3; s < b - 2.4; s += 6) {
        this._wallBox(axis, line, dir, s, s + 0.45, 0, height, this.ribMat, surface, {
          thickness: this.wallThickness + 0.3,
          collider: false,
        });
      }
    }
  }

  _wallBox(axis, line, dir, s0, s1, y0, y1, matKey, surface, opts = {}) {
    const t = opts.thickness ?? this.wallThickness;
    if (axis === 'z') {
      const z1 = dir < 0 ? line - t : line;
      const z2 = dir < 0 ? line : line + t;
      this.b.boxMM(matKey, s0, y0, z1, s1, y1, z2, { surface });
      if (opts.collider !== false) this.b.addCollider(s0, y0, z1, s1, y1, z2, surface);
    } else {
      const x1 = dir < 0 ? line - t : line;
      const x2 = dir < 0 ? line : line + t;
      this.b.boxMM(matKey, x1, y0, s0, x2, y1, s1, { surface });
      if (opts.collider !== false) this.b.addCollider(x1, y0, s0, x2, y1, s1, surface);
    }
  }

  _addSolid(axis, line, dir, s0, s1, y0, y1, mat, surface) {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
    this._wallBox(axis, line, dir, s0, s1, y0, y1, mat, surface);
    const full = y0 <= 1e-3 && y1 >= (this._runHeight ?? Infinity) - 1e-3;
    if (this.baseMat && y0 <= 1e-3) {
      this._wallBox(axis, line, dir, s0, s1, 0, Math.min(this.baseHeight, y1), this.baseMat, surface, {
        thickness: this.wallThickness + 0.1,
        collider: false,
      });
    }
    if (this.capMat && full) {
      this._wallBox(axis, line, dir, s0, s1, y1 - this.capHeight, y1, this.capMat, surface, {
        thickness: this.wallThickness + 0.16,
        collider: false,
      });
    }
  }

  _addGlass(axis, line, dir, s0, s1, y0, y1) {
    const t = 0.1;
    const mid = line + dir * (this.wallThickness * 0.5);
    const frameMat = 'metal';
    if (axis === 'z') {
      this.b.boxMM('glass', s0, y0, mid - t / 2, s1, y1, mid + t / 2, { surface: 'glass' });
      this.b.addCollider(s0, y0, mid - t / 2, s1, y1, mid + t / 2, 'glass');
      // marco
      this.b.boxMM(frameMat, s0, y0, mid - 0.09, s1, y0 + 0.08, mid + 0.09, { surface: 'metal' });
      this.b.boxMM(frameMat, s0, y1 - 0.08, mid - 0.09, s1, y1, mid + 0.09, { surface: 'metal' });
      const n = Math.max(1, Math.round((s1 - s0) / 2.2));
      for (let i = 0; i <= n; i++) {
        const p = s0 + ((s1 - s0) * i) / n;
        this.b.boxMM(frameMat, p - 0.045, y0, mid - 0.09, p + 0.045, y1, mid + 0.09, { surface: 'metal' });
      }
    } else {
      this.b.boxMM('glass', mid - t / 2, y0, s0, mid + t / 2, y1, s1, { surface: 'glass' });
      this.b.addCollider(mid - t / 2, y0, s0, mid + t / 2, y1, s1, 'glass');
      this.b.boxMM(frameMat, mid - 0.09, y0, s0, mid + 0.09, y0 + 0.08, s1, { surface: 'metal' });
      this.b.boxMM(frameMat, mid - 0.09, y1 - 0.08, s0, mid + 0.09, y1, s1, { surface: 'metal' });
      const n = Math.max(1, Math.round((s1 - s0) / 2.2));
      for (let i = 0; i <= n; i++) {
        const p = s0 + ((s1 - s0) * i) / n;
        this.b.boxMM(frameMat, mid - 0.09, y0, p - 0.045, mid + 0.09, y1, p + 0.045, { surface: 'metal' });
      }
    }
  }
}

/* ============================================================================
 * Waypoints
 * ========================================================================== */

function insideRegion(x, z, r) {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

function generateWaypoints(builder, layout, opts) {
  const {
    bounds,
    spacing = 2.75,
    clearance = 0.46,
    maxLink = 5.0,
    extra = [],
    regions = [],
    y = 0,
  } = opts;

  let nodes = [];

  const addNode = (x, z, tags) => {
    for (const n of nodes) {
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < 1.0) {
        if (tags) for (const t of tags) n.tags.add(t);
        return n;
      }
    }
    const node = { x, z, tags: new Set(tags || []), links: new Set() };
    nodes.push(node);
    return node;
  };

  for (const ex of extra) addNode(ex.x, ex.z, ex.tags);

  const startX = bounds.minX + spacing * 0.5;
  const startZ = bounds.minZ + spacing * 0.5;
  for (let z = startZ; z <= bounds.maxZ - spacing * 0.5; z += spacing) {
    for (let x = startX; x <= bounds.maxX - spacing * 0.5; x += spacing) {
      if (!layout.isWalkableAt(x, z)) continue;
      if (!builder.isFree(x, z, clearance)) continue;
      addNode(x, z);
    }
  }

  // tags por región + conectividad
  for (const node of nodes) {
    for (const region of regions) {
      if (insideRegion(node.x, node.z, region)) {
        for (const tag of region.tags || []) node.tags.add(tag);
      }
    }
  }

  // links bidireccionales entre nodos cercanos con espacio libre
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.abs(dx) > maxLink || Math.abs(dz) > maxLink) continue;
      const dist = Math.hypot(dx, dz);
      if (dist > maxLink) continue;
      if (!builder.segmentClear(a.x, a.z, b.x, b.z, 0.38)) continue;
      a.links.add(b);
      b.links.add(a);
    }
  }

  connectGraph(nodes, builder);
  nodes = pruneToLargestComponent(nodes);

  // ids y salida plana
  nodes.forEach((node, index) => {
    node.id = index;
  });
  return nodes.map((node) => ({
    id: node.id,
    x: Number(node.x.toFixed(2)),
    y,
    z: Number(node.z.toFixed(2)),
    links: [...node.links].map((n) => n.id).sort((a, b) => a - b),
    tags: [...node.tags].sort(),
  }));
}

function graphComponents(nodes) {
  const seen = new Set();
  const components = [];
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
    components.push(comp);
  }
  return components;
}

function connectGraph(nodes, builder) {
  for (let iter = 0; iter < 120; iter++) {
    const comps = graphComponents(nodes);
    if (comps.length <= 1) return true;
    comps.sort((a, b) => b.length - a.length);
    const main = comps[0];
    let best = null;
    for (let c = 1; c < comps.length; c++) {
      for (const a of main) {
        for (const b of comps[c]) {
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
    }
    if (!best) return false;
    if (best.d > 16) return false;
    if (!bridgeNodes(nodes, builder, best.a, best.b, 0)) return false;
  }
  return graphComponents(nodes).length <= 1;
}

function bridgeNodes(nodes, builder, a, b, depth) {
  if (builder.segmentClear(a.x, a.z, b.x, b.z, 0.36)) {
    a.links.add(b);
    b.links.add(a);
    return true;
  }
  if (depth >= 3) return false;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  if (!builder.isFree(mx, mz, 0.36)) return false;
  const mid = { x: mx, z: mz, tags: new Set(a.tags), links: new Set() };
  nodes.push(mid);
  return bridgeNodes(nodes, builder, a, mid, depth + 1) && bridgeNodes(nodes, builder, mid, b, depth + 1);
}

/** Descarta waypoints que quedaron aislados por props (garantiza navegación conexa). */
function pruneToLargestComponent(nodes) {
  const comps = graphComponents(nodes);
  if (comps.length <= 1) return nodes;
  comps.sort((a, b) => b.length - a.length);
  const keep = new Set(comps[0]);
  const kept = nodes.filter((node) => keep.has(node));
  for (const node of kept) {
    node.links = new Set([...node.links].filter((nb) => keep.has(nb)));
  }
  return kept;
}


/* ============================================================================
 * helpers de decoración compartidos
 * ========================================================================== */

function addArch(builder, opts) {
  const {
    x,
    z,
    span,
    along = 'x',
    height = 0,
    thickness = 0.8,
    mat = 'sandWall',
    stoneMat = 'sandWallDark',
    rise = 1.1,
    jamb = 0.45,
    lintelBottom = 2.7,
  } = opts;
  const h = height || 7;
  const half = span / 2;
  const lintelTop = Math.min(h - 0.1, Math.max(lintelBottom + 0.5, lintelBottom + rise + 0.4));

  if (along === 'x') {
    // pasaje en Z (el hueco se extiende en X)
    builder.box(stoneMat, x - half - jamb / 2, h / 2, z, jamb, h, thickness, {
      collider: true,
      surface: 'stone',
    });
    builder.box(stoneMat, x + half + jamb / 2, h / 2, z, jamb, h, thickness, {
      collider: true,
      surface: 'stone',
    });
    builder.box(stoneMat, x, (lintelBottom + lintelTop) / 2, z, span + jamb * 2, lintelTop - lintelBottom, thickness, {
      collider: true,
      surface: 'stone',
    });
    const blocks = 7;
    for (let i = 0; i < blocks; i++) {
      const t = (i + 0.5) / blocks;
      const ang = Math.PI * t;
      const bx = x + Math.cos(ang) * half;
      const by = lintelTop + Math.sin(ang) * rise;
      builder.box(stoneMat, bx, by, z, span / blocks + 0.18, 0.32, thickness + 0.14, {
        collider: false,
        surface: 'stone',
      });
    }
    // relleno de muro por encima del arco
    const top = lintelTop + rise;
    if (top < h - 0.05) {
      builder.box(mat, x, (top + h) / 2, z, span + jamb * 2, h - top, thickness, {
        collider: true,
        surface: 'stone',
      });
    }
  } else {
    // pasaje en X (el hueco se extiende en Z)
    builder.box(stoneMat, x, h / 2, z - half - jamb / 2, thickness, h, jamb, {
      collider: true,
      surface: 'stone',
    });
    builder.box(stoneMat, x, h / 2, z + half + jamb / 2, thickness, h, jamb, {
      collider: true,
      surface: 'stone',
    });
    builder.box(stoneMat, x, (lintelBottom + lintelTop) / 2, z, thickness, lintelTop - lintelBottom, span + jamb * 2, {
      collider: true,
      surface: 'stone',
    });
    const blocks = 7;
    for (let i = 0; i < blocks; i++) {
      const t = (i + 0.5) / blocks;
      const ang = Math.PI * t;
      const bz = z + Math.cos(ang) * half;
      const by = lintelTop + Math.sin(ang) * rise;
      builder.box(stoneMat, x, by, bz, thickness + 0.14, 0.32, span / blocks + 0.18, {
        collider: false,
        surface: 'stone',
      });
    }
    // relleno de muro por encima del arco
    const top = lintelTop + rise;
    if (top < h - 0.05) {
      builder.box(mat, x, (top + h) / 2, z, thickness, h - top, span + jamb * 2, {
        collider: true,
        surface: 'stone',
      });
    }
  }
}

function addDoorway(builder, opts) {
  const {
    x,
    z,
    span,
    along = 'x',
    height = 2.5,
    thickness = 0.35,
    mat = 'wood',
    jamb = 'woodDark',
    doors = true,
    doorMat = 'doorWood',
  } = opts;
  const half = span / 2;
  const t = thickness;
  if (along === 'x') {
    builder.box(jamb, x - half - 0.09, height / 2, z, 0.18, height, t, { collider: false, surface: 'wood' });
    builder.box(jamb, x + half + 0.09, height / 2, z, 0.18, height, t, { collider: false, surface: 'wood' });
    builder.box(mat, x, height + 0.12, z, span + 0.36, 0.24, t, { collider: true, surface: 'wood' });
    if (doors) {
      // dos hojas abiertas contra el marco
      builder.box(doorMat, x - half + 0.28, 1.1, z + t * 0.7, 0.1, 2.2, 1.15, {
        collider: true,
        uvFit: true,
        surface: 'wood',
      });
      builder.box(doorMat, x + half - 0.28, 1.1, z + t * 0.7, 0.1, 2.2, 1.15, {
        collider: true,
        uvFit: true,
        surface: 'wood',
      });
    }
  } else {
    builder.box(jamb, x, height / 2, z - half - 0.09, t, height, 0.18, { collider: false, surface: 'wood' });
    builder.box(jamb, x, height / 2, z + half + 0.09, t, height, 0.18, { collider: false, surface: 'wood' });
    builder.box(mat, x, height + 0.12, z, t, 0.24, span + 0.36, { collider: true, surface: 'wood' });
    if (doors) {
      builder.box(doorMat, x + t * 0.7, 1.1, z - half + 0.28, 1.15, 2.2, 0.1, {
        collider: true,
        uvFit: true,
        surface: 'wood',
      });
      builder.box(doorMat, x + t * 0.7, 1.1, z + half - 0.28, 1.15, 2.2, 0.1, {
        collider: true,
        uvFit: true,
        surface: 'wood',
      });
    }
  }
}

function addCrate(builder, x, z, size = 1.2, opts = {}) {
  const y = opts.y ?? 0;
  const ry = opts.ry ?? 0;
  builder.box('crate', x, y + size / 2, z, size, size, size, {
    uvFit: true,
    collider: true,
    ry,
    surface: 'wood',
  });
}

function addCrateStack(builder, x, z, size = 1.2, opts = {}) {
  addCrate(builder, x, z, size, opts);
  if (opts.count && opts.count > 1) {
    addCrate(builder, x + 0.04, z - 0.03, size * 0.88, {
      y: size,
      ry: (opts.ry ?? 0) + 0.22,
    });
  }
  if (opts.count && opts.count > 2) {
    addCrate(builder, x - 0.05, z + 0.02, size * 0.76, {
      y: size + size * 0.88,
      ry: (opts.ry ?? 0) - 0.15,
    });
  }
}

function addBarrel(builder, x, z, opts = {}) {
  const mat = opts.mat || 'barrelA';
  const h = 1.04;
  builder.cylinder(mat, x, h / 2, z, 0.4, 0.42, h, 12, { collider: true, surface: 'metal' });
  builder.cylinder(mat, x, h - 0.03, z, 0.36, 0.4, 0.06, 12, {});
}

function addSandbags(builder, x, z, count = 5, along = 'x', opts = {}) {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.62;
    const jitter = (builder.rng() - 0.5) * 0.06;
    if (along === 'x') {
      builder.box('sandWallDark', x + off + jitter, 0.16, z, 0.6, 0.32, 0.45, {
        uvFit: true,
        collider: false,
        surface: 'sand',
      });
      if (i % 2 === 0) {
        builder.box('sandWallDark', x + off + jitter + 0.1, 0.47, z - 0.02, 0.6, 0.3, 0.45, {
          uvFit: true,
          collider: false,
          surface: 'sand',
        });
      }
    } else {
      builder.box('sandWallDark', x, 0.16, z + off + jitter, 0.45, 0.32, 0.6, {
        uvFit: true,
        collider: false,
        surface: 'sand',
      });
      if (i % 2 === 0) {
        builder.box('sandWallDark', x - 0.02, 0.47, z + off + jitter + 0.1, 0.45, 0.3, 0.6, {
          uvFit: true,
          collider: false,
          surface: 'sand',
        });
      }
    }
  }
  // collider único
  if (along === 'x') {
    const w = count * 0.62;
    builder.addCollider(x - w / 2, 0, z - 0.3, x + w / 2, 0.7, z + 0.3, 'sand');
  } else {
    const d = count * 0.62;
    builder.addCollider(x - 0.3, 0, z - d / 2, x + 0.3, 0.7, z + d / 2, 'sand');
  }
}

function addPalm(builder, x, z, height = 9, seed = 1) {
  const rng = mulberry32(seed);
  const segments = 5;
  let px = x;
  let pz = z;
  for (let i = 0; i < segments; i++) {
    const y = (height / segments) * (i + 0.5) * 0.82;
    const r = 0.31 - i * 0.045;
    const lean = (i / segments) * 0.7;
    px = x + lean;
    builder.cylinder('wood', px, y, pz, r, r + 0.05, height / segments + 0.25, 7, {});
  }
  const topX = x + 0.7;
  const topY = height * 0.84;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const len = 2.2 + rng() * 1.2;
    const drop = 0.55 + rng() * 0.5;
    builder.box('foliageDry', topX + Math.cos(a) * len * 0.5, topY - drop * 0.5, pz + Math.sin(a) * len * 0.5, len, 0.12, 0.5, {
      ry: -a,
      rz: -drop,
      uvFit: true,
    });
  }
}

function addBush(builder, x, z, scale = 1, seed = 1) {
  const rng = mulberry32(seed);
  for (let i = 0; i < 3; i++) {
    const ox = (rng() - 0.5) * 0.9 * scale;
    const oz = (rng() - 0.5) * 0.9 * scale;
    const geom = new THREE.IcosahedronGeometry((0.35 + rng() * 0.35) * scale, 0);
    builder.applyTRS(geom, x + ox, (0.3 + rng() * 0.2) * scale, z + oz);
    builder.addRaw('foliageDry', geom);
  }
}

function addRock(builder, x, z, scale = 1, seed = 1) {
  const rng = mulberry32(seed);
  const geom = new THREE.DodecahedronGeometry(scale, 0);
  geom.scale(1, 0.6 + rng() * 0.3, 1);
  builder.applyTRS(geom, x, scale * 0.3, z, 0, rng() * Math.PI, 0);
  builder.addRaw('sandWallDark', geom);
}

function addVehicle(builder, x, z, ry = 0, color = 'metalDark') {
  builder.box(color, x, 0.62, z, 4.2, 0.72, 1.9, { collider: false, surface: 'metal', ry });
  builder.box(color, x - 0.15, 1.22, z, 2.3, 0.62, 1.72, { collider: false, surface: 'metal', ry });
  builder.box('glass', x - 0.15, 1.24, z, 2.1, 0.42, 1.76, { collider: false, surface: 'glass', ry });
  for (const [wx, wz] of [
    [1.35, 0.95],
    [1.35, -0.95],
    [-1.35, 0.95],
    [-1.35, -0.95],
  ]) {
    builder.cylinder('metalDark', x + wx, 0.4, z + wz, 0.36, 0.36, 0.26, 10, {
      rx: Math.PI / 2,
      ry,
    });
  }
}

// Marcador de sitio de bomba / zona de rescate.
function bombSiteDecalTexture(letter, color) {
  return makeDecalTexture((ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.045;
    ctx.setLineDash([s * 0.08, s * 0.05]);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(s * 0.42)}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + s * 0.01);
  });
}

function rescueZoneDecalTexture() {
  return makeDecalTexture((ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(90,220,130,0.9)';
    ctx.lineWidth = s * 0.04;
    ctx.setLineDash([s * 0.07, s * 0.045]);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(70,200,120,0.16)';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,245,160,0.95)';
    ctx.font = `bold ${Math.floor(s * 0.16)}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RESCUE', s / 2, s / 2 - s * 0.06);
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.38);
    ctx.lineTo(s * 0.42, s * 0.52);
    ctx.lineTo(s * 0.58, s * 0.52);
    ctx.closePath();
    ctx.fill();
  });
}

/* ============================================================================
 * MAPS
 * ========================================================================== */

export const MAPS = {
  de_dust2: {
    id: 'de_dust2',
    name: 'de_dust2',
    displayName: 'de_dust2',
    mode: 'bomb',
    description: 'El clásico mapa desértico de Counter-Strike. Sitios A y B, largo, medio y túneles.',
    players: 10,
    teamSize: 5,
  },
  cs_office: {
    id: 'cs_office',
    name: 'cs_office',
    displayName: 'cs_office',
    mode: 'hostage',
    description: 'Oficinas corporativas con dos rehenes y una zona de rescate para los CT.',
    players: 10,
    teamSize: 5,
  },
};

/* ============================================================================
 * de_dust2
 * ========================================================================== */

function buildDust2(builder, info) {
  const bounds = { minX: -42, maxX: 42, minZ: -44, maxZ: 44 };

  const ambient = {
    skyTop: 0x2f669f,
    skyBottom: 0xdecba4,
    fog: 0xd9c8a3,
    fogNear: 65,
    fogFar: 215,
    sunColor: 0xffe6b8,
    sunIntensity: 2.35,
    hemiColor: 0xbfd8ff,
    hemiGround: 0x8a7550,
    hemiIntensity: 0.85,
    ambientColor: 0x7d8898,
    ambientIntensity: 0.3,
    sunDir: { x: 0.55, y: 0.72, z: 0.42 },
  };

  const layout = new Layout(builder, bounds, {
    wallThickness: 0.55,
    capMat: 'sandWallDark',
    capHeight: 0.34,
    baseMat: 'stoneDark',
    baseHeight: 0.4,
    ribs: true,
    ribMat: 'sandWallDark',
    rng: builder.rng,
  });

  /* ---------------------------------------------------------- zonas */

  // T spawn (sur) y salidas
  layout.addWalk(4, 32, 22, 42, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(-18, 34, 4, 40, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(-26, 34, -18, 40, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  // Túneles B
  layout.addWalk(-26, -10, -18, 40, { wall: 'stoneWall', height: 8, floor: 'dirtFloor', surface: 'stone' });
  layout.addWalk(-18, 8, 0, 14, { wall: 'stoneWall', height: 8, floor: 'dirtFloor', surface: 'stone' });
  // Mid y top mid
  layout.addWalk(0, -8, 8, 32, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(0, -24, 8, -8, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  // CT spawn
  layout.addWalk(-10, -34, 12, -24, { wall: 'sandWall', height: 8, floor: 'concreteFloor', surface: 'stone' });
  // Catwalk / short
  layout.addWalk(8, -8, 20, -2, { wall: 'sandWall', height: 8, floor: 'concreteFloor', surface: 'stone' });
  layout.addWalk(16, -16, 24, -8, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  // A site
  layout.addWalk(20, -30, 38, -14, { wall: 'brickWall', height: 8, floor: 'sandFloor', surface: 'stone' });
  // Long A, long outside, long doors
  layout.addWalk(28, -14, 38, 6, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(24, 6, 40, 24, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(22, 24, 28, 36, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  // B site y accesos
  layout.addWalk(-38, -30, -18, -10, { wall: 'brickWall', height: 8, floor: 'sandFloor', surface: 'stone' });
  layout.addWalk(-18, -30, -10, -24, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(12, -30, 20, -24, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });
  layout.addWalk(-18, -14, 0, -6, { wall: 'sandWall', height: 8, floor: 'sandFloor', surface: 'sand' });

  /* ---------------------------------------------------------- pisos */

  // Pads de concreto y desgaste
  layout.paintFloor(20, -30, 38, -14, 'sandFloor');
  layout.paintFloor(24, -27, 35, -17, 'concreteFloor');
  layout.paintFloor(-38, -30, -18, -10, 'sandFloor');
  layout.paintFloor(-35, -27, -21, -14, 'concreteFloor');
  layout.paintFloor(-10, -34, 12, -24, 'concreteFloor');
  layout.paintFloor(8, -8, 20, -2, 'concreteFloor');
  layout.paintFloor(-26, -8, -18, 40, 'dirtFloor');
  layout.paintFloor(0, 12, 8, 24, 'sandFloor');
  layout.paintFloor(30, -10, 37, 4, 'sandFloor');
  layout.paintFloor(-18, 20, -10, 33, 'dirtFloor');

  layout.buildFloors();
  layout.buildWalls();

  /* ------------------------------------------------------ techos/arcos */

  // Túneles techados (bajo el pueblo)
  layout.buildCeilingRect(-26, -10, -18, 40, 3.7, 'stoneDark', { thickness: 0.45, top: false });
  layout.buildCeilingRect(-18, 8, 0, 14, 3.7, 'stoneDark', { thickness: 0.45, top: false });
  layout.buildCeilingRect(-26, 34, -18, 40, 3.7, 'stoneDark', { thickness: 0.45, top: false });
  // Catwalk con techo de tejas y vigas de madera
  layout.buildCeilingRect(8, -8, 20, -2, 4.15, 'roofStone', { thickness: 0.4, top: false });
  for (let bx = 9; bx <= 19; bx += 2) {
    builder.box('wood', bx, 4.0, -5, 0.32, 0.3, 6.0, { uvFit: true });
  }
  builder.box('wood', 8.4, 3.98, -5, 0.3, 0.3, 6.0, { uvFit: true });
  builder.box('wood', 19.6, 3.98, -5, 0.3, 0.3, 6.0, { uvFit: true });

  // Tejados del pueblo: los bloques no transitables se cubren a la altura de los
  // muros para que la vista del menú se lea como un pueblo desértico y no como
  // un laberinto de paredes. Las zonas techadas (túneles, catwalk) se tapan arriba.
  layout.buildVoidRoofs(8.06, 'roofStone', { altMat: 'sandWallDark' });
  layout.buildRoofTops(
    [
      [-26, -10, -18, 40],
      [-18, 8, 0, 14],
      [-26, 34, -18, 40],
      [8, -8, 20, -2],
    ],
    8.06,
    'roofStone',
  );

  // Detalle de techos: tanques, cajas de aire, cúpulas
  const roofRng = mulberry32(0x5eed12);
  for (let i = 0; i < 64; i++) {
    const rx = bounds.minX + 2 + roofRng() * (bounds.maxX - bounds.minX - 4);
    const rz = bounds.minZ + 2 + roofRng() * (bounds.maxZ - bounds.minZ - 4);
    if (layout.isWalkableAt(rx, rz)) continue;
    const kind = roofRng();
    const ry = 8.06;
    if (kind < 0.4) {
      builder.box('metalDark', rx, ry + 0.36, rz, 1.2, 0.72, 0.9, { uvFit: true });
      builder.box('metal', rx + 0.1, ry + 0.74, rz, 0.7, 0.06, 0.55, { uvFit: true });
    } else if (kind < 0.66) {
      builder.box('woodDark', rx, ry + 0.5, rz, 1.5, 1.0, 1.2, { uvFit: true });
      builder.box('sandWallDark', rx, ry + 1.02, rz, 1.6, 0.1, 1.3, { uvFit: true });
    } else if (kind < 0.87) {
      builder.cylinder('roofStone', rx, ry + 0.4, rz, 0.07, 0.95, 0.8, 10, {});
    } else {
      builder.box('sandWallDark', rx, ry + 0.3, rz, 0.9, 0.6, 0.9, { uvFit: true });
    }
  }

  /* ------------------------------------------------ ambiente exterior */

  // arena exterior (visible desde arriba / menú)
  builder.addRaw('sandFloor', makeQuad(-132, -132, 132, 132, -0.09, 9, true));
  builder.addEnvironment(ambient);
  builder.addSky(ambient, { radius: 190, sunSize: 7.5 });
  builder.addClouds(9, 11);

  // Palmeras y rocas fuera de la arena (silueta sobre los muros)
  addPalm(builder, 47, 9, 11.5, 3);
  addPalm(builder, 49, -21, 10, 7);
  addPalm(builder, -48, 6, 12, 11);
  addPalm(builder, -47, -31, 9.5, 17);
  addPalm(builder, 24, 49, 10.5, 23);
  addPalm(builder, -18, 50, 11, 29);
  addRock(builder, 48, 24, 2.8, 31);
  addRock(builder, 47, -34, 2.2, 37);
  addRock(builder, -49, 20, 3.2, 41);
  addRock(builder, -46, -8, 2.4, 43);
  addRock(builder, 12, 51, 2.6, 47);
  addBush(builder, 45, 30, 1.6, 53);
  addBush(builder, -45, -20, 1.8, 59);

  /* ------------------------------------------------------------- T spawn */

  addCrateStack(builder, 20.2, 40.4, 1.3, { count: 2, ry: 0.1 });
  addCrate(builder, 18.7, 41.2, 0.9, { ry: 0.3 });
  addBarrel(builder, 21.2, 34.5, { mat: 'barrelB' });
  addBarrel(builder, 21.2, 33.3, { mat: 'barrelA' });
  addSandbags(builder, 5.1, 41.35, 4, 'x');
  addDoorway(builder, { x: 4, z: 36.6, span: 4.2, along: 'z', height: 2.5, thickness: 0.42 });
  addDoorway(builder, { x: 22, z: 34, span: 3.4, along: 'z', height: 2.5, thickness: 0.42 });
  builder.addSign('T SPAWN', { x: 13, y: 3.1, z: 41.65, ry: Math.PI, w: 2.6, h: 0.9, fg: '#d9b25f' });
  builder.addSign('A  →', { x: 20.9, y: 2.5, z: 37.6, ry: -Math.PI / 2, w: 1.7, h: 0.7, fg: '#e0a34a' });
  builder.addCable(4.4, 6.2, 33, 21.6, 6.2, 33, { sag: 0.7 });
  builder.addCable(4.4, 6.4, 41, 21.6, 6.4, 41, { sag: 0.8 });

  /* --------------------------------------------------------- túneles B */

  addDoorway(builder, { x: -22, z: 37, span: 5.4, along: 'z', height: 2.6, thickness: 0.4 });
  addBarrel(builder, -19.2, 28.5, { mat: 'barrelA' });
  addBarrel(builder, -18.7, 27.3, { mat: 'barrelB' });
  addCrate(builder, -19.3, 12.5, 1.05, { ry: 0.2 });
  addCrate(builder, -19.2, 11.3, 0.85, { ry: -0.15 });
  addSandbags(builder, -21, 1.5, 4, 'z');
  builder.addSign('B TUNNELS', { x: -18.24, y: 2.7, z: 25, ry: -Math.PI / 2, w: 2.8, h: 0.9, fg: '#c9a24a' });
  // luces colgantes de túnel
  for (const lz of [31, 20, 6, -4]) {
    builder.box('lampWarm', -22, 3.45, lz, 0.5, 0.16, 0.24, { uvFit: true });
    builder.box('metalDark', -22, 3.57, lz, 0.06, 0.14, 0.06, {});
    builder.addPointLight(-22, 3.1, lz, 0xffb877, 5.5, 12, 1.8);
  }
  builder.addCable(-19.6, 5.2, 30, -24.4, 4.4, 30, { sag: 0.5 });
  addDoorway(builder, { x: -18, z: 11, span: 5.2, along: 'z', height: 2.6, thickness: 0.4 });
  builder.addSign('B', { x: -25.94, y: 2.6, z: 12.5, ry: Math.PI / 2, w: 1.2, h: 0.9, bg: '#3a2418', fg: '#e8b04a' });

  /* ---------------------------------------------------------------- mid */

  addDoorway(builder, { x: 4, z: 2, span: 6.2, along: 'x', height: 2.55, thickness: 0.52 });
  builder.addSign('MID', { x: 7.72, y: 2.7, z: 8.5, ry: -Math.PI / 2, w: 1.8, h: 0.75 });
  addCrate(builder, 1.1, 14.5, 1.05, { ry: 0.12 });
  addCrate(builder, 1.15, 13.2, 0.85, { ry: -0.2 });
  addBarrel(builder, 7.1, 20.5, { mat: 'barrelA' });
  addBarrel(builder, 7.05, 21.8, { mat: 'barrelB' });
  addSandbags(builder, 6.4, 25.5, 4, 'z');
  addCrate(builder, 6.9, -3.2, 1.1, { ry: 0.25 });
  builder.addCable(0.3, 5.6, 10, 7.7, 5.6, 10, { sag: 0.75 });
  builder.addCable(0.3, 5.9, -1, 7.7, 5.9, -1, { sag: 0.65 });

  /* ------------------------------------------------------------- catwalk */

  addArch(builder, { x: 8, z: -5, span: 6, along: 'z', height: 8, rise: 0.4, thickness: 0.7 });
  addArch(builder, { x: 18, z: -8, span: 4, along: 'x', height: 8, rise: 0.32, thickness: 0.7 });
  addCrate(builder, 18.6, -6.6, 1.0, { ry: 0.15 });
  addBarrel(builder, 9.2, -6.9, { mat: 'barrelA' });
  builder.box('lampWarm', 14, 3.86, -5, 0.9, 0.14, 0.3, { uvFit: true });
  builder.addPointLight(14, 3.5, -5, 0xffc98a, 6, 11, 1.8);

  /* ---------------------------------------------------------------- short */

  builder.addSign('SHORT', { x: 16.3, y: 2.6, z: -9.2, ry: Math.PI / 2, w: 1.9, h: 0.8 });
  addCrate(builder, 23.2, -12.2, 0.95, { ry: -0.2 });
  addBarrel(builder, 23.3, -14.6, { mat: 'barrelB' });

  /* --------------------------------------------------------------- A site */

  addArch(builder, { x: 33, z: -14, span: 9.6, along: 'x', height: 8, rise: 1.5, thickness: 0.8 });
  builder.addSign('A', {
    x: 34.6,
    y: 3.2,
    z: -29.55,
    ry: 0,
    w: 2.0,
    h: 1.5,
    bg: '#3c1d17',
    fg: '#e2482f',
    border: '#7d3a28',
  });
  builder.addDecal(bombSiteDecalTexture('A', 'rgba(235,90,50,0.95)'), {
    x: 29,
    z: -22,
    size: 13,
    name: 'bombsite-A',
  });
  addCrateStack(builder, 34.6, -27.6, 1.4, { count: 3, ry: 0.08 });
  addCrateStack(builder, 22.6, -27.2, 1.2, { count: 2, ry: -0.12 });
  addCrate(builder, 36.8, -24.2, 1.0, { ry: 0.2 });
  addCrate(builder, 36.7, -23.2, 0.8, { ry: 0.4 });
  addBarrel(builder, 36.6, -18.2, { mat: 'barrelA' });
  addBarrel(builder, 35.7, -17.3, { mat: 'barrelB' });
  addBarrel(builder, 36.4, -16.4, { mat: 'barrelA' });
  addSandbags(builder, 26.4, -15.4, 6, 'x');
  // puesto de mercado con lona
  builder.box('woodDark', 21.4, 1.3, -29.3, 0.18, 2.6, 0.18, {});
  builder.box('woodDark', 21.4, 1.3, -26.1, 0.18, 2.6, 0.18, {});
  builder.box('tarp', 21.4, 2.72, -27.7, 3.0, 0.06, 3.6, { rz: -0.16, uvFit: true });
  addCrate(builder, 22.0, -28.2, 1.1, { ry: 0.25 });
  addCrate(builder, 22.1, -26.6, 0.85, { ry: -0.1 });
  builder.addCable(20.3, 5.8, -25, 37.6, 5.8, -25, { sag: 1.1 });
  builder.addCable(20.3, 6.1, -18, 37.6, 6.1, -18, { sag: 0.9 });
  addBush(builder, 37.2, -29.2, 1.3, 61);

  /* ---------------------------------------------------------------- long */

  addDoorway(builder, { x: 33, z: 2, span: 6.8, along: 'x', height: 2.6, thickness: 0.55 });
  builder.addSign('LONG A', { x: 37.7, y: 2.9, z: -4.5, ry: -Math.PI / 2, w: 2.2, h: 0.8 });
  addCrateStack(builder, 36.4, 4.4, 1.1, { count: 2, ry: 0.14 });
  addBarrel(builder, 36.2, -2.6, { mat: 'barrelA' });
  addBarrel(builder, 35.3, -3.4, { mat: 'barrelB' });
  addSandbags(builder, 29.1, 4.8, 4, 'z');
  builder.addCable(28.3, 5.4, -6, 37.7, 5.4, -6, { sag: 0.6 });
  builder.addCable(28.3, 5.7, 10, 37.7, 5.7, 10, { sag: 0.7 });

  /* -------------------------------------------------------- long outside */

  addDoorway(builder, { x: 25, z: 30, span: 5.0, along: 'x', height: 2.6, thickness: 0.5 });
  builder.addSign('LONG', { x: 39.7, y: 2.9, z: 14, ry: -Math.PI / 2, w: 1.9, h: 0.75 });
  addCrateStack(builder, 38.4, 21.4, 1.3, { count: 2, ry: 0.2 });
  addBarrel(builder, 38.6, 8.6, { mat: 'barrelB' });
  addBarrel(builder, 37.7, 7.8, { mat: 'barrelA' });
  addSandbags(builder, 39.2, 12.8, 4, 'z');
  // carro de madera
  builder.box('wood', 31.2, 0.78, 18.4, 2.6, 0.16, 1.5, { uvFit: true, collider: true, surface: 'wood' });
  builder.box('woodDark', 31.2, 0.42, 18.4, 2.3, 0.5, 1.3, { uvFit: true });
  builder.cylinder('woodDark', 30.2, 0.42, 17.6, 0.4, 0.4, 0.18, 10, { rx: Math.PI / 2 });
  builder.cylinder('woodDark', 32.2, 0.42, 17.6, 0.4, 0.4, 0.18, 10, { rx: Math.PI / 2 });
  addCrate(builder, 31.2, 18.4, 0.9, { ry: 0.1 });
  addBush(builder, 39.1, 23, 1.4, 67);
  builder.addCable(24.3, 5.9, 8, 39.7, 5.9, 8, { sag: 0.8 });
  builder.addCable(24.3, 6.1, 20, 39.7, 6.1, 20, { sag: 0.9 });

  /* ------------------------------------------------------------- B site */

  addArch(builder, { x: -22, z: -10, span: 7.6, along: 'x', height: 8, rise: 1.3, thickness: 0.8 });
  builder.addSign('B', {
    x: -34.4,
    y: 3.2,
    z: -29.55,
    ry: 0,
    w: 2.0,
    h: 1.5,
    bg: '#3c1d17',
    fg: '#4f8fd6',
    border: '#2b4d78',
  });
  builder.addDecal(bombSiteDecalTexture('B', 'rgba(235,120,50,0.95)'), {
    x: -28,
    z: -20,
    size: 13,
    name: 'bombsite-B',
  });
  addCrateStack(builder, -36.4, -24.8, 1.4, { count: 3, ry: -0.1 });
  addCrateStack(builder, -20.6, -27.8, 1.2, { count: 2, ry: 0.15 });
  addCrate(builder, -36.6, -22.4, 1.0, { ry: -0.22 });
  addBarrel(builder, -36.4, -15.3, { mat: 'barrelB' });
  addBarrel(builder, -35.5, -14.3, { mat: 'barrelA' });
  addSandbags(builder, -22.6, -11.4, 5, 'x');
  // tienda de B con lona
  builder.box('woodDark', -33.6, 1.3, -29.3, 0.18, 2.6, 0.18, {});
  builder.box('woodDark', -30.6, 1.3, -29.3, 0.18, 2.6, 0.18, {});
  builder.box('tarp', -32.1, 2.72, -28.9, 3.4, 0.06, 2.6, { rz: 0.14, uvFit: true });
  addCrate(builder, -31.4, -28.6, 1.05, { ry: -0.25 });
  builder.addSign('B', { x: -18.28, y: 2.7, z: -14, ry: -Math.PI / 2, w: 1.2, h: 0.9, bg: '#3a2418', fg: '#e8b04a' });
  builder.addCable(-38.2, 5.8, -22, -18.4, 5.8, -22, { sag: 1.0 });
  addBush(builder, -37.1, -29.1, 1.4, 71);

  /* ------------------------------------------------------ CT spawn/rampas */

  addArch(builder, { x: 12, z: -27, span: 5.6, along: 'z', height: 8, rise: 1.0, thickness: 0.7 });
  addArch(builder, { x: -10, z: -27, span: 5.6, along: 'z', height: 8, rise: 1.0, thickness: 0.7 });
  builder.addSign('CT SPAWN', {
    x: 1,
    y: 3.15,
    z: -33.45,
    ry: 0,
    w: 3.0,
    h: 0.95,
    bg: '#1e2b38',
    fg: '#cfe2ee',
    border: '#42596c',
  });
  builder.addSign('de_dust2', {
    x: 1,
    y: 2.3,
    z: -33.5,
    ry: 0,
    w: 2.0,
    h: 0.55,
    bg: '#2b2924',
    fg: '#b9a06a',
    border: '#5d4f30',
    sub: '',
  });
  addCrateStack(builder, -8.6, -33.2, 1.2, { count: 2, ry: 0.12 });
  addCrate(builder, 10.5, -33.1, 1.1, { ry: -0.18 });
  addBarrel(builder, 10.9, -25.6, { mat: 'barrelA' });
  addBarrel(builder, 9.9, -25.2, { mat: 'barrelB' });
  addSandbags(builder, -6.4, -25.1, 4, 'x');
  addBush(builder, -9.3, -33.1, 1.2, 73);
  builder.addCable(-9.6, 6.1, -26, 11.6, 6.1, -26, { sag: 0.9 });

  /* ------------------------------------------------------------ B doors */

  addDoorway(builder, { x: -9, z: -10, span: 7.2, along: 'z', height: 2.6, thickness: 0.55 });
  builder.addSign('B  DOORS', { x: -9, y: 2.9, z: -13.6, ry: 0, w: 2.3, h: 0.8 });
  addBarrel(builder, -16.8, -8.4, { mat: 'barrelB' });
  addCrate(builder, -16.9, -12.6, 1.0, { ry: 0.2 });
  addSandbags(builder, -2.4, -8.4, 4, 'z');
  builder.addCable(-17.6, 5.4, -8, -0.4, 5.4, -8, { sag: 0.7 });

  /* ----------------------------------------------- vegetación y detalles */

  addBush(builder, 4.8, 33.4, 1.2, 79);
  addBush(builder, 20.8, 41.2, 1.1, 83);
  addBush(builder, 8.9, 30.6, 1.0, 89);
  addBush(builder, 29.6, -13.2, 1.1, 97);
  addBush(builder, 21.2, -15.6, 1.2, 101);
  addBush(builder, -17.2, 33.4, 1.1, 103);
  addBush(builder, 15.2, -14.9, 1.0, 107);
  addBush(builder, -19.4, 6.8, 1.0, 109);

  /* ---------------------------------------------- collider de suelo global */

  builder.addCollider(bounds.minX, -1, bounds.minZ, bounds.maxX, 0, bounds.maxZ, 'sand');

  /* ------------------------------------------------------------ waypoints */

  const regions = [
    { name: 'T Spawn', minX: 2, maxX: 24, minZ: 31, maxZ: 43, tags: ['T'] },
    { name: 'CT Spawn', minX: -11, maxX: 13, minZ: -35, maxZ: -23, tags: ['CT'] },
    { name: 'Mid', minX: -1, maxX: 9, minZ: -8, maxZ: 32, tags: ['mid'] },
    { name: 'Catwalk', minX: 7, maxX: 21, minZ: -9, maxZ: -1, tags: ['catwalk'] },
    { name: 'Short A', minX: 15, maxX: 25, minZ: -17, maxZ: -7, tags: ['catwalk', 'A'] },
    { name: 'A Site', minX: 19, maxX: 39, minZ: -31, maxZ: -13, tags: ['A', 'defend'] },
    { name: 'Long A', minX: 27, maxX: 39, minZ: -14, maxZ: 7, tags: ['long'] },
    { name: 'Long Doors', minX: 23, maxX: 41, minZ: 5, maxZ: 25, tags: ['long'] },
    { name: 'Long Outside', minX: 21, maxX: 29, minZ: 23, maxZ: 37, tags: ['long', 'T'] },
    { name: 'B Site', minX: -39, maxX: -17, minZ: -31, maxZ: -9, tags: ['B', 'defend'] },
    { name: 'Tunnels', minX: -27, maxX: -17, minZ: -9, maxZ: 41, tags: ['tunnels'] },
    { name: 'Lower Tunnels', minX: -19, maxX: 1, minZ: 7, maxZ: 15, tags: ['tunnels', 'mid'] },
    { name: 'B Doors', minX: -19, maxX: 1, minZ: -15, maxZ: -5, tags: ['B', 'defend'] },
    { name: 'CT Ramp', minX: 11, maxX: 21, minZ: -31, maxZ: -23, tags: ['CT', 'A'] },
    { name: 'CT to B', minX: -19, maxX: -9, minZ: -31, maxZ: -23, tags: ['CT', 'B'] },
  ];

  const extra = [
    { x: 13, z: 37.5, tags: ['T'] },
    { x: 1, z: -29, tags: ['CT'] },
    { x: 4, z: 2, tags: ['mid'] },
    { x: 4, z: 12, tags: ['mid'] },
    { x: 4, z: -4, tags: ['mid'] },
    { x: 4, z: -18, tags: ['mid', 'CT'] },
    { x: 14, z: -5, tags: ['catwalk'] },
    { x: 18, z: -8, tags: ['catwalk'] },
    { x: 20, z: -11, tags: ['catwalk', 'A'] },
    { x: 29, z: -22, tags: ['A', 'defend'] },
    { x: 23, z: -18, tags: ['A'] },
    { x: 33, z: -6, tags: ['long'] },
    { x: 33, z: 2, tags: ['long'] },
    { x: 25, z: 30, tags: ['long', 'T'] },
    { x: 33, z: 16, tags: ['long'] },
    { x: -28, z: -20, tags: ['B', 'defend'] },
    { x: -22, z: -10, tags: ['tunnels', 'B'] },
    { x: -22, z: 10, tags: ['tunnels'] },
    { x: -22, z: 26, tags: ['tunnels'] },
    { x: -22, z: 37, tags: ['tunnels', 'T'] },
    { x: -9, z: 11, tags: ['tunnels', 'mid'] },
    { x: -9, z: -10, tags: ['B', 'defend'] },
    { x: -14, z: -27, tags: ['CT', 'B'] },
    { x: 16, z: -27, tags: ['CT', 'A'] },
    { x: -32, z: -14, tags: ['B'] },
    { x: 34, z: -25, tags: ['A'] },
    { x: -34, z: -24, tags: ['B'] },
  ];
  builder.buildSpatialIndex();
  const waypoints = generateWaypoints(builder, layout, {
    bounds,
    spacing: 2.9,
    clearance: 0.46,
    maxLink: 5.1,
    extra,
    regions,
  });

  /* --------------------------------------------------------------- salida */

  const spawnFace = (x, z, yaw) => ({ x, y: 0.05, z, yaw });
  const spawns = {
    T: [
      spawnFace(7, 37, 0),
      spawnFace(10.5, 37, 0),
      spawnFace(14, 37, 0),
      spawnFace(17.5, 37, 0),
      spawnFace(7, 40.2, 0),
      spawnFace(10.5, 40.2, 0),
      spawnFace(14, 40.2, 0),
      spawnFace(17.5, 40.2, 0),
    ],
    CT: [
      spawnFace(-7, -28, -90),
      spawnFace(-3.5, -28, -90),
      spawnFace(0, -28, -90),
      spawnFace(3.5, -28, -90),
      spawnFace(7, -28, -90),
      spawnFace(-3.5, -31.5, -90),
      spawnFace(0, -31.5, -90),
      spawnFace(3.5, -31.5, -90),
    ],
  };

  const buyZones = {
    T: { min: { x: 4, z: 32 }, max: { x: 22, z: 42 } },
    CT: { min: { x: -10, z: -34 }, max: { x: 12, z: -24 } },
  };

  const bombsites = [
    {
      name: 'A',
      x: 29,
      z: -22,
      radius: 5.5,
      min: { x: 23, z: -29 },
      max: { x: 36, z: -16 },
    },
    {
      name: 'B',
      x: -28,
      z: -20,
      radius: 5.5,
      min: { x: -35, z: -28 },
      max: { x: -20, z: -12 },
    },
  ];

  const callouts = regions.map((r) => ({
    name: r.name,
    min: { x: r.minX, z: r.minZ },
    max: { x: r.maxX, z: r.maxZ },
  }));

  return {
    id: info.id,
    name: info.name,
    displayName: info.displayName,
    mode: info.mode,
    description: info.description,
    spawns,
    buyZones,
    bombsites,
    hostageSpawns: [],
    rescueZone: null,
    waypoints,
    callouts,
    bounds,
    ambient,
    menuCamera: {
      pos: { x: 31, y: 27, z: 31 },
      lookAt: { x: -1, y: 2, z: -8 },
    },
  };
}

/* ============================================================================
 * muebles de oficina
 * ========================================================================== */

const rot2 = (ox, oz, ry) => ({
  x: ox * Math.cos(ry) - oz * Math.sin(ry),
  z: ox * Math.sin(ry) + oz * Math.cos(ry),
});

function addMonitor(builder, x, z, y, ry = 0) {
  const base = rot2(0, 0, ry);
  builder.box('metalDark', x + base.x, y + 0.17, z + base.z, 0.52, 0.34, 0.05, {
    uvFit: true,
    ry,
    surface: 'metal',
  });
  const s = rot2(0, -0.035, ry);
  builder.box('screen', x + s.x, y + 0.18, z + s.z, 0.44, 0.27, 0.02, { uvFit: true, ry, surface: 'glass' });
  builder.box('metalDark', x, y + 0.02, z, 0.16, 0.04, 0.12, { uvFit: true, ry });
}

function addDesk(builder, x, z, opts = {}) {
  const ry = opts.ry ?? 0;
  const w = 2.0;
  const d = 0.86;
  const h = 0.75;
  builder.box('wood', x, h, z, w, 0.07, d, {
    uvFit: true,
    collider: true,
    surface: 'wood',
    ry,
  });
  for (const [ox, oz] of [
    [-w / 2 + 0.09, -d / 2 + 0.09],
    [w / 2 - 0.09, -d / 2 + 0.09],
    [-w / 2 + 0.09, d / 2 - 0.09],
    [w / 2 - 0.09, d / 2 - 0.09],
  ]) {
    const p = rot2(ox, oz, ry);
    builder.box('metalDark', x + p.x, (h - 0.07) / 2, z + p.z, 0.06, h - 0.07, 0.06, {});
  }
  if (opts.monitor !== false) {
    const p = rot2(0.45, 0, ry);
    addMonitor(builder, x + p.x, z + p.z, h + 0.04, ry);
  }
  if (opts.papers) {
    const p = rot2(-0.5, 0.1, ry);
    builder.box('paper', x + p.x, h + 0.045, z + p.z, 0.3, 0.01, 0.22, { ry });
    builder.box('paper', x + p.x + 0.03, h + 0.056, z + p.z - 0.02, 0.3, 0.01, 0.22, {
      ry: ry + 0.18,
    });
  }
  if (opts.keyboard !== false) {
    const p = rot2(-0.4, 0.32, ry);
    builder.box('metalDark', x + p.x, h + 0.045, z + p.z, 0.42, 0.03, 0.14, { ry });
  }
}

function addChair(builder, x, z, ry = 0) {
  builder.box('fabric', x, 0.45, z, 0.46, 0.09, 0.46, { collider: true, surface: 'wood', ry });
  builder.box('fabric', x, 0.47, z, 0.4, 0.05, 0.4, { ry });
  const back = rot2(0, 0.2, ry);
  builder.box('fabric', x + back.x, 0.78, z + back.z, 0.44, 0.55, 0.07, { ry });
  builder.cylinder('metalDark', x, 0.23, z, 0.04, 0.04, 0.4, 8, {});
  builder.cylinder('metalDark', x, 0.06, z, 0.22, 0.22, 0.05, 10, {});
}

function addCabinet(builder, x, z, opts = {}) {
  const ry = opts.ry ?? 0;
  builder.box('metalDark', x, 0.66, z, 0.9, 1.32, 0.46, {
    uvFit: true,
    collider: true,
    surface: 'metal',
    ry,
  });
  builder.box('metal', x, 1.32, z, 0.94, 0.04, 0.5, { uvFit: true, ry });
  for (let i = 0; i < 3; i++) {
    const p = rot2(0, -0.24, ry);
    builder.box('metal', x + p.x, 0.3 + i * 0.36, z + p.z, 0.6, 0.03, 0.02, { ry });
    builder.box('metal', x + p.x, 0.3 + i * 0.36, z + p.z, 0.12, 0.035, 0.05, { ry });
  }
}

function addShelf(builder, x, z, opts = {}) {
  const ry = opts.ry ?? 0;
  builder.box('woodDark', x, 1.0, z, 1.1, 1.95, 0.36, {
    uvFit: true,
    collider: true,
    surface: 'wood',
    ry,
  });
  const bookMats = ['carpetRed', 'fabric', 'board', 'paper', 'wood'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const p = rot2(-0.42 + i * 0.2, 0.2, ry);
      builder.box(bookMats[(i + row) % bookMats.length], x + p.x, 0.55 + row * 0.52, z + p.z, 0.12, 0.3, 0.12, {
        ry: ry + (i % 2 ? 0.03 : 0),
      });
    }
  }
}

function addPlant(builder, x, z, scale = 1) {
  builder.cylinder('stoneDark', x, 0.24 * scale, z, 0.24 * scale, 0.18 * scale, 0.48 * scale, 10, {});
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const geom = new THREE.IcosahedronGeometry(0.3 * scale, 0);
    builder.applyTRS(geom, x + Math.cos(a) * 0.18 * scale, (0.65 + i * 0.12) * scale, z + Math.sin(a) * 0.18 * scale);
    builder.addRaw('foliage', geom);
  }
  builder.addCollider(x - 0.24 * scale, 0, z - 0.24 * scale, x + 0.24 * scale, 0.7 * scale, z + 0.24 * scale, 'dirt');
}

function addSofa(builder, x, z, ry = 0) {
  builder.box('fabric', x, 0.22, z, 2.2, 0.44, 0.9, { uvFit: true, collider: true, surface: 'wood', ry });
  const back = rot2(0, 0.36, ry);
  builder.box('fabric', x + back.x, 0.62, z + back.z, 2.2, 0.68, 0.22, { uvFit: true, ry });
  for (const side of [-1, 1]) {
    const p = rot2(side * 1.0, 0, ry);
    builder.box('fabric', x + p.x, 0.42, z + p.z, 0.22, 0.42, 0.9, { uvFit: true, ry });
  }
}

function addVending(builder, x, z, ry = 0) {
  builder.box('metalDark', x, 0.95, z, 0.92, 1.9, 0.68, { uvFit: true, collider: true, surface: 'metal', ry });
  const p = rot2(0, 0.36, ry);
  builder.box('screen', x + p.x, 1.06, z + p.z, 0.66, 1.0, 0.02, { uvFit: true, ry });
  const btn = rot2(0.28, 0.37, ry);
  builder.box('lampPanel', x + btn.x, 0.62, z + btn.z, 0.3, 0.5, 0.02, { ry });
}

function addFridge(builder, x, z, ry = 0) {
  builder.box('metal', x, 0.93, z, 0.86, 1.86, 0.72, { uvFit: true, collider: true, surface: 'metal', ry });
  const h = rot2(0, 0.37, ry);
  builder.box('metalDark', x + h.x, 1.35, z + h.z, 0.5, 0.03, 0.03, { ry });
}

function addWaterCooler(builder, x, z) {
  builder.cylinder('metal', x, 0.45, z, 0.24, 0.26, 0.9, 10, { collider: true, surface: 'metal' });
  builder.cylinder('water', x, 1.15, z, 0.2, 0.2, 0.46, 10, {});
  builder.cylinder('metalDark', x, 0.9, z, 0.1, 0.1, 0.06, 8, {});
}

/* ============================================================================
 * particiones interiores (muros manuales con puertas y cristales)
 * ========================================================================== */

function addPartition(builder, opts) {
  const {
    axis,
    line,
    from,
    to,
    height = 3.2,
    thickness = 0.28,
    mat = 'plasterWall',
    baseMat = 'trim',
    baseHeight = 0.16,
    doors = [],
    glass = [],
    doorSide = 1,
    doorMat = 'doorWood',
    trimMat = 'plasterTrim',
  } = opts;

  const wallBox = (a, b, y0, y1, matKey = mat, collider = true) => {
    if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
    if (axis === 'z') {
      builder.boxMM(matKey, a, y0, line - thickness / 2, b, y1, line + thickness / 2, { surface: 'stone' });
      if (collider) builder.addCollider(a, y0, line - thickness / 2, b, y1, line + thickness / 2, 'stone');
    } else {
      builder.boxMM(matKey, line - thickness / 2, y0, a, line + thickness / 2, y1, b, { surface: 'stone' });
      if (collider) builder.addCollider(line - thickness / 2, y0, a, line + thickness / 2, y1, b, 'stone');
    }
  };

  const glassPanel = (a, b, y0, y1) => {
    const t = 0.07;
    if (axis === 'z') {
      builder.boxMM('glass', a, y0, line - t / 2, b, y1, line + t / 2, { surface: 'glass' });
      builder.addCollider(a, y0, line - t / 2, b, y1, line + t / 2, 'glass');
      builder.boxMM('metal', a, y0, line - 0.06, b, y0 + 0.06, line + 0.06, { surface: 'metal' });
      builder.boxMM('metal', a, y1 - 0.06, line - 0.06, b, y1, line + 0.06, { surface: 'metal' });
      const n = Math.max(1, Math.round((b - a) / 2.2));
      for (let i = 0; i <= n; i++) {
        const p = a + ((b - a) * i) / n;
        builder.boxMM('metal', p - 0.035, y0, line - 0.06, p + 0.035, y1, line + 0.06, { surface: 'metal' });
      }
    } else {
      builder.boxMM('glass', line - t / 2, y0, a, line + t / 2, y1, b, { surface: 'glass' });
      builder.addCollider(line - t / 2, y0, a, line + t / 2, y1, b, 'glass');
      builder.boxMM('metal', line - 0.06, y0, a, line + 0.06, y0 + 0.06, b, { surface: 'metal' });
      builder.boxMM('metal', line - 0.06, y1 - 0.06, a, line + 0.06, y1, b, { surface: 'metal' });
      const n = Math.max(1, Math.round((b - a) / 2.2));
      for (let i = 0; i <= n; i++) {
        const p = a + ((b - a) * i) / n;
        builder.boxMM('metal', line - 0.06, y0, p - 0.035, line + 0.06, y1, p + 0.035, { surface: 'metal' });
      }
    }
  };

  const openings = [
    ...doors.map((d) => ({ a: d[0], b: d[1], type: 'door' })),
    ...glass.map((g) => ({ a: g[0], b: g[1], type: 'glass', y0: g[2] ?? 0.95, y1: g[3] ?? 2.5 })),
  ].sort((p, q) => p.a - q.a);

  let cur = from;
  for (const o of openings) {
    const a = Math.max(from, o.a);
    const b = Math.min(to, o.b);
    if (b <= cur + 1e-6) continue;
    if (a > cur + 1e-6) wallBox(cur, a, 0, height);
    if (o.type === 'door') {
      wallBox(a, b, 2.35, height, mat);
      // jambas
      if (axis === 'z') {
        builder.box(trimMat, a - 0.04, height / 2, line, 0.09, height, thickness + 0.05, { uvFit: true });
        builder.box(trimMat, b + 0.04, height / 2, line, 0.09, height, thickness + 0.05, { uvFit: true });
        // hojas abiertas hacia el lado doorSide
        builder.box(doorMat, a + 0.13, 1.07, line + doorSide * 0.56, 0.09, 2.14, 0.98, {
          uvFit: true,
          collider: true,
          surface: 'wood',
        });
        builder.box(doorMat, b - 0.13, 1.07, line + doorSide * 0.56, 0.09, 2.14, 0.98, {
          uvFit: true,
          collider: true,
          surface: 'wood',
        });
      } else {
        builder.box(trimMat, line, height / 2, a - 0.04, thickness + 0.05, height, 0.09, { uvFit: true });
        builder.box(trimMat, line, height / 2, b + 0.04, thickness + 0.05, height, 0.09, { uvFit: true });
        builder.box(doorMat, line + doorSide * 0.56, 1.07, a + 0.13, 0.98, 2.14, 0.09, {
          uvFit: true,
          collider: true,
          surface: 'wood',
        });
        builder.box(doorMat, line + doorSide * 0.56, 1.07, b - 0.13, 0.98, 2.14, 0.09, {
          uvFit: true,
          collider: true,
          surface: 'wood',
        });
      }
    } else {
      if (o.y0 > 0.01) wallBox(a, b, 0, o.y0);
      if (o.y1 < height - 0.01) wallBox(a, b, o.y1, height);
      glassPanel(a, b, o.y0, o.y1);
    }
    cur = b;
  }
  if (cur < to - 1e-6) wallBox(cur, to, 0, height);

  // zócalo solo sobre los tramos llenos (aproximado, recorre la longitud total)
  if (baseMat) {
    let c = from;
    for (const o of openings) {
      if (o.a > c + 0.05) {
        if (axis === 'z') {
          builder.boxMM(baseMat, c, 0, line - thickness / 2 - 0.03, o.a, baseHeight, line + thickness / 2 + 0.03, {});
        } else {
          builder.boxMM(baseMat, line - thickness / 2 - 0.03, 0, c, line + thickness / 2 + 0.03, baseHeight, o.a, {});
        }
      }
      c = Math.max(c, o.b);
    }
    if (c < to - 0.05) {
      if (axis === 'z') {
        builder.boxMM(baseMat, c, 0, line - thickness / 2 - 0.03, to, baseHeight, line + thickness / 2 + 0.03, {});
      } else {
        builder.boxMM(baseMat, line - thickness / 2 - 0.03, 0, c, line + thickness / 2 + 0.03, baseHeight, to, {});
      }
    }
  }
}

/* ============================================================================
 * cs_office
 * ========================================================================== */

function buildOffice(builder, info) {
  const bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };

  const ambient = {
    skyTop: 0x6f9ec6,
    skyBottom: 0xd7e1e5,
    fog: 0xc4ccd0,
    fogNear: 40,
    fogFar: 155,
    sunColor: 0xfff4de,
    sunIntensity: 1.55,
    hemiColor: 0xdbe8f5,
    hemiGround: 0x5a5148,
    hemiIntensity: 0.75,
    ambientColor: 0x8a8478,
    ambientIntensity: 0.32,
    sunDir: { x: 0.62, y: 0.7, z: 0.35 },
  };

  const layout = new Layout(builder, bounds, {
    wallThickness: 0.5,
    baseMat: 'trim',
    baseHeight: 0.16,
    ribs: false,
    rng: builder.rng,
  });

  /* ---------------------------------------------------------- zonas */

  // Pasillo principal (este-oeste) y lobby / zona de rescate (sur)
  layout.addWalk(-24, -3, 24, 3, { wall: 'plasterWall', height: 3.2, floor: 'tileFloor', surface: 'stone' });
  layout.addWalk(6, 3, 24, 22, { wall: 'plasterWall', height: 3.2, floor: 'tileFloor', surface: 'stone' });
  // Ala norte: garaje (T), oficina grande, sala de conferencias
  layout.addWalk(-24, -24, -12, -3, { wall: 'concreteWall', height: 3.2, floor: 'concreteFloor', surface: 'stone' });
  layout.addWalk(-10, -24, 6, -3, { wall: 'plasterWall', height: 3.2, floor: 'carpetFloor', surface: 'stone' });
  layout.addWalk(8, -24, 24, -3, { wall: 'plasterWall', height: 3.2, floor: 'carpetFloor', surface: 'stone' });
  // Ala sur: sala de descanso y oficina chica
  layout.addWalk(-24, 3, -6, 22, { wall: 'plasterWall', height: 3.2, floor: 'tileFloor', surface: 'stone' });
  layout.addWalk(-4, 3, 4, 22, { wall: 'plasterWall', height: 3.2, floor: 'carpetFloor', surface: 'stone' });

  /* ---------------------------------------------------------- pisos */

  layout.paintFloor(7, 9, 22, 21, 'carpetRed');
  layout.paintFloor(9, -24, 23, -19, 'carpetRed');
  layout.paintFloor(-4, 5, 4, 13, 'carpetFloor');
  layout.buildFloors();

  /* --------------------------------------------------------- ventanas */

  // Lobby: ventanales al exterior (sur y este)
  layout.addWindow({ axis: 'z', line: 22, a: 8, b: 22, y0: 0.95, y1: 2.55 });
  layout.addWindow({ axis: 'x', line: 24, a: 5, b: 20, y0: 0.95, y1: 2.55 });
  // Ala norte: oficinas con luz natural
  layout.addWindow({ axis: 'z', line: -24, a: -9, b: 5, y0: 1.0, y1: 2.45 });
  layout.addWindow({ axis: 'z', line: -24, a: 9, b: 22, y0: 1.0, y1: 2.45 });
  // Ala sur
  layout.addWindow({ axis: 'z', line: 22, a: -21, b: -9, y0: 1.0, y1: 2.45 });
  layout.addWindow({ axis: 'z', line: 22, a: -3, b: 3, y0: 1.0, y1: 2.45 });
  // Garaje: ventanas altas
  layout.addWindow({ axis: 'x', line: -24, a: -21, b: -6, y0: 1.35, y1: 2.5 });

  layout.buildWalls();

  /* ------------------------------------------------------- particiones */

  // Muro norte del pasillo (oficinas norte)
  addPartition(builder, {
    axis: 'z',
    line: -3,
    from: -24,
    to: 6,
    doorSide: -1,
    doors: [
      [-20, -17],
      [-4, -1],
    ],
    glass: [[-9.5, -4.6]],
  });
  addPartition(builder, {
    axis: 'z',
    line: -3,
    from: 8,
    to: 24,
    doorSide: -1,
    doors: [[14, 17]],
    glass: [
      [9, 13.4],
      [18, 22],
    ],
  });
  // Muro sur del pasillo (sala de descanso / oficina chica)
  addPartition(builder, {
    axis: 'z',
    line: 3,
    from: -24,
    to: 6,
    doorSide: 1,
    doors: [
      [-20, -17],
      [-2.6, 0],
    ],
    glass: [[-14, -8]],
  });
  // Separación lobby / pasillo con cristaleras y hueco central
  addPartition(builder, {
    axis: 'z',
    line: 3,
    from: 6,
    to: 24,
    doorSide: 1,
    doors: [[10.6, 19.2]],
    glass: [
      [6, 10.4],
      [19.4, 24],
    ],
  });

  /* ------------------------------------------------------------ techo */

  layout.buildCeilingRect(-25.6, -25.6, 25.6, 23.6, 3.2, 'ceiling', { thickness: 0.55, surface: 'stone' });

  /* --------------------------------------------- ambiente y exteriores */

  builder.addRaw('concreteFloor', makeQuad(-140, -140, 140, 140, -0.12, 8, true));
  builder.addEnvironment(ambient);
  builder.addSky(ambient, { radius: 185, sunSize: 6.5 });
  builder.addClouds(8, 17);

  // Estacionamiento / calle visible por los ventanales
  addVehicle(builder, 27.3, 13, 0.02);
  addVehicle(builder, 27.2, 19.5, 0.02, 'metal');
  addVehicle(builder, 12.5, 25.6, Math.PI / 2);
  addVehicle(builder, 18.5, 25.7, Math.PI / 2, 'metal');
  builder.box('metalDark', 27.8, 2.5, 8, 0.12, 5, 0.12, {});
  builder.box('metalDark', 27.8, 5.1, 8, 1.0, 0.14, 0.3, {});
  builder.box('lampPanel', 27.8, 5.02, 8, 0.6, 0.06, 0.2, {});
  for (let i = 0; i < 4; i++) {
    addRock(builder, -34 - i * 3, 24 + i * 2, 1.2 + i * 0.2, 130 + i);
  }
  addBush(builder, 26.8, 23, 1.2, 137);
  addBush(builder, -26, 25, 1.3, 139);

  /* ------------------------------------------------- iluminación interior */

  const lampPositions = [
    [-16, 0],
    [-4, 0],
    [8, 0],
    [18, 0],
    [10, 9],
    [17, 16],
    [-2, -13],
    [16, -13],
    [-18, -13],
    [-15, 12],
    [0, 12],
  ];
  for (const [lx, lz] of lampPositions) {
    builder.box('lampPanel', lx, 3.16, lz, 1.6, 0.06, 0.5, { uvFit: true });
    builder.box('metal', lx, 3.2, lz, 1.72, 0.03, 0.6, { uvFit: true });
  }
  const pointLights = [
    [-8, 2.86, 0],
    [10, 2.86, 0],
    [18, 2.86, 0],
    [15, 2.86, 12],
    [-2, 2.86, -13],
    [16, 2.86, -13],
    [-18, 2.86, -13],
  ];
  for (const [lx, ly, lz] of pointLights) builder.addPointLight(lx, ly, lz, 0xffe0b0, 9, 13, 1.7);

  /* ------------------------------------------------------------- garaje */

  // portón metálico enrollable (decorativo) en el muro norte
  for (let i = 0; i < 11; i++) {
    builder.box(i % 2 ? 'metal' : 'metalDark', -18, 0.16 + i * 0.245, -23.7, 8.0, 0.23, 0.12, { uvFit: true });
  }
  builder.box('metalDark', -18, 2.78, -23.7, 8.4, 0.28, 0.2, { uvFit: true });
  builder.addSign('GARAGE', { x: -18, y: 2.95, z: -23.4, ry: 0, w: 2.2, h: 0.6, bg: '#2b2f31', fg: '#c9d3d8' });
  addCrateStack(builder, -22.4, -22.2, 1.25, { count: 3, ry: 0.1 });
  addCrate(builder, -22.6, -20.4, 0.95, { ry: -0.2 });
  addBarrel(builder, -13.1, -22.4, { mat: 'barrelB' });
  addBarrel(builder, -13.2, -21.2, { mat: 'barrelA' });
  addShelf(builder, -22.8, -6.5, { ry: Math.PI / 2 });
  addCabinet(builder, -13.2, -6.4, { ry: 0 });
  addCrate(builder, -12.9, -8.4, 1.0, { ry: 0.2 });

  /* -------------------------------------------------------- oficina grande */

  for (const dx of [-7, -2.5, 2]) {
    addDesk(builder, dx, -9, { papers: dx === -2.5, monitor: true });
    addChair(builder, dx, -8.2, 0);
    addDesk(builder, dx, -17, { papers: dx === 2, monitor: true });
    addChair(builder, dx, -17.8, Math.PI);
  }
  addCabinet(builder, -8.6, -23.3);
  addCabinet(builder, -6.6, -23.3);
  addShelf(builder, 5.2, -21.4, { ry: -Math.PI / 2 });
  addPlant(builder, -9.1, -4.6, 1.0);
  addPlant(builder, 5.2, -4.8, 1.0);
  builder.box('board', 5.72, 1.7, -15, 0.06, 1.1, 1.9, { uvFit: true, surface: 'wood' });
  builder.addSign('OFFICE', { x: -2.5, y: 2.92, z: -2.75, ry: 0, w: 1.9, h: 0.6, bg: '#243427', fg: '#d9e3cf' });

  /* ---------------------------------------------------- sala de conferencias */

  builder.box('wood', 15, 0.74, -14, 4.6, 0.09, 1.5, { uvFit: true, collider: true, surface: 'wood' });
  for (const [tx, tz] of [
    [13.4, -14],
    [15, -14],
    [16.6, -14],
  ]) {
    builder.box('metalDark', tx, 0.36, tz, 0.1, 0.72, 0.1, {});
  }
  addChair(builder, 13.6, -12.9, 0);
  addChair(builder, 15, -12.9, 0);
  addChair(builder, 16.4, -12.9, 0);
  addChair(builder, 13.6, -15.1, Math.PI);
  addChair(builder, 15, -15.1, Math.PI);
  addChair(builder, 16.4, -15.1, Math.PI);
  addMonitor(builder, 15.6, -14, 0.79, 0);
  builder.box('board', 23.72, 1.75, -14, 0.06, 1.2, 2.2, { uvFit: true, surface: 'wood' });
  addCabinet(builder, 22.7, -22.6);
  addCabinet(builder, 21.4, -22.6);
  addPlant(builder, 22.9, -4.6, 1.1);
  addVending(builder, 22.7, -6.4, Math.PI / 2);
  builder.addSign('CONFERENCE', {
    x: 15.5,
    y: 2.92,
    z: -2.75,
    ry: 0,
    w: 2.4,
    h: 0.6,
    bg: '#242a33',
    fg: '#c3d2e0',
  });

  /* ------------------------------------------------------- sala de descanso */

  builder.box('wood', -15, 0.74, 11, 2.6, 0.09, 1.3, { uvFit: true, collider: true, surface: 'wood' });
  for (const [tx, tz] of [
    [-16, 11],
    [-14, 11],
  ]) {
    builder.box('metalDark', tx, 0.36, tz, 0.1, 0.72, 0.1, {});
  }
  addChair(builder, -16, 12.1, 0);
  addChair(builder, -14, 12.1, 0);
  addChair(builder, -16, 9.9, Math.PI);
  addChair(builder, -14, 9.9, Math.PI);
  // barra / kitchenette
  builder.box('woodDark', -18, 0.45, 20.8, 8.0, 0.9, 0.7, { uvFit: true, collider: true, surface: 'wood' });
  builder.box('metal', -18, 0.93, 20.8, 8.1, 0.06, 0.8, { uvFit: true });
  builder.box('metalDark', -20.6, 1.22, 20.8, 0.5, 0.52, 0.44, { uvFit: true });
  builder.box('screen', -20.6, 1.25, 20.55, 0.34, 0.3, 0.02, { uvFit: true });
  addFridge(builder, -22.2, 19.4, Math.PI / 2);
  addPlant(builder, -7.2, 4.2, 1.0);
  builder.addSign('BREAK ROOM', {
    x: -18.5,
    y: 2.92,
    z: 3.25,
    ry: Math.PI,
    w: 2.6,
    h: 0.6,
    bg: '#332a24',
    fg: '#e0cfae',
  });

  /* -------------------------------------------------------- oficina chica */

  addDesk(builder, 0, 9, { papers: true, monitor: true });
  addChair(builder, 0, 10, Math.PI);
  addShelf(builder, 3.55, 6.4, { ry: -Math.PI / 2 });
  addCabinet(builder, -3.4, 20.4);
  addPlant(builder, -3.4, 4.2, 0.9);
  addWaterCooler(builder, 3.4, 17.5);

  /* --------------------------------------------------------- lobby / CT */

  // mostrador de recepción
  builder.box('wood', 11.4, 1.03, 9.4, 3.4, 0.1, 0.8, { uvFit: true, collider: true, surface: 'wood' });
  builder.box('woodDark', 11.4, 0.5, 9.4, 3.3, 0.96, 0.7, { uvFit: true, collider: true, surface: 'wood' });
  builder.box('metal', 11.4, 1.09, 9.4, 3.5, 0.04, 0.9, { uvFit: true });
  addMonitor(builder, 12.2, 9.2, 1.1, Math.PI);
  builder.addSign('RECEPTION', { x: 11.4, y: 2.5, z: 8.6, ry: 0, w: 2.2, h: 0.55, bg: '#2a2a2a', fg: '#d8cba8' });
  // columnas
  for (const cx of [8.6, 21.4]) {
    builder.box('plasterTrim', cx, 1.6, 6.4, 0.54, 3.2, 0.54, { collider: true, surface: 'stone' });
    builder.box('trim', cx, 3.12, 6.4, 0.72, 0.16, 0.72, {});
    builder.box('trim', cx, 0.1, 6.4, 0.68, 0.2, 0.68, {});
  }
  addSofa(builder, 20.9, 20.1, 0);
  builder.box('wood', 20.9, 0.38, 18.4, 1.5, 0.08, 0.9, { uvFit: true, collider: true, surface: 'wood' });
  builder.box('metalDark', 20.9, 0.18, 18.4, 1.2, 0.36, 0.6, {});
  addPlant(builder, 7.2, 20.2, 1.2);
  addPlant(builder, 22.6, 20.4, 1.1);
  addPlant(builder, 7.2, 4.4, 1.0);
  builder.addDecal(rescueZoneDecalTexture(), { x: 17, z: 15, size: 9, name: 'rescue-zone' });
  builder.addSign('RESCUE', {
    x: 23.68,
    y: 2.86,
    z: 4.2,
    ry: -Math.PI / 2,
    w: 2.0,
    h: 0.7,
    bg: '#173323',
    fg: '#7ef0a2',
    border: '#2f6b48',
  });
  builder.addSign('EXIT', {
    x: 23.68,
    y: 2.55,
    z: 19,
    ry: -Math.PI / 2,
    w: 1.2,
    h: 0.5,
    bg: '#12351f',
    fg: '#8cf7b0',
    border: '#2f7a4c',
  });
  addCabinet(builder, 23.3, 8.8, { ry: Math.PI / 2 });
  addWaterCooler(builder, 7.4, 12.4);
  builder.addSign('LOBBY', { x: 17, y: 2.92, z: 21.7, ry: Math.PI, w: 1.9, h: 0.55, bg: '#252b31', fg: '#cfdbe4' });

  /* --------------------------------------------------------- pasillo */

  addPlant(builder, -22.9, -2.2, 1.0);
  addPlant(builder, 22.9, 2.2, 0.9);
  addWaterCooler(builder, -23.2, 2.2);
  builder.addSign('← OFFICE', {
    x: -16,
    y: 2.62,
    z: -2.72,
    ry: 0,
    w: 2.4,
    h: 0.55,
    bg: '#2a2926',
    fg: '#d4c9a8',
  });
  builder.addCable(-24, 3.05, 0, 24, 3.05, 0, { sag: 0.12 });

  /* ------------------------------------------- collider de suelo global */

  builder.addCollider(bounds.minX, -1, bounds.minZ, bounds.maxX, 0, bounds.maxZ, 'stone');

  /* ------------------------------------------------------------ waypoints */

  const regions = [
    { name: 'Main Hall', minX: -25, maxX: 25, minZ: -4, maxZ: 4, tags: [] },
    { name: 'Lobby', minX: 5, maxX: 25, minZ: 2, maxZ: 23, tags: ['CT'] },
    { name: 'Rescue Zone', minX: 12, maxX: 22, minZ: 10, maxZ: 20, tags: ['rescue', 'CT', 'defend'] },
    { name: 'Big Office', minX: -11, maxX: 7, minZ: -25, maxZ: -2, tags: ['hostage', 'defend'] },
    { name: 'Conference Room', minX: 7, maxX: 25, minZ: -25, maxZ: -2, tags: ['hostage', 'defend'] },
    { name: 'Garage', minX: -25, maxX: -11, minZ: -25, maxZ: -2, tags: ['T'] },
    { name: 'Break Room', minX: -25, maxX: -5, minZ: 2, maxZ: 23, tags: ['defend'] },
    { name: 'Small Office', minX: -5, maxX: 5, minZ: 2, maxZ: 23, tags: ['defend'] },
  ];

  const extra = [
    { x: -18, z: -12, tags: ['T'] },
    { x: -18.5, z: -3, tags: ['T'] },
    { x: -2.5, z: -3, tags: ['hostage'] },
    { x: 15.5, z: -3, tags: ['hostage'] },
    { x: -18.5, z: 3, tags: ['defend'] },
    { x: -1.3, z: 3, tags: ['defend'] },
    { x: 15, z: 3, tags: ['CT'] },
    { x: 0, z: 0, tags: ['CT'] },
    { x: -6.5, z: -13, tags: ['hostage'] },
    { x: 10, z: -12, tags: ['hostage'] },
    { x: 17, z: 15, tags: ['rescue', 'CT', 'defend'] },
    { x: 14, z: 16, tags: ['CT', 'rescue'] },
    { x: -20, z: 14, tags: ['defend'] },
    { x: 2, z: 13, tags: ['defend'] },
    { x: 21, z: 7.5, tags: ['CT'] },
    { x: -20.5, z: -17, tags: ['T'] },
    { x: 2, z: -20, tags: ['hostage'] },
    { x: 17, z: -20, tags: ['hostage'] },
    { x: -12, z: 0, tags: ['CT'] },
  ];
  builder.buildSpatialIndex();
  const waypoints = generateWaypoints(builder, layout, {
    bounds,
    spacing: 2.35,
    clearance: 0.44,
    maxLink: 4.7,
    extra,
    regions,
  });

  /* --------------------------------------------------------------- salida */

  const spawnFace = (x, z, yaw) => ({ x, y: 0.05, z, yaw });
  const spawns = {
    T: [
      spawnFace(-21, -8, 180),
      spawnFace(-17.5, -8, 180),
      spawnFace(-14, -8, 180),
      spawnFace(-21, -11.5, 180),
      spawnFace(-17.5, -11.5, 180),
      spawnFace(-14, -11.5, 180),
      spawnFace(-21, -15, 180),
      spawnFace(-17.5, -15, 180),
    ],
    CT: [
      spawnFace(9.5, 16.5, 0),
      spawnFace(12.5, 16.5, 0),
      spawnFace(15.5, 16.5, 0),
      spawnFace(18.5, 16.5, 0),
      spawnFace(9.5, 19.5, 0),
      spawnFace(12.5, 19.5, 0),
      spawnFace(15.5, 19.5, 0),
      spawnFace(18.5, 19.5, 0),
    ],
  };

  const buyZones = {
    T: { min: { x: -24, z: -23 }, max: { x: -12, z: -4 } },
    CT: { min: { x: 6, z: 4 }, max: { x: 24, z: 21 } },
  };

  const hostageSpawns = [
    { id: 'hostage-1', x: -6.5, z: -13 },
    { id: 'hostage-2', x: 10, z: -12 },
  ];

  const rescueZone = { x: 17, z: 15, radius: 3.4 };

  const callouts = regions.map((r) => ({
    name: r.name,
    min: { x: r.minX, z: r.minZ },
    max: { x: r.maxX, z: r.maxZ },
  }));

  return {
    id: info.id,
    name: info.name,
    displayName: info.displayName,
    mode: info.mode,
    description: info.description,
    spawns,
    buyZones,
    bombsites: [],
    hostageSpawns,
    rescueZone,
    waypoints,
    callouts,
    bounds,
    ambient,
    menuCamera: {
      pos: { x: 17.5, y: 2.56, z: 19.6 },
      lookAt: { x: 4, y: 1.15, z: -7 },
    },
  };
}

/* ============================================================================
 * buildMap — entrada del contrato
 * ========================================================================== */

export function buildMap(game, mapId) {
  const info = MAPS[mapId] || MAPS.de_dust2;
  const materialSet = createMaterialSet(info.id);
  const builder = new MapBuilder(info.id, materialSet, hashString(info.id));

  let data;
  try {
    data = info.id === 'cs_office' ? buildOffice(builder, info) : buildDust2(builder, info);
    builder.finalize();
  } catch (err) {
    materialSet.dispose();
    throw err;
  }

  // Métricas de rendimiento
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
      `Mapa ${info.id}: ${stats.triangles} tris · ${stats.drawCalls} draw calls · ` +
        `${stats.colliders} colliders · ${stats.waypoints} waypoints · ${stats.links} links`,
    );
  }
  return data;
}


