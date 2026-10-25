/**
 * Real Dust2 test map used by offline/online deathmatch.
 *
 * Visuals come from the user-selected Sketchfab GLB in /assets/maps. The
 * source mesh is already in useful metre-like units, so it stays at 1:1.
 * Physics is derived once from the loaded mesh: flat faces become compact
 * Box3 colliders and walkable ramps become SlopeCollider descriptors.
 */
import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';

export const DUST2_DEATHMATCH_INFO = Object.freeze({
  id: 'de_dust2_dm',
  name: 'de_dust2_dm',
  displayName: 'DUST2 · DEATHMATCH',
  mode: 'deathmatch',
  description: 'Dust2 real para Deathmatch libre, hasta 10 jugadores.',
  players: 10,
  teamSize: 5,
});

export const DUST2_MODEL_URL = '/assets/maps/de_dust2_dm.glb';

const loader = new GLTFLoader();
const MIN_SURFACE_AREA = 0.12;
const WALKABLE_NORMAL_Y = 0.72;
const FLAT_NORMAL_Y = 0.985;
const BOX_EPS = 0.045;
const DIAGONAL_WALL_NORMAL_Y = 0.12;
const DIAGONAL_WALL_STEP = 0.28;
const NAV_RADIUS = 0.38;
const NAV_HEIGHT = 1.75;
const SPAWN_RADIUS = 0.44;
const SPAWN_NAV_DISTANCE = 3.2;
const SPAWN_NAV_VERTICAL = 0.55;
const STAIR_TREAD_MIN = 0.35;
const STAIR_TREAD_MAX = 2.5;
const STAIR_RISE_MIN = 0.45;
const STAIR_RISE_MAX = 1.2;
const STAIR_RISE_MATCH_EPS = 0.16;
const STAIR_EDGE_EPS = 0.08;
const STAIR_MIN_WIDTH = 0.9;
const STAIR_TARGET_GRADE = 0.72;
const STAIR_CLEARANCE_HEIGHT = 1.8;
const SLOPE_SEAM_OVERLAP = 0.08;
const DUST2_SLOPE_SEAM_FIXES = Object.freeze([
  // Upper lip of the long cobbled ramp on the west side of the imported GLB.
  { minX: -35.3, maxX: -31.3, minZ: 8.4, maxZ: 11.1, slopeZ: 0.25, edge: 'maxZ', edgeCoord: 11.0043 },
  // Upper lip of the long cobbled ramp on the east side, beside the boxed/arched route.
  { minX: 21.9, maxX: 26.0, minZ: -48.5, maxZ: -44.4, slopeZ: -0.25, edge: 'minZ', edgeCoord: -48.4189 },
]);

function triangleAreaAndNormal(a, b, c, normal) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  normal.crossVectors(ab, ac);
  const twiceArea = normal.length();
  if (twiceArea < 1e-8) return 0;
  normal.multiplyScalar(1 / twiceArea);
  return twiceArea * 0.5;
}

function forEachWorldTriangle(root, callback) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      const area = triangleAreaAndNormal(a, b, c, normal);
      if (area <= 0) continue;
      callback(a, b, c, normal, area);
    }
  });
}

function makeBoxFromPoints(a, b, c, surface = 'stone') {
  const box = new THREE.Box3().setFromPoints([a, b, c]);
  if (box.max.x - box.min.x < BOX_EPS * 2) {
    const cx = (box.min.x + box.max.x) * 0.5;
    box.min.x = cx - BOX_EPS;
    box.max.x = cx + BOX_EPS;
  }
  if (box.max.y - box.min.y < BOX_EPS * 2) {
    const cy = (box.min.y + box.max.y) * 0.5;
    box.min.y = cy - BOX_EPS;
    box.max.y = cy + BOX_EPS;
  }
  if (box.max.z - box.min.z < BOX_EPS * 2) {
    const cz = (box.min.z + box.max.z) * 0.5;
    box.min.z = cz - BOX_EPS;
    box.max.z = cz + BOX_EPS;
  }
  box.surface = surface;
  return box;
}

