import * as THREE from '../../vendor/three.module.js';
import { intersectHitbox } from '../combat/hitboxes.js';

export const MAX_REWIND_MS = 400;
const mixMatrix = (out, a, b, t) => {
  for (let i = 0; i < 16; i++) out.elements[i] = a.elements[i] + (b.elements[i] - a.elements[i]) * t;
};

// A bounded history of the actual skinned hit geometry, never enlarged hitboxes.
// Matrices are restored synchronously before rendering or processing another ray.
export class HitHistory {
  constructor() { this.players = new Map(); }
  delete(id) { this.players.delete(id); }
  clear() { this.players.clear(); }
  capture(id, time, boxes) {
    const frames = this.players.get(id) || [];
    if (frames.length && time - frames.at(-1).time < 1000 / 30) return;
    const pose = boxes.map(hb => hb.mesh ? {
      hb, matrix: hb.mesh.matrixWorld.clone(),
      bones: hb.mesh.skeleton?.bones.map(bone => bone.matrixWorld.clone()) || [],
    } : { hb, box: hb.box.clone() });
    frames.push({ time, pose });
    while (frames.length > 2 && frames[1].time < time - MAX_REWIND_MS - 100) frames.shift();
    this.players.set(id, frames);
  }
  raycast(id, time, origin, dir, range) {
    const frames = this.players.get(id);
    if (!frames?.length || time < frames[0].time - 50) return { available: false, hit: null };
    let a = frames[0], b = a;
    for (const frame of frames) {
      b = frame;
      if (frame.time >= time) break;
      a = frame;
    }
    const t = b.time > a.time ? THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1) : 0;
    let best = null;
    for (let i = 0; i < a.pose.length; i++) {
      const p = a.pose[i], candidate = b.pose[i];
      const q = candidate && candidate.hb.mesh === p.hb.mesh ? candidate : p;
      const hb = p.hb;
      let contact;
      if (!hb.mesh) {
        const box = new THREE.Box3(p.box.min.clone().lerp(q.box.min, t), p.box.max.clone().lerp(q.box.max, t));
        contact = intersectHitbox(origin, dir, { ...hb, box }, best?.t ?? range);
      } else {
        const mesh = hb.mesh, bones = mesh.skeleton?.bones || [];
        const savedMatrix = mesh.matrixWorld.clone(), savedBones = bones.map(bone => bone.matrixWorld.clone());
        const savedBindInverse = mesh.bindMatrixInverse?.clone();
        try {
          mixMatrix(mesh.matrixWorld, p.matrix, q.matrix, t);
          if (mesh.isSkinnedMesh && mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
          bones.forEach((bone, j) => mixMatrix(bone.matrixWorld, p.bones[j], q.bones[j], t));
          contact = intersectHitbox(origin, dir, hb, best?.t ?? range);
        } finally {
          mesh.matrixWorld.copy(savedMatrix);
          if (savedBindInverse) mesh.bindMatrixInverse.copy(savedBindInverse);
          bones.forEach((bone, j) => bone.matrixWorld.copy(savedBones[j]));
        }
      }
      if (contact && (!best || contact.t < best.t)) best = contact;
    }
    return { available: true, hit: best };
  }
}
