import * as THREE from '../vendor/three.module.js';
import {bonePart,characterHitboxes} from '../src/combat/hitboxes.js';
export function installHitboxDebug(game){
 const colors={head:0xff665e,neck:0xffb46b,chest:0x6fe2b1,stomach:0xf9df68,leftarm:0x69cfff,rightarm:0x8b9fff,leftleg:0xc591ff,rightleg:0xff93cd};
 const tracked=new Map(),helpers=new Map(),point=new THREE.Mesh(new THREE.SphereGeometry(.035),new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false}));
 const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),.4,0xffffff);
 game.scene.add(point,arrow);point.visible=arrow.visible=false;
 const label=document.createElement('pre');label.style.cssText='position:fixed;left:12px;top:12px;max-width:550px;z-index:999;background:#101719e8;padding:12px;color:#eef4ed;font:12px monospace;pointer-events:none;white-space:pre-wrap';document.body.append(label);
 const original=game.raycastShot;let last='Sin disparo';
 game.raycastShot=function(origin,dir,...args){const hit=original.call(this,origin,dir,...args);if(hit){point.position.copy(hit.point);point.visible=true;if(hit.normal){arrow.position.copy(hit.point);arrow.setDirection(hit.normal);arrow.visible=true;}}
 last=JSON.stringify({weapon:this.weapons?.currentId,result:hit?.type||'miss',hitgroup:hit?.part||null,distance:hit?.t,point:hit?.point,normal:hit?.normal,rejection:hit?.type==='world'?'occluded by world':hit?'nearest deformed triangle':'no intersection'},null,1);return hit;};
 function frame(){
  const characters=[...(game.bots?.bots||[]).filter(b=>b.alive).map(b=>[b.parts?.character,b.team]),...[...(game.online?.avatars?.values()||[])].map(a=>[a._kenney,a.team])];
  for(const [character,team] of characters){if(!character)continue;
   if(!helpers.has(character)){const helper=new THREE.SkeletonHelper(character.root);helper.material.depthTest=false;game.scene.add(helper);helpers.set(character,helper);}
   for(const {mesh} of characterHitboxes(character,team))if(!tracked.has(mesh)){
    tracked.set(mesh,{geometry:mesh.geometry,material:mesh.material});mesh.geometry=mesh.geometry.clone();
    const weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex,color=[];
    for(let i=0;i<weights.count;i++){let best=0;for(let k=1;k<4;k++)if(weights.getComponent(i,k)>weights.getComponent(i,best))best=k;const part=bonePart(mesh.skeleton.bones[indices.getComponent(i,best)]?.name||'',team),c=new THREE.Color(colors[part]);color.push(c.r,c.g,c.b);}
    mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));mesh.material=new THREE.MeshBasicMaterial({vertexColors:true,wireframe:true,side:THREE.DoubleSide});
   }
  }
  label.textContent='DEBUG LOCAL · triángulos animados y huesos\nCabeza rojo / torso verde / abdomen amarillo / extremidades azul-violeta\n'+last;
  requestAnimationFrame(frame);
 }
 frame();return {tracked,helpers};
}
