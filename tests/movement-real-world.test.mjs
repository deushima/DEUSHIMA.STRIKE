import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {Player} from '../src/core/player.js';
import {PhysicsWorld} from '../src/core/physics.js';
const floor=new THREE.Box3(new THREE.Vector3(-10000,-1,-10000),new THREE.Vector3(10000,0,10000));
function make(){
 const keys=new Set();const game={settings:{autoBhop:false},input:{locked:true,isDown:k=>keys.has(k),wasPressed:()=>false,consumeLook:()=>({x:0,y:0})},canMove:()=>true,weapons:{getMoveSpeed:()=>6.25},audio:{play(){}},physics:new PhysicsWorld([floor]),ui:{}};
 const player=new Player(game);player.reset('T',{x:0,y:.001,z:0});player.onGround=true;return {player,game,keys};
}
const rising=make();rising.player.pos.y=.01;rising.player.vel.y=1;rising.player.onGround=false;rising.game.physics.moveBody(rising.player,.01);assert.equal(rising.player.onGround,false,'rising body snapped onto floor');
const takeoff=make();takeoff.keys.add('Space');takeoff.keys.add('KeyW');takeoff.player.update(.01);assert.ok(takeoff.player.vel.z<-.6,'takeoff tick omitted air acceleration');
const results=[];
for(const fps of [30,60,144]){
 const {player,keys}=make();keys.add('Space');player.vel.x=8;
 let impulses=0,previous=0,minGap=Infinity,lastTick=-1000;const curve=[];
 const simulate=player._simulateMovementStep.bind(player);
 player._simulateMovementStep=(dt,canMove)=>{simulate(dt,canMove);if(player._jumpCount>previous){impulses++;minGap=Math.min(minGap,player._physicsTick-lastTick);lastTick=player._physicsTick;previous=player._jumpCount;curve.push({tick:lastTick,jump:impulses,speed:player.getVelocity2D(),height:player.pos.y});}};
 for(let f=0;f<fps*21;f++)player.update(1/fps);
 assert.ok(impulses>=30,`${fps}: not 30 jumps`);assert.ok(minGap>=60,`${fps}: double jump or false landing`);assert.ok(Math.abs(player.getVelocity2D()-8)<1e-8,'momentum lost on real collider');
 const before=impulses;keys.delete('Space');for(let f=0;f<fps;f++)player.update(1/fps);assert.equal(impulses,before);assert.equal(player.onGround,true);
 results.push({fps,impulses,minGap,curve,finalTick:player._physicsTick,pos:player.pos.toArray()});
}
for(const r of results){assert.equal(r.finalTick,2200);assert.ok(Math.abs(r.pos[0]-results[0].pos[0])<1e-7);}
// Equal physics-tick input scripts: speed curves must be identical across renders.
const strafe=[];
for(const fps of [30,60,144]){
 const {player,keys}=make();keys.add('Space');keys.add('KeyD');player.vel.z=-6.25;
 const curve=[];const simulate=player._simulateMovementStep.bind(player);
 player._simulateMovementStep=(dt,canMove)=>{
  const velocityAngle=Math.atan2(-player.vel.z,player.vel.x);
  // A small positive projection permits acceleration; yaw follows the velocity
  // smoothly once per physical tick, independent of the rendering schedule.
  const side=player._jumpCount%2 ? -1 : 1;
  keys.delete(side>0?'KeyA':'KeyD');keys.add(side>0?'KeyD':'KeyA');
  const theta=velocityAngle+side*Math.acos(Math.min(1,.10/Math.max(.11,player.getVelocity2D())))+(side<0?Math.PI:0);
  player.yaw=theta;simulate(dt,canMove);
  if(player._physicsTick%10===0)curve.push({tick:player._physicsTick,speed:player.getVelocity2D(),x:player.pos.x,z:player.pos.z,jumps:player._jumpCount});
 };
 for(let f=0;f<fps*14;f++)player.update(1/fps);
 assert.ok(player.getVelocity2D()>6.5,'coordinated strafe gained no speed');assert.ok(player._jumpCount>=20);
 strafe.push({fps,curve});
}
assert.deepEqual(strafe[0].curve,strafe[1].curve);assert.deepEqual(strafe[1].curve,strafe[2].curve);

// Normal spawn/reset paths retain the preset for both teams and all maps.
for(const map of ['aim_1v1','aim_redline','aim_forge','cs_assault'])for(const team of ['T','CT']){
 const h=make();h.game.map={id:map};h.player.reset(team,{x:0,y:.001,z:0});
 assert.equal(h.player.movementPresetId,'CS16_1V1_AUTOBHOP');assert.equal(h.player.getMovementDebugState().autoBhopEnabled,true);
 assert.equal(h.player.vel.length(),0);
}
const turn=make();turn.player.vel.z=-6.25;turn.keys.add('KeyD');turn.player.update(.01);
assert.ok(turn.player.vel.z < -5 && turn.player.vel.x < 1,'90-degree input instantly replaced velocity');
const forward=make();forward.player.vel.z=-6.25;forward.keys.add('KeyW');forward.keys.add('Space');
for(let i=0;i<1400;i++)forward.player.update(.01);
assert.ok(Math.abs(forward.player.getVelocity2D()-6.25)<1e-6,'W+Space generated artificial speed');

fs.mkdirSync('tests/artifacts/movement',{recursive:true});fs.writeFileSync('tests/artifacts/movement/real-world-curves.json',JSON.stringify({chains:results,strafe},null,2));
console.log('movement-real-world OK: 30-jump chains, release, no ascent reattachment, takeoff air acceleration, 20 strafe jumps and identical tick-input curves at 30/60/144 render FPS');
