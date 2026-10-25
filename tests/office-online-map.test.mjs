import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildMap } from '../src/world/maps.js';
import { isOnlineMap, onlineMapLabel } from '../src/world/online_map_pool.js';
import { OnlineMatch } from '../src/online/match.js';

assert.equal(isOnlineMap('cs_office'), true);
assert.equal(onlineMapLabel('cs_office'), 'CS_OFFICE');

const map = buildMap({ scene: new THREE.Scene() }, 'cs_office');
try {
  assert.equal(map.id, 'cs_office');
  assert.equal(map.mode, 'hostage');
  assert.ok(map.colliders.length > 0);
  assert.ok(map.spawns.CT.length >= 2);
  assert.ok(map.spawns.T.length >= 2);

  const match = { game: { map } };
  for (const team of ['CT', 'T']) {
    const spawn = OnlineMatch.prototype._spawnFor.call(match, team, 0);
    assert.equal(spawn.x, map.spawns[team][0].x);
    assert.equal(spawn.z, map.spawns[team][0].z);
    assert.ok(Number.isFinite(spawn.yaw));
  }
  console.log('CS_OFFICE online OK: mapa real, colisiones y spawns CT/T');
} finally {
  map.dispose();
}
