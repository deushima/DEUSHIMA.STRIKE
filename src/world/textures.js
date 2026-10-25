/**
 * textures.js â€” CS 1.6 Browser Â· texturas procedurales (canvas) y sets de materiales.
 *
 * Sin assets externos: todo se dibuja en un <canvas> y se sube como THREE.CanvasTexture.
 * Los materiales se comparten por mapa (un MeshStandardMaterial por clave) para que el
 * batcher de maps.js pueda fusionar geometrÃ­a y mantener pocos draw calls.
 *
 * Exporta:
 *   createMaterialSet(mapId) -> { materials, tiles, textures, addUnique, dispose }
 *   makeSignTexture(text, opts) -> THREE.CanvasTexture | null
 *   makeDecalTexture(draw, size) -> THREE.CanvasTexture | null
 *   disposeMaterial(mat)
 *
 * En Node (tests) no hay document: las funciones devuelven null y los materiales usan
 * solo color, asÃ­ el mapa se puede construir y validar sin DOM.
 */

import * as THREE from '../../vendor/three.module.js';
import { wadTextureFor } from './wad.js';

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

/* ----------------------------------------------------------------------------
 * utilidades
 * -------------------------------------------------------------------------- */

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeCanvas(w, h) {
  if (!HAS_DOM) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function newTexture(canvas, { clamp = false, anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  if (clamp) {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  } else {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function rgba(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function noiseDots(ctx, s, rng, count, { light = true, alpha = 0.09, size = 2 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const a = alpha * (0.35 + rng() * 0.9);
    ctx.fillStyle = light ? rgba(255, 244, 214, a) : rgba(38, 28, 16, a);
    const sz = rng() < 0.2 ? size + 1 : 1;
    ctx.fillRect(x, y, sz, sz);
  }
}

function softPatches(ctx, s, rng, count, rgb, maxAlpha = 0.12, rMin = 5, rMax = 26) {
  for (let i = 0; i < count; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const r = rMin + rng() * rMax;
    ctx.fillStyle = rgba(rgb[0], rgb[1], rgb[2], maxAlpha * (0.4 + rng() * 0.8));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function scratches(ctx, s, rng, count, color = 'rgba(30,24,16,0.16)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const len = 3 + rng() * 16;
    const a = rng() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

function crack(ctx, x, y, len, rng) {
  ctx.strokeStyle = 'rgba(38,30,20,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x;
  let cy = y;
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    cx += (rng() - 0.5) * len * 0.5;
    cy += (rng() - 0.2) * len * 0.35;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}

/* ----------------------------------------------------------------------------
 * dibujos de texturas
 * -------------------------------------------------------------------------- */

const TEX_DRAW = {
  sand(ctx, s, rng) {
    ctx.fillStyle = '#c8aa79';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 60, [182, 154, 104], 0.14, 6, 28);
    softPatches(ctx, s, rng, 26, [150, 122, 80], 0.1, 10, 30);
    noiseDots(ctx, s, rng, 2600, { light: true, alpha: 0.1 });
    noiseDots(ctx, s, rng, 1600, { light: false, alpha: 0.07 });
    // ondulaciones de viento
    ctx.strokeStyle = 'rgba(122,96,60,0.13)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      const y0 = rng() * s;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= s; x += 10) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.09 + rng() * 0.4) * 2.2);
      }
      ctx.stroke();
    }
    // piedritas
    for (let i = 0; i < 70; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = 0.7 + rng() * 1.6;
      ctx.fillStyle = rgba(110, 88, 56, 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(240, 220, 180, 0.25);
      ctx.beginPath();
      ctx.arc(x - 0.4, y - 0.4, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  sandWall(ctx, s, rng) {
    ctx.fillStyle = '#b9a077';
    ctx.fillRect(0, 0, s, s);
    const rows = 8;
    const rowH = s / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      let x = row % 2 ? -s * 0.08 : -s * 0.02;
      while (x < s) {
        const w = s * (0.16 + rng() * 0.16);
        const tint = Math.floor(rng() * 26 - 13);
        ctx.fillStyle = `rgb(${206 + tint},${181 + tint},${137 + tint})`;
        ctx.fillRect(x + 1.5, y + 1.5, w - 3, rowH - 3);
        // bisel
        ctx.fillStyle = 'rgba(255,244,210,0.16)';
        ctx.fillRect(x + 1.5, y + 1.5, w - 3, 1.4);
        ctx.fillStyle = 'rgba(74,56,32,0.16)';
        ctx.fillRect(x + 1.5, y + rowH - 3.5, w - 3, 2);
        // erosiÃ³n interna
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = rgba(150, 126, 88, 0.12);
          ctx.fillRect(x + 2 + rng() * (w - 6), y + 2 + rng() * (rowH - 6), 2 + rng() * 5, 1.5);
        }
        x += w;
      }
      ctx.fillStyle = 'rgba(110,90,58,0.6)';
      ctx.fillRect(0, y, s, 1.6);
    }
    noiseDots(ctx, s, rng, 2200, { light: true, alpha: 0.08 });
    noiseDots(ctx, s, rng, 1400, { light: false, alpha: 0.06 });
    for (let i = 0; i < 4; i++) crack(ctx, rng() * s, rng() * s, 18 + rng() * 22, rng);
    // regueros de polvo
    for (let i = 0; i < 10; i++) {
      const x = rng() * s;
      ctx.fillStyle = 'rgba(120,98,64,0.08)';
      ctx.fillRect(x, 0, 1 + rng() * 2, s);
    }
  },

  brick(ctx, s, rng) {
    ctx.fillStyle = '#b7a07d';
    ctx.fillRect(0, 0, s, s);
    const rowH = s / 9;
    for (let row = 0; row < 9; row++) {
      const y = row * rowH;
      let x = row % 2 ? -s * 0.11 : 0;
      while (x < s) {
        const w = s * 0.2;
        const tint = Math.floor(rng() * 30 - 15);
        ctx.fillStyle = `rgb(${170 + tint},${104 + tint * 0.6},${74 + tint * 0.4})`;
        ctx.fillRect(x + 1.5, y + 1.5, w - 3, rowH - 3);
        ctx.fillStyle = 'rgba(255,220,180,0.12)';
        ctx.fillRect(x + 1.5, y + 1.5, w - 3, 1);
        ctx.fillStyle = 'rgba(52,30,20,0.18)';
        ctx.fillRect(x + 1.5, y + rowH - 3, w - 3, 1.5);
        x += w;
      }
    }
    noiseDots(ctx, s, rng, 2000, { light: true, alpha: 0.07 });
    noiseDots(ctx, s, rng, 1800, { light: false, alpha: 0.07 });
    for (let i = 0; i < 3; i++) crack(ctx, rng() * s, rng() * s, 20, rng);
  },

  stoneWall(ctx, s, rng) {
    ctx.fillStyle = '#8d8677';
    ctx.fillRect(0, 0, s, s);
    const rows = 6;
    const rowH = s / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      let x = row % 2 ? -s * 0.07 : 0;
      while (x < s) {
        const w = s * (0.18 + rng() * 0.2);
        const tint = Math.floor(rng() * 34 - 17);
        ctx.fillStyle = `rgb(${151 + tint},${144 + tint},${130 + tint})`;
        ctx.fillRect(x + 2, y + 2, w - 4, rowH - 4);
        ctx.fillStyle = 'rgba(240,236,222,0.12)';
        ctx.fillRect(x + 2, y + 2, w - 4, 1.5);
        ctx.fillStyle = 'rgba(30,28,22,0.2)';
        ctx.fillRect(x + 2, y + rowH - 4, w - 4, 2);
        x += w;
      }
      ctx.fillStyle = 'rgba(58,54,46,0.5)';
      ctx.fillRect(0, y, s, 1.8);
    }
    noiseDots(ctx, s, rng, 2400, { light: true, alpha: 0.07 });
    noiseDots(ctx, s, rng, 2000, { light: false, alpha: 0.08 });
    // musgo seco
    for (let i = 0; i < 12; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rgba(96, 104, 64, 0.12);
      ctx.beginPath();
      ctx.arc(x, y, 3 + rng() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 3; i++) crack(ctx, rng() * s, rng() * s, 22, rng);
  },

  stoneDark(ctx, s, rng) {
    ctx.fillStyle = '#6b675c';
    ctx.fillRect(0, 0, s, s);
    const rows = 5;
    const rowH = s / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      let x = row % 2 ? -s * 0.1 : 0;
      while (x < s) {
        const w = s * (0.2 + rng() * 0.22);
        const tint = Math.floor(rng() * 20 - 10);
        ctx.fillStyle = `rgb(${104 + tint},${99 + tint},${89 + tint})`;
        ctx.fillRect(x + 2, y + 2, w - 4, rowH - 4);
        ctx.fillStyle = 'rgba(210,205,190,0.08)';
        ctx.fillRect(x + 2, y + 2, w - 4, 1.2);
        x += w;
      }
      ctx.fillStyle = 'rgba(24,22,18,0.45)';
      ctx.fillRect(0, y, s, 1.6);
    }
    noiseDots(ctx, s, rng, 2200, { light: true, alpha: 0.05 });
    noiseDots(ctx, s, rng, 2200, { light: false, alpha: 0.09 });
    // hollÃ­n
    softPatches(ctx, s, rng, 12, [26, 24, 20], 0.16, 10, 34);
  },

  wood(ctx, s, rng) {
    ctx.fillStyle = '#8a6236';
    ctx.fillRect(0, 0, s, s);
    const planks = 5;
    const ph = s / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph;
      const tint = Math.floor(rng() * 26 - 13);
      ctx.fillStyle = `rgb(${138 + tint},${99 + tint * 0.7},${56 + tint * 0.4})`;
      ctx.fillRect(0, y + 1, s, ph - 2);
      // vetas
      ctx.strokeStyle = 'rgba(64,42,20,0.22)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const yy = y + 2 + rng() * (ph - 4);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        for (let x = 0; x <= s; x += 8) ctx.lineTo(x, yy + Math.sin(x * 0.13 + p) * 1.2);
        ctx.stroke();
      }
      // nudo
      if (rng() < 0.6) {
        const kx = 10 + rng() * (s - 20);
        const ky = y + ph * 0.5;
        ctx.strokeStyle = 'rgba(58,36,16,0.45)';
        ctx.lineWidth = 1.4;
        for (let r = 1; r <= 3; r++) {
          ctx.beginPath();
          ctx.ellipse(kx, ky, r * 3.2, r * 1.8, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(40,26,12,0.5)';
      ctx.fillRect(0, y, s, 1.3);
    }
    noiseDots(ctx, s, rng, 1200, { light: true, alpha: 0.05 });
    noiseDots(ctx, s, rng, 1200, { light: false, alpha: 0.06 });
  },

  crate(ctx, s, rng) {
    ctx.fillStyle = '#a3793f';
    ctx.fillRect(0, 0, s, s);
    // tablones
    const ph = s / 4;
    for (let p = 0; p < 4; p++) {
      const y = p * ph;
      const tint = Math.floor(rng() * 22 - 11);
      ctx.fillStyle = `rgb(${163 + tint},${121 + tint * 0.8},${64 + tint * 0.5})`;
      ctx.fillRect(0, y + 1.5, s, ph - 3);
      ctx.strokeStyle = 'rgba(70,46,20,0.2)';
      for (let i = 0; i < 8; i++) {
        const yy = y + 3 + rng() * (ph - 6);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        for (let x = 0; x <= s; x += 10) ctx.lineTo(x, yy + Math.sin(x * 0.11) * 1.3);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(52,32,14,0.45)';
      ctx.fillRect(0, y, s, 1.6);
    }
    // marco
    ctx.fillStyle = '#6d4a24';
    ctx.fillRect(0, 0, s, 7);
    ctx.fillRect(0, s - 7, s, 7);
    ctx.fillRect(0, 0, 7, s);
    ctx.fillRect(s - 7, 0, 7, s);
    // refuerzos diagonales
    ctx.strokeStyle = 'rgba(96,64,30,0.9)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(s - 8, s - 8);
    ctx.moveTo(s - 8, 8);
    ctx.lineTo(8, s - 8);
    ctx.stroke();
    // clavos
    for (const [x, y] of [
      [10, 10],
      [s - 10, 10],
      [10, s - 10],
      [s - 10, s - 10],
    ]) {
      ctx.fillStyle = '#3f3223';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(220,200,160,0.4)';
      ctx.beginPath();
      ctx.arc(x - 0.7, y - 0.7, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    noiseDots(ctx, s, rng, 900, { light: false, alpha: 0.07 });
  },

  doorWood(ctx, s, rng) {
    ctx.fillStyle = '#7c5328';
    ctx.fillRect(0, 0, s, s);
    noiseDots(ctx, s, rng, 900, { light: false, alpha: 0.06 });
    ctx.strokeStyle = 'rgba(46,28,10,0.55)';
    ctx.lineWidth = 2;
    // dos paneles rehundidos
    for (const [x, y, w, h] of [
      [s * 0.12, s * 0.08, s * 0.76, s * 0.38],
      [s * 0.12, s * 0.54, s * 0.76, s * 0.38],
    ]) {
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(44,26,10,0.28)';
      ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
      ctx.fillStyle = 'rgba(220,180,130,0.12)';
      ctx.fillRect(x + 5, y + 5, w - 10, 2);
    }
    // pomo
    ctx.fillStyle = '#c9a24a';
    ctx.beginPath();
    ctx.arc(s * 0.85, s * 0.52, 3.2, 0, Math.PI * 2);
    ctx.fill();
  },

  metal(ctx, s, rng) {
    ctx.fillStyle = '#8d9195';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 320; i++) {
      const x = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(30,34,38,0.07)';
      ctx.fillRect(x, 0, 0.8 + rng() * 1.2, s);
    }
    softPatches(ctx, s, rng, 18, [120, 122, 124], 0.1, 8, 24);
    // Ã³xido
    for (let i = 0; i < 16; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rgba(146, 82, 40, 0.18);
      ctx.beginPath();
      ctx.arc(x, y, 1 + rng() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // remaches
    for (let i = 0; i < 10; i++) {
      const x = 10 + rng() * (s - 20);
      const y = 10 + rng() * (s - 20);
      ctx.fillStyle = 'rgba(60,64,68,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(230,236,240,0.35)';
      ctx.beginPath();
      ctx.arc(x - 0.6, y - 0.6, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  metalDark(ctx, s, rng) {
    ctx.fillStyle = '#4c5155';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 280; i++) {
      const x = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(190,200,206,0.04)' : 'rgba(10,12,14,0.12)';
      ctx.fillRect(x, 0, 1 + rng() * 1.6, s);
    }
    softPatches(ctx, s, rng, 20, [24, 26, 28], 0.14, 6, 22);
    for (let i = 0; i < 12; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rgba(140, 78, 38, 0.2);
      ctx.beginPath();
      ctx.arc(x, y, 1 + rng() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // plancha soldada
    ctx.strokeStyle = 'rgba(18,20,22,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5);
    ctx.lineTo(s, s * 0.5);
    ctx.stroke();
    noiseDots(ctx, s, rng, 800, { light: true, alpha: 0.04 });
  },

  barrelA(ctx, s, rng) {
    barrelPaint(ctx, s, rng, [158, 66, 40], [92, 38, 24]);
  },

  barrelB(ctx, s, rng) {
    barrelPaint(ctx, s, rng, [58, 104, 128], [34, 62, 78]);
  },

  glass(ctx, s, rng) {
    ctx.fillStyle = '#cfe3e7';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < 7; i++) {
      const x = rng() * s;
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(0.32);
      ctx.fillRect(0, -s, 5 + rng() * 14, s * 2.4);
      ctx.restore();
    }
    // suciedad en bordes
    ctx.strokeStyle = 'rgba(120,132,132,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, s, s);
  },

  tarp(ctx, s, rng) {
    ctx.fillStyle = '#c9c0ac';
    ctx.fillRect(0, 0, s, s);
    const stripe = s / 5;
    for (let i = 0; i < 5; i += 2) {
      ctx.fillStyle = '#9c3a2e';
      ctx.fillRect(i * stripe, 0, stripe, s);
    }
    // pliegues
    for (let i = 0; i < 18; i++) {
      const x = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(40,30,24,0.1)';
      ctx.fillRect(x, 0, 1 + rng() * 3, s);
    }
    noiseDots(ctx, s, rng, 900, { light: false, alpha: 0.06 });
  },

  foliage(ctx, s, rng) {
    ctx.fillStyle = '#5c6b30';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 130; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const a = rng() * Math.PI * 2;
      const len = 5 + rng() * 12;
      ctx.strokeStyle = rng() < 0.5 ? 'rgba(132,150,72,0.55)' : 'rgba(64,82,34,0.5)';
      ctx.lineWidth = 2 + rng() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    noiseDots(ctx, s, rng, 600, { light: true, alpha: 0.05 });
  },

  grassDry(ctx, s, rng) {
    ctx.fillStyle = '#9a8b53';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 24, [140, 126, 74], 0.16, 8, 24);
    for (let i = 0; i < 420; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const a = -Math.PI / 2 + (rng() - 0.5) * 0.9;
      const len = 3 + rng() * 9;
      ctx.strokeStyle = rng() < 0.5 ? 'rgba(186,170,110,0.55)' : 'rgba(96,88,48,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    noiseDots(ctx, s, rng, 700, { light: false, alpha: 0.06 });
  },

  concrete(ctx, s, rng) {
    ctx.fillStyle = '#a29e96';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 30, [170, 166, 156], 0.16, 8, 26);
    softPatches(ctx, s, rng, 24, [110, 106, 98], 0.12, 5, 20);
    noiseDots(ctx, s, rng, 2600, { light: true, alpha: 0.08 });
    noiseDots(ctx, s, rng, 2200, { light: false, alpha: 0.07 });
    // juntas
    ctx.strokeStyle = 'rgba(74,72,66,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.5);
    ctx.lineTo(s, s * 0.5);
    ctx.moveTo(s * 0.5, 0);
    ctx.lineTo(s * 0.5, s);
    ctx.stroke();
    for (let i = 0; i < 2; i++) crack(ctx, rng() * s, rng() * s, 26, rng);
  },

  dirt(ctx, s, rng) {
    ctx.fillStyle = '#87703f';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 44, [116, 94, 52], 0.18, 6, 26);
    softPatches(ctx, s, rng, 20, [60, 48, 26], 0.14, 8, 24);
    noiseDots(ctx, s, rng, 2400, { light: true, alpha: 0.07 });
    noiseDots(ctx, s, rng, 2200, { light: false, alpha: 0.09 });
    for (let i = 0; i < 80; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rgba(78, 62, 36, 0.5);
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + rng() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  plaster(ctx, s, rng) {
    ctx.fillStyle = '#d7d0bf';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 26, [196, 188, 172], 0.16, 8, 30);
    softPatches(ctx, s, rng, 14, [152, 144, 128], 0.1, 8, 26);
    for (let i = 0; i < 140; i++) {
      const x = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(120,112,96,0.06)';
      ctx.fillRect(x, 0, 0.8 + rng() * 2, s);
    }
    noiseDots(ctx, s, rng, 1600, { light: true, alpha: 0.06 });
    noiseDots(ctx, s, rng, 1400, { light: false, alpha: 0.05 });
    // humedad baja
    ctx.fillStyle = 'rgba(128,116,92,0.06)';
    ctx.fillRect(0, s * 0.86, s, s * 0.14);
  },

  concreteWall(ctx, s, rng) {
    ctx.fillStyle = '#9b968c';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 24, [170, 164, 152], 0.14, 8, 28);
    noiseDots(ctx, s, rng, 2200, { light: true, alpha: 0.07 });
    noiseDots(ctx, s, rng, 2000, { light: false, alpha: 0.07 });
    ctx.strokeStyle = 'rgba(62,60,54,0.45)';
    ctx.lineWidth = 1.6;
    for (let x = 0; x <= s; x += s / 3) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
    for (let y = 0; y <= s; y += s / 2) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    for (let i = 0; i < 2; i++) crack(ctx, rng() * s, rng() * s, 22, rng);
  },

  carpet(ctx, s, rng) {
    ctx.fillStyle = '#4c443c';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 26, [66, 58, 50], 0.2, 6, 24);
    softPatches(ctx, s, rng, 20, [38, 32, 26], 0.2, 4, 16);
    for (let i = 0; i < 900; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(120,108,92,0.12)' : 'rgba(24,20,16,0.14)';
      ctx.fillRect(x, y, 1, 2);
    }
    noiseDots(ctx, s, rng, 1400, { light: true, alpha: 0.04 });
    noiseDots(ctx, s, rng, 1400, { light: false, alpha: 0.07 });
  },

  carpetRed(ctx, s, rng) {
    ctx.fillStyle = '#632e2c';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 24, [84, 36, 34], 0.22, 6, 24);
    softPatches(ctx, s, rng, 18, [42, 18, 18], 0.2, 4, 18);
    for (let i = 0; i < 800; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(154,96,86,0.12)' : 'rgba(20,8,8,0.16)';
      ctx.fillRect(x, y, 1, 2);
    }
  },

  ceiling(ctx, s, rng) {
    ctx.fillStyle = '#d9d4c4';
    ctx.fillRect(0, 0, s, s);
    // placas
    const cell = s / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const tint = Math.floor(rng() * 12 - 6);
        ctx.fillStyle = `rgb(${216 + tint},${211 + tint},${194 + tint})`;
        ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      }
    }
    ctx.strokeStyle = 'rgba(150,144,128,0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, s);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(s, i * cell);
      ctx.stroke();
    }
    // manchas
    softPatches(ctx, s, rng, 8, [140, 128, 100], 0.1, 6, 18);
    noiseDots(ctx, s, rng, 500, { light: false, alpha: 0.05 });
  },

  tile(ctx, s, rng) {
    const n = 4;
    const cell = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dark = (x + y) % 2 === 0;
        const tint = Math.floor(rng() * 12 - 6);
        ctx.fillStyle = dark
          ? `rgb(${168 + tint},${161 + tint},${146 + tint})`
          : `rgb(${205 + tint},${199 + tint},${184 + tint})`;
        ctx.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, 1.5);
      }
    }
    ctx.strokeStyle = 'rgba(110,104,92,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, s);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(s, i * cell);
      ctx.stroke();
    }
    noiseDots(ctx, s, rng, 800, { light: true, alpha: 0.05 });
    softPatches(ctx, s, rng, 10, [120, 112, 98], 0.07, 4, 14);
  },

  screen(ctx, s, rng) {
    ctx.fillStyle = '#08150e';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(90,200,130,0.1)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(${80 + Math.floor(rng() * 90)},${180 + Math.floor(rng() * 60)},${110 + Math.floor(rng() * 60)},${0.16 + rng() * 0.3})`;
      const y = rng() * s;
      ctx.fillRect(4 + rng() * 10, y, 4 + rng() * (s - 20), 1.4);
    }
    ctx.fillStyle = 'rgba(160,255,200,0.25)';
    ctx.fillRect(0, 0, s, 2);
    ctx.fillRect(0, s - 2, s, 2);
    // scanlines
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, y, s, 1);
    }
    ctx.strokeStyle = 'rgba(120,140,130,0.5)';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, s, s);
  },

  board(ctx, s, rng) {
    ctx.fillStyle = '#2c4636';
    ctx.fillRect(0, 0, s, s);
    softPatches(ctx, s, rng, 20, [72, 108, 82], 0.14, 6, 22);
    ctx.strokeStyle = 'rgba(228,236,220,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 16; i++) {
      const x = 6 + rng() * (s - 12);
      const y = 8 + rng() * (s - 16);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 34, y + (rng() - 0.5) * 8);
      ctx.stroke();
    }
    // marco
    ctx.fillStyle = '#6b5232';
    ctx.fillRect(0, 0, s, 5);
    ctx.fillRect(0, s - 5, s, 5);
    ctx.fillRect(0, 0, 5, s);
    ctx.fillRect(s - 5, 0, 5, s);
  },

  fabric(ctx, s, rng) {
    ctx.fillStyle = '#3f5068';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 800; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(96,116,144,0.12)' : 'rgba(24,32,44,0.16)';
      ctx.fillRect(x, y, 1, 1);
    }
    // trama
    ctx.strokeStyle = 'rgba(20,28,40,0.2)';
    ctx.lineWidth = 1;
    for (let i = 0; i < s; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
    softPatches(ctx, s, rng, 10, [96, 116, 146], 0.1, 6, 20);
  },

  roofTiles(ctx, s, rng) {
    ctx.fillStyle = '#8e4e34';
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const rh = s / rows;
    const tw = s / 6;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 7; c++) {
        const x = c * tw + (r % 2 ? tw * 0.5 : 0);
        const y = r * rh;
        const tint = Math.floor(rng() * 22 - 11);
        ctx.fillStyle = `rgb(${154 + tint},${86 + tint * 0.6},${58 + tint * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(x, y + rh);
        ctx.lineTo(x, y + rh * 0.35);
        ctx.quadraticCurveTo(x + tw * 0.5, y - rh * 0.2, x + tw, y + rh * 0.35);
        ctx.lineTo(x + tw, y + rh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(52,26,16,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(42,22,14,0.4)';
      ctx.fillRect(0, r * rh, s, 1.5);
    }
    noiseDots(ctx, s, rng, 900, { light: false, alpha: 0.08 });
  },
};

function barrelPaint(ctx, s, rng, main, dark) {
  const grad = ctx.createLinearGradient(0, 0, s, 0);
  grad.addColorStop(0, `rgb(${dark[0]},${dark[1]},${dark[2]})`);
  grad.addColorStop(0.35, `rgb(${main[0]},${main[1]},${main[2]})`);
  grad.addColorStop(0.7, `rgb(${main[0] + 18},${main[1] + 18},${main[2] + 18})`);
  grad.addColorStop(1, `rgb(${dark[0]},${dark[1]},${dark[2]})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  // aros
  for (const y of [s * 0.16, s * 0.5, s * 0.84]) {
    ctx.fillStyle = 'rgba(24,22,20,0.35)';
    ctx.fillRect(0, y - 3, s, 6);
    ctx.fillStyle = 'rgba(230,230,220,0.12)';
    ctx.fillRect(0, y - 3, s, 1.5);
  }
  noiseDots(ctx, s, rng, 500, { light: true, alpha: 0.05 });
  // Ã³xido y rasguÃ±os
  for (let i = 0; i < 26; i++) {
    const x = rng() * s;
    const y = rng() * s;
    ctx.fillStyle = rgba(150, 82, 40, 0.25);
    ctx.beginPath();
    ctx.arc(x, y, 1 + rng() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  scratches(ctx, s, rng, 16, 'rgba(30,26,22,0.3)');
}

/* ----------------------------------------------------------------------------
 * texturas de carteles y calcomanÃ­as
 * -------------------------------------------------------------------------- */

export function makeSignTexture(text, opts = {}) {
  const o = {
    width: 256,
    height: 128,
    bg: '#2b2924',
    fg: '#e8c46a',
    border: '#6d5a34',
    sub: '',
    font: 'Impact, "Arial Black", sans-serif',
    ...opts,
  };
  const canvas = makeCanvas(o.width, o.height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.bg;
  ctx.fillRect(0, 0, o.width, o.height);
  // ruido + desgaste
  const rng = mulberry32(hashString(text + o.bg + o.fg));
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(0.04 + rng() * 0.1).toFixed(3)})`;
    ctx.fillRect(rng() * o.width, rng() * o.height, 1 + rng() * 2, 1 + rng() * 2);
  }
  // borde doble
  ctx.strokeStyle = o.border;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, o.width - 6, o.height - 6);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(9, 9, o.width - 18, o.height - 18);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  const mainSize = Math.floor(o.height * (o.sub ? 0.42 : 0.54));
  ctx.font = `bold ${mainSize}px ${o.font}`;
  const ty = o.sub ? o.height * 0.40 : o.height * 0.52;
  ctx.fillText(text, o.width / 2 + 2, ty + 2);
  ctx.fillStyle = o.fg;
  ctx.fillText(text, o.width / 2, ty);
  if (o.sub) {
    ctx.font = `bold ${Math.floor(o.height * 0.2)}px ${o.font}`;
    ctx.fillStyle = o.subColor || 'rgba(210,200,170,0.9)';
    ctx.fillText(o.sub, o.width / 2, o.height * 0.76);
  }
  return newTexture(canvas, { clamp: true });
}

export function makeDecalTexture(draw, size = 256) {
  const canvas = makeCanvas(size, size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(0x51f3a7);
  draw(ctx, size, rng);
  return newTexture(canvas, { clamp: true });
}

/* ----------------------------------------------------------------------------
 * especificaciones de materiales
 * -------------------------------------------------------------------------- */

const SPECS = {
  sandFloor: { texture: 'sand', tile: 6, roughness: 1 },
  dirtFloor: { texture: 'dirt', tile: 4.5, roughness: 1 },
  concreteFloor: { texture: 'concrete', tile: 5, roughness: 0.95 },
  tileFloor: { texture: 'tile', tile: 3, roughness: 0.55, metalness: 0.03 },
  carpetFloor: { texture: 'carpet', tile: 2.6, roughness: 1 },
  carpetRed: { texture: 'carpetRed', tile: 2.6, roughness: 1 },

  sandWall: { texture: 'sandWall', tile: 2.6, roughness: 1 },
  sandWallDark: { texture: 'sandWall', tile: 2.6, color: 0xc3ad88, roughness: 1 },
  brickWall: { texture: 'brick', tile: 2.3, roughness: 1 },
  stoneWall: { texture: 'stoneWall', tile: 2.8, roughness: 1 },
  stoneDark: { texture: 'stoneDark', tile: 2.8, roughness: 1 },
  plasterWall: { texture: 'plaster', tile: 2.6, roughness: 0.92 },
  concreteWall: { texture: 'concreteWall', tile: 2.6, roughness: 0.95 },

  trim: { color: 0x8a7457, roughness: 0.85 },
  plasterTrim: { color: 0xcbc2ae, roughness: 0.9 },
  wood: { texture: 'wood', tile: 2.2, roughness: 0.88 },
  woodDark: { texture: 'wood', tile: 1.8, color: 0x9c8a70, roughness: 0.9 },
  crate: { texture: 'crate', tile: 1.5, roughness: 0.9 },
  doorWood: { texture: 'doorWood', tile: 2.2, roughness: 0.82 },

  metal: { texture: 'metal', tile: 1.6, roughness: 0.5, metalness: 0.6 },
  metalDark: { texture: 'metalDark', tile: 1.6, roughness: 0.55, metalness: 0.65 },
  barrelA: { texture: 'barrelA', tile: 1.4, roughness: 0.6, metalness: 0.35 },
  barrelB: { texture: 'barrelB', tile: 1.4, roughness: 0.6, metalness: 0.35 },

  glass: {
    texture: 'glass',
    tile: 2.4,
    transparent: true,
    opacity: 0.3,
    roughness: 0.08,
    metalness: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
  },
  tarp: { texture: 'tarp', tile: 1.8, roughness: 0.9, side: THREE.DoubleSide },
  foliage: { texture: 'foliage', tile: 1.3, roughness: 1, side: THREE.DoubleSide },
  foliageDry: { texture: 'grassDry', tile: 1.6, roughness: 1, side: THREE.DoubleSide },
  roofStone: { texture: 'roofTiles', tile: 2.6, roughness: 1 },

  ceiling: { texture: 'ceiling', tile: 3.2, roughness: 0.95 },
  screen: { texture: 'screen', tile: 1.4, roughness: 0.4, emissive: 0x2b6b3c, emissiveIntensity: 0.6 },
  board: { texture: 'board', tile: 2.2, roughness: 0.9 },
  fabric: { texture: 'fabric', tile: 1.4, roughness: 1 },
  paper: { color: 0xe9e4d6, roughness: 1 },
  water: { color: 0x8fc7dd, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.68 },
  lampPanel: { color: 0xfff6df, emissive: 0xfff0c8, emissiveIntensity: 1.7, roughness: 0.6 },
  lampWarm: { color: 0x3a3128, emissive: 0xffb266, emissiveIntensity: 1.2, roughness: 0.7 },
};

const MAP_MATERIALS = {
  de_dust2: [
    'sandFloor',
    'dirtFloor',
    'concreteFloor',
    'sandWall',
    'sandWallDark',
    'brickWall',
    'stoneWall',
    'stoneDark',
    'trim',
    'wood',
    'woodDark',
    'crate',
    'doorWood',
    'metal',
    'metalDark',
    'barrelA',
    'barrelB',
    'glass',
    'tarp',
    'foliage',
    'foliageDry',
    'roofStone',
    'lampWarm',
  ],
  cs_assault: [
    'concreteFloor',
    'concreteWall',
    'brickWall',
    'stoneWall',
    'stoneDark',
    'trim',
    'metal',
    'metalDark',
    'wood',
    'woodDark',
    'crate',
    'doorWood',
    'roofStone',
    'tarp',
    'barrelA',
    'barrelB',
    'glass',
    'lampWarm',
    'lampPanel',
    'sandWallDark',
  ],
  cs_office: [
    'tileFloor',
    'carpetFloor',
    'carpetRed',
    'concreteFloor',
    'plasterWall',
    'concreteWall',
    'plasterTrim',
    'trim',
    'wood',
    'woodDark',
    'crate',
    'doorWood',
    'metal',
    'metalDark',
    'barrelA',
    'barrelB',
    'glass',
    'ceiling',
    'screen',
    'board',
    'fabric',
    'paper',
    'water',
    'foliage',
    'foliageDry',
    'stoneDark',
    'sandWallDark',
    'lampPanel',
    'sandFloor',
  ],
};

/* ----------------------------------------------------------------------------
 * API pÃºblica
 * -------------------------------------------------------------------------- */

function createTexture(cache, key, size) {
  if (cache.has(key)) return cache.get(key);
  let tex = null;
  const draw = TEX_DRAW[key];
  if (HAS_DOM && draw) {
    const canvas = makeCanvas(size, size);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      draw(ctx, size, mulberry32(hashString(key)));
      tex = newTexture(canvas);
    }
  }
  cache.set(key, tex);
  return tex;
}

export function disposeMaterial(mat) {
  if (!mat) return;
  for (const key of Object.keys(mat)) {
    const value = mat[key];
    if (value && value.isTexture) {
      value.dispose?.();
      mat[key] = null;
    }
  }
  mat.dispose?.();
}

/**
 * Crea el set de materiales compartidos de un mapa.
 * @param {'de_dust2'|'cs_office'|string} mapId
 */
export function createMaterialSet(mapId) {
  const keys = MAP_MATERIALS[mapId] || MAP_MATERIALS.de_dust2;
  const textures = new Map();
  const materials = {};
  const tiles = {};
  const unique = new Set();

  for (const key of keys) {
    const spec = SPECS[key];
    if (!spec) {
      console.warn('[textures] material sin spec:', key);
      continue;
    }
    const params = {
      color: spec.color ?? 0xffffff,
      roughness: spec.roughness ?? 0.9,
      metalness: spec.metalness ?? 0,
    };
    if (spec.texture && HAS_DOM) {
      params.map = createTexture(textures, spec.texture, spec.size || 128);
    }
    for (const prop of [
      'transparent',
      'opacity',
      'side',
      'depthWrite',
      'emissive',
      'emissiveIntensity',
      'alphaTest',
      'vertexColors',
    ]) {
      if (spec[prop] !== undefined) params[prop] = spec[prop];
    }
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = `mat:${key}`;
    // Si hay una textura WAD original para este material, reemplaza la procedural.
    const wad = wadTextureFor(mapId, key) || wadTextureFor('de_dust2', key);
    if (wad) {
      mat.map = wad;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
    materials[key] = mat;
    tiles[key] = spec.tile ?? 2;
  }

  return {
    materials,
    tiles,
    textures,
    addUnique(mat) {
      if (mat) unique.add(mat);
      return mat;
    },
    dispose() {
      for (const mat of unique) disposeMaterial(mat);
      unique.clear();
      for (const mat of Object.values(materials)) disposeMaterial(mat);
      for (const tex of textures.values()) tex?.dispose?.();
      textures.clear();
    },
  };
}

export { HAS_DOM };

