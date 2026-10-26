import assert from 'node:assert/strict';
import {loadGLB} from './helpers/load-glb.mjs';
import * as THREE from '../vendor/three.module.js';
import {createCommunityAnimator} from '../src/characters/community-rig.js';
import {characterHitboxes,intersectHitbox} from '../src/combat/hitboxes.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
for(const [team,file] of [['T','leet'],['CT','sas']]) {
 const {scene}=await loadGLB(new URL(`../assets/characters/community/${file}.glb`,import.meta.url));
 scene.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(scene,true),size=bounds.getSize(V());
 scene.position.sub(V((bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2));
 const model=new THREE.Group();model.add(scene);model.scale.setScalar(1.8/size.y);model.rotation.y=Math.PI;
 const character=createCommunityAnimator(model,team),seen=new Set();
 for(const pose of [{onGround:true},{onGround:true,speed:4,velocity:V(2,0,-3)},{onGround:true,crouching:true},{onGround:false,velocity:V(1,4,1)},{onGround:false,velocity:V(1,-3,1),pitch:.5}]) {
  for(let i=0;i<30;i++)character.update(.016,pose,!!pose.speed);
  const boxes=characterHitboxes(character,team),parts=new Set();
  for(let y=.06;y<1.9;y+=.035)for(let x=-.55;x<=.55;x+=.035) {
   const hits=boxes.map(h=>intersectHitbox(V(x,y,-3),V(0,0,1),h,5)).filter(Boolean).sort((a,b)=>a.t-b.t);
   if(hits.length){parts.add(hits[0].part);seen.add(hits[0].part);}
  }
  assert.ok(parts.has('head'),`${team} pose missing head ${JSON.stringify(pose)} contacts=${[...parts]} bounds=${JSON.stringify(new THREE.Box3().setFromObject(character.root,true))}`);
  assert.ok(parts.has('chest'),`${team} pose missing chest`);
  assert.ok(parts.has('leftleg')&&parts.has('rightleg'),`${team} legs ${[...parts]}`);
  for(const h of boxes)assert.equal(intersectHitbox(V(0,2.1,-3),V(0,0,1),h,5),null,'air above head must miss');
 }
 assert.ok(seen.has('leftarm')&&seen.has('rightarm'),`${team} arms ${[...seen]}`);
 console.log(`${team}: actual animated GLB contacts ${[...seen].join(', ')}; air rejected in idle/run/duck/jump/fall.`);
 character.dispose();
}
