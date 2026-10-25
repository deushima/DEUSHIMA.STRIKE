import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildForgeMap } from '../src/world/forge_map.js';
import { ONLINE_MAPS, isOnlineMap } from '../src/world/online_map_pool.js';

assert.ok(ONLINE_MAPS.some(map => map.id === 'aim_forge'));
assert.equal(isOnlineMap('aim_forge'), true);

const map = buildForgeMap({ scene: new THREE.Scene() });
try {
  assert.equal(map.id, 'aim_forge');
  assert.equal(map.spawns.CT.length, 4);
  assert.equal(map.spawns.T.length, 4);
  assert.ok(map.bounds.maxX - map.bounds.minX <= 28, 'compact horizontal bounds');
  assert.ok(map.bounds.maxZ - map.bounds.minZ <= 32, 'compact longitudinal bounds');
  assert.ok(map.colliders.length >= 16, 'arena has meaningful cover collision');

  const free = spawn => map.colliders.every(c =>
    !(spawn.x - .5 < c.max.x && spawn.x + .5 > c.min.x &&
      .06 < c.max.y && 1.8 > c.min.y &&
      spawn.z - .5 < c.max.z && spawn.z + .5 > c.min.z));
  for (const spawn of map.spawns.CT) {
    assert.ok(spawn.z > 11 && spawn.z < 14.5, 'CT stays in CT yard');
    assert.equal(spawn.yaw, 0);
    assert.ok(free(spawn), 'CT spawn clear of colliders');
  }
  for (const spawn of map.spawns.T) {
    assert.ok(spawn.z < -11 && spawn.z > -14.5, 'T stays in T yard');
    assert.equal(spawn.yaw, 180);
    assert.ok(free(spawn), 'T spawn clear of colliders');
  }

  // All 16 opposing spawn pairs must intersect solid cover at eye height.
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
    assert.ok(blocked, `opening sightline CT ${ct.x} to T ${t.x} is blocked`);
  }

  // Cover around the center is mirrored so both teams encounter the same lane
  // geometry before reaching the freight stack.
  const colliderKey = c => [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z]
    .map(n => Number(n.toFixed(3))).join(',');
  const keys = new Set(map.colliders.map(colliderKey));
  for (const c of map.colliders) {
    if (c.max.y <= 0) continue;
    const mirrored = new THREE.Box3(
      new THREE.Vector3(-c.max.x, c.min.y, -c.max.z),
      new THREE.Vector3(-c.min.x, c.max.y, -c.min.z),
    );
    assert.ok(keys.has(colliderKey(mirrored)), 'combat cover keeps 180-degree symmetry');
  }

  assert.ok(map.waypoints.length > 30, 'enough navigation coverage for both side routes');
  const visited = new Set([map.waypoints[0].id]);
  const queue = [map.waypoints[0]];
  for (let i = 0; i < queue.length; i++) for (const id of queue[i].links) {
    if (!visited.has(id)) {
      visited.add(id);
      queue.push(map.waypoints[id]);
    }
  }
  assert.equal(visited.size, map.waypoints.length, 'waypoint graph connects both routes');

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
  console.log(`AIM_FORGE: ${triangles} triangles, ${map.colliders.length} colliders, ${map.waypoints.length} connected waypoints, 8 valid spawns, 0 opening sightlines.`);
} finally {
  map.dispose();
}