function makeDiagonalWallBoxes(a, b, c, surface = 'stone') {
  const points = [a, b, c];
  let start = a;
  let end = b;
  let maxDistanceSq = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      const dz = points[j].z - points[i].z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq;
        start = points[i];
        end = points[j];
      }
    }
  }
  const length = Math.sqrt(Math.max(0, maxDistanceSq));
  if (length < BOX_EPS * 2) return [makeBoxFromPoints(a, b, c, surface)];

  const minY = Math.min(a.y, b.y, c.y);
  const maxY = Math.max(a.y, b.y, c.y);
  const segments = Math.max(1, Math.ceil(length / DIAGONAL_WALL_STEP));
  const dx = (end.x - start.x) / segments;
  const dz = (end.z - start.z) / segments;
  const height = Math.max(BOX_EPS * 2, maxY - minY);
  const cy = (minY + maxY) * 0.5;
  const boxes = [];
  for (let index = 0; index < segments; index++) {
    const t = (index + 0.5) / segments;
    const cx = start.x + (end.x - start.x) * t;
    const cz = start.z + (end.z - start.z) * t;
    const box = new THREE.Box3(
      new THREE.Vector3(cx - Math.abs(dx) * 0.5 - BOX_EPS, cy - height * 0.5, cz - Math.abs(dz) * 0.5 - BOX_EPS),
      new THREE.Vector3(cx + Math.abs(dx) * 0.5 + BOX_EPS, cy + height * 0.5, cz + Math.abs(dz) * 0.5 + BOX_EPS),
    );
    box.surface = surface;
    boxes.push(box);
  }
  return boxes;
}

const quant = (value, step = 0.05) => Math.round(value / step);

function dedupeBoxes(boxes) {
  const unique = new Map();
  for (const box of boxes) {
    const key = [
      box.surface || 'stone',
      quant(box.min.x), quant(box.min.y), quant(box.min.z),
      quant(box.max.x), quant(box.max.y), quant(box.max.z),
    ].join('|');
    if (!unique.has(key)) unique.set(key, box);
  }
  return [...unique.values()];
}

function mergeAlong(boxes, axis) {
  const other = axis === 'x' ? ['y', 'z'] : ['x', 'y'];
  const groups = new Map();
  for (const box of boxes) {
    const key = [
      box.surface || 'stone',
      quant(box.min[other[0]]), quant(box.max[other[0]]),
      quant(box.min[other[1]]), quant(box.max[other[1]]),
    ].join('|');
    let group = groups.get(key);
    if (!group) groups.set(key, group = []);
    group.push(box);
  }

  const result = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.min[axis] - b.min[axis]);
    let current = null;
    for (const box of group) {
      if (!current) {
        current = box.clone();
        current.surface = box.surface;
        continue;
      }
      if (box.min[axis] <= current.max[axis] + 0.07) {
        current.max[axis] = Math.max(current.max[axis], box.max[axis]);
      } else {
        result.push(current);
        current = box.clone();
        current.surface = box.surface;
      }
    }
    if (current) result.push(current);
  }
  return result;
}

function compactBoxes(boxes) {
  let out = dedupeBoxes(boxes);
  out = mergeAlong(out, 'x');
  out = mergeAlong(out, 'z');
  return dedupeBoxes(out);
}

function slopePlaneY(slope, x, z) {
  return slope.baseY
    + slope.slopeX * (x - slope.minX)
    + slope.slopeZ * (z - slope.minZ);
}

