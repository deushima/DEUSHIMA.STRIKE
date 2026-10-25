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
const { movementPreset } = await import('../src/core/movement-presets.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = path.resolve(here, '../assets/maps/de_dust2_dm.glb');
const source = fs.readFileSync(asset);
const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');

const game = { scene: new THREE.Scene(), log() {} };
const map = buildDust2DeathmatchMapFromScene(game, gltf.scene);

assert.equal(map.id, 'de_dust2_dm');
assert.equal(map.mode, 'deathmatch');
assert.equal(map.deathmatchSpawns.length, 24);
assert.equal(map.spawns.CT.length, 12);
assert.equal(map.spawns.T.length, 12);
assert.ok(map.colliders.length >= 100 && map.colliders.length < 5000, `unexpected collider count ${map.colliders.length}`);
assert.ok(map.slopes.length >= 1 && map.slopes.length < 1000, `unexpected slope count ${map.slopes.length}`);
assert.ok(map.waypoints.length >= 12, `unexpected waypoint count ${map.waypoints.length}`);
assert.ok(map.stats.triangles > 9000 && map.stats.triangles < 9200);
assert.ok(map.bounds.minX < -40 && map.bounds.maxX > 30);
assert.ok(map.bounds.minZ < -60 && map.bounds.maxZ > 20);
assert.ok(Math.max(...map.deathmatchSpawns.map((spawn) => spawn.x)) > 20, 'deathmatch spawns must still cover east Dust2');
assert.ok(Math.min(...map.deathmatchSpawns.map((spawn) => spawn.z)) < -40, 'deathmatch spawns must still cover south Dust2');
assert.ok(
  map.deathmatchSpawns.every((spawn) => Math.hypot(spawn.x + 42.7333, spawn.z + 61.9908) > 4),
  'isolated off-map A spawn must not return to the deathmatch pool',
);
const physics = new PhysicsWorld(map.colliders, map.slopes);
const movement = movementPreset();
for (const spawn of map.deathmatchSpawns) {
  assert.ok(Number.isFinite(spawn.x) && Number.isFinite(spawn.y) && Number.isFinite(spawn.z));
  assert.ok(spawn.y > -2.5 && spawn.y < 2.8, `spawn outside playable elevation: ${spawn.y}`);
  assert.ok(
    physics.isPositionFree({ x: spawn.x, y: spawn.y + 0.08, z: spawn.z }, 0.4, 1.8),
    `blocked spawn at ${spawn.x.toFixed(2)},${spawn.y.toFixed(2)},${spawn.z.toFixed(2)}`,
  );
  assert.ok(
    physics.hasGroundBelow({ pos: new THREE.Vector3(spawn.x, spawn.y, spawn.z) }, 0, 0, 0.3),
    `spawn without support at ${spawn.x.toFixed(2)},${spawn.y.toFixed(2)},${spawn.z.toFixed(2)}`,
  );
  const nearestNavigable = map.waypoints.reduce((best, waypoint) => {
    const vertical = Math.abs(waypoint.y - spawn.y);
    if (vertical > 0.55) return best;
    const distance = Math.hypot(waypoint.x - spawn.x, waypoint.z - spawn.z);
    return !best || distance < best.distance ? { distance, vertical } : best;
  }, null);
  assert.ok(
    nearestNavigable && nearestNavigable.distance <= 3.2,
    `spawn disconnected from navigation at ${spawn.x.toFixed(2)},${spawn.y.toFixed(2)},${spawn.z.toFixed(2)}`,
  );

  // Regression for Deathmatch spawns that begin on a Dust2 ramp. Game marks a
  // supported fresh spawn as grounded; from there, two seconds of fixed-tick
  // physics with zero player input must keep the body attached to the map.
  // Mirror Player's split-gravity integration around PhysicsWorld.moveBody().
  const body = {
    pos: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
    vel: new THREE.Vector3(),
    radius: 0.38,
    height: 1.8,
    stepHeight: movement.stepHeight,
    onGround: true,
    stepped: false,
  };
  const startY = body.pos.y;
  let minY = startY;
  const ticks = Math.round(2 / movement.fixedStep);
  for (let tick = 0; tick < ticks; tick++) {
    if (!body.onGround || body.vel.y > 0) body.vel.y -= movement.gravity * 0.5 * movement.fixedStep;
    body.vel.y = Math.max(-movement.maxVelocity, Math.min(movement.maxVelocity, body.vel.y));
    physics.moveBody(body, movement.fixedStep);
    if (!body.onGround) body.vel.y -= movement.gravity * 0.5 * movement.fixedStep;
    minY = Math.min(minY, body.pos.y);
  }
  assert.ok(
    minY >= startY - 0.2,
    `spawn fell during idle physics: start=${startY.toFixed(3)} min=${minY.toFixed(3)} at ${spawn.x.toFixed(2)},${spawn.z.toFixed(2)}`,
  );
  assert.equal(
    body.onGround,
    true,
    `spawn lost ground after idle physics at ${spawn.x.toFixed(2)},${body.pos.y.toFixed(3)},${spawn.z.toFixed(2)}`,
  );
}

console.log(`Dust2 runtime OK · ${map.colliders.length} colliders · ${map.slopes.length} slopes · ${map.waypoints.length} waypoints · ${map.deathmatchSpawns.length} spawns`);
map.dispose();
