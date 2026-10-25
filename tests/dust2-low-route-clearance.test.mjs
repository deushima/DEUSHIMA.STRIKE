import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Four suspicious but actual GLB-derived waypoint edges, not imaginary
// door openings. Assert that the current full-height Dust2 hull traverses
// their endpoints in both directions without requiring crouch.
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
const { collisionHullForMap } = await import('../src/core/player.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const file = fs.readFileSync(path.resolve(here, '../assets/maps/de_dust2_dm.glb'));
const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
const map = buildDust2DeathmatchMapFromScene({ scene: new THREE.Scene(), log() {} }, gltf.scene);
const physics = new PhysicsWorld(map.colliders, map.slopes);
const hull = collisionHullForMap(map);

const edges = [
  [149, 158], [149, 159], [149, 160], [475, 481],
];
assert.equal(map.waypoints.length, 541, 'expected waypoint graph from imported Dust2 mesh');

function walk(from, to) {
  const dirX = to.x - from.x;
  const dirZ = to.z - from.z;
  const len = Math.hypot(dirX, dirZ);
  assert.ok(len > 0.1, 'waypoint edge must have actual horizontal displacement');
  const body = {
    pos: new THREE.Vector3(from.x, from.y, from.z),
    vel: new THREE.Vector3(),
    radius: hull.radius,
    height: hull.standHeight,
    stepHeight: 0.4,
    onGround: true,
    stepped: false,
  };
  let minDistance = len;
  const ticks = Math.ceil((len / 3 + 0.5) / 0.01);
  for (let i=0; i<ticks; i++) {
    const dx = to.x - body.pos.x;
    const dz = to.z - body.pos.z;
    const distance = Math.hypot(dx, dz);
    minDistance = Math.min(minDistance, distance);
    if (distance < 0.3) break;
    body.vel.x = dx / distance * 3;
    body.vel.z = dz / distance * 3;
    if (!body.onGround || body.vel.y > 0) body.vel.y -= 20 * 0.005;
    physics.moveBody(body, 0.01);
    if (!body.onGround) body.vel.y -= 20 * 0.005;
    assert.ok(Number.isFinite(body.pos.x) && Number.isFinite(body.pos.y) && Number.isFinite(body.pos.z));
    assert.equal(physics.overlapsWorld(physics.bodyBox(body), 0.015), null,
      'Dust2 waypoint crossing must not tunnel through any solid AABB wall');
  }
  return { minDistance, body };
}

for (const [idA,idB] of edges) {
  const a = map.waypoints[idA];
  const b = map.waypoints[idB];
  assert.ok(a?.links?.includes(idB), `GLB waypoint ${idA} does not link ${idB}`);
  assert.ok(b?.links?.includes(idA), `GLB waypoint ${idB} does not link ${idA}`);
  for (const [from,to] of [[a,b],[b,a]]) {
    const { minDistance, body } = walk(from,to);
    assert.ok(minDistance < 0.55,
      `Dust2 full-height player stalled between GLB waypoint ${from.id} → ${to.id}; closest=${minDistance.toFixed(3)}m`);
    assert.ok(Math.abs(body.pos.y - to.y) < 0.85,
      `Dust2 player changed floor at ${from.id} → ${to.id}`);
  }
}
console.log('Dust2 real low-route clearance OK: 4 GLB waypoint edges, 8 standing traversals, no AI crouch required');
map.dispose();
