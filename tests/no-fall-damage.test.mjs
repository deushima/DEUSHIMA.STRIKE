import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {Player} from '../src/core/player.js';
import {PhysicsWorld} from '../src/core/physics.js';
import {Game} from '../src/game.js';
import {OnlineMatch} from '../src/online/match.js';

const floor=new THREE.Box3(new THREE.Vector3(-30,-1,-30),new THREE.Vector3(30,0,30));
for(const mode of ['offline','online','deathmatch']){
  const keys=new Set();
  const game={map:{id:'aim_1v1',spawns:{CT:[{x:2,y:.001,z:3}]}},settings:{autoBhop:false},
    input:{locked:true,isDown:key=>keys.has(key),wasPressed:()=>false,consumeLook:()=>({x:0,y:0})},
    canMove:()=>true,weapons:{getMoveSpeed:()=>6.25},audio:{play(){}},physics:new PhysicsWorld([floor]),
    ui:{},online:mode==='online'?{canControl:()=>true}:null,deathmatch:mode==='deathmatch'?{}:null};
  const player=new Player(game);game.player=player;player.reset('CT',{x:0,y:20,z:0});
  player.health=73;player.armor=42;player.alive=true;player.onGround=false;
  let landed=false;
  for(let i=0;i<800;i++){player.update(.01);if(player.onGround){landed=true;break;}}
  assert.equal(landed,true,`${mode}: must physically land`);
  assert.equal(player.health,73,`${mode}: landing cannot damage HP`);
  assert.equal(player.armor,42,`${mode}: landing cannot damage armor`);
  assert.equal(player.alive,true,`${mode}: landing cannot kill`);
  assert.equal(player.takeDamage(1000,null,'legs','fall'),0,`${mode}: fall damage API disabled`);
  assert.equal(player.health,73);
  player.pos.y=-10;player.vel.set(10,-20,0);
  assert.equal(Game.prototype.recoverPlayerFromVoid.call(game),true);
  assert.deepEqual(player.pos.toArray(),[2,.001,3]);
  assert.equal(player.health,73,`${mode}: void recovery preserves HP`);
  assert.equal(player.armor,42,`${mode}: void recovery preserves armor`);
  assert.equal(player.alive,true);
}
const host=Object.create(OnlineMatch.prototype);
host.isHost=true;host.isDeathmatch=true;host.phase='live';host.players=new Map([['guest',{id:'guest',connected:true,lifeSeq:0}]]);
assert.equal(host._hostHandleSelfDeath('guest',{reason:'fall'},false),false,
  'network fall-death claims must not enter the death pipeline');
console.log('No fall damage: high landing, direct fall call, void recovery, and host fall-death rejection pass in offline, online, and deathmatch.');