function extendMeasuredSlopeSeams(colliders, slopes) {
  const floors = colliders.filter((box) => box.surface === 'sand' && box.max.y - box.min.y < 0.2);
  for (const fix of DUST2_SLOPE_SEAM_FIXES) {
    const slope = slopes.find((candidate) => (
      candidate.minX >= fix.minX && candidate.maxX <= fix.maxX &&
      candidate.minZ >= fix.minZ && candidate.maxZ <= fix.maxZ &&
      Math.abs(candidate.slopeX) < 0.03 &&
      Math.abs(candidate.slopeZ - fix.slopeZ) < 0.02 &&
      Math.abs(candidate[fix.edge] - fix.edgeCoord) < 0.08
    ));
    if (!slope) continue;

    const highZ = fix.edge === 'maxZ' ? slope.maxZ : slope.minZ;
    const centerX = (slope.minX + slope.maxX) * 0.5;
    const highY = slopePlaneY(slope, centerX, highZ);
    const flat = floors.find((box) => {
      const edge = fix.edge === 'maxZ' ? box.min.z : box.max.z;
      const overlapX = Math.min(slope.maxX, box.max.x) - Math.max(slope.minX, box.min.x);
      const depth = fix.edge === 'maxZ' ? box.max.z - highZ : highZ - box.min.z;
      return (
        Math.abs(edge - highZ) <= 0.08 &&
        overlapX >= 0.9 && depth >= 0.5 &&
        Math.abs(box.max.y - highY) <= 0.08
      );
    });
    if (!flat) continue;

    // The live Dust2 hull must have a clear standing volume at the seam. This
    // keeps the tiny overlap from turning an actual wall/box into a climbable lip.
    if (!bodyIsFree(colliders, { x: centerX, y: flat.max.y, z: highZ }, NAV_RADIUS, NAV_HEIGHT)) continue;

    const oldMinX = slope.minX;
    const oldMinZ = slope.minZ;
    if (fix.edge === 'maxZ') slope.maxZ += SLOPE_SEAM_OVERLAP;
    else slope.minZ -= SLOPE_SEAM_OVERLAP;
    // baseY is anchored to (minX,minZ), so preserve the original plane when
    // extending a min edge into the adjoining flat floor.
    slope.baseY += slope.slopeX * (slope.minX - oldMinX) + slope.slopeZ * (slope.minZ - oldMinZ);
    const lowest = slope.baseY
      + Math.min(0, slope.slopeX * (slope.maxX - slope.minX))
      + Math.min(0, slope.slopeZ * (slope.maxZ - slope.minZ));
    slope.bottomY = lowest - 0.18;
  }
}

function intervalOverlap(a, b, axis) {
  return Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
}

function stairClipHasClearance(descriptor, colliders, lowCoord, highCoord, axis) {
  const perp = axis === 'x' ? 'z' : 'x';
  const centerPerp = (descriptor[`min${perp.toUpperCase()}`] + descriptor[`max${perp.toUpperCase()}`]) * 0.5;
  const radius = NAV_RADIUS;
  const samples = 12;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const axisPos = THREE.MathUtils.lerp(lowCoord, highCoord, t);
    const x = axis === 'x' ? axisPos : centerPerp;
    const z = axis === 'z' ? axisPos : centerPerp;
    // Match SlopeCollider.supportHeight(): support is determined at the uphill
    // edge of the horizontal hull, not at its center. Without this, legitimate
    // stair clips look blocked by the next riser during validation even though
    // the runtime body has already been lifted over it.
    const supportX = THREE.MathUtils.clamp(
      x + Math.sign(descriptor.slopeX) * radius,
      descriptor.minX,
      descriptor.maxX,
    );
    const supportZ = THREE.MathUtils.clamp(
      z + Math.sign(descriptor.slopeZ) * radius,
      descriptor.minZ,
      descriptor.maxZ,
    );
    const y = descriptor.baseY
      + descriptor.slopeX * (supportX - descriptor.minX)
      + descriptor.slopeZ * (supportZ - descriptor.minZ)
      + 0.004;
    const body = new THREE.Box3(
      new THREE.Vector3(x - radius, y, z - radius),
      new THREE.Vector3(x + radius, y + STAIR_CLEARANCE_HEIGHT, z + radius),
    );
    for (const box of colliders) {
      // Treads and risers already below the smoothed clip are intentional. Any
      // geometry entering the standing hull above the clip (wall/ceiling/prop)
      // means this is not a traversable staircase and must remain solid.
      if (box.max.y <= y + 0.05) continue;
      if (body.intersectsBox(box)) return false;
    }
  }
  return true;
}

