/** AIM_REDLINE: enclosed 1v1 warehouse reconstructed from the supplied views.
 * White block walls, concrete floor, steel roof, paired cover and stacked red
 * freight containers. The photo of the larger hangar informs the red steel,
 * striping and industrial lighting; it does not add its aircraft or blue cargo.
 */
import * as THREE from '../../vendor/three.module.js';
import { ArenaBuilder } from './aim_map.js';
import { createMaterialSet } from './textures.js';

export const REDLINE_INFO = Object.freeze({
  id: 'aim_redline', name: 'aim_redline', displayName: 'AIM_REDLINE', mode: 'aim',
  description: 'Arena industrial cerrada para duelos 1v1.',
});

const B = Object.freeze({ minX: -15, maxX: 15, minZ: -19, maxZ: 19 });
const WHITE = 0xe4e5dd;

function canvasMap(draw) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  draw(canvas.getContext('2d'), 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function makeWhiteBrick() {
  return canvasMap((ctx, size) => {
    ctx.fillStyle = '#b5b6b0'; ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 9; col++) {
        const x = col * 32 + (row % 2) * 16 + 1;
        const y = row * 16 + 1;
        const tint = (row * 13 + col * 7 + 96) % 17;
        ctx.fillStyle = `rgb(${224 + tint},${225 + tint},${219 + tint})`;
        ctx.fillRect(x, y, 30, 14);
      }
    }
    ctx.fillStyle = 'rgba(70,72,68,.055)';
    for (let i = 0; i < 1100; i++) {
      const x = (i * 109 + 37) % size, y = (i * 71 + 19) % size;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

function makeConcrete() {
  return canvasMap((ctx, size) => {
    ctx.fillStyle = '#a8a7a3'; ctx.fillRect(0, 0, size, size);
    let seed = 0x4e291acf;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let i = 0; i < 8500; i++) {
      const v = Math.floor(rand() * 90);
      ctx.fillStyle = i % 4 ? `rgba(49,48,46,${.035 + v / 1400})` : 'rgba(243,242,234,.13)';
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    }
    ctx.strokeStyle = 'rgba(75,73,70,.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(size, 2); ctx.stroke();
  });
}

function makeHazardTape() {
  return canvasMap((ctx, size) => {
    ctx.fillStyle = '#d6b31c'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#242420';
    for (let x = -size; x < size * 2; x += 96) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + 39, 0);
      ctx.lineTo(x + 39 + size, size); ctx.lineTo(x + size, size);
      ctx.closePath(); ctx.fill();
    }
  });
}

function makeCorrugated(base) {
  return canvasMap((ctx, size) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, 0, 2, size);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x + 12, 0, 3, size);
    }
    ctx.fillStyle = 'rgba(26,21,19,.055)';
    for (let i = 0; i < 200; i++) ctx.fillRect((i * 83) % size, (i * 47) % size, 3, 1);
  });
}

function addMaterials(set) {
  const specs = {
    redSteel: [makeCorrugated('#823c3d'), 0xedadad, 1.3, .68, .32],
    whiteBrick: [makeWhiteBrick(), WHITE, 2.2, 1, 0],
    redlineFloor: [makeConcrete(), 0xffffff, 4, .96, 0],
    roofPanel: [makeCorrugated('#737777'), 0xe2e2df, 2.6, .82, .2],
    paintedSteel: [null, 0x727574, 1, .7, .35],
    blackSteel: [null, 0x292c2b, 1, .75, .45],
    hazardYellow: [null, 0xd8b527, 1, .9, 0],
    hazardTape: [makeHazardTape(), 0xffffff, .45, .9, 0],
  };
  for (const [key, [map, color, tile, roughness, metalness]] of Object.entries(specs)) {
    const mat = new THREE.MeshStandardMaterial({ map, color, roughness, metalness });
    mat.name = `mat:${key}`;
    set.materials[key] = mat;
    set.tiles[key] = tile;
  }
  // The roof is lit mostly from below; a faint emissive term preserves the
  // gray sheet-metal appearance of the reference without affecting shadows.
  set.materials.roofPanel.emissive.setHex(0x858887);
  set.materials.roofPanel.emissiveIntensity = .55;
}

function crate(b, x, z, size = 1.45, y = 0) {
  b.box('crate', x, y + size / 2, z, size, size, size,
    { uvFit: true, collider: true, surface: 'wood' });
}

