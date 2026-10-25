import { SlopeCollider } from './slope-collider.js';
import * as THREE from '../../vendor/three.module.js';
import { EPS } from './utils.js';

const _box = new THREE.Box3();
const _test = new THREE.Box3();

/** Simple swept-AABB world with axis separation, step-up and hitscan ray queries. */
export class PhysicsWorld {
  constructor(colliders = [], slopes = []) {
    this.setSlopes(slopes);
    this.colliders = colliders;
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._inv = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  setColliders(colliders, slopes = []) {
    this.colliders = colliders || [];
    this.setSlopes(slopes);
  }

  setSlopes(slopes = []) {
    this.slopes = slopes.map(s => s instanceof SlopeCollider ? s : new SlopeCollider(s));
  }

  addSlope(slope) {
    const collider = slope instanceof SlopeCollider ? slope : new SlopeCollider(slope);
    this.slopes.push(collider);return collider;
  }

  _moveOnSlopes(body, start, wasGrounded) {
    if (!this.slopes.length) return;
    const r = body.radius ?? .38, h = body.height ?? 1.8;
    // Follow walkable ground only within the step budget. Airborne bodies use
    // swept hull/plane collisions, including ramp sides and the underside.
    if (wasGrounded && body.vel.y <= 0) {
      for (const slope of this.slopes) {
        const y = slope.supportHeight(body.pos.x, body.pos.z, r);
        if (!slope.walkable || y === null || y > start.y + (body.stepHeight ?? .45) || y < start.y - .08) continue;
        const oldY = body.pos.y;body.pos.y = y + .001;
        if (!this.overlapsWorld(this.bodyBox(body))) {body.onGround = true;body.vel.y = 0;return;}
        body.pos.y = oldY;
      }
    }
    let closest = null;
    for (const slope of this.slopes) {
      const hit = slope.sweep(start, body.pos, r, h);
      if (hit && (!closest || hit.fraction < closest.fraction)) closest = hit;
    }
    if (closest) {
      body.pos.copy(closest.point).addScaledVector(closest.normal, .001);
      const into = body.vel.dot(closest.normal);
      if (into < 0) body.vel.addScaledVector(closest.normal, -into);
      if (closest.normal.y >= .7) {body.onGround = true;body.vel.y = 0;}
      else body.onGround = false;
    }
    if (!body.onGround && body.vel.y <= 0) {
      for (const slope of this.slopes) {
        const y = slope.supportHeight(body.pos.x, body.pos.z, r);
        if (slope.walkable && y !== null && y <= body.pos.y + .002 && y >= body.pos.y - .06) {
          body.pos.y = y + .001;body.onGround = true;body.vel.y = 0;break;
        }
      }
    }
  }

  bodyBox(body) {
    const r = body.radius ?? 0.38;
    const h = body.height ?? 1.8;
    _box.min.set(body.pos.x - r, body.pos.y, body.pos.z - r);
    _box.max.set(body.pos.x + r, body.pos.y + h, body.pos.z + r);
    return _box;
  }

  static overlap(a, b, epsilon = 0) {
    return (
      a.min.x < b.max.x - epsilon &&
      a.max.x > b.min.x + epsilon &&
      a.min.y < b.max.y - epsilon &&
      a.max.y > b.min.y + epsilon &&
      a.min.z < b.max.z - epsilon &&
      a.max.z > b.min.z + epsilon
    );
  }

  overlapsWorld(box, epsilon = 0) {
    for (const c of this.colliders) {
      if (PhysicsWorld.overlap(box, c, epsilon)) return c;
    }
    return null;
  }

  canFitBody(body, height = body?.height ?? 1.8, epsilon = 0.001) {
    if (!body?.pos) return false;
    const r = body.radius ?? 0.38;
    _test.min.set(body.pos.x - r, body.pos.y, body.pos.z - r);
    _test.max.set(body.pos.x + r, body.pos.y + height, body.pos.z + r);
    return !this.overlapsWorld(_test, epsilon) && !this.slopes.some(s => s.overlaps({...body, height}, epsilon));
  }

  hasGroundBelow(body, offsetX = 0, offsetZ = 0, drop = 0.85) {
    if (!body?.pos) return false;
    const x = body.pos.x + offsetX;
    const z = body.pos.z + offsetZ;
    const top = body.pos.y + 0.04;
    const bottom = body.pos.y - Math.max(0.01, Number(drop) || 0.85);
    for (const c of this.colliders) {
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      if (c.max.y <= top && c.max.y >= bottom) return true;
    }
    return this.slopes.some(s => {
      const y = s.supportHeight(x,z);return s.walkable && y !== null && y <= top && y >= bottom;
    });
  }

  _collisionBoxAt(body, px, py, pz) {
    const r = body.radius ?? 0.38;
    const h = body.height ?? 1.8;
    _test.min.set(px - r, py, pz - r);
    _test.max.set(px + r, py + h, pz + r);
    return _test;
  }

  _horizontalAxis(body, axis, delta) {
    if (Math.abs(delta) < 1e-9) return;
    const start = body.pos[axis];
    body.pos[axis] += delta;
    let hit = null;
    let box = this.bodyBox(body);
    for (const c of this.colliders) {
      if (PhysicsWorld.overlap(box, c)) {
        if (!hit || c.max.y > hit.max.y) hit = c;
      }
    }
    if (!hit) return;

    const stepHeight = body.stepHeight ?? 0.5;
    const rise = hit.max.y - body.pos.y;
    if (body.onGround && rise > 0 && rise <= stepHeight) {
      const oldY = body.pos.y;
      body.pos.y = hit.max.y + 0.002;
      const lifted = this.bodyBox(body);
      if (!this.overlapsWorld(lifted)) {
        body.onGround = true;
        body.stepped = true;
        return;
      }
      body.pos.y = oldY;
    }

    body.pos[axis] = start;
    body.vel[axis] = 0;
  }

  moveBody(body, dt) {
    const startedGrounded = !!body.onGround;
    const vx = body.vel.x * dt;
    const vy = body.vel.y * dt;
    const vz = body.vel.z * dt;
    const maxSpeed = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
    const steps = Math.max(1, Math.ceil(maxSpeed / 0.18));
    const subDt = dt / steps;
    body.stepped = false;
    body.onGround = false;
    let landedDuringMove = false;

    for (let i = 0; i < steps; i++) {
      const slopeStart = this.slopes.length ? body.pos.clone() : null;
      const slopeGround = body.onGround || (i === 0 && startedGrounded);
      // Re-read velocity after each collision; cancelled components stay cancelled.
      const sy = body.vel.y * subDt;
      // Vertical first, so we can land before attempting step-up.
      if (Math.abs(sy) > 1e-9) {
        body.pos.y += sy;
        let box = this.bodyBox(body);
        let guard = 0;
        let hit;
        while ((hit = this.overlapsWorld(box)) && guard++ < 8) {
          if (sy < 0) {
            body.pos.y = hit.max.y + 0.001;
            body.onGround = true;
            landedDuringMove = true;
            body.vel.y = 0;
          } else {
            body.pos.y = hit.min.y - (body.height ?? 1.8) - 0.001;
            body.vel.y = 0;
          }
          box = this.bodyBox(body);
        }
      }

      // A grounded body with zero vertical displacement still needs its prior
      // support state while resolving horizontal step-up. We clear it again
      // afterwards unless an actual step/landing established new support.
      const borrowedGround = startedGrounded && !body.onGround && Math.abs(sy) <= 1e-9;
      if (borrowedGround) body.onGround = true;
      this._horizontalAxis(body, 'x', body.vel.x * subDt);
      this._horizontalAxis(body, 'z', body.vel.z * subDt);
      if (borrowedGround && !body.stepped && !landedDuringMove) body.onGround = false;

      // If we stepped up, cancel the remaining downward movement for this tick.
      if (body.stepped) {
        body.vel.y = Math.max(0, body.vel.y);
      }
      if (slopeStart) this._moveOnSlopes(body, slopeStart, slopeGround);
    }

    if (!body.onGround && body.vel.y <= 0) {
      // Never reattach a rising body to the floor.
      // Small ground probe, needed after horizontal movement.
      const r = body.radius ?? 0.38;
      const h = body.height ?? 1.8;
      _test.min.set(body.pos.x - r, body.pos.y - 0.06, body.pos.z - r);
      _test.max.set(body.pos.x + r, body.pos.y + 0.02, body.pos.z + r);
      for (const c of this.colliders) {
        if (PhysicsWorld.overlap(_test, c, 0.001)) {
          if (c.max.y <= body.pos.y + 0.06 && c.max.y >= body.pos.y - 0.08) {
            body.pos.y = Math.max(body.pos.y, c.max.y + 0.001);
            body.onGround = true;
          }
          break;
        }
      }
    }
    return body.onGround;
  }

  /** Returns { t, point, normal, collider } for the closest hit, or null. */
  raycast(origin, direction, maxDist = 200, slopeRadius = 0) {
    this._origin.copy(origin);
    this._dir.copy(direction).normalize();
    this._inv.set(
      Math.abs(this._dir.x) > 1e-9 ? 1 / this._dir.x : 1e9,
      Math.abs(this._dir.y) > 1e-9 ? 1 / this._dir.y : 1e9,
      Math.abs(this._dir.z) > 1e-9 ? 1 / this._dir.z : 1e9,
    );

    let best = maxDist;
    let bestCollider = null;
    let bestAxis = -1;
    let bestSign = 0;

    for (const c of this.colliders) {
      let tmin = 0;
      let tmax = best;
      let axis = -1;
      let sign = 0;
      let ok = true;

      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? this._origin.x : a === 1 ? this._origin.y : this._origin.z;
        const d = a === 0 ? this._dir.x : a === 1 ? this._dir.y : this._dir.z;
        const min = a === 0 ? c.min.x : a === 1 ? c.min.y : c.min.z;
        const max = a === 0 ? c.max.x : a === 1 ? c.max.y : c.max.z;
        const inv = a === 0 ? this._inv.x : a === 1 ? this._inv.y : this._inv.z;
        let t1 = (min - o) * inv;
        let t2 = (max - o) * inv;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = a;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) {
          ok = false;
          break;
        }
      }

      if (ok && tmin >= 0 && tmin < best) {
        best = tmin;
        bestCollider = c;
        bestAxis = axis;
        bestSign = sign;
      }
    }