/**
 * The source Dust2 mesh contains a few stair flights modeled as two coarse
 * terraces (roughly 1.1 m per riser). Treating every source face literally
 * makes those risers waist-high collision walls even though the visual feature
 * is a staircase. Detect only a low -> middle -> high sequence of matching
 * treads and overlay a conservative walkable clip ramp. The original boxes stay
 * in place, so surrounding walls and the underside remain solid.
 */
function makeStairClipSlopes(colliders) {
  const floors = colliders
    .filter((box) => box.surface === 'sand')
    .map((box) => ({ box, top: box.max.y }));
  const clips = [];
  const keys = new Set();

  for (const middle of floors) {
    for (const axis of ['x', 'z']) {
      const perp = axis === 'x' ? 'z' : 'x';
      const treadRun = middle.box.max[axis] - middle.box.min[axis];
      if (treadRun < STAIR_TREAD_MIN || treadRun > STAIR_TREAD_MAX) continue;

      for (const lowSide of [-1, 1]) {
        const lowBoundary = lowSide > 0 ? middle.box.max[axis] : middle.box.min[axis];
        const highBoundary = lowSide > 0 ? middle.box.min[axis] : middle.box.max[axis];
        const lowFloors = floors.filter((low) => {
          if (low === middle) return false;
          const rise = middle.top - low.top;
          const edge = lowSide > 0 ? low.box.min[axis] : low.box.max[axis];
          return (
            rise >= STAIR_RISE_MIN && rise <= STAIR_RISE_MAX &&
            Math.abs(edge - lowBoundary) <= STAIR_EDGE_EPS &&
            intervalOverlap(low.box, middle.box, perp) >= STAIR_MIN_WIDTH
          );
        });
        const highFloors = floors.filter((high) => {
          if (high === middle) return false;
          const rise = high.top - middle.top;
          const edge = lowSide > 0 ? high.box.max[axis] : high.box.min[axis];
          return (
            rise >= STAIR_RISE_MIN && rise <= STAIR_RISE_MAX &&
            Math.abs(edge - highBoundary) <= STAIR_EDGE_EPS &&
            intervalOverlap(high.box, middle.box, perp) >= STAIR_MIN_WIDTH
          );
        });

        for (const low of lowFloors) {
          for (const high of highFloors) {
            const firstRise = middle.top - low.top;
            const secondRise = high.top - middle.top;
            if (Math.abs(firstRise - secondRise) > STAIR_RISE_MATCH_EPS) continue;
            const perpMin = Math.max(low.box.min[perp], middle.box.min[perp], high.box.min[perp]);
            const perpMax = Math.min(low.box.max[perp], middle.box.max[perp], high.box.max[perp]);
            if (perpMax - perpMin < STAIR_MIN_WIDTH) continue;

            const totalRise = high.top - low.top;
            const requiredRun = Math.max(totalRise / STAIR_TARGET_GRADE, treadRun * 2.25);
            const lowCoord = highBoundary + lowSide * requiredRun;
            if (lowCoord < low.box.min[axis] - STAIR_EDGE_EPS || lowCoord > low.box.max[axis] + STAIR_EDGE_EPS) continue;

            const minAxis = Math.min(highBoundary, lowCoord);
            const maxAxis = Math.max(highBoundary, lowCoord);
            const slope = totalRise / (highBoundary - lowCoord);
            const descriptor = {
              minX: axis === 'x' ? minAxis : perpMin,
              maxX: axis === 'x' ? maxAxis : perpMax,
              minZ: axis === 'z' ? minAxis : perpMin,
              maxZ: axis === 'z' ? maxAxis : perpMax,
              baseY: 0,
              slopeX: axis === 'x' ? slope : 0,
              slopeZ: axis === 'z' ? slope : 0,
            };
            descriptor.baseY = low.top
              + descriptor.slopeX * (descriptor.minX - (axis === 'x' ? lowCoord : descriptor.minX))
              + descriptor.slopeZ * (descriptor.minZ - (axis === 'z' ? lowCoord : descriptor.minZ));
            const lowest = descriptor.baseY
              + Math.min(0, descriptor.slopeX * (descriptor.maxX - descriptor.minX))
              + Math.min(0, descriptor.slopeZ * (descriptor.maxZ - descriptor.minZ));
            descriptor.bottomY = lowest - 0.18;

            if (!stairClipHasClearance(descriptor, colliders, lowCoord, highBoundary, axis)) continue;
            const key = [
              quant(descriptor.minX), quant(descriptor.maxX),
              quant(descriptor.minZ), quant(descriptor.maxZ),
              quant(descriptor.baseY), quant(descriptor.slopeX, 0.02), quant(descriptor.slopeZ, 0.02),
            ].join('|');
            if (keys.has(key)) continue;
            keys.add(key);
            clips.push(descriptor);
          }
        }
      }
    }
  }
  return clips;
}

