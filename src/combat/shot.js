import * as THREE from '../../vendor/three.module.js';
import { CS2_PROFILES } from './cs2-data.js';
import { seededRandom, OPENING_STRAIGHT_SHOTS } from './recoil.js';

export function aimDirection(yaw,pitch,out=new THREE.Vector3()) {
  return out.set(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)).normalize();
}

// Reproducible browser sampling. The two independent disks are kept separate;
// their RNG/distribution is not claimed to be Valve's closed runtime algorithm.
export function shotDirections(id,aim,punch,accuracy,{dispersion=true}={}) {
  const p=CS2_PROFILES[id];
  const yaw=Math.atan2(-aim.x,-aim.z)+punch.yaw;
  const pitch=Math.asin(THREE.MathUtils.clamp(aim.y,-1,1))+punch.pitch;
  const forward=aimDirection(yaw,pitch);
  const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
  const up=new THREE.Vector3().crossVectors(right,forward).normalize();
  const random=seededRandom((p?.recoil.seed||1)+Math.imul(punch.index+1,0x9e3779b9));
  return Array.from({length:p?.pellets||1},()=>{
    const dir=forward.clone();
    // Single-projectile opening rounds follow the player's actual aim. Keep
    // each shotgun pellet's cone; collapsing it would change the weapon class.
    if(dispersion && !(p?.pellets===1 && punch.index<OPENING_STRAIGHT_SHOTS))for(const amount of [accuracy.spread||0,accuracy.inaccuracy||0]) {
      const r=Math.sqrt(random())*amount,a=random()*Math.PI*2;
      dir.addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r);
    }
    return dir.normalize();
  });
}
