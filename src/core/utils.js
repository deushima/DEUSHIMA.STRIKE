import * as THREE from '../../vendor/three.module.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const EPS = 1e-4;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a || 1);
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const expDamp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const chance = (p) => Math.random() < p;
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const angleDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const approachAngle = (current, target, maxStep) => {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
};

export const distance2D = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
export const distanceXZ = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

export const formatClock = (seconds, showHours = false) => {
  seconds = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${showHours ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
};

export const formatMoney = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export const pointInRect = (x, z, min, max) =>
  x >= min.x && x <= max.x && z >= min.z && z <= max.z;

export const pointInCircle = (x, z, cx, cz, r) => (x - cx) ** 2 + (z - cz) ** 2 <= r * r;

export const seededRandom = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export const canvasTexture = (size, draw, opts = {}) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = opts.anisotropy || 4;
  tex.needsUpdate = true;
  return tex;
};

export const disposeObject = (obj) => {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const val = m[key];
          if (val && val.isTexture) val.dispose?.();
        }
        m.dispose?.();
      }
    }
  });
  obj.removeFromParent?.();
};

export const makeBoxCollider = (minX, minY, minZ, maxX, maxY, maxZ, surface = 'stone') => {
  const box = new THREE.Box3(
    new THREE.Vector3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
    new THREE.Vector3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
  );
  box.surface = surface;
  return box;
};

export const expandBox = (box, amount) => {
  const b = box.clone();
  b.min.x -= amount;
  b.min.y -= amount;
  b.min.z -= amount;
  b.max.x += amount;
  b.max.y += amount;
  b.max.z += amount;
  return b;
};

export const randomPointInCircle = (radius) => {
  const a = rand(0, TAU);
  const r = radius * Math.sqrt(Math.random());
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
};

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