function buildCollisionProxy(root) {
  const boxes = [];
  const slopes = [];
  const walkable = [];
  const slopeKeys = new Set();

  forEachWorldTriangle(root, (a, b, c, normal, area) => {
    if (area < MIN_SURFACE_AREA) return;
    const bounds = new THREE.Box3().setFromPoints([a, b, c]);

    if (normal.y >= WALKABLE_NORMAL_Y) {
      const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
      walkable.push({ x: centroid.x, y: centroid.y, z: centroid.z, area, ny: normal.y });

      if (normal.y >= FLAT_NORMAL_Y) {
        const top = Math.max(a.y, b.y, c.y);
        const floor = new THREE.Box3(
          new THREE.Vector3(bounds.min.x, top - 0.12, bounds.min.z),
          new THREE.Vector3(bounds.max.x, top + 0.012, bounds.max.z),
        );
        if (floor.max.x - floor.min.x < BOX_EPS * 2) {
          const cx = (floor.min.x + floor.max.x) * 0.5;
          floor.min.x = cx - BOX_EPS; floor.max.x = cx + BOX_EPS;
        }
        if (floor.max.z - floor.min.z < BOX_EPS * 2) {
          const cz = (floor.min.z + floor.max.z) * 0.5;
          floor.min.z = cz - BOX_EPS; floor.max.z = cz + BOX_EPS;
        }
        floor.surface = 'sand';
        boxes.push(floor);
        return;
      }

      const slopeX = -normal.x / normal.y;
      const slopeZ = -normal.z / normal.y;
      const baseY = a.y + slopeX * (bounds.min.x - a.x) + slopeZ * (bounds.min.z - a.z);
      if (bounds.max.x - bounds.min.x < 0.08 || bounds.max.z - bounds.min.z < 0.08) return;
      const lowestPlaneY = baseY
        + Math.min(0, slopeX * (bounds.max.x - bounds.min.x))
        + Math.min(0, slopeZ * (bounds.max.z - bounds.min.z));
      const descriptor = {
        minX: bounds.min.x,
        maxX: bounds.max.x,
        minZ: bounds.min.z,
        maxZ: bounds.max.z,
        baseY,
        slopeX,
        slopeZ,
        // SlopeCollider validates the underside against the complete
        // rectangular proxy plane, including the extrapolated fourth corner.
        // That corner can sit below all three source-triangle vertices.
        bottomY: lowestPlaneY - 0.18,
      };
      const key = [
        quant(descriptor.minX), quant(descriptor.maxX),
        quant(descriptor.minZ), quant(descriptor.maxZ),
        quant(descriptor.baseY), quant(descriptor.slopeX, 0.02), quant(descriptor.slopeZ, 0.02),
      ].join('|');
      if (!slopeKeys.has(key)) {
        slopeKeys.add(key);
        slopes.push(descriptor);
      }
      return;
    }

    // Down-facing horizontal faces are useful as ceilings. Very small faces
    // and trim stay visual-only so the collision proxy remains affordable.
    if (normal.y <= -0.8) {
      if (area < 0.35) return;
      boxes.push(makeBoxFromPoints(a, b, c, 'stone'));
      return;
    }

    // A single AABB around a diagonal vertical triangle fills the complete
    // projected rectangle and can close real Dust2 doorways. Approximate only
    // those walls with a thin staircase following the source wall line.
    if (
      Math.abs(normal.y) <= DIAGONAL_WALL_NORMAL_Y &&
      Math.abs(normal.x) > 0.12 &&
      Math.abs(normal.z) > 0.12
    ) {
      boxes.push(...makeDiagonalWallBoxes(a, b, c, 'stone'));
    } else {
      boxes.push(makeBoxFromPoints(a, b, c, 'stone'));
    }
  });

  const colliders = compactBoxes(boxes);
  extendMeasuredSlopeSeams(colliders, slopes);
  slopes.push(...makeStairClipSlopes(colliders));
  return { colliders, slopes, walkable };
}

