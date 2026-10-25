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
const DT = 0.01;
const SPEED = 3;
const MAX_HORIZONTAL_TICK_TRAVEL = 0.04;
// Both measured seams are grade 0.25. At a triangle-proxy boundary the slope
// support can switch from the trailing to the leading edge of the 0.50m hull,
// so a grounded correction of radius*2*grade is physical rather than a warp.
const MAX_SLOPE_SUPPORT_SNAP = HULL.radius * 2 * 0.25 + 0.01;
let observedMaxHorizontalTravel = 0;
let observedMaxVerticalTravel = 0;

function makeBody(from) {
  return {
    pos: new THREE.Vector3(...from), vel: new THREE.Vector3(),
    ...HULL, onGround: true, stepped: false,
  };
}

function hasHullGroundContact(body, drop = 0.12) {
  const r = body.radius;
  const floorProbe = new THREE.Box3(
    new THREE.Vector3(body.pos.x - r, body.pos.y - drop, body.pos.z - r),
    new THREE.Vector3(body.pos.x + r, body.pos.y + 0.02, body.pos.z + r),
  );
  const floorSupport = map.colliders.some((collider) => (
    collider.max.y <= body.pos.y + 0.06 &&
    collider.max.y >= body.pos.y - drop &&
    THREE.Box3.prototype.intersectsBox.call(floorProbe, collider)
  ));
  if (floorSupport) return true;
  return physics.slopes.some((slope) => {
    if (!slope.walkable) return false;
    const supportY = slope.supportHeight(body.pos.x, body.pos.z, r);
    return supportY !== null && supportY <= body.pos.y + 0.02 && supportY >= body.pos.y - drop;
  });
}

function assertStableGroundContact(name, body, previous) {
  assert.ok(
    Number.isFinite(body.pos.x) && Number.isFinite(body.pos.y) && Number.isFinite(body.pos.z),
    `${name}: player position became non-finite`,
  );
  assert.equal(
    physics.overlapsWorld(physics.bodyBox(body), 0.015), null,
    `${name}: player hull tunneled into a solid Dust2 AABB`,
  );
  assert.equal(body.onGround, true, `${name}: player lost grounded state at the slope seam`);
  assert.equal(
    hasHullGroundContact(body), true,
    `${name}: grounded player lost physical support beneath the hull`,
  );
  const horizontalTravel = Math.hypot(body.pos.x - previous.x, body.pos.z - previous.z);
  const verticalTravel = Math.abs(body.pos.y - previous.y);
  observedMaxHorizontalTravel = Math.max(observedMaxHorizontalTravel, horizontalTravel);
  observedMaxVerticalTravel = Math.max(observedMaxVerticalTravel, verticalTravel);
  const verticalLimit = body.stepped ? HULL.stepHeight + 0.01 : MAX_SLOPE_SUPPORT_SNAP;
  assert.ok(
    horizontalTravel <= MAX_HORIZONTAL_TICK_TRAVEL,
    `${name}: implausible ${horizontalTravel.toFixed(3)}m horizontal teleport in one ${DT}s physics tick`,
  );
  assert.ok(
    verticalTravel <= verticalLimit,
    `${name}: implausible ${verticalTravel.toFixed(3)}m vertical teleport in one ${DT}s physics tick ` +
      `from (${previous.x.toFixed(3)},${previous.y.toFixed(3)},${previous.z.toFixed(3)}) ` +
      `to (${body.pos.x.toFixed(3)},${body.pos.y.toFixed(3)},${body.pos.z.toFixed(3)}), stepped=${body.stepped}`,
  );
}

function stepBody(name, body, vx, vz) {
  const previous = body.pos.clone();
  body.vel.x = vx;
  body.vel.z = vz;
  if (!body.onGround || body.vel.y > 0) body.vel.y -= 0.1;
  physics.moveBody(body, DT);
  if (!body.onGround) body.vel.y -= 0.1;
  assertStableGroundContact(name, body, previous);
}

function driveTo(name, body, target) {
  let best = Math.hypot(target[0] - body.pos.x, target[1] - body.pos.z);
  for (let tick = 0; tick < 240; tick++) {
    const dx = target[0] - body.pos.x;
    const dz = target[1] - body.pos.z;
    const distance = Math.hypot(dx, dz);
    best = Math.min(best, distance);
    if (distance < 0.16) break;
    stepBody(name, body, dx / distance * SPEED, dz / distance * SPEED);
  }
  assert.ok(best < 0.24, `${name}: stalled ${best.toFixed(3)}m from target`);
}

function pause(name, body, ticks = 10) {
  for (let tick = 0; tick < ticks; tick++) stepBody(name, body, 0, 0);
}

function traverseSeam(name, from, outbound, turn, inbound) {
  const body = {
    ...makeBody(from),
  };
  for (const target of outbound) driveTo(`${name} descend`, body, target);
  driveTo(`${name} turn`, body, turn);
  pause(`${name} pause`, body);
  for (const target of inbound) driveTo(`${name} ascend`, body, target);
  driveTo(`${name} return`, body, [from[0], from[2]]);
  return body;
}

// Long cobbled slope near the western arched/boxed route. Before the Dust2
// seam overlap, descending stopped at z≈11.255, exactly one hull radius before
// the real slope began at z=11.004.
traverseSeam(
  'west seam',
  [-33.288, 2.214, 11.754],
  [[-33.00, 10.86], [-33.58, 10.42]],
  [-33.288, 10.254],
  [[-33.62, 10.72], [-32.98, 11.18]],
);

// Mirrored long cobbled slope on the eastern route. The old proxy stalled the
// descent at z≈-48.670 while the GLB slope begins at z=-48.419.
traverseSeam(
  'east seam',
  [23.934, 2.214, -49.169],
  [[24.24, -48.28], [23.62, -47.84]],
  [23.934, -47.669],
  [[23.58, -48.08], [24.22, -48.56]],
);

assert.equal(map.colliders.length, 4130, 'slope seam fix must preserve Dust2 collider count');
assert.equal(map.deathmatchSpawns.length, 24, 'slope seam fix must preserve all 24 Dust2 spawns');
assert.equal(map.slopes.length, 263, 'slope seam fix extends source ramps and must preserve the 2 prior stair clips');
assert.equal(map.waypoints.length, 541, 'slope seam fix must preserve Dust2 waypoint graph');

console.log(
  `Dust2 slope seams OK: continuous east/west descend-turn-pause-ascend zigzags stay grounded; ` +
  `no AABB tunneling; max tick travel h=${observedMaxHorizontalTravel.toFixed(3)}m v=${observedMaxVerticalTravel.toFixed(3)}m; map counts preserved`,
);
map.dispose();
