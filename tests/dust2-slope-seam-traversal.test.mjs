import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis;
globalThis.document = {
  createElementNS(_ns, name) {
    if (name !== 'img') return {};
    const listeners = new Map();
    return {
      width: 2048, height: 2048,
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      set src(_value) { queueMicrotask(() => listeners.get('load')?.call(this)); },
    };
  },
};

const THREE = await import('../vendor/three.module.js');
const { GLTFLoader } = await import('../vendor/loaders/GLTFLoader.js');
const { buildDust2DeathmatchMapFromScene } = await import('../src/world/dust2_map.js');
const { PhysicsWorld } = await import('../src/core/physics.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const file = fs.readFileSync(path.resolve(here, '../assets/maps/de_dust2_dm.glb'));
const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
const map = buildDust2DeathmatchMapFromScene({ scene: new THREE.Scene(), log() {} }, gltf.scene);
const physics = new PhysicsWorld(map.colliders, map.slopes);

const HULL = { radius: 0.25, height: 1.56, stepHeight: 0.45 };

function walk(name, from, to) {
  const body = {
    pos: new THREE.Vector3(...from), vel: new THREE.Vector3(),
    ...HULL, onGround: true, stepped: false,
  };
  let best = Math.hypot(to[0] - from[0], to[2] - from[2]);
  for (let tick = 0; tick < 320; tick++) {
    const dx = to[0] - body.pos.x;
    const dz = to[2] - body.pos.z;
    const distance = Math.hypot(dx, dz);
    best = Math.min(best, distance);
    if (distance < 0.20) break;
    body.vel.x = dx / distance * 3;
    body.vel.z = dz / distance * 3;
    if (!body.onGround || body.vel.y > 0) body.vel.y -= 0.1;
    physics.moveBody(body, 0.01);
    if (!body.onGround) body.vel.y -= 0.1;
    assert.equal(
      physics.overlapsWorld(physics.bodyBox(body), 0.015), null,
      `${name}: player hull tunneled into a solid Dust2 AABB`,
    );
  }
  assert.ok(best < 0.32, `${name}: stalled ${best.toFixed(3)}m from target`);
  return body;
}

// Long cobbled slope near the western arched/boxed route. Before the Dust2
// seam overlap, descending stopped at z≈11.255, exactly one hull radius before
// the real slope began at z=11.004.
walk('west seam descend', [-33.288, 2.214, 11.754], [-33.288, 2.014, 10.254]);
walk('west seam ascend', [-33.288, 2.014, 10.254], [-33.288, 2.214, 11.754]);

// Mirrored long cobbled slope on the eastern route. The old proxy stalled the
// descent at z≈-48.670 while the GLB slope begins at z=-48.419.
walk('east seam descend', [23.934, 2.214, -49.169], [23.934, 2.014, -47.669]);
walk('east seam ascend', [23.934, 2.014, -47.669], [23.934, 2.214, -49.169]);

assert.equal(map.deathmatchSpawns.length, 24, 'slope seam fix must preserve all 24 Dust2 spawns');
assert.equal(map.slopes.length, 263, 'slope seam fix extends source ramps and must preserve the 2 prior stair clips');

console.log('Dust2 slope seams OK: east/west cobbled lips traverse both directions, no AABB tunneling, 24 spawns preserved');
map.dispose();
