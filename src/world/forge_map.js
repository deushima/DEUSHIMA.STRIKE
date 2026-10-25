/**
 * AIM_FORGE · compact open-air training yard for 1v1 / 2v2.
 *
 * The layout uses 180-degree symmetry, a solid central freight stack that
 * blocks every spawn-to-spawn opening angle, and two equivalent side routes.
 * Visual detail stays procedural and reuses the project's existing materials.
 */
import * as THREE from '../../vendor/three.module.js';
import { ArenaBuilder } from './aim_map.js';
import { createMaterialSet, disposeMaterial } from './textures.js';

export const FORGE_MAP_INFO = Object.freeze({
  id: 'aim_forge',
  name: 'aim_forge',
  displayName: 'AIM_FORGE',
  mode: 'aim',
  description: 'Patio industrial compacto con dos rutas laterales equilibradas.',
});

const BOUNDS = Object.freeze({ minX: -13.5, maxX: 13.5, minZ: -15.5, maxZ: 15.5 });
const EYE_HEIGHT = 1.62;

function addCrate(b, x, z, size = 1.55, height = size) {
  b.box('crate', x, height / 2, z, size, height, size, {
    uvFit: true,
    collider: true,
    surface: 'wood',
  });
}

function addFreightBlock(b, x, z, w = 4.8, d = 2.7, h = 2.35) {
  b.box('metalDark', x, h / 2, z, w, h, d, {
    uvFit: true,
    collider: true,
    surface: 'metal',
  });
  b.box('metal', x, h - 0.08, z, w + 0.08, 0.12, d + 0.08, { uvFit: true });
  for (const sx of [-1, 1])
    b.box('trim', x + sx * (w / 2 - 0.12), h / 2, z, 0.11, h - 0.18, d + 0.04, { uvFit: true });
}

function addLampPost(b, x, z, warm = true) {
  b.box('metalDark', x, 2.65, z, 0.18, 5.3, 0.18, { uvFit: true });
  b.box('metal', x, 5.22, z, 1.25, 0.14, 0.2, { uvFit: true });
  b.box('lampPanel', x, 5.08, z, 0.82, 0.08, 0.48, { uvFit: true });
  const light = new THREE.PointLight(warm ? 0xffc982 : 0xc7ddff, 4.2, 12, 1.8);
  light.position.set(x, 4.9, z);
  b.root.add(light);
  b.lights.push(light);
}

function buildArena(b) {
  // Ground and perimeter. Low walls keep the open sky visible while preserving
  // compact duel bounds.
  b.box('concreteFloor', 0, -0.32, 0, 27, 0.64, 31, { collider: true, surface: 'stone' });
  b.box('stoneDark', -13.28, 2.5, 0, 0.44, 5, 31, { uvFit: true, collider: true });
  b.box('stoneDark', 13.28, 2.5, 0, 0.44, 5, 31, { uvFit: true, collider: true });
  b.box('concreteWall', 0, 2.5, -15.28, 27, 5, 0.44, { uvFit: true, collider: true });
  b.box('concreteWall', 0, 2.5, 15.28, 27, 5, 0.44, { uvFit: true, collider: true });

  // Central freight stack. Its continuous width covers every midpoint between
  // the four CT and four T spawn x positions, so no opening spawn shot exists.
  for (const x of [-4.6, 0, 4.6]) addFreightBlock(b, x, 0);
  addCrate(b, -6.1, -2.55, 1.35, 1.35);
  addCrate(b, 6.1, 2.55, 1.35, 1.35);
  addCrate(b, 6.1, -2.55, 1.35, 1.35);
  addCrate(b, -6.1, 2.55, 1.35, 1.35);

  // Mirrored route cover: each side gets the same sequence and distance from
  // its spawn, preserving equal timing for left/right peeks.
  for (const sign of [-1, 1]) {
    addCrate(b, sign * 9.6, -5.7, 1.65, 1.75);
    addCrate(b, sign * 9.6, 5.7, 1.65, 1.75);
    b.box('metal', sign * 6.8, 1.05, -8.2, 3.4, 2.1, 1.05, {
      uvFit: true, collider: true, surface: 'metal',
    });
    b.box('metal', -sign * 6.8, 1.05, 8.2, 3.4, 2.1, 1.05, {
      uvFit: true, collider: true, surface: 'metal',
    });
  }

  // Side service frames and lighting add depth without changing collision or
  // combat timing. They echo the small, polished training-yard feel.
  for (const x of [-11.5, 11.5]) {
    for (const z of [-10.5, 0, 10.5]) {
      b.box('metalDark', x, 3.35, z, 0.16, 6.7, 0.16, { uvFit: true });
      b.box('metalDark', x, 6.55, z, 2.5, 0.14, 0.18, { uvFit: true });
    }
  }
  addLampPost(b, -10.7, -11.1, true);
  addLampPost(b, 10.7, 11.1, true);
  addLampPost(b, 10.7, -11.1, false);
  addLampPost(b, -10.7, 11.1, false);
  b.addCable(-11.5, 6.5, -10.5, -11.5, 6.5, 10.5, { sag: 0.65, segments: 12 });
  b.addCable(11.5, 6.5, -10.5, 11.5, 6.5, 10.5, { sag: 0.65, segments: 12 });

  b.addSign('FORGE', {
    x: 0, y: 3.65, z: -15.04, w: 4.6, h: 1.05,
    bg: '#1b2024', fg: '#f4bd62', border: '#75552b', sub: 'TRAINING YARD',
  });
  b.addSign('AIM', {
    x: 13.03, y: 3.3, z: 0, ry: -Math.PI / 2, w: 2.4, h: 0.82,
    bg: '#20262b', fg: '#cadcf0', border: '#556779', sub: 'SECTOR 04',
  });
}