function bodyIsFree(colliders, point, radius = 0.46, height = 1.8) {
  const body = new THREE.Box3(
    new THREE.Vector3(point.x - radius, point.y + 0.02, point.z - radius),
    new THREE.Vector3(point.x + radius, point.y + height, point.z + radius),
  );
  return !colliders.some((box) => body.intersectsBox(box));
}

function nearestNavigableWaypoint(point, waypoints) {
  let best = null;
  for (const waypoint of waypoints) {
    const vertical = Math.abs(waypoint.y - point.y);
    if (vertical > SPAWN_NAV_VERTICAL) continue;
    const distance = Math.hypot(waypoint.x - point.x, waypoint.z - point.z);
    if (!best || distance < best.distance) best = { waypoint, distance, vertical };
  }
  return best;
}

function makeDistributedSpawns(walkable, colliders, waypoints, center, count = 24) {
  let candidates = walkable
    .filter((p) => p.ny >= 0.97 && p.area >= 0.45 && p.y >= -2.4 && p.y <= 2.7)
    .map((p) => ({ x: p.x, y: p.y + 0.065, z: p.z, area: p.area }))
    .filter((p) => bodyIsFree(colliders, p, SPAWN_RADIUS))
    .filter((p) => {
      const nearest = nearestNavigableWaypoint(p, waypoints);
      return nearest && nearest.distance <= SPAWN_NAV_DISTANCE;
    });

  candidates.sort((a, b) => b.area - a.area);
  const spaced = [];
  for (const candidate of candidates) {
    if (spaced.every((p) => Math.hypot(p.x - candidate.x, p.z - candidate.z) >= 1.8)) spaced.push(candidate);
  }
  candidates = spaced;
  if (candidates.length < 10) throw new Error(`[dust2] solo ${candidates.length} spawns físicos seguros`);

  const first = candidates.reduce((best, p) => {
    const d = Math.hypot(p.x - center.x, p.z - center.z);
    return !best || d < best.d ? { p, d } : best;
  }, null)?.p || candidates[0];
  const selected = [first];
  while (selected.length < Math.min(count, candidates.length)) {
    let best = null;
    let bestDistance = -1;
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      const nearest = selected.reduce((d, p) => Math.min(d, Math.hypot(p.x - candidate.x, p.z - candidate.z)), Infinity);
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  return selected.map((p) => {
    const dx = center.x - p.x;
    const dz = center.z - p.z;
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(-dx, -dz));
    return { x: p.x, y: p.y, z: p.z, yaw };
  });
}