function darkCrate(b, x, z, w = 2.6, d = 1.45, h = 1.44) {
  b.box('metalDark', x, h / 2, z, w, h, d,
    { uvFit: true, collider: true, surface: 'metal' });
  for (const sx of [-1, 1]) {
    b.box('paintedSteel', x + sx * (w / 2 + .015), h / 2, z, .035, h - .17, d - .13);
  }
  b.box('blackSteel', x, h + .03, z, w + .08, .06, d + .08);
}

function redContainer(b, x, z, w, d, bottom, height) {
  const top = bottom + height;
  b.box('redSteel', x, bottom + height / 2, z, w, height, d,
    { uvFit: false, collider: true, surface: 'metal' });
  b.box('blackSteel', x, bottom + .07, z, w + .06, .14, d + .06);
  b.box('blackSteel', x, top - .07, z, w + .06, .14, d + .06);
  for (let dz = -d / 2 + .35; dz < d / 2 - .2; dz += .55) {
    for (const side of [-1, 1])
      b.box('redSteel', x + side * (w / 2 + .035), bottom + height / 2, z + dz,
        .075, height - .25, .09, { uvFit: true });
  }
  for (let dx = -w / 2 + .35; dx < w / 2 - .2; dx += .55) {
    for (const side of [-1, 1])
      b.box('redSteel', x + dx, bottom + height / 2, z + side * (d / 2 + .035),
        .09, height - .25, .075, { uvFit: true });
  }
}

function hazardBorder(b) {
  // Four separate strips lie above the floor, so no coplanar overlays or
  // Z-fighting. Diagonal stripes are painted into the tape texture.
  for (const x of [-6.1, 6.1])
    b.box('hazardTape', x, .035, 0, .4, .014, 13.4);
  for (const z of [-6.7, 6.7])
    b.box('hazardTape', 0, .035, z, 12.2, .014, .4);
}

function buildRoom(b) {
  b.box('redlineFloor', 0, -.28, 0, 30, .56, 38, { collider: true, surface: 'stone' });
  b.box('whiteBrick', -14.82, 3.6, 0, .36, 7.2, 38, { collider: true });
  b.box('whiteBrick', 14.82, 3.6, 0, .36, 7.2, 38, { collider: true });
  b.box('whiteBrick', 0, 3.6, -18.82, 30, 7.2, .36, { collider: true });
  b.box('whiteBrick', 0, 3.6, 18.82, 30, 7.2, .36, { collider: true });
  b.box('roofPanel', 0, 7.34, 0, 30, .28, 38);

  // Exposed posts, transverse beams and small suspended industrial lights.
  for (const side of [-1, 1]) {
    for (const z of [-14, -7, 0, 7, 14])
      b.box('paintedSteel', side * 14.5, 3.6, z, .26, 7.2, .32);
    for (const z of [-12, 0, 12])
      b.box('blackSteel', side * 7.3, 6.82, z, 14.3, .13, .14);
  }
  for (const z of [-12, -4, 4, 12]) {
    b.box('blackSteel', 0, 6.89, z, 28.6, .16, .2);
    for (const x of [-10, -5, 0, 5, 10]) {
      b.box('blackSteel', x, 6.55, z, .045, .55, .045);
      b.box('lampPanel', x, 6.25, z, .7, .09, .52);
    }
    const light = new THREE.PointLight(0xfff1d7, 5, 16, 1.8);
    light.position.set(0, 6.15, z);
    b.root.add(light); b.lights.push(light);
  }
  // Narrow dark service shutters visible on the white walls in photo 1.
  for (const z of [-11, 10]) {
    b.box('metalDark', -14.59, 2.35, z, .07, 3.7, 2.1, { uvFit: true });
    b.box('metalDark', 14.59, 2.35, -z, .07, 3.7, 2.1, { uvFit: true });
  }
  // Container stack and the flanking low metal/wood cover from both photos.
  redContainer(b, 0, -.3, 5.8, 4.3, 0, 2.5);
  redContainer(b, 0, -.65, 4.7, 3.5, 2.5, 2.15);
  hazardBorder(b);
  for (const side of [-1, 1]) {
    for (const z of [-9, 9]) {
      darkCrate(b, side * 11.8, z, 3.1, 1.7);
      // Tall metal cover screens both bases from a direct opening shot while
      // leaving a central route and an outer route, as in the second photo.
      darkCrate(b, side * 5.25, z, 4.2, 2.1, 2.1);
      crate(b, side * 8.6, z * .78, 1.45);
      crate(b, side * 10.2, z * .62, 1.12);
    }
    darkCrate(b, side * 9.7, 0, 1.9, 1.4);
    crate(b, side * 11.2, -2.5, 1.45);
    crate(b, side * 11.2, 2.5, 1.45);
  }
}