function makeWaypoints(b) {
  const points = [];
  for (let z = -12.6; z <= 12.6; z += 2.8) {
    for (let x = -11.2; x <= 11.2; x += 2.8) {
      if (b.isFree(x, z, 0.46, 0.06, 1.8))
        points.push({ id: points.length, x, y: 0.05, z, links: [], tags: [] });
    }
  }
  for (const a of points) for (const c of points) {
    if (a.id >= c.id || Math.hypot(a.x - c.x, a.z - c.z) > 4.1) continue;
    if (b.segmentClear(a.x, a.z, c.x, c.z, 0.38, 0.35)) {
      a.links.push(c.id);
      c.links.push(a.id);
    }
  }

  // Keep the largest connected navigation component. Tiny pockets behind
  // cover remain valid player space but should not become isolated bot goals.
  const byId = new Map(points.map(p => [p.id, p]));
  const components = [];
  const seen = new Set();
  for (const start of points) {
    if (seen.has(start.id)) continue;
    const component = [];
    const queue = [start];
    seen.add(start.id);
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      component.push(node);
      for (const id of node.links) if (!seen.has(id)) {
        seen.add(id);
        queue.push(byId.get(id));
      }
    }
    components.push(component);
  }
  const connected = components.sort((a, c) => c.length - a.length)[0] || [];
  const reindex = new Map(connected.map((point, id) => [point.id, id]));
  return connected.map((point, id) => ({
    ...point,
    id,
    links: point.links.filter(link => reindex.has(link)).map(link => reindex.get(link)),
  }));
}

function assertSpawnSafety(b, spawns) {
  for (const team of ['CT', 'T']) for (const spawn of spawns[team]) {
    if (!b.isFree(spawn.x, spawn.z, 0.5, 0.06, 1.8))
      throw new Error(`Spawn ${team} obstruido: ${spawn.x},${spawn.z}`);
  }

  for (const ct of spawns.CT) for (const t of spawns.T) {
    const start = new THREE.Vector3(ct.x, EYE_HEIGHT, ct.z);
    const end = new THREE.Vector3(t.x, EYE_HEIGHT, t.z);
    const delta = end.clone().sub(start);
    const ray = new THREE.Ray(start, delta.clone().normalize());
    const blocked = b.colliders.some(collider => {
      if (collider.min.y >= EYE_HEIGHT || collider.max.y <= EYE_HEIGHT) return false;
      const hit = ray.intersectBox(collider, new THREE.Vector3());
      return hit && hit.distanceTo(start) < delta.length() - 0.1;
    });
    if (!blocked) throw new Error(`Sightline inicial sin cobertura: CT ${ct.x} / T ${t.x}`);
  }
}

