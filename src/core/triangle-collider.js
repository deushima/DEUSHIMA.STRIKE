import * as THREE from '../../vendor/three.module.js';
import { SlopeCollider } from './slope-collider.js';
// Finite convex triangular prism. Reuses the existing plane/hull sweep solver.
export class TriangleCollider extends SlopeCollider {
  constructor(a,b,c,normal,surface='stone') {
    const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x);
    const minZ=Math.min(a.z,b.z,c.z),maxZ=Math.max(a.z,b.z,c.z);
    super({minX,maxX:Math.max(minX+1e-6,maxX),minZ,maxZ:Math.max(minZ+1e-6,maxZ),baseY:Math.min(a.y,b.y,c.y),bottomY:Math.min(a.y,b.y,c.y)-.02});
    this.triangle=true;this.points=[a.clone(),b.clone(),c.clone()];this.normal.copy(normal);
    this.walkable=normal.y>=.72;this.surface=surface;
    this.minY=Math.min(a.y,b.y,c.y)-.015;this.maxY=Math.max(a.y,b.y,c.y)+.015;
    const thickness=.0001;
    this.planes=[{n:normal.clone(),c:normal.dot(a)}, {n:normal.clone().negate(),c:-normal.dot(a)+thickness}];
    for(let i=0;i<3;i++) {
      const first=this.points[i],second=this.points[(i+1)%3];
      const n=second.clone().sub(first).cross(normal).normalize();
      this.planes.push({n,c:n.dot(first)});
    }
    // Full separating axes for a triangle prism swept against an AABB. Face
    // normals alone produce phantom collisions beyond long, thin triangles.
    const vertices=[...this.points,...this.points.map(p=>p.clone().addScaledVector(normal,-thickness))];
    const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)];
    const edges=[normal,...this.points.map((p,i)=>this.points[(i+1)%3].clone().sub(p))];
    const candidates=[...axes];
    for(const edge of edges)for(const axis of axes)candidates.push(edge.clone().cross(axis));
    for(const candidate of candidates) {
      if(candidate.lengthSq()<1e-12)continue;
      candidate.normalize();
      for(const sign of [1,-1]) {
        const n=candidate.clone().multiplyScalar(sign);
        if(this.planes.some(p=>p.n.dot(n)>1-1e-10))continue;
        this.planes.push({n,c:Math.max(...vertices.map(p=>n.dot(p)))});
      }
    }
    this.baseY=Math.abs(normal.y)>1e-6 ? a.y-(normal.x*(minX-a.x)+normal.z*(minZ-a.z))/normal.y : a.y;
    this.slopeX=Math.abs(normal.y)>1e-6 ? -normal.x/normal.y:0;
    this.slopeZ=Math.abs(normal.y)>1e-6 ? -normal.z/normal.y:0;
  }
  overlaps(body,epsilon=.001) {
    const p=body.pos,r=body.radius??.38,h=body.height??1.8;
    if(p.x+r<this.minX||p.x-r>this.maxX||p.z+r<this.minZ||p.z-r>this.maxZ||p.y>this.maxY||p.y+h<this.minY)return false;
    return super.overlaps(body,epsilon);
  }
  sweep(start,end,radius=0,height=0) {
    if(Math.max(start.x,end.x)+radius<this.minX||Math.min(start.x,end.x)-radius>this.maxX||Math.max(start.z,end.z)+radius<this.minZ||Math.min(start.z,end.z)-radius>this.maxZ||Math.min(start.y,end.y)>this.maxY||Math.max(start.y,end.y)+height<this.minY)return null;
    return super.sweep(start,end,radius,height);
  }
  supportHeight(x,z,radius=0) {
    if(!this.walkable || x+radius<this.minX || x-radius>this.maxX || z+radius<this.minZ || z-radius>this.maxZ)return null;
    if(radius===0) {
      const [a,b,c]=this.points;
      const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      if(Math.abs(d)<1e-12)return null;
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/d;
      const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/d;
      return u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8 ? a.y*u+b.y*v+c.y*(1-u-v) : null;
    }
    // Clip actual footprint against the hull footprint. Small floor triangles
    // remain valid; no rectangle is filled outside the source triangle.
    let polygon=this.points.map(p=>({x:p.x,z:p.z}));
    for(const [axis,bound,sign] of [['x',x-radius,1],['x',x+radius,-1],['z',z-radius,1],['z',z+radius,-1]]) {
      const out=[];
      for(let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*(a[axis]-bound),db=sign*(b[axis]-bound);
        if(da>=-1e-8)out.push(a);
        if((da<0)!==(db<0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
      }
      polygon=out;if(!polygon.length)return null;
    }
    return Math.max(...polygon.map(p=>this.baseY+this.slopeX*(p.x-this.minX)+this.slopeZ*(p.z-this.minZ)));
  }
}