function segmentClear(a, b, colliders) {
  const from = new THREE.Vector3(a.x, a.y + 0.9, a.z);
  const to = new THREE.Vector3(b.x, b.y + 0.9, b.z);
  const delta = to.clone().sub(from);
  const distance = delta.length();
  if (distance < 1e-4) return true;
  const ray = new THREE.Ray(from, delta.multiplyScalar(1 / distance));
  const hit = new THREE.Vector3();
  for (const box of colliders) {
    if (box.max.y < Math.min(from.y, to.y) - 0.2 || box.min.y > Math.max(from.y, to.y) + 0.2) continue;
    const point = ray.intersectBox(box, hit);
    if (point && point.distanceTo(from) < distance - 0.15) return false;
  }
  return true;
}

function makeWaypoints(walkable, colliders) {
  const cells = new Map();
  for (const p of walkable) {
    if (p.ny < 0.8 || p.area < 0.18 || p.y < -2.5 || p.y > 2.9) continue;
    const point = { x: p.x, y: p.y + 0.055, z: p.z, area: p.area };
    if (!bodyIsFree(colliders, point, NAV_RADIUS, NAV_HEIGHT)) continue;
    const key = `${Math.round(p.x / 2.2)}|${Math.round(p.z / 2.2)}|${Math.round(p.y / 0.75)}`;
    const current = cells.get(key);
    if (!current || p.area > current.area) cells.set(key, point);
  }

  const nodes = [...cells.values()].map((p, id) => ({ id, x: p.x, y: p.y, z: p.z, area: p.area, links: [], tags: ['dm'] }));
  for (const node of nodes) {
    const neighbors = nodes
      .filter((other) => other !== node && Math.abs(other.y - node.y) <= 1.25)
      .map((other) => ({ other, distance: Math.hypot(other.x - node.x, other.z - node.z) }))
      .filter((entry) => entry.distance <= 5.2)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
    for (const { other } of neighbors) {
      if (node.links.includes(other.id) || !segmentClear(node, other, colliders)) continue;
      node.links.push(other.id);
      other.links.push(node.id);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const components = [];
  for (const start of nodes) {
    if (seen.has(start.id)) continue;
    const component = [];
    const queue = [start];
    seen.add(start.id);
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      component.push(node);
      for (const id of node.links) {
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        queue.push(byId.get(id));
      }
    }
    components.push(component);
  }
  const largest = components.sort((a, b) => b.length - a.length)[0] || [];
  const reindex = new Map(largest.map((node, id) => [node.id, id]));
  return largest.map((node, id) => ({
    id,
    x: node.x,
    y: node.y,
    z: node.z,
    tags: node.tags,
    links: [...new Set(node.links.filter((link) => reindex.has(link)).map((link) => reindex.get(link)))],
  }));
}

function makeLightRig(root) {
  // The selected asset uses KHR_materials_unlit because its "real light" is
  // baked into the textures. Keep that look and only provide a neutral rig for
  // any non-unlit helper/overlay material added later.
  const hemi = new THREE.HemisphereLight(0xc8ddf0, 0x6b5944, 0.55);
  hemi.name = 'dust2:hemi';
  const sun = new THREE.DirectionalLight(0xffe2b4, 0.75);
  sun.name = 'dust2:sun';
  sun.position.set(-24, 45, 18);
  root.add(hemi, sun);
  return [hemi, sun];
}

function disposeRoot(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const texture of textures) texture.dispose?.();
  for (const material of materials) material.dispose?.();
  root.removeFromParent();
}

