import * as THREE from '../../vendor/three.module.js';
import { PhysicsWorld } from '../core/physics.js';
const R=.3,H=1.8,STEP=.45,PITCH=.6;
export function traceWalk(physics,start,end,{speed=2.4,radius=R,height=H,dt=.01}={}) {
  const body={pos:new THREE.Vector3(start.x,start.y,start.z),vel:new THREE.Vector3(),radius,height,stepHeight:STEP,onGround:true};
  const maxTicks=Math.ceil((Math.hypot(end.x-start.x,end.z-start.z)/speed+1)*1/dt);
  let best=Infinity,groundless=0;
  for(let i=0;i<maxTicks;i++) {
    const dx=end.x-body.pos.x,dz=end.z-body.pos.z,dist=Math.hypot(dx,dz);best=Math.min(best,dist);
    if(dist<.07)return {ok:Math.abs(body.pos.y-end.y)<.5,body,best,ticks:i};
    body.vel.x=dx/dist*speed;body.vel.z=dz/dist*speed;
    if(!body.onGround)body.vel.y-=.1;
    physics.moveBody(body,dt);
    if(!body.onGround)body.vel.y-=.1;
    groundless=body.onGround?0:groundless+1;
    if(groundless>15 || body.pos.y<Math.min(start.y,end.y)-.6)return {ok:false,body,best};
  }
  return {ok:false,body,best};
}
export function buildTriangleNavigation(slopes,hints,{maxFloorY=Infinity}={}) {
  const physics=new PhysicsWorld([],slopes),cells=new Map();
  for(const floor of slopes) {
    if(!floor.walkable || floor.minY>maxFloorY)continue;
    for(let ix=Math.ceil(floor.minX/PITCH);ix<=Math.floor(floor.maxX/PITCH);ix++)for(let iz=Math.ceil(floor.minZ/PITCH);iz<=Math.floor(floor.maxZ/PITCH);iz++) {
      const x=ix*PITCH,z=iz*PITCH,y=floor.supportHeight(x,z,0);
      if(y===null || y>maxFloorY)continue;
      const k=ix+','+iz;
      if(!cells.has(k))cells.set(k,[]);
      if(!cells.get(k).some(p=>Math.abs(p.y-y)<.05))cells.get(k).push({x,y:y+.006,z,ix,iz,links:[],tags:['1v1']});
    }
  }
  const nodes=[];
  for(const [key,candidates] of cells) {
    const valid=candidates.filter(p=>{
      // The player's square hull contacts the highest point under its feet,
      // not the triangle height at the center (uneven authored ground).
      for(const floor of physics._querySlopes(p.x-R,p.x+R,p.z-R,p.z+R)) {
        const y=floor.supportHeight(p.x,p.z,R);
        if(y!==null && y>p.y && y<p.y+STEP)p.y=y+.006;
      }
      return physics.isPositionFree(p,R,H);
    });
    if(!valid.length){cells.delete(key);continue;}
    // Multiple levels are retained; edges cannot jump between floors.
    for(const p of valid){p.id=nodes.length;nodes.push(p);}cells.set(key,valid);
  }
  const edgeCache=new Map();
  const traversable=(a,b)=>{
    const key=a.id+':'+b.id;
    if(!edgeCache.has(key))edgeCache.set(key,traceWalk(physics,a,b).ok);
    return edgeCache.get(key);
  };
  const choose=(hint)=>nodes.map(p=>({p,d:Math.hypot(p.x-hint.x,p.z-hint.z)})).filter(v=>v.d<8 && v.p.y<maxFloorY).sort((a,b)=>a.d-b.d).slice(0,100);
  const candidates={CT:choose(hints.CT),T:choose(hints.T)};
  if(!candidates.CT.length||!candidates.T.length)throw new Error('Dust Short: no clear standing spawn near screenshot anchors');
  function neighbors(p) {
    const out=[];
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])for(const q of cells.get((p.ix+dx)+','+(p.iz+dz))||[]) {
      // A grid edge may cross several individual legal stairs. The real
      // sweep, not total endpoint elevation, enforces the per-step limit.
      if(Math.abs(q.y-p.y)>STEP+PITCH*Math.SQRT2)continue;
      if(traversable(p,q))out.push(q);
    }
    return out;
  }
  function search(start,goal) {
    const open=new Set([start.id]),cost=new Map([[start.id,0]]),parent=new Map(),closed=new Set();
    while(open.size) {
      let id=null,best=Infinity;
      for(const k of open){const p=nodes[k],score=cost.get(k)+Math.hypot(p.x-goal.x,p.z-goal.z);if(score<best){best=score;id=k;}}
      if(id===goal.id){const route=[];for(let k=id;k!==undefined;k=parent.get(k))route.push(nodes[k]);return route.reverse();}
      open.delete(id);closed.add(id);
      for(const q of neighbors(nodes[id])) {
        if(closed.has(q.id))continue;
        const c=cost.get(id)+Math.hypot(q.x-nodes[id].x,q.z-nodes[id].z);
        if(c>=(cost.get(q.id)??Infinity))continue;
        cost.set(q.id,c);parent.set(q.id,id);open.add(q.id);
      }
    }
    return null;
  }
  // Spawn candidate must share the physically traversable component. Probes
  // are outward from the screenshot anchor; no teleport or invisible bridges.
  let ct,t,forward,reverse;
  outer:for(const a of candidates.CT.slice(0,12))for(const b of candidates.T.slice(0,12)) {
    const route=search(a.p,b.p);if(!route)continue;
    const back=search(b.p,a.p);if(!back)continue;
    ct=a.p;t=b.p;forward=route;reverse=back;break outer;
  }
  if(!forward) {
    const err=new Error('Dust Short: screenshot spawn regions have no bidirectional physical route');
    err.details={nodes:nodes.length,checked:edgeCache.size,accepted:[...edgeCache.values()].filter(Boolean).length,candidates:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,v.slice(0,4)]))};
    err.debug={nodes,edges:[...edgeCache]};
    err.physics=physics;
    throw err;
  }
  const kept=new Map();
  for(const route of [forward,reverse])for(const p of route)if(!kept.has(p.id))kept.set(p.id,{...p,id:kept.size,links:[],tags:['1v1']});
  for(const route of [forward,reverse])for(let i=1;i<route.length;i++) {
    const a=kept.get(route[i-1].id),b=kept.get(route[i].id);if(!a.links.includes(b.id))a.links.push(b.id);
  }
  kept.get(ct.id).tags.push('spawn:CT');kept.get(t.id).tags.push('spawn:T');
  const spawns={CT:[{x:ct.x,y:ct.y,z:ct.z}],T:[{x:t.x,y:t.y,z:t.z}]};
  for(const [team,route] of [['CT',forward],['T',reverse]]) {
    const a=spawns[team][0],b=route[Math.min(3,route.length-1)];
    a.yaw=Math.atan2(-(b.x-a.x),-(b.z-a.z))*180/Math.PI;
  }
  return {spawns,waypoints:[...kept.values()],stats:{candidateNodes:nodes.length,physicalEdgesChecked:edgeCache.size,forwardLength:forward.length,reverseLength:reverse.length}};
}
