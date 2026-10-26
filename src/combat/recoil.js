import { CS2_PROFILES } from './cs2-data.js';
import { RECOIL_PATHS } from './recoil-reference.js';
const RAD = Math.PI/180;
export function seededRandom(seed) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
// State is per weapon; changing weapons does not erase a spray. Recovery is an
// explicit approximation, separate from the measured full-magazine trajectory.
export class RecoilState {
  constructor(id,seed=1){this.id=id;this.random=seededRandom(seed);this.reset();}
  reset(){this.index=0;this.last=-Infinity;this.pitch=0;this.yaw=0;this.inaccuracy=0;}
  recovery(crouch=false){const p=CS2_PROFILES[this.id];return (crouch?p?.recovery.crouchFinal:p?.recovery.standFinal)>0?(crouch?p.recovery.crouchFinal:p.recovery.standFinal):.5;}
  sample(time,crouch=false) {
    const p=CS2_PROFILES[this.id]; const idle=Math.max(0,time-this.last-(p?.cycleTime[0]||.1));
    const factor=Math.exp(-idle*5/this.recovery(crouch));
    // Firing inaccuracy recovers throughout the interval between shots. Recoil
    // uses the post-cycle idle interval so a full spray follows its measured path.
    const elapsed=Math.max(0,time-this.last);
    const accuracyFactor=Math.exp(-elapsed*5/this.recovery(crouch));
    return {pitch:this.pitch*factor,yaw:this.yaw*factor,index:this.index,inaccuracy:this.inaccuracy*accuracyFactor};
  }
  fire(time,{crouching=false}={}) {
    const p=CS2_PROFILES[this.id], path=RECOIL_PATHS[this.id];
    if(time-this.last>this.recovery(crouching)*2.5) this.reset();
    const current=this.sample(time,crouching);
    const pathIndex=this.index;
    const next=path?.[Math.min(pathIndex,path.length-1)];
    if(next) {
      const previous=path[Math.min(pathIndex-1,path.length-1)]||[0,0];
      this.pitch=current.pitch+(next[1]-previous[1])*RAD;
      this.yaw=current.yaw-(next[0]-previous[0])*RAD;
    } else {
      // Other weapons: seeded vdata impulse, not claimed to reproduce Source 2.
      const angle=((p?.recoil.angle[0]||0)+(this.random()-.5)*2*(p?.recoil.angleVariance[0]||0))*RAD;
      const mag=(p?.recoil.magnitude[0]||15)*.035*RAD;
      this.pitch=current.pitch+Math.cos(angle)*mag;this.yaw=current.yaw+Math.sin(angle)*mag;
    }
    this.inaccuracy=current.inaccuracy+(p?.inaccuracy.fire?.[0]||0);
    this.last=time;const shot=this.index++;
    return {index:shot,time,pitch:this.pitch,yaw:this.yaw};
  }
}
export function accuracyRadius(id, actor={}, recoil=null, time=0, scoped=false) {
  const p=CS2_PROFILES[id];if(!p)return 0;
  const mode=scoped?1:0;
  const read=x=>Array.isArray(x)?x[mode]:x||0;
  let accuracy=read(actor.crouching?p.inaccuracy.crouch:p.inaccuracy.stand);
  const speed=actor.getVelocity2D?.()??actor.speed??Math.hypot(actor.vel?.x||0,actor.vel?.z||0);
  const maxSpeed=p.maxSpeed[mode]/40;
  accuracy+=read(p.inaccuracy.move)*Math.max(0,Math.min(1,(speed/maxSpeed-.34)/.66));
  if(actor.onGround===false)accuracy+=read(p.inaccuracy.jump);
  if(actor.landingTime>0)accuracy+=read(p.inaccuracy.land);
  return {spread:read(p.spread),inaccuracy:accuracy+(recoil?.sample(time,actor.crouching).inaccuracy||0)};
}
