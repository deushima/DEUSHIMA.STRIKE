import * as THREE from '../../vendor/three.module.js';
import { hasNativeWeaponAsset, loadWeaponModel } from '../weapon-assets.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const AX = V(1,0,0);
const clamp = THREE.MathUtils.clamp;

function weaponVisuals() {
  const pivot = new THREE.Group(), meshes={}, native=new Map(), pending=new Set();
  const metal=new THREE.MeshStandardMaterial({color:0x394147,metalness:.65,roughness:.45});
  const polymer=new THREE.MeshStandardMaterial({color:0x202426,metalness:.05,roughness:.86});
  function box(parent, size, pos, mat=metal){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.position.set(...pos);parent.add(m);}
  for(const family of ['AK','SMG','Sniper','Pistol','Knife']){
    const g=new THREE.Group();g.name='world-weapon:'+family;pivot.add(g);meshes[family]=g;
    if(family==='Knife'){box(g,[.025,.025,.23],[0,0,-.09]);box(g,[.04,.04,.11],[0,0,.07],polymer);continue;}
    const pistol=family==='Pistol',length=pistol?.22:family==='SMG'?.39:.55;
    box(g,[.07,.095,length],[0,.025,-length*.35]);
    box(g,[.055,.13,.065],[0,-.07,.025],polymer);
    if(!pistol){
      box(g,[.04,.035,family==='Sniper'?.35:.18],[0,.035,-length*.95]);
      box(g,[.06,.14,.085],[0,-.07,-.14],polymer);
      box(g,[.075,.09,.18],[0,.02,.16],polymer);
      if(family==='Sniper')box(g,[.06,.065,.19],[0,.11,-.12],polymer);
    }
  }
  function select(id,family){
    pivot.userData.selected=id;
    for(const [key,group] of Object.entries(meshes)) group.visible=key===family && !native.has(id);
    for(const [key,group] of native) group.visible=key===id;
    if(!hasNativeWeaponAsset(id)||native.has(id)||pending.has(id)||typeof window==='undefined')return;
    pending.add(id);
    loadWeaponModel(id,'world').then(model=>{
      const group=new THREE.Group();group.name=`world-weapon:${id}`;
      model.position.z=-.08;group.add(model);pivot.add(group);native.set(id,group);
      group.visible=false;
      if(pivot.userData.selected===id)select(id,family);
    }).catch(error=>console.warn(`[world weapon] ${id} asset unavailable`,error)).finally(()=>pending.delete(id));
  }
  return {pivot,meshes,select,dispose(){for(const group of Object.values(meshes))group.traverse(o=>o.geometry?.dispose());metal.dispose();polymer.dispose();}};
}

