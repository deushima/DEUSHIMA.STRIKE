import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Player } from '../src/core/player.js';
import { WeaponSystem } from '../src/weapons.js';
import { OnlineMatch } from '../src/online/match.js';
import { HitHistory } from '../src/online/hit-history.js';
import { characterHitboxes, intersectHitbox } from '../src/combat/hitboxes.js';

const realNow=Date.now;
let now=100000;Date.now=()=>now;
const summaries=[];
try {
  for(const id of ['ak47','m4a1','m249'])for(const fps of [30,60,144])for(const guest of [false,true])for(const moving of [false,true]) {
    now=100000;
    const packets=[],accepted=[];
    const game={state:'playing',time:0,scene:new THREE.Scene(),settings:{},audio:{play(){}},effects:{},canUseWeapons:()=>true,
      input:{locked:true,wasPressed:()=>false,wasMousePressed:()=>false,isMouseDown:()=>true,consumeWheel:()=>0},raycastShot:()=>null};
    const player=game.player=new Player(game);player.alive=true;player.onGround=true;player.vel.x=moving?3:0;
    // moveSpeed remains the movement limit (6.25), including while stationary.
    class TrialWeapon extends WeaponSystem{_updateGrenadeProjectiles(){}_updateDropped(){}_updateVisuals(){}}
    const w=game.weapons=new TrialWeapon(game);w.currentId=id;w.inventory.primary={id,magazine:30,reserve:0};
    const shooterId=guest?'guest':'host';
    const record={id:shooterId,alive:true,lifeSeq:2,inventory:{primary:{id,magazine:30,reserve:0}},lastState:{pos:{x:0,y:0,z:0},moveSpeed:0,onGround:true},lastStateAt:now};
    const host=Object.assign(Object.create(OnlineMatch.prototype),{isHost:true,localId:'host',phase:'live',roundNumber:1,game,players:new Map([[shooterId,record]]),_shotSeq:0,
      _hostResolvePellet(s,o,d,weapon,seq){accepted.push({seq,dir:d.clone()});}});
    game.online=guest?Object.assign(Object.create(OnlineMatch.prototype),{isHost:false,localId:'guest',phase:'live',roundNumber:1,game,_shotSeq:0,
      players:new Map([[shooterId,record]]),_sendToHost(type,payload){packets.push({type,payload,at:now});}}):host;
    for(let f=1;f<=fps*5&&w.shotLog.length<30;f++) {now=100000+Math.round(f*1000/fps);w.update(1/fps);}
    if(guest)for(const [i,packet] of packets.entries()) {
      // Variable transit times and ordered batches, without changing fire times.
      now=Math.max(i?now:0,packet.at+[100,20,80,30,90,40][i%6]);record.lastStateAt=now;
      host._handleGuestShot(packet.payload,'guest');
    }
    assert.equal(w.shotLog.length,30);
    assert.equal(accepted.length,30,`${id}/${fps}/${guest}: every legitimate round is accepted`);
    const errors=accepted.map(a=>new THREE.Vector3(...w.shotLog[a.seq-1].dir).distanceTo(a.dir));
    assert.ok(Math.max(...errors)<1e-10,`${id}/${fps}/${guest}/${moving}: host and shooter must use identical bullet directions`);
    if(guest) {
      assert.equal(record.inventory.primary.magazine,0);
      const last=packets.at(-1).payload;
      record.inventory.primary.magazine=10;
      host._handleGuestShot(last,'guest');
      host._handleGuestShot({...last,seq:31,shotTime:last.shotTime+.001},'guest');
      host._handleGuestShot({...last,seq:32,shotTime:last.shotTime+10},'guest');
      host._handleGuestShot({...last,seq:33,shotTime:last.shotTime+.2,round:0},'guest');
      host._handleGuestShot({...last,seq:34,shotTime:last.shotTime+.2,lifeSeq:1},'guest');
      assert.equal(accepted.length,30,'duplicate, impossible cadence and future clock rejected');
      assert.equal(record.inventory.primary.magazine,10);
      assert.equal(last.lifeSeq,2,'shots identify the current life');
    }
    summaries.push({id,fps,role:shooterId,moving,shots:30,maxDirectionError:Math.max(...errors)});
  }

  // Historical geometry moves and crouches; current ray misses, old ray hits.
  const history=new HitHistory();
  const box=x=>[{part:'chest',box:new THREE.Box3(new THREE.Vector3(x-.2,1,-.2),new THREE.Vector3(x+.2,1.6,.2))}];
  history.capture('host',1000,box(0));history.capture('host',1100,box(1));history.capture('host',1200,box(2));
  const origin=new THREE.Vector3(0,1.3,5),dir=new THREE.Vector3(0,0,-1);
  assert.ok(history.raycast('host',1000,origin,dir,20).hit);
  assert.equal(history.raycast('host',1200,origin,dir,20).hit,null);
  assert.ok(history.raycast('host',1050,new THREE.Vector3(.5,1.3,5),dir,20).hit);
  const target={team:'CT',alive:true};
  const match=Object.assign(Object.create(OnlineMatch.prototype),{localId:'host',isDeathmatch:false,_shotHistory:history,
    game:{player:target,physics:{raycast:()=>null},getPlayerHitboxes:()=>box(2)},getRemoteEntities:()=>[]});
  now=1200;
  const shooter={id:'guest',team:'T',ping:120};
  assert.equal(match._rewoundRaycast(origin,dir,20,shooter,{viewTimes:{host:1000}}).entity,target);
  assert.equal(match._rewoundRaycast(origin,dir,20,shooter,{viewTimes:{host:999999}}),null,'future requests clamp to current pose');
  assert.equal(match._rewoundRaycast(origin,dir,20,{...shooter,team:'CT'},{viewTimes:{host:1000}}),null,'classic teammates excluded');
  match.isDeathmatch=true;
  assert.equal(match._rewoundRaycast(origin,dir,20,{...shooter,team:'CT'},{viewTimes:{host:1000}}).entity,target,'DM same-team damage preserved');
  match.game.physics.raycast=()=>({t:2,point:new THREE.Vector3(0,1.3,3)});
  assert.equal(match._rewoundRaycast(origin,dir,20,shooter,{viewTimes:{host:1000}}).type,'world','rewind never shoots through a wall');
  history.delete('host');assert.equal(history.raycast('host',1000,origin,dir,20).available,false,'respawn clears past life');

  // Exercise the same deformation API as the imported CT/T skinned meshes.
  const geometry=new THREE.BoxGeometry(.4,.6,.4),count=geometry.attributes.position.count;
  const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial()),bone=new THREE.Bone();bone.name='spine';
  mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));
  const root=new THREE.Group();root.add(mesh);
  const character={root,model:mesh};
  const poses=new HitHistory();poses.capture('skin',1000,characterHitboxes(character,'CT'));
  bone.position.x=2;poses.capture('skin',1100,characterHitboxes(character,'CT'));
  const before=bone.matrixWorld.clone(),beforeMesh=mesh.matrixWorld.clone(),rayStart=new THREE.Vector3(0,0,5);
  assert.equal(intersectHitbox(rayStart,dir,character.ballisticMeshes[0],20),null);
  assert.ok(poses.raycast('skin',1000,rayStart,dir,20).hit,'rewound animated triangles register');
  assert.deepEqual(bone.matrixWorld.elements,before.elements,'bone matrices restored');
  assert.deepEqual(mesh.matrixWorld.elements,beforeMesh.elements,'mesh matrices restored');
  assert.equal(intersectHitbox(rayStart,dir,character.ballisticMeshes[0],20),null,'live pose remains unchanged after rewind');
  // Moving the entire rig also changes the attached skin's bind inverse.
  bone.position.x=0;root.position.x=0;
  const translated=new HitHistory();translated.capture('skin',2000,characterHitboxes(character,'CT'));
  root.position.x=3;translated.capture('skin',2100,characterHitboxes(character,'CT'));
  const liveBind=mesh.bindMatrixInverse.clone();
  assert.ok(translated.raycast('skin',2000,rayStart,dir,20).hit,'translated rig rewinds skin bind space');
  assert.deepEqual(mesh.bindMatrixInverse.elements,liveBind.elements,'live bind inverse restored');
  assert.equal(intersectHitbox(rayStart,dir,character.ballisticMeshes[0],20),null);
  for(let t=1200;t<5000;t+=40)poses.capture('skin',t,characterHitboxes(character,'CT'));
  assert.ok(poses.players.get('skin').length<18,'history remains bounded');

  let markers=0;
  const feedback=Object.assign(Object.create(OnlineMatch.prototype),{localId:'host',game:{ui:{showHitmarker(){markers++;}},audio:{play(){}}}});
  feedback._sendTo('host','hitConfirm',{miss:true});assert.equal(markers,0);
  feedback._sendTo('host','hitConfirm',{damage:27});assert.equal(markers,1,'host receives confirmed feedback');
  // Reload completion travels on the same simulation clock as subsequent fire.
  now=10000;
  const reloadRecord={id:'guest',alive:true,team:'T',inventory:{primary:{id:'ak47',magazine:0,reserve:90}},weaponId:'ak47'};
  const reloadMatch=Object.assign(Object.create(OnlineMatch.prototype),{isHost:true,phase:'live',localId:'host',game:{},players:new Map([['guest',reloadRecord]]),_ensureRemotePlayer:()=>null,_validShotOrigin:()=>true,_hostResolvePellet(){}});
  const reloadState={pos:{x:0,y:0,z:0},weaponId:'ak47',reloading:true,weaponTime:10,reloadRemaining:2.5};
  reloadMatch._acceptState('guest',reloadState);
  const serverDeadline=reloadRecord.reloadReadyAt,clientDeadline=reloadRecord.reloadClientReadyAt;
  now=serverDeadline-50;
  reloadMatch._acceptState('guest',{...reloadState,reloading:false});
  assert.equal(reloadRecord.reloadReadyAt,serverDeadline,'early reload-complete state must not cancel server refill');
  reloadMatch._hostResolveShot('guest',origin,dir,'ak47',null,1,{shotTime:clientDeadline/1000});
  assert.equal(reloadRecord.acceptedShotSeq,1,'first legitimate shot after reload accepted despite receipt jitter');
  assert.equal(reloadRecord.inventory.primary.magazine,29);
  assert.equal(reloadRecord.inventory.primary.reserve,60);
  console.log('Online registration OK: 36 full real WeaponSystem sprays / 1080 rounds, exact host/guest directions at 30/60/144 FPS with jitter; replay/rate/clock validation; historical and skinned poses, occlusion, life reset, FFA and hit confirmations.');
  console.log(JSON.stringify({maxDirectionError:Math.max(...summaries.map(r=>r.maxDirectionError)),cases:summaries.length}));
} finally {Date.now=realNow;}