export function buildDust2DeathmatchMapFromScene(game, root) {
  root.name = `map:${DUST2_DEATHMATCH_INFO.id}`;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  let physics;
  try {
    physics = buildCollisionProxy(root);
  } catch (error) {
    disposeRoot(root);
    throw error;
  }

  const visualBounds = new THREE.Box3().setFromObject(root, true);
  const size = visualBounds.getSize(new THREE.Vector3());
  const center = visualBounds.getCenter(new THREE.Vector3());
  const waypoints = makeWaypoints(physics.walkable, physics.colliders);
  if (waypoints.length < 12) {
    disposeRoot(root);
    throw new Error(`[dust2] grafo de navegación demasiado pequeño (${waypoints.length})`);
  }
  const deathmatchSpawns = makeDistributedSpawns(physics.walkable, physics.colliders, waypoints, center, 24);
  const spawns = {
    CT: deathmatchSpawns.filter((_, index) => index % 2 === 0),
    T: deathmatchSpawns.filter((_, index) => index % 2 === 1),
  };
  if (spawns.CT.length < 5 || spawns.T.length < 5) {
    disposeRoot(root);
    throw new Error(`[dust2] spawns insuficientes CT=${spawns.CT.length} T=${spawns.T.length}`);
  }
  const lights = makeLightRig(root);
  let triangles = 0;
  let drawCalls = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    drawCalls++;
    const geometry = object.geometry;
    triangles += (geometry?.index?.count || geometry?.attributes?.position?.count || 0) / 3;
    object.castShadow = false;
    object.receiveShadow = true;
  });

  const bounds = {
    minX: visualBounds.min.x,
    maxX: visualBounds.max.x,
    minZ: visualBounds.min.z,
    maxZ: visualBounds.max.z,
  };
  const ambient = {
    skyTop: 0x6f8da9,
    skyBottom: 0xd7b77e,
    fog: 0xc6ad82,
    fogNear: Math.max(70, Math.max(size.x, size.z) * 0.9),
    fogFar: Math.max(170, Math.max(size.x, size.z) * 2.1),
  };
  const disabledZone = { min: { x: 9999, z: 9999 }, max: { x: 10000, z: 10000 } };
  const data = {
    ...DUST2_DEATHMATCH_INFO,
    root,
    colliders: physics.colliders,
    slopes: physics.slopes,
    spawns,
    deathmatchSpawns,
    waypoints,
    bounds,
    ambient,
    buyZones: { CT: disabledZone, T: disabledZone },
    bombsites: [],
    hostageSpawns: [],
    rescueZone: null,
    callouts: [],
    menuCamera: {
      pos: { x: center.x + 46, y: 58, z: center.z + 54 },
      lookAt: { x: center.x, y: 0.8, z: center.z },
    },
    stats: {
      triangles: Math.round(triangles),
      drawCalls,
      meshes: drawCalls,
      lights: lights.length,
      colliders: physics.colliders.length,
      slopes: physics.slopes.length,
      waypoints: waypoints.length,
      links: waypoints.reduce((sum, waypoint) => sum + waypoint.links.length, 0) / 2,
      sourceSize: { x: size.x, y: size.y, z: size.z },
    },
  };

  data.dispose = () => {
    disposeRoot(root);
    physics.colliders.length = 0;
    physics.slopes.length = 0;
    physics.walkable.length = 0;
    data.colliders = [];
    data.slopes = [];
  };

  game.scene.add(root);
  game.log?.(
    `Mapa ${data.id}: ${data.stats.triangles} tris · ${data.stats.drawCalls} draw calls · ` +
    `${data.stats.colliders} colliders · ${data.stats.slopes} slopes · ` +
    `${deathmatchSpawns.length} spawns · ${data.stats.waypoints} waypoints`,
  );
  return data;
}

export async function buildDust2DeathmatchMap(game) {
  const gltf = await loader.loadAsync(DUST2_MODEL_URL);
  return buildDust2DeathmatchMapFromScene(game, gltf.scene);
}
