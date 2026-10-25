import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {CHARACTER_IDS} from '../src/characters/identities.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../docs/v3-asset-manifest.json',import.meta.url),'utf8'));
for(const row of manifest.targets){
 const bytes=fs.readFileSync(new URL('../'+row.runtimeFile,import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.runtimeSha256,'runtime asset changed without audit');
 assert.equal(row.characterId,CHARACTER_IDS[row.team]);assert.ok(row.author&&row.source&&row.license);
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);
 const jsonLength=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+jsonLength)),bin=bytes.subarray(28+jsonLength);
 assert.ok(j.materials.length&&j.skins.length);assert.equal(j.skins[0].joints.length,row.team==='T'?122:78);
 if(row.team==='T')assert.ok(j.images.length,'Leet texture missing');
 if(row.team==='CT')assert.equal(j.animations?.length||0,0,'intermediary animation clips must be excluded');
 for(const mesh of j.meshes)for(const p of mesh.primitives){
  for(const key of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])assert.ok(Number.isInteger(p.attributes[key]),'missing '+key);
  const a=j.accessors[p.attributes.WEIGHTS_0],v=j.bufferViews[a.bufferView];assert.equal(a.componentType,5126);
  for(let i=0;i<a.count;i++){
   const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||16);let sum=0;
   for(let k=0;k<4;k++){const weight=bin.readFloatLE(offset+k*4);assert.ok(Number.isFinite(weight)&&weight>=0);sum+=weight;}
   assert.ok(Math.abs(sum-1)<.001,'unnormalized skin weights');
  }
 }
 if(row.team==='T')assert.equal(row.originalSha256,row.runtimeSha256,'Leet original changed');
 const licenseName=row.team==='T'?'T-LICENSE.txt':'CT-RUNTIME-LICENSE.txt';
 const license=fs.readFileSync(new URL('../assets/characters/community/'+licenseName,import.meta.url),'utf8');assert.ok(license.includes(row.source));
}
assert.ok(fs.readFileSync(new URL('../character-credits.html',import.meta.url),'utf8').includes('BAMEN'));
console.log('community-assets OK: Leet and CT hashes, source credits, normals/UV/weights and 122/78 independent joints');