    let slopeHit = null;
    const end = this._origin.clone().addScaledVector(this._dir, best);
    for (const slope of this.slopes) {
      const start = this._origin.clone();start.y -= slopeRadius;
      const target = end.clone();target.y -= slopeRadius;
      const hit = slope.sweep(start, target, slopeRadius, slopeRadius * 2);
      if (hit) hit.point.y += slopeRadius;
      if (hit && (!slopeHit || hit.fraction < slopeHit.fraction)) slopeHit = hit;
    }
    if (slopeHit) return { t: slopeHit.fraction * best, point: slopeHit.point, normal: slopeHit.normal, collider: slopeHit.collider };
    if (!bestCollider) return null;
    this._hitPoint.copy(this._origin).addScaledVector(this._dir, best);
    this._normal.set(0, 0, 0);
    if (bestAxis === 0) this._normal.x = bestSign;
    else if (bestAxis === 1) this._normal.y = bestSign;
    else this._normal.z = bestSign;
    if (this._normal.lengthSq() === 0) this._normal.set(0, 1, 0);
    return {
      t: best,
      point: this._hitPoint.clone(),
      normal: this._normal.clone(),
      collider: bestCollider,
    };
  }

  raycastExpanded(origin, direction, radius, maxDist = 200) {
    const dir = direction.clone().normalize();
    const expanded = this.colliders.map((c) => {
      const b = c.clone();
      b.min.x -= radius;
      b.min.y -= radius;
      b.min.z -= radius;
      b.max.x += radius;
      b.max.y += radius;
      b.max.z += radius;
      b.surface = c.surface;
      return b;
    });
    const old = this.colliders;
    this.colliders = expanded;
    const hit = this.raycast(origin, dir, maxDist, radius);
    this.colliders = old;
    if (hit) hit.collider = hit.collider.surface ? hit.collider : hit.collider;
    return hit;
  }

  hasLineOfSight(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 1e-4) return true;
    dir.multiplyScalar(1 / dist);
    const hit = this.raycast(from, dir, dist);
    return !hit || hit.t > dist - 0.08;
  }

  isPositionFree(pos, radius = 0.4, height = 1.8) {
    _test.min.set(pos.x - radius, pos.y + 0.02, pos.z - radius);
    _test.max.set(pos.x + radius, pos.y + height, pos.z + radius);
    return !this.overlapsWorld(_test) && !this.slopes.some(s => s.overlaps({pos, radius, height}));
  }
}
