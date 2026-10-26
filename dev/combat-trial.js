import * as THREE from '../vendor/three.module.js';
import {WeaponSystem,WEAPONS} from '../src/weapons.js';
import {Player} from '../src/core/player.js';
import {PhysicsWorld} from '../src/core/physics.js';
import {CS2_PROFILES,CS2_SNAPSHOT} from '../src/combat/cs2-data.js';
import {RECOIL_PATHS,RECOIL_REFERENCE} from '../src/combat/recoil-reference.js';
import {OPENING_STRAIGHT_SHOTS} from '../src/combat/recoil.js';
export function runTrial({id='ak47',fps=60,dispersion=false,mouseYaw=0,mousePitch=0,frameDrops=false}={}){
 const profile=CS2_PROFILES[id];
 const physics=new PhysicsWorld([new THREE.Box3(new THREE.Vector3(-100,-100,-25.05),new THREE.Vector3(100,100,-25))]);
 let pressed=true;
 const game={state:'playing',time:0,physics,scene:new THREE.Scene(),settings:{},audio:{play(){}},effects:{},canUseWeapons:()=>true,
 input:{locked:true,wasPressed:()=>false,wasMousePressed:()=>false,isMouseDown:()=>pressed,consumeWheel:()=>0},
 raycastShot:(origin,dir,range)=>{const h=physics.raycast(origin,dir,range);return h?{...h,type:'world'}:null;}};
 const player=new Player(game);game.player=player;player.pos.set(0,0,0);player.yaw=mouseYaw;player.pitch=mousePitch;player.onGround=true;player.alive=true;
 const definition={...WEAPONS.m4a1,id,ballisticProfile:profile,damage:profile.baseDamage,headshotMult:profile.headshotMultiplier,fireInterval:profile.cycleTime[0],fireRate:1/profile.cycleTime[0],magazine:profile.magazine,reserve:0,pellets:profile.pellets,range:profile.rangeCS/40,auto:true};
 // Diagnostic M4A1-S uses the same firing implementation without adding a
 // nonexistent model/weapon to the player's production arsenal.
 class TrialWeapon extends WeaponSystem{_currentWeapon(){return definition;}_currentEntry(){return this.inventory.primary;}_updateGrenadeProjectiles(){}_updateDropped(){}_updateVisuals(){}}
 const weapons=new TrialWeapon(game,{disableDispersion:!dispersion});game.weapons=weapons;
 weapons.currentId=id;weapons.inventory.primary={id,magazine:profile.magazine,reserve:0};
 for(let frame=0;weapons.shotLog.length<profile.magazine&&frame<fps*12;frame++)weapons.update(frameDrops&&frame%17===0?.09:1/fps);
 pressed=false;
 const first=weapons.shotLog[0]?.time||0,ref=RECOIL_PATHS[id],rows=weapons.shotLog.map((r,i)=>{
  const dir=new THREE.Vector3(...r.dir),yaw=Math.atan2(dir.x,-dir.z)*180/Math.PI,pitch=Math.asin(dir.y)*180/Math.PI;
  const target=ref?.[i];
  const gameTarget=i<OPENING_STRAIGHT_SHOTS?[0,0]:ref?.[Math.min(i-OPENING_STRAIGHT_SHOTS+1,ref.length-1)];
  const error=gameTarget?Math.hypot(yaw-gameTarget[0],pitch-gameTarget[1]):null;
  const sourceError=target?Math.hypot(yaw-target[0],pitch-target[1]):null;
  return {...r,time:r.time-first,impactX:r.point?.[0],impactY:(r.point?.[1]??0)-player.eyeHeight,measuredYaw:yaw,measuredPitch:pitch,reference:target,gameTarget,error,sourceError,seed:profile.recoil.seed};
 });
 return {id,fps,dispersion,distanceWorld:25,csUnitsPerWorld:40,snapshot:CS2_SNAPSHOT.commit,rows,maxError:Math.max(...rows.map(r=>r.error||0)),rms:Math.sqrt(rows.reduce((n,r)=>n+(r.error||0)**2,0)/rows.length),maxSourceError:Math.max(...rows.map(r=>r.sourceError||0)),rmsSource:Math.sqrt(rows.reduce((n,r)=>n+(r.sourceError||0)**2,0)/rows.length),reference:RECOIL_REFERENCE,openingStraightShots:OPENING_STRAIGHT_SHOTS};
}
