/**
 * ASSAULT · ARENA 1v1
 *
 * Mapa original inspirado en cs_assault: almacén industrial con pasarela,
 * oficina elevada, contenedores y patio exterior. Usa texturas WAD originales
 * de cs_assault.wad / cs_office.wad.
 *
 * No es el BSP original de Valve: es un layout propio pensado para duelos 1v1,
 * con dos spawns enfrentados, cobertura media y una pasarela elevada.
 */
import * as THREE from '../../vendor/three.module.js';
import { ArenaBuilder } from './aim_map.js';
import { createMaterialSet, disposeMaterial } from './textures.js';

export const ASSAULT_MAP_INFO = {
  id: 'cs_assault',
  name: 'ASSAULT · ARENA 1V1',
  displayName: 'ASSAULT · 1v1',
  mode: 'aim',
  description: 'Almacén industrial inspirado en cs_assault, con pasarela y patio.',
};

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function spawnFace(x, z, yaw) {
  return { x, z, y: 0.05, yaw };
}

function wallWithDoor(b, mat, x1, z1, x2, z2, y1, y2, door) {
  // Divide una pared recta en dos tramos dejando un hueco central.
  const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1);
  const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  const mid = horizontal ? (x1 + x2) / 2 : (z1 + z2) / 2;
  const half = len / 2;
  const gap = door / 2;
  if (horizontal) {
    b.boxMM(mat, x1, y1, z1, mid - gap, y2, z2, { uvFit: true, collider: true, surface: 'stone' });
    b.boxMM(mat, mid + gap, y1, z1, x2, y2, z2, { uvFit: true, collider: true, surface: 'stone' });
    // dintel
    b.boxMM(mat, mid - gap, y2 - 0.7, z1, mid + gap, y2, z2, { uvFit: true });
  } else {
    b.boxMM(mat, x1, y1, z1, x2, y2, mid - gap, { uvFit: true, collider: true, surface: 'stone' });
    b.boxMM(mat, x1, y1, mid + gap, x2, y2, z2, { uvFit: true, collider: true, surface: 'stone' });
    b.boxMM(mat, x1, y2 - 0.7, mid - gap, x2, y2, mid + gap, { uvFit: true });
  }
}

