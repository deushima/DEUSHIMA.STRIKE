import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUST2_DEATHMATCH_INFO, DUST2_MODEL_URL } from '../src/world/dust2_map.js';
import { ONLINE_MAPS, isOnlineMap, onlineMapLabel } from '../src/world/online_map_pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const asset = path.join(root, DUST2_MODEL_URL.replace(/^\//, ''));

assert.equal(DUST2_DEATHMATCH_INFO.id, 'de_dust2_dm');
assert.equal(DUST2_DEATHMATCH_INFO.mode, 'deathmatch');
assert.equal(DUST2_DEATHMATCH_INFO.players, 10);
assert.equal(DUST2_MODEL_URL, '/assets/maps/de_dust2_dm.glb');
assert.ok(isOnlineMap('de_dust2_dm'), 'Dust2 Deathmatch must be valid on the wire');
assert.equal(onlineMapLabel('de_dust2_dm'), 'DUST2 · DEATHMATCH');
assert.ok(ONLINE_MAPS.some((map) => map.id === 'de_dust2_dm'));

const bytes = fs.readFileSync(asset);
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
assert.equal(bytes.readUInt32LE(4), 2, 'asset must be GLB v2');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length header must match file');
assert.ok(bytes.length < 20 * 1024 * 1024, `browser asset unexpectedly large: ${(bytes.length / 1048576).toFixed(1)} MB`);

const jsonLength = bytes.readUInt32LE(12);
assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'first GLB chunk must be JSON');
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
assert.equal(json.asset?.extras?.author?.includes('Neo_minigan'), true, 'source attribution must stay embedded');
assert.equal(json.asset?.extras?.license?.includes('CC-BY-4.0'), true, 'source license must stay embedded');
assert.equal(json.images?.length, 11);
assert.equal(json.meshes?.length, 11);

let triangles = 0;
for (const mesh of json.meshes || []) {
  for (const primitive of mesh.primitives || []) {
    const accessor = json.accessors?.[primitive.indices];
    triangles += (accessor?.count || 0) / 3;
  }
}
assert.ok(triangles > 9000 && triangles < 9200, `unexpected Dust2 topology: ${triangles} triangles`);

console.log(`Dust2 Deathmatch asset OK · ${(bytes.length / 1048576).toFixed(1)} MB · ${Math.round(triangles)} tris`);
