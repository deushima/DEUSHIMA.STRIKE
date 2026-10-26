import assert from 'node:assert/strict';
import {runTrial} from '../dev/combat-trial.js';
import {CS2_PROFILES} from '../src/combat/cs2-data.js';
import {RecoilState,accuracyRadius} from '../src/combat/recoil.js';
import {TriangleCollider} from '../src/core/triangle-collider.js';
import * as THREE from '../vendor/three.module.js';
for(const id of ['ak47','m4a1','m4a1s'])for(const fps of [30,60,120,144])for(const frameDrops of [false,true]){
 const trial=runTrial({id,fps,frameDrops});
 assert.equal(trial.rows.length,CS2_PROFILES[id].magazine);
 assert.ok(trial.maxError<1e-8,'actual bullet direction agrees with the five-shot game rule');
 assert.ok(trial.rows.slice(0,5).every(r=>Math.abs(r.measuredYaw)+Math.abs(r.measuredPitch)<1e-8),'opening five rounds track the raw aim');
 assert.ok(trial.rows.slice(6).some(r=>Math.abs(r.measuredYaw)+Math.abs(r.measuredPitch)>1),'published recoil starts after round five');
 assert.ok(trial.maxSourceError>1,'custom rule must be reported as a real deviation from CS2');
 for(let i=1;i<trial.rows.length;i++)assert.ok(Math.abs(trial.rows[i].time-trial.rows[i-1].time-CS2_PROFILES[id].cycleTime[0])<1e-8,'actual firing scheduler cadence');
 assert.ok(trial.rows.every(r=>Math.abs(r.point[2]+25)<1e-8),'every recorded contact is on the real calibrated wall');
}
const manual=runTrial({mousePitch:-.05,mouseYaw:.03}),plain=runTrial();
assert.ok(Math.abs((manual.rows[10].measuredPitch-plain.rows[10].measuredPitch)+.05*180/Math.PI)<1e-8,'mouse compensation remains independent');
const random=runTrial({dispersion:true});
assert.notDeepEqual(random.rows.map(r=>r.dir),plain.rows.map(r=>r.dir),'spread is genuinely ballistic');
assert.deepEqual(random.rows.map(r=>r.dir),runTrial({dispersion:true}).rows.map(r=>r.dir),'repeatable seed');
for(const [id,p] of Object.entries(CS2_PROFILES)){
 const trial=runTrial({id,dispersion:true});
 assert.ok(trial.rows.length>=5,`${id}: insufficient opening rounds`);
 assert.ok(trial.rows.slice(0,5).every(r=>Math.abs(r.yaw)+Math.abs(r.pitch)<1e-10),`${id}: first five recoil impulses must be zero`);
 if(p.pellets===1)assert.ok(trial.rows.slice(0,5).every(r=>Math.abs(r.measuredYaw)+Math.abs(r.measuredPitch)<1e-8),`${id}: first five actual bullets must track the aim`);
}
for(const id of Object.keys(CS2_PROFILES)){
 const s=new RecoilState(id),still=accuracyRadius(id,{onGround:true},s,0),run=accuracyRadius(id,{onGround:true,speed:6},s,0),air=accuracyRadius(id,{onGround:false},s,0),duck=accuracyRadius(id,{onGround:true,crouching:true},s,0);
 assert.ok(run.inaccuracy>=still.inaccuracy&&air.inaccuracy>=still.inaccuracy&&duck.inaccuracy<=still.inaccuracy);
}
// Regression: a long thin triangle must not create a wall outside its actual footprint.
const v=(x,y,z)=>new THREE.Vector3(x,y,z),a=v(28,3.5,-11.12),b=v(28,5.83,-11.09),c=v(25.74,5.83,-11.09);
const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),triangle=new TriangleCollider(a,b,c,n);
assert.equal(triangle.overlaps({pos:v(24,5.82,-11.22),radius:.3,height:1.8}),false);
assert.equal(triangle.sweep(v(24,5.82,-10.9),v(24,5.82,-11.4),.3,1.8),null);
console.log('Runtime combat: real WeaponSystem + wall impacts, 24 full sprays, all FPS/drop variants, input compensation, seeded spread, and phantom-triangle regression pass.');