function makeWaypoints(b) {
  const points = [];
  for (let z = -16; z <= 16; z += 3.2) {
    for (let x = -12; x <= 12; x += 3) {
      if (b.isFree(x, z, .48, .06, 1.8))
        points.push({ id: points.length, x, y: .05, z, links: [], tags: [] });
    }
  }
  for (const a of points) for (const c of points) {
    if (a.id >= c.id || Math.hypot(a.x - c.x, a.z - c.z) > 4.5) continue;
    if (b.segmentClear(a.x, a.z, c.x, c.z, .4, .5)) {
      a.links.push(c.id); c.links.push(a.id);
    }
  }
  // Small pockets behind side crates are walkable but not connected to the
  // coarse waypoint grid. They should not become isolated bot destinations.
  const connected = points.filter(point => point.links.length > 0);
  const newId = new Map(connected.map((point, id) => [point.id, id]));
  for (const point of connected) {
    point.links = point.links.map(id => newId.get(id));
    point.id = newId.get(point.id);
  }
  return connected;
}

export function buildRedlineMap(game) {
  const materials = createMaterialSet('cs_assault');
  addMaterials(materials);
  const b = new ArenaBuilder(REDLINE_INFO.id, materials, 0x7265646c);
  let data;
  try {
    buildRoom(b);
    b.addEnvironment({
      hemiColor: 0xdce4ec, hemiGround: 0x88837c, hemiIntensity: .95,
      sunColor: 0xffffff, sunIntensity: .55, ambientColor: 0xc6c6c1,
      ambientIntensity: .46, sunDir: { x: .15, y: .9, z: -.1 },
    });
    b.finalize();
    const spawns = {
      CT: [-7, -3.5, 3.5, 7].map(x => ({ x, y: .05, z: 16.1, yaw: 0 })),
      T: [-7, -3.5, 3.5, 7].map(x => ({ x, y: .05, z: -16.1, yaw: 180 })),
    };
    for (const team of ['CT', 'T']) for (const spawn of spawns[team]) {
      if (!b.isFree(spawn.x, spawn.z, .5, .06, 1.8))
        throw new Error(`Spawn ${team} obstruido: ${spawn.x},${spawn.z}`);
    }
    const waypoints = makeWaypoints(b);
    data = {
      ...REDLINE_INFO, bounds: B,
      ambient: { fog: 0xb7b5af, fogNear: 35, fogFar: 92 },
      root: b.root, colliders: b.colliders, spawns, waypoints,
      buyZones: { CT: { min: { x: -12, z: 14 }, max: { x: 12, z: 18 } },
        T: { min: { x: -12, z: -18 }, max: { x: 12, z: -14 } } },
      bombsites: [], hostageSpawns: [], rescueZone: null,
      callouts: [
        { name: 'CT Base', min: { x: -15, z: 13 }, max: { x: 15, z: 19 } },
        { name: 'T Base', min: { x: -15, z: -19 }, max: { x: 15, z: -13 } },
        { name: 'Red Stack', min: { x: -6, z: -7 }, max: { x: 6, z: 7 } },
        { name: 'West Lane', min: { x: -15, z: -13 }, max: { x: -6, z: 13 } },
        { name: 'East Lane', min: { x: 6, z: -13 }, max: { x: 15, z: 13 } },
      ],
      menuCamera: { pos: { x: 10, y: 5.8, z: 15 }, lookAt: { x: 0, y: 2, z: 0 } },
      stats: { triangles: 0, drawCalls: 0, colliders: b.colliders.length, waypoints: waypoints.length },
    };
    b.root.traverse(obj => {
      if (!obj.isMesh && !obj.isLine) return;
      data.stats.drawCalls++;
      data.stats.triangles += (obj.geometry?.index?.count || obj.geometry?.attributes.position.count || 0) / 3;
    });
    data.stats.triangles = Math.round(data.stats.triangles);
  } catch (error) {
    b.root.traverse(obj => obj.geometry?.dispose?.());
    materials.dispose();
    throw error;
  }
  data.dispose = () => {
    b.root.removeFromParent();
    b.root.traverse(obj => obj.geometry?.dispose?.());
    materials.dispose();
    b.colliders.length = 0;
    data.colliders = [];
  };
  game.scene.add(b.root);
  game.log?.(`Mapa ${data.id}: ${data.stats.triangles} tris · ${data.stats.drawCalls} draw calls`);
  return data;
}
