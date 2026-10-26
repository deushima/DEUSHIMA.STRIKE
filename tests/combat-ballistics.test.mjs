import assert from 'node:assert/strict';
import { CS2_PROFILES } from '../src/combat/cs2-data.js';
import { WEAPONS } from '../src/weapons.js';
import { calculateBulletDamage, resolveArmorDamage, HITGROUP } from '../src/combat/ballistics.js';
import { RecoilState, OPENING_STRAIGHT_SHOTS } from '../src/combat/recoil.js';
import { RECOIL_PATHS } from '../src/combat/recoil-reference.js';
import { Player } from '../src/core/player.js';
import { BotManager } from '../src/bots.js';
import { Game } from '../src/game.js';
import { OnlineMatch } from '../src/online/match.js';
const full={health:100,armor:100,helmet:true};
let cases=0;
for(const [id,p] of Object.entries(CS2_PROFILES)) {
 if(WEAPONS[id]) {assert.equal(WEAPONS[id].damage,p.baseDamage);assert.equal(WEAPONS[id].fireInterval,p.cycleTime[0]);}
 for(const part of Object.keys(HITGROUP))for(const distance of [0,250,500,1000,2000,4000])for(const armor of [0,1,4,99,100])for(const helmet of [false,true]) {
  const r=calculateBulletDamage(id,part,distance/40,{...full,armor,helmet});
  assert.ok(Number.isInteger(r.healthDamage));assert.ok(r.armorRemaining>=0);assert.ok(r.healthRemaining>=0);
  if(part.includes('leg'))assert.equal(r.armorDamage,0);
  if(part==='head'&&!helmet)assert.equal(r.armorDamage,0);
  assert.ok(r.healthDamage<=p.baseDamage*4*1.25);cases++;
 }
}
const expected={ak47:[36,27,144,111],m4a1:[33,23,132,92],m4a1s:[38,26,132,92]};
for(const [id,values] of Object.entries(expected))assert.deepEqual([
 calculateBulletDamage(id,'chest',0,{armor:0}).healthDamage,
 calculateBulletDamage(id,'chest',0,full).healthDamage,
 calculateBulletDamage(id,'head',0,{armor:100,helmet:false}).healthDamage,
 calculateBulletDamage(id,'head',0,full).healthDamage],values);
assert.equal(calculateBulletDamage('ak47','chest',500/40,full).healthDamage,27);
assert.equal(calculateBulletDamage('ak47','chest',2000/40,full).healthDamage,25);
assert.equal(calculateBulletDamage('m4a1','head',2000/40,full).healthDamage,81);
assert.equal(resolveArmorDamage(36,{armor:1},'chest','ak47').healthDamage,34);
assert.equal(resolveArmorDamage(36,{armor:1},'chest','ak47').armorRemaining,0);
// Actual entity methods, not only constants: three AK chest hits must agree.
const game={time:1,audio:{play(){}},ui:{flashDamage(){}},classicUI:{},notifyKill(){},player:null};
const player=new Player(game);Object.assign(player,full,{alive:true,spawnProtection:0});game.player=player;
for(let i=0;i<3;i++)Game.prototype.damagePlayer.call(game,36,null,'chest','ak47');
assert.equal(player.health,19);assert.equal(player.armor,88);
const manager=Object.create(BotManager.prototype);manager.game={effects:{}};manager._time=1;
manager._distToPlayer=()=>100;
const bot={...full,alive:true};
for(let i=0;i<3;i++)manager.damageBot(bot,36,null,'chest','ak47');
assert.equal(bot.health,19);assert.equal(bot.armor,88);
const match=Object.create(OnlineMatch.prototype);match.localId='local';
const remote={...full,id:'remote'};
for(let i=0;i<3;i++)match._hostDamage(remote,36,'chest','ak47');
assert.equal(remote.health,19);assert.equal(remote.armor,88);
// Published trajectory sampled at every weapon deadline, at different render rates.
for(const id of Object.keys(RECOIL_PATHS)) {
 const p=CS2_PROFILES[id],ref=RECOIL_PATHS[id];
 for(const fps of [30,60,120,144]) {
  const state=new RecoilState(id),rows=[];let due=0;
  for(let frame=0;rows.length<ref.length;frame++)while(due<=frame/fps+1e-9&&rows.length<ref.length) {
   const r=state.fire(due);rows.push([-r.yaw*180/Math.PI,r.pitch*180/Math.PI]);due+=p.cycleTime[0];
  }
  rows.forEach((r,i)=>{
   const target=i<OPENING_STRAIGHT_SHOTS?[0,0]:ref[Math.min(i-OPENING_STRAIGHT_SHOTS+1,ref.length-1)];
   r.forEach((v,j)=>assert.ok(Math.abs(v-target[j])<1e-9,`${id}/${fps}/${i}`));
  });
 }
 const state=new RecoilState(id);state.fire(0);state.fire(p.cycleTime[0]);
 assert.equal(state.fire(p.cycleTime[0]+.15).index,2,'brief pause must preserve shot index');
 assert.equal(state.fire(3).index,0,'recovered tap begins a new spray');
}
console.log(`Combat OK: ${cases} damage cases; runtime Player/Bot/host 3 AK chest=19HP/88armor; full measured recoil paths at 30/60/120/144 FPS.`);