export function buildForgeMap(game) {
  const materials = createMaterialSet('cs_assault');
  const b = new ArenaBuilder(FORGE_MAP_INFO.id, materials, 0x464f5247);
  let data;
  try {
    buildArena(b);
    const ambient = {
      skyTop: 0x557a9e,
      skyBottom: 0xd8ad78,
      sunColor: 0xffd29a,
      sunIntensity: 1.55,
      hemiColor: 0xa8c3dc,
      hemiGround: 0x4a443c,
      hemiIntensity: 0.78,
      ambientColor: 0x747a82,
      ambientIntensity: 0.46,
      sunDir: { x: -0.38, y: 0.82, z: 0.31 },
    };
    b.addEnvironment(ambient);
    b.addSky(ambient, { radius: 120, sunSize: 5.2 });
    b.addClouds(5, 0x464f5247);
    b.finalize();

    const spawns = {
      CT: [-6, -2, 2, 6].map(x => ({ x, y: 0.05, z: 12.8, yaw: 0 })),
      T: [-6, -2, 2, 6].map(x => ({ x, y: 0.05, z: -12.8, yaw: 180 })),
    };
    assertSpawnSafety(b, spawns);
    const waypoints = makeWaypoints(b);

    data = {
      ...FORGE_MAP_INFO,
      bounds: BOUNDS,
      ambient: { ...ambient, fog: 0xb7a58f, fogNear: 38, fogFar: 100 },
      root: b.root,
      colliders: b.colliders,
      spawns,
      waypoints,
      buyZones: {
        CT: { min: { x: -10, z: 10.7 }, max: { x: 10, z: 14.7 } },
        T: { min: { x: -10, z: -14.7 }, max: { x: 10, z: -10.7 } },
      },
      bombsites: [],
      hostageSpawns: [],
      rescueZone: null,
      callouts: [
        { name: 'CT Yard', min: { x: -13.5, z: 9.5 }, max: { x: 13.5, z: 15.5 } },
        { name: 'T Yard', min: { x: -13.5, z: -15.5 }, max: { x: 13.5, z: -9.5 } },
        { name: 'Freight', min: { x: -7.5, z: -3.5 }, max: { x: 7.5, z: 3.5 } },
        { name: 'West Route', min: { x: -13.5, z: -9.5 }, max: { x: -7.2, z: 9.5 } },
        { name: 'East Route', min: { x: 7.2, z: -9.5 }, max: { x: 13.5, z: 9.5 } },
      ],
      menuCamera: { pos: { x: 12.2, y: 7.2, z: 14 }, lookAt: { x: 0, y: 1.4, z: 0 } },
      stats: { triangles: 0, drawCalls: 0, colliders: b.colliders.length, waypoints: waypoints.length },
    };

    b.root.traverse(obj => {
      if (!obj.isMesh && !obj.isLine) return;
      data.stats.drawCalls++;
      if (!obj.isMesh) return;
      const geom = obj.geometry;
      data.stats.triangles += (geom?.index?.count || geom?.attributes.position?.count || 0) / 3;
    });
    data.stats.triangles = Math.round(data.stats.triangles);
  } catch (error) {
    b.root.traverse(obj => obj.geometry?.dispose?.());
    for (const mat of b.uniqueMaterials) disposeMaterial(mat);
    materials.dispose();
    throw error;
  }

  data.dispose = () => {
    b.root.removeFromParent();
    b.root.traverse(obj => obj.geometry?.dispose?.());
    for (const mat of b.uniqueMaterials) disposeMaterial(mat);
    b.uniqueMaterials.length = 0;
    for (const light of b.lights) light.dispose?.();
    b.lights.length = 0;
    materials.dispose();
    b.colliders.length = 0;
    data.colliders = [];
  };

  game.scene.add(b.root);
  game.log?.(`Mapa ${data.id}: ${data.stats.triangles} tris · ${data.stats.drawCalls} draw calls`);
  return data;
}
