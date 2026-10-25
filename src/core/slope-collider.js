import * as THREE from '../../vendor/three.module.js';

/** A finite solid ramp, described in world units. No triangle mesh is needed.
 * Top: y = baseY + slopeX*(x-minX) + slopeZ*(z-minZ).
 * The remaining five planes bound its footprint and solid underside.
 */
export class SlopeCollider {
  constructor({minX,maxX,minZ,maxZ,baseY=0,slopeX=0,slopeZ=0,bottomY}) {
    if(![minX,maxX,minZ,maxZ,baseY,slopeX,slopeZ].every(Number.isFinite)||maxX<=minX||maxZ<=minZ)throw new Error('Invalid slope bounds');
    Object.assign(this,{minX,maxX,minZ,maxZ,baseY,slopeX,slopeZ});
    const lowest=baseY+Math.min(0,slopeX*(maxX-minX))+Math.min(0,slopeZ*(maxZ-minZ));
    this.bottomY=bottomY??lowest-1;
    if(!Number.isFinite(this.bottomY)||this.bottomY>=lowest)throw new Error('Invalid slope underside');
    this.normal=new THREE.Vector3(-slopeX,1,-slopeZ).normalize();
    this.walkable=this.normal.y>=.7;
    const top=this.normal.dot(new THREE.Vector3(minX,baseY,minZ));
    this.planes=[
      {n:this.normal,c:top},
      {n:new THREE.Vector3(-1,0,0),c:-minX},{n:new THREE.Vector3(1,0,0),c:maxX},
      {n:new THREE.Vector3(0,0,-1),c:-minZ},{n:new THREE.Vector3(0,0,1),c:maxZ},
      {n:new THREE.Vector3(0,-1,0),c:-this.bottomY},
    ];
  }
  supportHeight(x,z,radius=0) {
    if(x+radius<this.minX||x-radius>this.maxX||z+radius<this.minZ||z-radius>this.maxZ)return null;
    const px=THREE.MathUtils.clamp(x+Math.sign(this.slopeX)*radius,this.minX,this.maxX);
    const pz=THREE.MathUtils.clamp(z+Math.sign(this.slopeZ)*radius,this.minZ,this.maxZ);
    return this.baseY+this.slopeX*(px-this.minX)+this.slopeZ*(pz-this.minZ);
  }
  _distance(plane,pos,radius,height) {
    return plane.n.dot(pos)-plane.c-radius*(Math.abs(plane.n.x)+Math.abs(plane.n.z))-Math.max(0,-plane.n.y)*height;
  }
  overlaps(body,epsilon=.001) {
    return this.planes.every(p=>this._distance(p,body.pos,body.radius??.38,body.height??1.8)<-epsilon);
  }
  sweep(start,end,radius=0,height=0) {
    const delta=new THREE.Vector3().subVectors(end,start);let enter=0,exit=1,normal=null;
    for(const plane of this.planes){
      const d=this._distance(plane,start,radius,height),v=plane.n.dot(delta);
      if(Math.abs(v)<1e-12){if(d>1e-7)return null;continue;}
      const time=-d/v;
      if(v<0){if(time>=enter){enter=time;normal=plane.n;}}
      else exit=Math.min(exit,time);
      if(enter>exit)return null;
    }
    if(!normal||enter<0||enter>1)return null;
    return {fraction:enter,normal:normal.clone(),point:start.clone().addScaledVector(delta,enter),collider:this};
  }
}