function buildArena(b) {
  const B = { minX: -25, maxX: 25, minZ: -25, maxZ: 25 };

  /* ---------------------------------------------------------------- piso */
  b.boxMM('concreteFloor', B.minX, -1.2, B.minZ, B.maxX, 0, B.maxZ, {
    collider: true, surface: 'stone',
  });

  /* ------------------------------------------------------------- perímetro */
  const H = 8.5;
  b.boxMM('concreteWall', B.minX - 1, 0, B.minZ - 1, B.minX, H, B.maxZ + 1, { uvFit: true, collider: true });
  b.boxMM('concreteWall', B.maxX, 0, B.minZ - 1, B.maxX + 1, H, B.maxZ + 1, { uvFit: true, collider: true });
  b.boxMM('concreteWall', B.minX, 0, B.minZ - 1, B.maxX, H, B.minZ, { uvFit: true, collider: true });
  b.boxMM('concreteWall', B.minX, 0, B.maxZ, B.maxX, H, B.maxZ + 1, { uvFit: true, collider: true });

  // Vigas y techo parcial del perímetro (deja ver el cielo en el patio).
  for (let x = -24; x <= 24; x += 8) {
    b.boxMM('metalDark', x - 0.16, H - 0.7, -25, x + 0.16, H, 9, { uvFit: true });
  }

  /* --------------------------------------------------------- almacén central */
  // Muro norte del almacén (fondo del spawn T)
  b.boxMM('concreteWall', -14, 0, -18, 14, 7.2, -17, { uvFit: true, collider: true });
  // Muro sur con portón principal
  wallWithDoor(b, 'concreteWall', -14, 8, 14, 8.6, 0, 7.2, 6);
  // Muros laterales con aberturas
  wallWithDoor(b, 'brickWall', -14, -17, -13.4, 8, 0, 7.2, 3.2);
  wallWithDoor(b, 'brickWall', 13.4, -17, 14, 8, 0, 7.2, 3.2);

  // Oficina elevada dentro del almacén (oeste)
  b.boxMM('metalDark', -13.4, 3.1, -13, -9.5, 3.45, -3, { uvFit: true, collider: true, surface: 'metal' });
  b.boxMM('concreteWall', -13.4, 3.45, -13, -9.5, 7.2, -12.4, { uvFit: true, collider: true });
  b.boxMM('concreteWall', -13.4, 3.45, -3.6, -9.5, 7.2, -3, { uvFit: true, collider: true });
  b.boxMM('metalDark', -9.7, 3.45, -13, -9.5, 4.4, -8, { uvFit: true, collider: true });
  // baranda
  b.boxMM('metal', -9.4, 3.45, -13, -9.25, 4.35, -3.2, { uvFit: true, collider: true });

  // Pasarela este (catwalk)
  b.boxMM('metalDark', 8.8, 3.35, -16.6, 12.6, 3.65, 6.2, { uvFit: true, collider: true, surface: 'metal' });
  b.boxMM('metal', 8.6, 3.65, -16.6, 8.8, 4.55, 6.2, { uvFit: true, collider: true });
  // escalera a la pasarela
  for (let i = 0; i < 10; i++) {
    const z = 6.2 + i * 0.55;
    const y = 0.35 + i * 0.34;
    b.boxMM('metal', 9.6, y - 0.17, z, 11.8, y, z + 0.45, { uvFit: true, collider: true, surface: 'metal' });
  }

  // Cajas de cobertura (interior y patio)
  const crates = [
    [-6, -10, 2.1], [4, -9, 1.7], [0, -4, 2.4], [-7, 2, 1.8], [7, 1, 2.2],
    [-17, -14, 2.0], [17, -14, 1.6], [-18, 12, 2.2], [18, 13, 1.8],
    [0, 20, 2.0], [-7, 17, 1.5], [7, 17, 1.5],
  ];
  // El spawn CT debe quedar despejado: movemos la caja central del patio.
  crates[crates.length - 3] = [12, 20, 2.0];
  for (const [x, z, s] of crates) {
    b.boxMM('crate', x - s / 2, 0, z - s / 2, x + s / 2, s, z + s / 2, {
      uvFit: true, collider: true, surface: 'wood',
    });
  }

  // Contenedores del patio
  b.boxMM('metalDark', -24, 0, 13, -18, 3.0, 19, { uvFit: true, collider: true, surface: 'metal' });
  b.boxMM('metalDark', 18, 0, 12, 24, 3.0, 18, { uvFit: true, collider: true, surface: 'metal' });
  b.boxMM('metalDark', -24, 0, -23, -18, 3.0, -17, { uvFit: true, collider: true, surface: 'metal' });

  // Barriles y cajas pequeñas
  for (const [x, z] of [[-16, 4], [15, -4], [5, 14], [-11, 13], [19, -6]]) {
    b.cylinder('barrelA', x, 0.55, z, 0.42, 0.46, 1.1, 10, { collider: true });
    b.cylinder('metalDark', x, 1.13, z, 0.43, 0.43, 0.06, 10, {});
  }

  // Lámparas industriales (interior)
  for (const [x, z] of [[-5, -8], [5, -8], [0, 3]]) {
    b.boxMM('metalDark', x - 0.1, 6.6, z - 0.1, x + 0.1, 7.2, z + 0.1, {});
    b.boxMM('lampPanel', x - 0.8, 6.35, z - 0.35, x + 0.8, 6.6, z + 0.35, { uvFit: true });
    const light = new THREE.PointLight(0xffd9a0, 9, 15, 1.6);
    light.position.set(x, 6.1, z);
    b.root.add(light);
    b.lights.push(light);
  }
  // Refuerzo de luz en el portón para que el interior no quede a negro.
  const doorLight = new THREE.PointLight(0xffe6bf, 5, 14, 1.7);
  doorLight.position.set(0, 4.5, 7);
  b.root.add(doorLight);
  b.lights.push(doorLight);

  // Letreros
  b.addSign('ASSAULT', { x: 0, y: 5.1, z: -16.98, w: 5.2, h: 1.3, bg: '#191b18', fg: '#e1b45c', border: '#7b5a25', sub: 'SECTOR 7' });
  b.addSign('CARGO', { x: 14.02, y: 5.2, z: -8, ry: Math.PI / 2, w: 2.6, h: 0.9, bg: '#25251f', fg: '#d7c9a0', border: '#6e5c33' });

  /* ------------------------------------------------------------- waypoints */
  const waypoints = [];
  const ids = new Map();
  const addWp = (x, z, tags = []) => {
    if (!b.isFree(x, z, 0.55, 0.05, 1.8)) return null;
    const id = waypoints.length;
    const wp = { id, x, z, y: 0.05, tags, links: [] };
    waypoints.push(wp);
    ids.set(`${x.toFixed(1)},${z.toFixed(1)}`, wp);
    return wp;
  };

  for (let x = -21; x <= 21; x += 4.2) {
    for (let z = -21; z <= 21; z += 4.2) {
      const tags = [];
      if (x < -12 && z < -3) tags.push('office');
      if (x > 8 && z < 7) tags.push('catwalk');
      if (Math.abs(z) > 14) tags.push('yard');
      if (Math.abs(z) < 9 && Math.abs(x) < 13) tags.push('warehouse');
      addWp(x, z, tags);
    }
  }
  // Conectar nodos cercanos con línea de vista libre.
  for (const a of waypoints) {
    for (const c of waypoints) {
      if (a === c || a.links.length >= 4) continue;
      const d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d > 6.2) continue;
      if (!b.segmentClear(a.x, a.z, c.x, c.z, 0.42, 0.45)) continue;
      if (!a.links.includes(c.id)) a.links.push(c.id);
      if (!c.links.includes(a.id)) c.links.push(a.id);
    }
  }

  return {
    bounds: B,
    ambient: {
      skyTop: 0x6b7c8b,
      skyBottom: 0xb6a889,
      sunColor: 0xffe2b3,
      sunIntensity: 1.5,
      hemiColor: 0x8fa4b8,
      hemiGround: 0x4c443b,
      hemiIntensity: 0.7,
      ambientColor: 0x6a6f78,
      ambientIntensity: 0.5,
      sunDir: { x: 0.45, y: 0.78, z: 0.35 },
    },
    spawns: {
      CT: [spawnFace(0, 22, 0), spawnFace(-4, 22, 0), spawnFace(4, 22, 0), spawnFace(-8, 20, 0)],
      T: [spawnFace(0, -13, 180), spawnFace(-4, -13, 180), spawnFace(4, -13, 180), spawnFace(-8, -11, 180)],
    },
    waypoints,
    callouts: [
      { name: 'CT Yard', min: { x: -10, z: 17 }, max: { x: 10, z: 24 } },
      { name: 'T Warehouse', min: { x: -12, z: -16 }, max: { x: 12, z: -5 } },
      { name: 'Catwalk', min: { x: 8, z: -16 }, max: { x: 13, z: 6 } },
      { name: 'Office', min: { x: -13, z: -13 }, max: { x: -9, z: -3 } },
      { name: 'Main Door', min: { x: -3, z: 6 }, max: { x: 3, z: 10 } },
      { name: 'Containers', min: { x: 17, z: 11 }, max: { x: 24, z: 19 } },
    ],
  };
}

