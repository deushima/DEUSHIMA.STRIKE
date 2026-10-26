import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three.module.js';
import {loadGLB} from './helpers/load-glb.mjs';
import {PhysicsWorld} from '../src/core/physics.js';
import {Player,collisionHullForMap} from '../src/core/player.js';
import {buildDustShortMapFromScene,DUST_SHORT_SCALE} from '../src/world/dust_short_map.js';
import {traceWalk} from '../src/world/triangle-navigation.js';
const source=fs.readFileSync('assets/maps/dust_short.glb');
assert.equal(createHash('sha256').update(source).digest('hex'),'806e89c103447b3e275c112e323882cb3e1c1e25e2d43cb4aff9d13112f8b57c','original GLB unchanged');
const gltf=await loadGLB('assets/maps/dust_short.glb');
assert.match(gltf.asset.extras.license,/CC-BY-4.0/);
const map=buildDustShortMapFromScene({scene:new THREE.Scene()},gltf.scene);
assert.equal(map.stats.triangles,24742);assert.equal(map.stats.drawCalls,9);
assert.equal(DUST_SHORT_SCALE,96);
assert.ok(Math.abs(map.stats.sourceSize.x-212.767876)<1e-4);
assert.ok(Math.abs(map.stats.sourceSize.y-40.016699)<1e-4);
assert.ok(Math.abs(map.stats.sourceSize.z-255.393254)<1e-4);
assert.equal(map.colliders.length,0,'no filled rectangles over triangle gaps');
assert.equal(map.slopes.length,24742,'all original triangles, including tiny faces');
const physics=new PhysicsWorld(map.colliders,map.slopes),hull=collisionHullForMap(map);
const controls=new Set(['KeyW']);
const playerGame={map,physics,settings:{},input:{locked:true,isDown:k=>controls.has(k),wasPressed:()=>false,consumeLook:()=>({x:0,y:0})},canMove:()=>true,weapons:{getMoveSpeed:()=>5.75},audio:{play(){}},ui:{}};
for(const fps of [30,60,144]){
 const p=new Player(playerGame);p.reset('CT',map.spawns.CT[0]);p.onGround=true;
 for(let i=0;i<fps*8;i++){
  p.update(1/fps);
  assert.ok(p.pos.x<27.85,'holding forward must stop at the real CT corridor wall');
  assert.ok(physics.canFitBody(p,p.height,.002),'player must not penetrate triangle walls');
  assert.ok(p.pos.y>3.6,'player must not escape the CT floor through a thin wall');
 }
 assert.ok(p.pos.x>27.7,'player must actually walk out of the spawn, not freeze there');
}
assert.equal(hull.standHeight,1.8);
const anchors={CT:{x:19.2,z:-1.44},T:{x:30.72,z:18}};
for(const team of ['CT','T']){
 const spawn=map.spawns[team][0];
 assert.ok(Math.hypot(spawn.x-anchors[team].x,spawn.z-anchors[team].z)<.75,'spawn inside registered screenshot region');
 assert.ok(physics.isPositionFree(spawn,hull.radius,hull.standHeight));
 assert.ok(physics.hasGroundBelow({pos:spawn},0,0,.1));
 const body={pos:new THREE.Vector3(spawn.x,spawn.y,spawn.z),vel:new THREE.Vector3(),height:hull.standHeight,radius:hull.radius,stepHeight:.45,onGround:false};
 for(let i=0;i<100;i++){if(!body.onGround)body.vel.y-=.2;physics.moveBody(body,.01);assert.ok(Math.abs(body.pos.y-spawn.y)<.03);}
 assert.ok(body.onGround);
 const endTeam=team==='CT'?'T':'CT',start=map.waypoints.find(p=>p.tags.includes('spawn:'+team)),end=map.waypoints.find(p=>p.tags.includes('spawn:'+endTeam));
 const queue=[start.id],prev=new Map([[start.id,null]]);
 for(const id of queue)for(const next of map.waypoints[id].links)if(!prev.has(next)){prev.set(next,id);queue.push(next);}
 assert.ok(prev.has(end.id),'both directions required, never skip disconnected graphs');
 const route=[];for(let id=end.id;id!==null;id=prev.get(id))route.unshift(map.waypoints[id]);
 for(let i=1;i<route.length;i++)assert.ok(traceWalk(physics,route[i-1],route[i]).ok,`${team}: actual hull failed ${route[i-1].id}->${route[i].id}`);
}
const materials=new Set();map.root.traverse(o=>{if(o.isMesh)materials.add(o.material);});
assert.equal(materials.size,9);for(const m of materials)assert.ok(m.map,'embedded texture retained');
console.log('Dust Short original GLB preserved; human scale; both screenshot spawns grounded/free; both complete physical routes verified.');
map.dispose();