// Gameplay-driven poses are authored here independently. No Valve animation is
// used. Both wrists use two-bone IK to keep the original mesh on weapon grips.
export function createCommunityAnimator(model, team) {
  const root=new THREE.Group();root.add(model);
  const bones=[];model.traverse(o=>{if(o.isBone)bones.push(o);});
  const canonical=(name)=>name.replace(/_\d+$/,'').replace(/\./g,'');
  const find=(name)=>bones.find(b=>canonical(b.name)===canonical(name));
  const hips=find(team==='T'?'spine':'pelvis');
  const spine=team==='T'?[find('spine.001'),find('spine.002'),find('spine.003')]:[find('spine'),find('chest')];
  const neck=team==='T'?[find('spine.004'),find('spine.005'),find('spine.006')]:[find('neck'),find('head')];
  const rest=bones.map(b=>({b,p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));
  root.updateWorldMatrix(true,true);
  const rootInverse=root.matrixWorld.clone().invert();
  const restFeet={},restEndRotation={};for(const s of ['L','R']){
    restFeet[s]=find('foot.'+s).getWorldPosition(V()).applyMatrix4(rootInverse);
    for(const name of ['foot.'+s,'hand.'+s])restEndRotation[name]=find(name).getWorldQuaternion(new THREE.Quaternion());
  }
  const gun=weaponVisuals();root.add(gun.pivot);
  let weapon='',weaponFamily='AK',state='idle',phase=0,previousGround=true,landing=0,crouch=0,moveBlend=0;
  const aimBones=Object.fromEntries([...spine,...neck].filter(Boolean).map(b=>[b.name,b]));
  const point=(local)=>root.localToWorld(local.clone());
  function rotateWorld(b,axis,angle){
    if(!b)return;
    root.updateWorldMatrix(true,true);
    const current=b.getWorldQuaternion(new THREE.Quaternion());
    const parent=b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    b.quaternion.copy(parent.multiply(new THREE.Quaternion().setFromAxisAngle(axis,angle)).multiply(current));
    b.updateWorldMatrix(false,true);
  }
  function turnToward(b,child,target){
    const p=b.getWorldPosition(V()),from=child.getWorldPosition(V()).sub(p).normalize(),to=target.clone().sub(p).normalize();
    if(!from.lengthSq()||!to.lengthSq())return;
    const q=new THREE.Quaternion().setFromUnitVectors(from,to);
    b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    b.updateWorldMatrix(false,true);
  }
  function ik(a,b,c,target,pole){
    if(!a||!b||!c)return;
    root.updateWorldMatrix(true,true);
    const start=a.getWorldPosition(V()),middle=b.getWorldPosition(V()),end=c.getWorldPosition(V());
    const l1=start.distanceTo(middle),l2=middle.distanceTo(end),delta=target.clone().sub(start);
    const dist=clamp(delta.length(),Math.abs(l1-l2)+.001,l1+l2-.001),dir=delta.normalize();
    const bend=pole.clone().sub(start);bend.addScaledVector(dir,-bend.dot(dir)).normalize();
    const along=(l1*l1-l2*l2+dist*dist)/(2*dist),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    turnToward(a,b,start.clone().addScaledVector(dir,along).addScaledVector(bend,height));
    turnToward(b,c,start.clone().addScaledVector(dir,dist));
  }
  function setWeapon(id){
    weapon=String(id||'knife');
    const family=/^(deagle|usp|glock|glock18|p228|elite|fiveseven)$/.test(weapon)?'Pistol':/^(mp5|tmp|p90|ump45|mac10)$/.test(weapon)?'SMG':/^(awp|scout|sg550|g3sg1)$/.test(weapon)?'Sniper':weapon==='knife'?'Knife':'AK';
    weaponFamily=family;
    gun.select(weapon,family);
  }
  function update(dt,actor={},moving=false){
    dt=clamp(Number(dt)||0,0,.1);
    for(const r of rest){r.b.position.copy(r.p);r.b.quaternion.copy(r.q);r.b.scale.copy(r.s);}
    const grounded=actor.onGround!==false,duck=!!actor.crouching;
    const speed=Number(actor.speed??actor.moveSpeed)|| (moving?1.8:0);
    crouch=THREE.MathUtils.damp(crouch,duck?1:0,14,dt);
    moveBlend=THREE.MathUtils.damp(moveBlend,grounded?clamp(speed/.7,0,1):0,12,dt);
    if(grounded&&!previousGround)landing=.16;previousGround=grounded;landing=Math.max(0,landing-dt);
    const jump=actor.jumpState||(grounded?'ground':Number(actor.velocity?.y)>0?'rise':'fall');
    state=duck?'duck':!grounded?(jump==='rise'?'jump':'jump_idle'):speed>.45?(speed>3.2?'run_gun':'walk'):'idle';
    if(actor.shooting&&grounded&&!duck)state=speed>.45?'run_shoot':'idle_shoot';
    setWeapon(actor.weaponId||weapon);
    const hipDrop=crouch*.48+Math.sin(landing/.16*Math.PI)*.045;
    root.updateWorldMatrix(true,true);
    const desiredHip=hips.getWorldPosition(V()).add(point(V(0,-hipDrop,0)).sub(point(V())));
    hips.position.copy(hips.parent.worldToLocal(desiredHip));
    root.updateWorldMatrix(true,true);
    const pitch=clamp(Number(actor.pitch)||0,-80*Math.PI/180,80*Math.PI/180);
    const rightAxis=AX.clone().transformDirection(root.matrixWorld);
    for(const b of spine)rotateWorld(b,rightAxis,pitch*.32/spine.length+crouch*.12/spine.length);
    for(const b of neck)rotateWorld(b,rightAxis,pitch*.42/neck.length);
    const stride=clamp(speed*.065,.08,.32)*(1-.5*crouch);
    phase+=dt*Math.min(19,speed/Math.max(.12,stride)*Math.PI*.75);
    const yaw=Number(actor.yaw)||0,v=actor.velocity;
    let dx=v?Math.cos(yaw)*v.x-Math.sin(yaw)*v.z:0;
    let dz=v?Math.sin(yaw)*v.x+Math.cos(yaw)*v.z:-1;
    const norm=Math.hypot(dx,dz);if(norm>.05){dx/=norm;dz/=norm;}else{dx=0;dz=-1;}
    for(const [side,offset]of [['L',0],['R',Math.PI]]){
      const f=restFeet[side].clone(),wave=Math.sin(phase+offset);
      f.x+=dx*stride*wave*moveBlend;f.z+=dz*stride*wave*moveBlend;
      f.y+=Math.max(0,Math.cos(phase+offset))*.11*moveBlend;
      if(!grounded){f.y+=jump==='rise'?.10:.035;f.z+=.06;}
      ik(find('thigh.'+side),find('shin.'+side),find('foot.'+side),point(f),point(V(side==='L'?-.13:.13,.48,-.9)));
      const foot=find('foot.'+side);
      foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(root.getWorldQuaternion(new THREE.Quaternion())).multiply(restEndRotation['foot.'+side]));
      foot.updateWorldMatrix(false,true);
    }
    // The weapon and its grip targets share the same transform. Aim rotates
    // upper-body joints; the player's root, collider and camera ray stay intact.
    gun.pivot.position.set(.08,1.30-hipDrop,team==='CT'?-.11:-.22);
    gun.pivot.rotation.set(pitch,0,0);
    if(actor.shooting)gun.pivot.position.z+=.012;
    root.updateWorldMatrix(true,true);
    for(const [side,grip]of [['R',V(0,-.065,.025)],['L',V(-.035,-.025,weaponFamily==='Pistol'?-.10:-.16)]]){
      const hand=find('hand.'+side);
      const target=gun.pivot.localToWorld(grip);
      ik(find('upper_arm.'+side),find('forearm.'+side),hand,target,point(V(side==='L'?-.55:.55,.99-hipDrop,.05)));
      const neutral=root.getWorldQuaternion(new THREE.Quaternion()).multiply(restEndRotation['hand.'+side]);
      const palm=V(0,1,0).applyQuaternion(neutral),forward=V(0,0,-1).transformDirection(gun.pivot.matrixWorld);
      const aligned=new THREE.Quaternion().setFromUnitVectors(palm,forward).multiply(neutral);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(aligned));
    }
    root.updateWorldMatrix(true,true);
  }
  setWeapon(team==='T'?'ak47':'m4a1');update(0,{weaponId:weapon,onGround:true});
  return {root,model,gunMeshes:gun.meshes,aimBones,mixer:new THREE.AnimationMixer(model),actions:{},
    yawOffset:0,targetHeight:1.8,characterId:team==='T'?'community-leet-fe6216ca':'community-sas-e9c56308',
    get state(){return state;},setState(name){state=String(name).toLowerCase();},setWeapon,update,
    dispose(){gun.dispose();const seen=new Set();model.traverse(o=>{if(o.skeleton&&!seen.has(o.skeleton)){seen.add(o.skeleton);o.skeleton.dispose();}});root.removeFromParent();},
    getGripErrors(){const rows={};for(const [side,local]of [['R',V(0,-.065,.025)],['L',V(-.035,-.025,weaponFamily==='Pistol'?-.10:-.16)]])rows[side]=find('hand.'+side).getWorldPosition(V()).distanceTo(gun.pivot.localToWorld(local));return rows;},
  };
}