export function buildAssaultMap(game) {
  const info = ASSAULT_MAP_INFO;
  const materialSet = createMaterialSet('cs_assault');
  const builder = new ArenaBuilder(info.id, materialSet, hashString(info.id));

  let data;
  try {
    data = buildArena(builder);
    builder.addEnvironment(data.ambient);
    builder.addSky(data.ambient);
    builder.finalize();
  } catch (err) {
    materialSet.dispose();
    throw err;
  }

  let triangles = 0;
  let drawCalls = 0;
  builder.root.traverse((obj) => {
    if (!obj.isMesh && !obj.isLine) return;
    drawCalls++;
    const geom = obj.geometry;
    if (!geom) return;
    triangles += geom.index ? geom.index.count / 3 : (geom.attributes.position?.count || 0) / 3;
  });

  const stats = {
    triangles: Math.round(triangles),
    drawCalls,
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
  data.id = info.id;
  data.name = info.name;
  data.displayName = info.displayName;
  data.mode = info.mode;
  data.description = info.description;
  data.buyZones = {
    CT: { min: { x: -10, z: 17 }, max: { x: 10, z: 24 } },
    T: { min: { x: -10, z: -16 }, max: { x: 10, z: -6 } },
  };
  data.bombsites = [];
  data.hostageSpawns = [];
  data.rescueZone = null;
  data.menuCamera = { pos: { x: 19, y: 11, z: 21 }, lookAt: { x: 0, y: 1.2, z: -3 } };

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
    game.log(`Mapa ${info.id}: ${stats.triangles} tris · ${stats.drawCalls} draw calls · ${stats.colliders} colliders · ${stats.waypoints} waypoints`);
  }
  return data;
}
