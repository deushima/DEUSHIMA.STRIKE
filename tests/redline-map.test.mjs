import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildRedlineMap } from '../src/world/redline_map.js';
import { ONLINE_MAPS, isOnlineMap } from '../src/world/online_map_pool.js';
import { OnlineMatch } from '../src/online/match.js';

assert.deepEqual(ONLINE_MAPS.map(m => m.id), ['aim_redline', 'aim_forge', 'aim_1v1', 'cs_assault', 'cs_office', 'de_dust2_dm']);
for (const id of ONLINE_MAPS.map(m => m.id)) assert.equal(isOnlineMap(id), true);
assert.equal(isOnlineMap('unknown'), false);

const map = buildRedlineMap({ scene: new THREE.Scene() });
try {
  assert.equal(map.id, 'aim_redline');
  assert.equal(map.spawns.CT.length, 4);
  assert.equal(map.spawns.T.length, 4);
  assert.ok(map.colliders.length > 20);

  const free = (s) => map.colliders.every(c =>
    !(s.x - .5 < c.max.x && s.x + .5 > c.min.x &&
      .06 < c.max.y && 1.8 > c.min.y &&
      s.z - .5 < c.max.z && s.z + .5 > c.min.z));
  for (const s of map.spawns.CT) {
    assert.ok(s.z > 14 && s.z < 18, 'CT stays in CT base');
    assert.equal(s.yaw, 0);
    assert.ok(free(s), 'CT spawn clear of colliders');
  }
  for (const s of map.spawns.T) {
    assert.ok(s.z < -14 && s.z > -18, 'T stays in T base');
    assert.equal(s.yaw, 180);
    assert.ok(free(s), 'T spawn clear of colliders');
  }

  // Every opposite-base sightline must meet solid cover at player eye height.
  for (const ct of map.spawns.CT) for (const t of map.spawns.T) {
    const start = new THREE.Vector3(ct.x, 1.62, ct.z);
    const end = new THREE.Vector3(t.x, 1.62, t.z);
    const delta = end.clone().sub(start);
    const ray = new THREE.Ray(start, delta.clone().normalize());
    const blocked = map.colliders.some(c => {
      if (c.min.y >= 1.62 || c.max.y <= 1.62) return false;
      const hit = ray.intersectBox(c, new THREE.Vector3());
      return hit && hit.distanceTo(start) < delta.length() - .1;
    });
    assert.ok(blocked, `opening sightline ${ct.x} to ${t.x} is blocked`);
  }

  const chooser = { game: { map } };
  for (const team of ['CT', 'T']) {
    const selected = [.01, .26, .51, .76].map(roll =>
      OnlineMatch.prototype._spawnFor.call(chooser, team, roll));
    assert.deepEqual(selected.map(s => s.x), map.spawns[team].map(s => s.x));
    assert.ok(selected.every(s => s.z === map.spawns[team][0].z));
  }

  const visited = new Set([map.waypoints[0].id]);
  const queue = [map.waypoints[0]];
  for (let i = 0; i < queue.length; i++) for (const id of queue[i].links) {
    if (!visited.has(id)) { visited.add(id); queue.push(map.waypoints[id]); }
  }
  assert.equal(visited.size, map.waypoints.length, 'waypoint graph connects all routes');

  let triangles = 0;
  map.root.traverse(obj => {
    if (!obj.isMesh) return;
    const geometry = obj.geometry;
    const position = geometry.attributes.position;
    for (const attr of Object.values(geometry.attributes))
      for (const value of attr.array) assert.ok(Number.isFinite(value), 'finite geometry');
    const indices = geometry.index?.array;
    const count = indices?.length || position.count;
    for (let i = 0; i < count; i += 3) {
      const ia = indices ? indices[i] : i;
      const ib = indices ? indices[i + 1] : i + 1;
      const ic = indices ? indices[i + 2] : i + 2;
      assert.ok(ia < position.count && ib < position.count && ic < position.count);
      const a = new THREE.Vector3().fromBufferAttribute(position, ia);
      const b = new THREE.Vector3().fromBufferAttribute(position, ib);
      const c = new THREE.Vector3().fromBufferAttribute(position, ic);
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16, 'nondegenerate triangle');
      triangles++;
    }
  });
  assert.equal(triangles, map.stats.triangles);
  console.log(`AIM_REDLINE: ${triangles} triangles, ${map.colliders.length} colliders, ${map.waypoints.length} connected waypoints, 8 valid spawns, 0 opening sightlines.`);
} finally { map.dispose(); }
