import * as THREE from '../../vendor/three.module.js';
// Anatomical adapter for the two credited community rigs, not Valve hitbox data.
// Exact deformed triangles supply contact; skin weights classify the contact.
export function bonePart(name, team) {
  const n=name.replace(/_\d+$/,'').replace(/\./g,'').toLowerCase();
  const side=/l(?:\d+)?$|left/.test(n)?'left':'right';
  if(/thigh|shin|foot|toe/.test(n))return side+'leg';
  if(/upper_arm|forearm|hand|finger|thumb|palm/.test(n))return side+'arm';
  if(team==='T' && /spine00[456]|head|jaw|eye|face|nose|lip|chin|ear|brow|lid|tongue/.test(n))return 'head';
  if(/head|jaw|eye/.test(n))return 'head';
  if(/neck/.test(n))return 'neck';
  if(/pelvis|hip/.test(n) || (team==='T' && /^(spine|spine001)$/.test(n)))return 'stomach';
  return 'chest';
}
const caster=new THREE.Raycaster(), inverseWorld=new THREE.Matrix4(), localPoint=new THREE.Vector3(), a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),bary=new THREE.Vector3();
function classify(mesh, hit, team) {
  if(!mesh.isSkinnedMesh || !hit.face)return 'chest';
  // Use the raycast pose, including a historical pose during online rewind.
  // worldToLocal updates matrices from the live transform and would undo it.
  localPoint.copy(hit.point).applyMatrix4(inverseWorld.copy(mesh.matrixWorld).invert());
  const indices=[hit.face.a,hit.face.b,hit.face.c];
  mesh.getVertexPosition(indices[0],a);mesh.getVertexPosition(indices[1],b);mesh.getVertexPosition(indices[2],c);
  THREE.Triangle.getBarycoord(localPoint,a,b,c,bary);
  const scores={};
  const weights=mesh.geometry.attributes.skinWeight, joints=mesh.geometry.attributes.skinIndex;
  for(let v=0;v<3;v++)for(let k=0;k<4;k++) {
    const weight=weights.getComponent(indices[v],k)*Math.max(0,bary.getComponent(v));
    const part=bonePart(mesh.skeleton.bones[joints.getComponent(indices[v],k)]?.name||'',team);
    scores[part]=(scores[part]||0)+weight;
  }
  return Object.keys(scores).sort((x,y)=>scores[y]-scores[x])[0]||'chest';
}
export function characterHitboxes(character,team) {
  if(!character)return null;
  if(!character.ballisticMeshes) {
    character.ballisticMeshes=[];
    character.model.traverse(mesh=>{if(mesh.isSkinnedMesh){
      // A pose-independent broad phase; only real animated triangles cause damage.
      mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e5);
      mesh.boundingBox=null;
      character.ballisticMeshes.push({mesh,team,part:'chest'});
    }});
  }
  character.root.updateWorldMatrix(true,false);
  character.root.updateMatrixWorld(true);
  for(const hb of character.ballisticMeshes) hb.mesh.skeleton.update();
  return character.ballisticMeshes;
}
export function intersectHitbox(origin,direction,hb,maxDist) {
  if(!hb.mesh){
    const point=new THREE.Ray(origin,direction).intersectBox(hb.box,new THREE.Vector3());
    if(!point || point.distanceTo(origin)>maxDist)return null;
    return {t:point.distanceTo(origin),normal:direction.clone().negate(),part:hb.part};
  }
  caster.set(origin,direction);caster.near=0;caster.far=maxDist;
  const hits=[];hb.mesh.raycast(caster,hits);
  hits.sort((a,b)=>a.distance-b.distance);
  const hit=hits[0];if(!hit)return null;
  return {t:hit.distance,normal:hit.face.normal.clone().transformDirection(hb.mesh.matrixWorld),part:classify(hb.mesh,hit,hb.team)};
}
// Pose-aware logical adapter for loading/fallback characters, with distinct limbs.
export function logicalHitboxes(entity) {
  const p=entity.pos,h=entity.height||1.8,s=h/1.8,yaw=entity.yaw||0;
  const make=(part,x,y,z,w,t,d)=>{
    const center=new THREE.Vector3(x,y,z).multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(p);
    return {part,box:new THREE.Box3().setFromCenterAndSize(center,new THREE.Vector3(w,t,d).multiplyScalar(s))};
  };
  return [make('head',0,1.66,0,.25,.28,.25),make('neck',0,1.48,0,.15,.08,.16),
    make('chest',0,1.3,0,.36,.3,.24),make('stomach',0,1,0,.34,.3,.26),
    make('leftarm',-.26,1.24,-.13,.14,.4,.2),make('rightarm',.26,1.24,-.13,.14,.4,.2),
    make('leftleg',-.12,.43,0,.16,.84,.2),make('rightleg',.12,.43,0,.16,.84,.2)];
}
