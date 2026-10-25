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
      width: 2048,
      height: 2048,
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      set src(_value) { queueMicrotask(() => listeners.get('load')?.call(this)); },
      get src() { return ''; },
    };
  },
};

const THREE = await import('../vendor/three.module.js');
const { GLTFLoader } = await import('../vendor/loaders/GLTFLoader.js');
const { buildDust2DeathmatchMapFromScene } = await import('../src/world/dust2_map.js');
const { PhysicsWorld } = await import('../src/core/physics.js');
const { collisionHullForMap } = await import('../src/core/player.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = path.resolve(here, '../assets/maps/de_dust2_dm.glb');
const source = fs.readFileSync(asset);
const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
const map = buildDust2DeathmatchMapFromScene({ scene: new THREE.Scene(), log() {} }, gltf.scene);
const physics = new PhysicsWorld(map.colliders, map.slopes);

function walkStraight(from, direction, seconds, radius = 0.30, height = 1.8) {
  const body = {
    pos: new THREE.Vector3(...from),
    vel: new THREE.Vector3(),
    radius,
    height,
    stepHeight: 0.5,
    onGround: true,
    stepped: false,
  };
  const dir = new THREE.Vector3(...direction).normalize();
  const ticks = Math.round(seconds / 0.01);
  for (let tick = 0; tick < ticks; tick++) {
    // Player re-applies horizontal wish velocity every simulation tick; emulate
    // that here so a one-frame collision cancellation does not create a false
    // permanent stop in the trajectory test.
    body.vel.x = dir.x * 3;
    body.vel.z = dir.z * 3;
    if (!body.onGround || body.vel.y > 0) body.vel.y -= 20 * 0.005;
    physics.moveBody(body, 0.01);
    if (!body.onGround) body.vel.y -= 20 * 0.005;
  }
  return body;
}

// In addition to the conservative 1.8m / r=0.30 test body below, repeat both
// actual ascents with the smaller Dust2 player hull used by the live game.
{
  const hull = collisionHullForMap(map);
  const east = walkStraight([18.35, 0.013, -20.358], [-1, 0, 0], 1.4, hull.radius, hull.standHeight);
  assert.ok(east.pos.x < 14.5 && east.pos.y > 2.15 && east.onGround,
    `Dust2 actual player hull stalled on east stair: x=${east.pos.x.toFixed(2)} y=${east.pos.y.toFixed(2)}`);
  const south = walkStraight([-29.987, 2.214, 7.6], [0, 0, -1], 1.4, hull.radius, hull.standHeight);
  assert.ok(south.pos.z < 3.8 && south.pos.y > 4.35 && south.onGround,
    `Dust2 actual player hull stalled on south stair: z=${south.pos.z.toFixed(2)} y=${south.pos.y.toFixed(2)}`);
}

// The GLB models this flight as y=0 -> 1.10 -> 2.20 metre terraces around
// x=16.5/15.4. Literal AABBs form waist-high riser walls; the Dust2 collision
// proxy now overlays a measured clip ramp while keeping those boxes underneath.
{
  const up = walkStraight([18.35, 0.013, -20.358], [-1, 0, 0], 1.4);
  assert.ok(up.pos.x < 14.5, `east stair ascent stalled at x=${up.pos.x.toFixed(3)}`);
  assert.ok(up.pos.y > 2.15, `east stair ascent never reached upper floor: y=${up.pos.y.toFixed(3)}`);
  assert.equal(up.onGround, true);

  const down = walkStraight([14.8, 2.214, -20.358], [1, 0, 0], 1.4);
  assert.ok(down.pos.x > 18.5, `east stair descent stalled at x=${down.pos.x.toFixed(3)}`);
  assert.ok(down.pos.y < 0.08, `east stair descent never reached lower floor: y=${down.pos.y.toFixed(3)}`);
  assert.equal(down.onGround, true);
}

// Second detected stair flight: same coarse 1.10 m terraces, oriented on Z.
{
  const up = walkStraight([-29.987, 2.214, 7.6], [0, 0, -1], 1.4);
  assert.ok(up.pos.z < 3.8, `south stair ascent stalled at z=${up.pos.z.toFixed(3)}`);
  assert.ok(up.pos.y > 4.35, `south stair ascent never reached upper floor: y=${up.pos.y.toFixed(3)}`);
  assert.equal(up.onGround, true);

  const down = walkStraight([-29.987, 4.414, 4.4], [0, 0, 1], 1.4);
  assert.ok(down.pos.z > 8.2, `south stair descent stalled at z=${down.pos.z.toFixed(3)}`);
  assert.ok(down.pos.y < 2.3, `south stair descent never reached lower floor: y=${down.pos.y.toFixed(3)}`);
  assert.equal(down.onGround, true);
}

// A geometrically similar low/mid/high sequence under a real ceiling must NOT
// receive a stair clip. Standing-height clearance rejects it and the straight
// path remains blocked instead of tunnelling through the ceiling/wall volume.
{
  const blocked = walkStraight([-8.253, 0.013, 5.45], [0, 0, -1], 1.4);
  assert.ok(blocked.pos.z > 3.5, `low-ceiling false stair was opened: z=${blocked.pos.z.toFixed(3)}`);
  assert.ok(blocked.pos.y < 0.1, `low-ceiling false stair lifted player through geometry: y=${blocked.pos.y.toFixed(3)}`);
}

// Clip ramps retain solid finite sides. Approaching the east stair laterally
// cannot cross its z=-20.908 boundary with a radius-0.30 body.
{
  const lateral = walkStraight([17.0, 0.9, -21.5], [0, 0, 1], 0.5);
  assert.ok(
    lateral.pos.z <= -21.19,
    `stair clip side became pass-through: z=${lateral.pos.z.toFixed(3)}`,
  );
}

assert.equal(map.slopes.length, 263, 'Dust2 should add exactly two validated stair clip ramps');

console.log('Dust2 ramp traversal OK: 2 measured stair flights ascend/descend, low ceiling rejected, clip sides remain solid');
map.dispose();
