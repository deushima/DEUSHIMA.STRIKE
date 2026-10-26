import { DamagePulse } from './damage-pulse.js';
import { WEAPON_ASSETS } from '../weapon-assets.js';
import { DEFAULT_OFFLINE_DUEL_MAP, OFFLINE_DUEL_MAPS, isOfflineDuelMap } from './offline-maps.js';

/**
 * Capa visual CS 1.6 clsica.
 *
 * Usa assets reales extrados de la instalacin GoldSrc:
 *  - sprites 640hud1..20 + hud.txt para el HUD (nmeros y iconos originales)
 *  - logo/men/fondos TGA convertidos a PNG
 *  - sonidos UI originales
 *
 * Se instala por encima del UI existente sin modificarlo: oculta su HUD/men y
 * dibuja un HUD de canvas con la mtrica original 640x480.
 */
const ASSETS = '/assets/cs16';
const WEAPON_ICON = {
  ak47: 'd_ak47', m4a1: 'd_m4a1', awp: 'd_awp', deagle: 'd_deagle',
  usp: 'd_usp', glock: 'd_glock18', knife: 'd_knife', mp5: 'd_mp5navy',
  xm1014: 'd_xm1014', m3: 'd_m3', scout: 'd_scout', sg552: 'd_sg552',
  sg550: 'd_sg550', aug: 'd_aug', famas: 'd_famas', galil: 'd_galil',
  m249: 'd_m249', mac10: 'd_mac10', p90: 'd_p90', tmp: 'd_tmp',
  ump45: 'd_ump45', elite: 'd_elite', fiveseven: 'd_fiveseven', p228: 'd_p228',
  he: 'd_grenade', flash: 'd_flashbang', smoke: 'd_grenade', c4: 'c4',
};
const GOLD = '#ffb000';
const WHITE = '#e9e4d2';
const RED = '#e05243';
const GREEN = '#7dff63';
const BLUE = '#9fc9ff';
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
class ClassicHUD {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('classic-hud');
    this.ctx = this.canvas.getContext('2d');
    this.hudData = null;
    this.images = new Map();
    this.tints = new Map();
    this.killfeed = [];
    this.damageHits = [];
    this.healthPulse = new DamagePulse();
    this.armorPulse = new DamagePulse();
    this.lastVitals = null;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    this.last = 0;
    this.scale = 1;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }
  get accent() {
    return this.game?.settings?.hudTheme === 'classic' ? GOLD : '#bdd2aa';
  }
  async load() {
    if (globalThis.__DEUSHIMA_PUBLIC__) return false;
    const res = await fetch(`${ASSETS}/ui/hud.json`).catch(() => null);
    if (!res || !res.ok) {
      console.error('[classic] falta assets/cs16/ui/hud.json. Ejecut tools/extract-assets.py');
      return false;
    }
    this.hudData = await res.json();
    const names = new Set(['radar640', 'radaropaque640', 'sniper_scope', 'ch_sniper']);
    for (const item of Object.values(this.hudData)) names.add(item.sprite);
    const probe = this.hudData.number_0?.sprite;
    if (!probe) { this.hudData = null; return false; }
    const probeImage = await loadImage(`${ASSETS}/ui/hud/${probe}.png`);
    if (!probeImage) {
      this.hudData = null;
      console.warn('[classic] No hay atlas HUD; se usa el HUD vectorial de respaldo');
      return false;
    }
    this.images.set(probe, probeImage);
    await Promise.all([...names].filter((n) => n !== probe).map(async (n) => {
      this.images.set(n, await loadImage(`${ASSETS}/ui/hud/${n}.png`));
    }));
    if ([...names].some((n) => !this.images.get(n))) {
      this.hudData = null;
      console.warn('[classic] Atlas HUD incompleto; se usa el HUD vectorial de respaldo');
      return false;
    }
    this.radar = this.images.get('radar640');
    this.sniperScope = this.images.get('sniper_scope');
    return true;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.dpr = dpr;
  }
  tinted(img, color) {
    if (!img) return null;
    const key = `${img.src}|${color}`;
    if (this.tints.has(key)) return this.tints.get(key);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    this.tints.set(key, c);
    return c;
  }
  sprite(name, x, y, w, h, color = this.accent, alpha = 1) {
    const item = this.hudData[name];
    if (!item) return;
    const img = this.images.get(item.sprite);
    if (!img) return;
    const src = color ? this.tinted(img, color) : img;
    if (!src) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, item.x, item.y, item.w, item.h, x, y, w ?? item.w, h ?? item.h);
    ctx.restore();
  }
  digit(d, x, y, s = 1, color = this.accent) {
    const item = this.hudData[`number_${d}`];
    if (!item) return;
    const img = this.images.get(item.sprite);
    if (!img) return;
    const src = color ? this.tinted(img, color) : img;
    this.ctx.drawImage(src, item.x, item.y, item.w, item.h, x, y, item.w * s, item.h * s);
  }
  number(value, x, y, s = 1, color = this.accent, align = 'left') {
    const str = String(Math.max(0, Math.round(Number(value) || 0)));
    const w = 20 * s;
    let start = align === 'right' ? x - str.length * w : align === 'center' ? x - (str.length * w) / 2 : x;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') this.digit(Number(ch), start, y, s, color);
      start += w;
    }
    return start;
  }
  text(str, x, y, { size = 10, color = WHITE, align = 'left', weight = 600, alpha = 1, shadow = true } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px "Trebuchet MS", Tahoma, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(str, x + 1, y + 1);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }
  addDamage(angle) {
    this.damageHits.push({ angle: Number(angle) || 0, time: performance.now() });
    if (this.damageHits.length > 4) this.damageHits.shift();
  }
  notifyDamage(healthLoss, armorLoss) {
    const now = performance.now();
    this.healthPulse.trigger(healthLoss, now);
    this.armorPulse.trigger(armorLoss, now);
  }
  _vitalColors(health, armor, now) {
    if (this.lastVitals) {
      if (health > this.lastVitals.health) this.healthPulse.reset();
      if (armor > this.lastVitals.armor) this.armorPulse.reset();
    }
    this.lastVitals = { health, armor };
    return {
      health: this.healthPulse.color(this.accent, now, this.reducedMotion),
      armor: this.armorPulse.color(this.accent, now, this.reducedMotion),
    };
  }
  addKill(entry) {
    if (!entry) return;
    const killer = entry.killer || 'Mundo';
    const victim = entry.victim || '???';
    const hs = !!(entry.headshot || entry.hs);
    this.killfeed.push({
      killer, victim,
      killerTeam: entry.killerTeam,
      victimTeam: entry.victimTeam,
      hs,
      time: performance.now(),
    });
    if (this.killfeed.length > 5) this.killfeed.shift();
  }
  update(now) {
    const game = this.game;
    const ctx = this.ctx;
    const W = 640, H = 480;
    if (this._debug == null && location.search.includes('debug=1')) {
      this._debug = document.createElement('pre');
      this._debug.style.cssText = 'position:fixed;left:8px;top:8px;z-index:999;color:#0f0;background:#000a;font:11px monospace;padding:4px;white-space:pre';
      document.body.appendChild(this._debug);
    }
    if (this._debug) {
      this._debug.textContent = `state=${game?.state} hudData=${!!this.hudData} imgs=${this.images.size} err=${this._err || ''} rounds=${game?.rounds?.constructor?.name} phase=${game?.duel?.phase} map=${game?.map?.id}`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!game || !['playing', 'roundover'].includes(game.state)) return;
    const s = Math.min(this.canvas.width / W, this.canvas.height / H);
    const ox = (this.canvas.width - W * s) / 2;
    const oy = (this.canvas.height - H * s) / 2;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    if (!this.hudData) {
      this._fallbackHud(game);
      return;
    }
    const hud = (() => { try { return game.getHudState(); } catch (err) { this._err = err.message; return null; } })();
    if (!hud) return;
    const r = hud.round || {};
    const weapon = hud.weapon || {};
    const alive = hud.alive;
    // dinero (arriba izquierda)
    if (!game.duel && !hud.online) {
      this.sprite('dollar', 18, 15, 15, 16, this.accent);
      this.number(hud.money, 36, 12, 0.86, this.accent);
    }
    // radar
    const rx = 18, ry = 40, rs = 128;
    this._drawRadar(hud.radar, rx, ry, rs);
    this.text((hud.mapName || 'AIM_1V1').toUpperCase(), rx + 2, ry + rs + 3, { size: 8, color: '#d8d2ba', alpha: 0.9 });
    // timer y marcador (arriba centro)


    const t = Math.max(0, Math.ceil(r.timeLeft || 0));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    const clockX = 320;
    this.number(mm, clockX - 44, 16, 1.05, this.accent, 'right');
    this._colon(clockX - 1, 17, this.accent);
    this.number(ss, clockX + 4, 16, 1.05, this.accent);
    this.text(`RONDA ${r.round || r.roundNumber || 1}`, clockX, 44, { size: 8, color: '#c9c3ad', align: 'center', alpha: 0.9 });
      // scores CT / T
      this.text('CT', 194, 22, { size: 10, color: BLUE, weight: 700 });
      this.number(r.scoreCT || 0, 216, 17, 1, BLUE);
      this.number(r.scoreT || 0, 404, 17, 1, '#ffb35d');
      this.text('T', 432, 22, { size: 10, color: '#ffb35d', weight: 700 });
    // freeze / estado
    if (r.phase === 'freeze' && r.freezeLeft > 0) {
      this.text('CONGELADO', 320, 70, { size: 11, color: this.accent, align: 'center' });
      this.text(`${Math.ceil(r.freezeLeft)}`, 320, 85, { size: 20, color: WHITE, align: 'center', weight: 800 });
    } else if (r.phase === 'over' && r.message) {
      this.text(r.message, 320, 74, { size: 12, color: this.accent, align: 'center' });
    }
    // salud / chaleco (abajo izquierda)
    const low = alive && hud.health <= 25;
    const vitals = this._vitalColors(hud.health, hud.armor, now);
    this.sprite('cross', 18, 428, 24, 24, low && vitals.health === this.accent ? RED : vitals.health);
    this.number(hud.health, 46, 425, 1.15, vitals.health === this.accent ? (low ? RED : WHITE) : vitals.health);
    this.sprite('suit_full', 18, 454, 18, 18, hud.armor > 0 || vitals.armor !== this.accent ? vitals.armor : '#4f4b3c');
    this.number(hud.armor, 41, 451, 0.85, vitals.armor === this.accent ? (hud.armor > 0 ? WHITE : '#6d6a5b') : vitals.armor);
    if (hud.helmet) this.sprite('suithelmet_full', 78, 452, 15, 15, this.accent);
    // arma / municin (abajo derecha)
    const icon = WEAPON_ICON[weapon.weaponId] || null;
    if (icon) this.sprite(icon, 552, 422, 48, 16, this.accent);
    this.text((weapon.name || 'SIN ARMA').toUpperCase(), 602, 422, { size: 8, color: '#c9c3ad', align: 'right' });
    this.number(weapon.ammo ?? 0, 602, 438, 1.25, WHITE, 'right');
    this.text('/', 604, 445, { size: 12, color: '#7c7868', align: 'left' });
    this.number(weapon.reserve ?? 0, 636, 442, 0.7, '#b7b19b', 'right');
    this.text('BALAS', 602, 464, { size: 7, color: '#6e6b5b', align: 'right', alpha: 0.8 });
    // crosshair / scope
    if (!hud.crosshair.hidden) this._crosshair(hud.crosshair);
    if (hud.crosshair.scoped) this._scope();
    // killfeed
    this._drawDamage(now);
    this._killfeed(now);
  }
  _colon(x, y, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 4, 2, 2);
    ctx.fillRect(x, y + 13, 2, 2);
  }
  _drawRadar(data, x, y, size) {
    if (!data) return;
    const ctx = this.ctx;
    const b = data.bounds || { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    const pad = 8;
    const map = (v, min, max) => pad + ((v - min) / Math.max(0.001, max - min)) * (size - pad * 2);
    ctx.save();
    ctx.globalAlpha = 0.82;
    if (this.radar) ctx.drawImage(this.radar, x, y, size, size);
    else {
      ctx.fillStyle = 'rgba(29, 48, 27, 0.72)';
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    // Geometra de colisiones del mapa, como las lneas del radar original.
    const mapData = this.game?.map;
    if (mapData?.colliders?.length) {
      ctx.strokeStyle = 'rgba(20, 80, 35, 0.75)';
      ctx.lineWidth = 0.7;
      for (const c of mapData.colliders) {
        const box = c?.box || c;
        if (!box?.min || !box?.max) continue;
        const x1 = x + map(box.min.x, b.minX, b.maxX);
        const x2 = x + map(box.max.x, b.minX, b.maxX);
        const y1 = y + map(box.min.z, b.minZ, b.maxZ);
        const y2 = y + map(box.max.z, b.minZ, b.maxZ);
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
    }
    for (const p of data.players || []) {
      if (!p.isPlayer) continue; // en 1v1 el radar no revela enemigos
      const px = x + map(p.x, b.minX, b.maxX);
      const py = y + map(p.z, b.minZ, b.maxZ);
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a2410';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(p.yaw || 0) * 7, py - Math.cos(p.yaw || 0) * 7);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,255,99,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  _fallbackHud(game) {
    const ctx = this.ctx;
    let hud;
    try { hud = game.getHudState(); } catch { return; }
    if (!hud) return;
    const r = hud.round || {};
    const weapon = hud.weapon || {};
    const p = game.player || {};
    const left = (text, x, y, color = '#e8ddc1', size = 13, align = 'left') => {
      ctx.textAlign = align;
      ctx.fillStyle = color;
      ctx.font = `700 ${size}px Tahoma, Verdana, Arial, sans-serif`;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,.72)';
      ctx.strokeText(String(text), x, y);
      ctx.fillText(String(text), x, y);
    };
    // The public build has no licensed GoldSrc HUD atlas. Keep its HUD
    // legible without four opaque boxes competing with the 3D scene.
    if (hud.radar) this._drawRadar(hud.radar, 18, 57, 108);
    if (!game.duel && !hud.online) left(`$${Math.round(hud.money || 0)}`, 18, 30, this.accent, 16);
    left(`${hud.mapName || 'AIM_REDLINE'}`, 18, 48, '#b9b4a1', 9);
    left(`RONDA ${r.round || 1}`, 300, 30, '#d8d2ba', 11);
    left(`${r.scoreCT || 0}  :  ${r.scoreT || 0}`, 300, 48, '#e8ddc1', 12);
    if (Number(r.timeLeft) > 0) left(`${Math.ceil(r.timeLeft)}`, 326, 66, this.accent, 10);
    const vitals = this._vitalColors(hud.health, hud.armor, performance.now());
    ctx.fillStyle = vitals.health;
    ctx.fillRect(19, 414, 22, 8);
    ctx.fillRect(26, 407, 8, 22);
    ctx.fillStyle = vitals.armor;
    ctx.beginPath(); ctx.moveTo(19, 438); ctx.lineTo(40, 438); ctx.lineTo(38, 452); ctx.lineTo(30, 459); ctx.lineTo(21, 452); ctx.closePath(); ctx.fill();
    left(`${Math.max(0, Math.round(p.health ?? hud.health ?? 100))}`, 48, 425, vitals.health, 18);
    left(`${Math.max(0, Math.round(p.armor ?? hud.armor ?? 0))}`, 48, 452, vitals.armor, 15);
    left(`${weapon.name || 'ARMA'}`, 620, 424, '#d8d2ba', 10, 'right');
    left(`${weapon.ammo ?? 0} / ${weapon.reserve ?? 0}`, 620, 446, '#ffffff', 16, 'right');
    left('BALAS', 620, 462, '#9a947f', 8, 'right');
    this._crosshair({
      color: this.game?.settings?.crosshairColor || '#78ff63',
      spread: weapon.spread || 0,
      hidden: false,
    });
  }

  _crosshair(ch) {
    const ctx = this.ctx;
    const cx = 320, cy = 240;
    const spread = Math.max(0, Number(ch.spread) || 0);
    const gap = 3 + Math.min(14, spread * 1.6);
    const len = 5;
    ctx.save();
    ctx.strokeStyle = ch.color || GREEN;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - gap); ctx.lineTo(cx, cy - gap - len);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.moveTo(cx - gap, cy); ctx.lineTo(cx - gap - len, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.stroke();
    ctx.restore();
  }
  _scope() {
    if (!this.sniperScope) return;
    const ctx = this.ctx;
    const cx = 320, cy = 240;
    const r = 210;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, 640, 480);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(210,210,210,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx - 28, cy);
    ctx.moveTo(cx + 28, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - 28);
    ctx.moveTo(cx, cy + 28); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  _drawDamage(now) {
    this.damageHits = this.damageHits.filter((d) => now - d.time < 1300);
    const item = this.hudData?.dmg_bio;
    if (!item) return;
    const img = this.images.get(item.sprite);
    if (!img) return;
    const src = this.tinted(img, RED);
    const ctx = this.ctx;
    const cx = 320;
    const cy = 240;
    for (const d of this.damageHits) {
      const alpha = Math.max(0, 1 - (now - d.time) / 1300);
      const ang = (d.angle - 90) * Math.PI / 180;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.translate(cx + Math.cos(ang) * 150, cy + Math.sin(ang) * 120);
      ctx.rotate(ang + Math.PI / 2);
      ctx.drawImage(src, item.x, item.y, item.w, item.h, -32, -32, 64, 64);
      ctx.restore();
    }
  }
  _killfeed(now) {
    const ctx = this.ctx;
    this.killfeed = this.killfeed.filter((k) => now - k.time < 6000);
    let y = 8;
    for (const k of this.killfeed) {
      ctx.save();
      ctx.font = '11px "Trebuchet MS", Tahoma, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const label = `${k.killer}  ${k.hs ? '☠' : '×'}  ${k.victim}`;
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(640 - w - 8, y, w, 18);
      ctx.fillStyle = '#d8d2ba';
      ctx.fillText(label, 640 - 14, y + 4);
      y += 21;
      ctx.restore();
    }
  }
}
class ClassicMenu {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.root = document.getElementById('classic-menu');
    this.visible = false;
    this._armed = null;
    this._lastRolloverAt = 0;
    this._installMarkup();
    this._bind();
    this._fsHandler = () => this._syncFullscreen();
    document.addEventListener('fullscreenchange', this._fsHandler);
    this._syncFullscreen();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }
  _installMarkup() {
    this.root.innerHTML = `      <div class="cm-topline"></div>
      <div class="cm-brand">
        <img class="cm-logo" src="/assets/branding/menu-logo-white.png" alt="DEUSHIMA STRIKE" draggable="false">
        <div class="cm-sub"><b>1.6</b><span>GOLDSRC | BROWSER EDITION</span></div>
        <div class="cm-rule"></div>
      </div>
      <button class="cm-fullscreen" data-cm="fullscreen" type="button" title="Pantalla completa">
        <span class="cm-fs-icon">⛶</span><span class="cm-fs-label">PANTALLA COMPLETA</span>
      </button>
      <nav class="cm-nav" aria-label="Menú principal">
        <button class="cm-btn primary" data-cm="offline"><span class="idx">01</span>1V1 OFFLINE<span class="hint">SELECCIONAR MAPA</span></button>
        <button class="cm-btn" data-cm="online"><span class="idx">02</span>ONLINE 1V1 / 2V2<span class="hint">AMIGOS</span></button>
        <button class="cm-btn" data-cm="deathmatch"><span class="idx">03</span>DEATHMATCH<span class="hint">ONLINE / OFFLINE</span></button>
        <button class="cm-btn" data-cm="options"><span class="idx">04</span>OPCIONES<span class="hint">AJUSTES</span></button>
        <button class="cm-btn" data-cm="help"><span class="idx">05</span>COMO JUGAR<span class="hint">AYUDA</span></button>
        <button class="cm-btn" data-cm="quit"><span class="idx">06</span>SALIR<span class="hint">FIN</span></button>
      </nav>
      <div class="cm-foot">
        <span class="cm-keys"><b>ENTER</b> JUGAR | <b>TAB</b> MARCADOR | <b>G</b> TIRAR ARMA | <b>ESC</b> PAUSA</span>
        <div class="cm-legal">
          <img class="cm-legal-logo" src="/assets/branding/menu-logo-color.png" alt="DEUSHIMA STRIKE" draggable="false">
          <span>© 2026 DEUSHIMA · MARCA Y ARTE ORIGINAL</span>
          <span>RECURSOS DE TERCEROS · CRÉDITOS EN OPCIONES</span>
        </div>
      </div>
      <div class="cm-modal hidden" data-cm-modal></div>
    `;
  }
  _bind() {
    this.root.querySelectorAll('[data-cm]').forEach((btn) => {
      btn.addEventListener('pointerenter', () => {
        if (btn.disabled) return;
        this._arm(btn);
        const now = performance.now();
        if (now - this._lastRolloverAt > 65) {
          this._lastRolloverAt = now;
          this._sound('buttonrollover', 0.45);
        }
      });
      btn.addEventListener('pointerleave', () => this._disarm(btn));
      btn.addEventListener('focus', () => this._arm(btn));
      btn.addEventListener('blur', () => this._disarm(btn));
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this._sound('buttonclick', 0.34);
        const action = btn.dataset.cm;
        if (action === 'offline') this._openOfflineSelector();
        else if (action === 'online') this._startOnline();
        else if (action === 'deathmatch') this._startDeathmatch();
        else if (action === 'fullscreen') this._toggleFullscreen();
        else if (action === 'options') this.game.classicPause?.show(true);
        else if (action === 'help') this._openModal(this._helpMarkup());
        else if (action === 'quit') window.close();
      });
    });
    this.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-cm-close]')) {
        this._sound('buttonclick', 0.6);
        this._closeModal();
      }
      const apply = e.target.closest('[data-cm-apply]');
      if (apply) this._applyOptions();
      const map = e.target.closest('[data-offline-map]');
      if (map) {
        this._sound('buttonclick', 0.34);
        this._startOfflineMap(map.dataset.offlineMap);
      }
    });
    this.root.addEventListener('pointerover', (e) => {
      const map = e.target.closest?.('[data-offline-map]');
      if (!map || map.contains(e.relatedTarget)) return;
      const now = performance.now();
      if (now - this._lastRolloverAt > 65) {
        this._lastRolloverAt = now;
        this._sound('buttonrollover', 0.45);
      }
    });
    const auto = new URLSearchParams(location.search).get('auto');
    const autoMaps = {
      duel: 'aim_1v1',
      redline: 'aim_redline',
      forge: 'aim_forge',
      assault: 'cs_assault',
      office: 'cs_office',
      dust2: 'de_dust2',
      dust_short: 'dust_short',
    };
    if (autoMaps[auto]) setTimeout(() => this._startOfflineMap(autoMaps[auto]), 700);
  }
  _arm(btn) {
    if (this._armed === btn) return;
    this._armed?.classList.remove('is-armed');
    this._armed = btn;
    btn.classList.add('is-armed');
  }
  _disarm(btn) {
    if (this._armed !== btn) return;
    btn.classList.remove('is-armed');
    this._armed = null;
  }
  _toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => this._syncFullscreen())
      .catch(() => {
        // Si el navegador lo bloquea, intentar sin opciones.
        el.requestFullscreen?.().then(() => this._syncFullscreen()).catch(() => {});
      });
  }
  _syncFullscreen() {
    const btn = this.root.querySelector('.cm-fullscreen');
    if (!btn) return;
    const active = !!document.fullscreenElement;
    btn.classList.toggle('is-fullscreen', active);
    const label = btn.querySelector('.cm-fs-label');
    if (label) label.textContent = active ? 'SALIR DE PANTALLA COMPLETA' : 'PANTALLA COMPLETA';
    btn.title = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  }
  _sound(name, volume) {
    const audio = this.game?.audio;
    audio?.play?.(name === 'buttonrollover' ? 'ui_hover' : 'ui_click', { volume });
  }
  _offlineSelectorMarkup() {
    const maps = OFFLINE_DUEL_MAPS.map((map, index) => `
      <button class="cm-offline-map" type="button" data-offline-map="${map.id}">
        <span class="cm-offline-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="cm-offline-copy"><b>${map.label}</b><small>${map.hint}</small></span>
        <span class="cm-offline-arrow">›</span>
      </button>`).join('');
    return `
      <h2>1V1 OFFLINE</h2>
      <p class="lead">Seleccioná un mapa para jugar contra un bot.</p>
      <div class="cm-offline-grid" role="list" aria-label="Mapas 1V1 offline">${maps}</div>
      <button class="cm-close" type="button" data-cm-close>VOLVER</button>
    `;
  }
  _openOfflineSelector() {
    this._openModal(this._offlineSelectorMarkup());
  }
  _startOfflineMap(mapId = DEFAULT_OFFLINE_DUEL_MAP) {
    if (!isOfflineDuelMap(mapId)) mapId = DEFAULT_OFFLINE_DUEL_MAP;
    this._closeModal();
    this._hide();
    this.game.settings.volume = Number(this.game.settings.volume) || 0.65;
    this.game._suppressPause = true;
    setTimeout(() => { this.game._suppressPause = false; }, 1600);
    const config = {
      difficulty: 'normal',
      roundsToWin: Number(this.game.settings.roundsToWin) || 13,
    };
    if (typeof this.game.startOffline === 'function') this.game.startOffline(mapId, config);
    else if (typeof this.game.startDuel === 'function') this.game.startDuel({ ...config, map: mapId });
  }
  _startDuel() { this._startOfflineMap('aim_1v1'); }
  _startRedline() {
    this._startOfflineMap('aim_redline');
  }
  _startForge() {
    this._startOfflineMap('aim_forge');
  }
  _startAssault() {
    this._startOfflineMap('cs_assault');
  }
  _startOnline() {
    this._hide();
    try {
      this.game.openOnlineHome?.();
    } catch (err) {
      console.warn('[classic] online', err);
      this._show();
    }
  }
  _startDeathmatch() {
    this._hide();
    this.game.deathmatchUI?.open();
  }
  _hide() { this._armed?.classList.remove('is-armed'); this._armed = null; this.visible = false; this.root.classList.add('hidden'); }
  _show() { this.visible = true; this.root.classList.remove('hidden'); }
  _tick() {
    requestAnimationFrame(this._tick);
    const state = this.game?.state;
    if (!state) return;
    const onlineOpen = !!this.game?.onlineUI?.isOpen;
    const deathmatchOpen = !!this.game?.deathmatchUI?.isOpen;
    if (state === 'menu' && !onlineOpen && !deathmatchOpen && !this.visible) this._show();
    if ((state !== 'menu' || onlineOpen || deathmatchOpen) && this.visible) this._hide();
  }
  _openModal(html) {
    const modal = this.root.querySelector('[data-cm-modal]');
    modal.innerHTML = `<div class="cm-card">${html}</div>`;
    modal.classList.remove('hidden');
  }
  _closeModal() {
    const modal = this.root.querySelector('[data-cm-modal]');
    modal.classList.add('hidden');
    modal.innerHTML = '';
  }
  _optionsMarkup() {
    const s = this.game.settings;
    return `
      <h2>Opciones</h2>
      <p class="lead">Ajustes guardados en el navegador.</p>
      <div class="cm-field"><span>Sensibilidad</span><input data-opt="sensitivity" type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}"><output data-out="sensitivity">${Number(s.sensitivity).toFixed(2)}</output></div>
      <div class="cm-field"><span>Volumen</span><input data-opt="volume" type="range" min="0" max="1" step="0.01" value="${s.volume}"><output data-out="volume">${Math.round(s.volume * 100)}%</output></div>
      <div class="cm-field"><span>FOV</span><input data-opt="fov" type="range" min="70" max="110" step="1" value="${s.fov}"><output data-out="fov">${s.fov}</output></div>
      <div class="cm-field"><span>Resolución</span><input data-opt="resolution" type="range" min="0.55" max="1" step="0.05" value="${s.resolution}"><output data-out="resolution">${Math.round(s.resolution * 100)}%</output></div>
      <button class="cm-close" data-cm-apply>APLICAR</button>
      <button class="cm-close" data-cm-close style="margin-left:8px">CERRAR</button>
    `;
  }
  _applyOptions() {
    const modal = this.root.querySelector('[data-cm-modal]');
    const s = this.game.settings;
    modal.querySelectorAll('[data-opt]').forEach((input) => {
      const k = input.dataset.opt;
      const v = Number(input.value);
      if (k === 'sensitivity') { s.sensitivity = v; this.game.input.sensitivity = v; }
      if (k === 'volume') { s.volume = v; this.game.audio.setVolume(v); }
      if (k === 'fov') { s.fov = v; this.game.camera.fov = v; this.game.camera.updateProjectionMatrix(); }
      if (k === 'resolution') { s.resolution = v; this.game.renderer.setPixelRatio(this.game.pixelRatio()); }
    });
    try { localStorage.setItem('cs16-settings', JSON.stringify(s)); } catch { /* ignore */ }
    this._closeModal();
  }
  _helpMarkup() {
    return `
      <h2>Cómo jugar</h2>
      <p class="lead">AIM por rondas: 1v1 local o salas online 1v1 / 2v2. La ronda termina cuando cae un equipo completo.</p>
      <div class="cm-help-grid">
        <b>WASD</b><span>Moverse</span><b>Mouse</b><span>Apuntar</span>
        <b>Click izq.</b><span>Disparar</span><b>Click der.</b><span>Zoom AWP</span>
        <b>R</b><span>Recargar</span><b>1/2/3</b><span>Armas</span>
        <b>Shift</b><span>Caminar silencioso</span><b>Ctrl</b><span>Agacharse</span>
        <b>Space</b><span>Saltar / bhop</span><b>G</b><span>Tirar arma</span>
        <b>Tab</b><span>Marcador</span><b>Esc</b><span>Pausa</span>
      </div>
      <p class="lead" style="margin-top:16px">1V1 OFFLINE: AIM_MAP, AIM_REDLINE, AIM_FORGE, ASSAULT, CS_OFFICE, DUST2 y DUST SHORT. Partida al primero en ganar 13 rondas.</p>
      <button class="cm-close" data-cm-close>CERRAR</button>
    `;
  }
  _onlineMarkup() {
    return `
      <h2>Online 1v1 / 2v2</h2>
      <p class="lead">Creá una sala privada, elegí 1v1 o 2v2 y compartí el código o enlace de invitación. El host mantiene el estado autoritativo de rondas, daño y armas.</p>
      <button class="cm-close" data-cm-close>CERRAR</button>
    `;
  }
}
class ClassicPause {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('classic-pause');
    this.fromMenu = false;
    this.tab = 'mouse';
    this._build();
  }
  _build() {
    this.root.innerHTML = `
      <div class="cp-panel">
        <header class="cp-head">
          <div class="cp-logo">DEUSHIMA <b>STRIKE</b></div>
          <div class="cp-mode">PAUSA · CONFIGURACIÓN</div>
        </header>
        <div class="cp-body">
          <nav class="cp-tabs">
            <button class="cp-tab" data-cp-tab="mouse">RATÓN</button>
            <button class="cp-tab" data-cp-tab="keyboard">TECLADO</button>
            <button class="cp-tab" data-cp-tab="audio">AUDIO</button>
            <button class="cp-tab" data-cp-tab="video">VÍDEO</button>
            <button class="cp-tab" data-cp-tab="game">JUEGO</button>
            <button class="cp-tab" data-cp-tab="server">SERVIDOR LOCAL</button>
            <button class="cp-tab" data-cp-tab="about">ACERCA DEL JUEGO</button>
          </nav>
          <div class="cp-content" data-cp-content></div>
        </div>
        <footer class="cp-foot">
          <button class="cp-btn danger" data-cp="quit">SALIR AL MENÚ</button>
          <button class="cp-btn" data-cp="close">CERRAR</button>
          <button class="cp-btn primary" data-cp="resume">REANUDAR</button>
          <button class="cp-btn" data-cp="apply">APLICAR</button>
        </footer>
        <button class="cp-close" data-cp="close" aria-label="Cerrar">×</button>
      </div>`;
    this.root.addEventListener('pointerover', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled || btn.contains(e.relatedTarget)) return;
      const now = performance.now();
      if (now - (this._lastRolloverAt || 0) > 65) {
        this._lastRolloverAt = now;
        this.game.audio?.play?.('ui_hover', { volume: 0.4 });
      }
    });
    this.root.addEventListener('click', (e) => {
      const clicked = e.target.closest('button');
      if (clicked && !clicked.disabled) this.game.audio?.play?.('ui_click', { volume: 0.34 });
      const tab = e.target.closest('[data-cp-tab]');
      if (tab) { this.tab = tab.dataset.cpTab; this._render(); return; }
      const action = e.target.closest('[data-cp]')?.dataset.cp;
      if (!action) return;
      if (action === 'close') this._resume();
      else if (action === 'resume') this._resume();
      else if (action === 'apply') { this._apply(); this._render(); }
      else if (action === 'quit') this._quit();
    });
    this.root.addEventListener('input', (e) => {
      const out = e.target.closest('[data-cp-row]')?.querySelector('output');
      if (out && e.target.type === 'range') out.textContent = this._fmt(e.target.dataset.setting, e.target.value);
    });
  }
  _fmt(key, value) {
    const n = Number(value);
    if (key === 'volume') return `${Math.round(n * 100)}%`;
    if (key === 'sensitivity' || key === 'zoomSensitivity') return n.toFixed(2);
    if (key === 'fov') return `${Math.round(n)}`;
    if (key === 'resolution') return `${Math.round(n * 100)}%`;
    return String(value);
  }
  show(fromMenu = false) {
    this.fromMenu = fromMenu;
    this.root.querySelector('.cp-mode').textContent = fromMenu ? 'OPCIONES · CONFIGURACIÓN' : 'PAUSA · CONFIGURACIÓN';
    this.root.classList.remove('hidden');
    this._render();
  }
  hide() {
    this.root.classList.add('hidden');
    this.fromMenu = false;
  }
  toggle() {
    if (this.root.classList.contains('hidden')) this.show(false);
    else this.hide();
  }
  _resume() {
    const fromMenu = this.fromMenu;
    this.hide();
    if (fromMenu) return;
    this.game.resume?.();
  }
  _quit() {
    this.hide();
    this.game.quitToMenu?.();
  }
  _row(key, label, min, max, step, type = 'range', value = null) {
    const v = value ?? this.game.settings[key];
    const out = type === 'range' ? `<output>${this._fmt(key, v)}</output>` : '';
    const control = type === 'color'
      ? `<input type="color" data-setting="${key}" value="${v}">`
      : type === 'text'
        ? `<input type="text" data-setting="${key}" value="${v}">`
        : `<input type="range" min="${min}" max="${max}" step="${step}" data-setting="${key}" value="${v}">`;
    return `<div class="cp-row" data-cp-row><label>${label}</label>${control}${out}</div>`;
  }
  _render() {
    const s = this.game.settings;
    this.root.querySelectorAll('.cp-tab').forEach((el) => el.classList.toggle('active', el.dataset.cpTab === this.tab));
    const content = this.root.querySelector('[data-cp-content]');
    if (this.tab === 'mouse') {
      content.innerHTML = `
        <h2 class="cp-title">Ratón</h2>
        <p class="cp-desc">Sensibilidad, inversión y zoom. Pulsá APLICAR para guardar los cambios.</p>
        
        ${this._row('sensitivity', 'Sensibilidad', 0.2, 3, 0.05)}
        ${this._row('zoomSensitivity', 'Sensibilidad de zoom', 0.2, 2, 0.05)}
        <label class="cp-check"><input type="checkbox" data-setting="invertY" ${s.invertY ? 'checked' : ''}> Invertir eje Y</label>
        <label class="cp-check"><input type="checkbox" data-setting="rawInput" ${s.rawInput !== false ? 'checked' : ''}> Raw input / sin aceleración</label>`;
    } else if (this.tab === 'keyboard') {
      content.innerHTML = `
        <h2 class="cp-title">Teclado</h2>
        <p class="cp-desc">Activá la dirección de la rueda que quieras usar para saltar y pulsá APLICAR.</p>
        <div class="cp-binds">
          <b>W A S D</b><span>Moverse</span>
          <b>Mouse 1</b><span>Disparar</span>
          <b>Mouse 2</b><span>Zoom / mira</span>
          <b>R</b><span>Recargar</span>
          <b>1 / 2 / 3</b><span>Primaria / secundaria / cuchillo</span>
          <b>Shift</b><span>Caminar</span>
          <b>Ctrl</b><span>Agacharse</span>
          <b>Space</b><span>Saltar</span>
          <b>Rueda</b><span>Saltar arriba/abajo si está activado en opciones</span>
          <b>G</b><span>Tirar arma</span>
          <b>Tab</b><span>Marcador</span>
          <b>Esc</b><span>Pausa</span>
        </div>
        <label class="cp-check"><input type="checkbox" data-setting="jumpWheelUp" ${s.jumpWheelUp === true ? 'checked' : ''}> Saltar con rueda hacia arriba</label>
        <label class="cp-check"><input type="checkbox" data-setting="jumpWheelDown" ${s.jumpWheelDown === true ? 'checked' : ''}> Saltar con rueda hacia abajo</label>
        <div class="cp-note">Cada dirección activada salta en vez de cambiar de arma.</div>`;
    } else if (this.tab === 'audio') {
      content.innerHTML = `
        <h2 class="cp-title">Audio</h2>
        <p class="cp-desc">Sonidos originales GoldSrc: armas, pasos, radio y UI.</p>
        
        ${this._row('volume', 'Volumen general', 0, 1, 0.01)}
        <label class="cp-check"><input type="checkbox" data-setting="muted" ${s.muted ? 'checked' : ''}> Silenciar</label>
        <label class="cp-check"><input type="checkbox" data-setting="hitSound" ${s.hitSound !== false ? 'checked' : ''}> Sonido de impacto</label>`;
    } else if (this.tab === 'video') {
      content.innerHTML = `
        <h2 class="cp-title">Vídeo</h2>
        <p class="cp-desc">Resolución interna, campo de visión y mira.</p>
        ${this._row('resolution', 'Resolución interna', 0.55, 1, 0.05)}
        ${this._row('fov', 'Campo de visión', 70, 110, 1)}
        <div class="cp-row"><label>Color de mira</label><input type="color" data-setting="crosshairColor" value="${s.crosshairColor}"><span></span></div>
        ${this._row('crosshairSize', 'Tamaño de mira', 0.5, 2, 0.1)}
        <label class="cp-check"><input type="checkbox" data-setting="fps" ${s.fps ? 'checked' : ''}> Mostrar FPS</label>
        <div class="cp-row"><label for="cp-hud-theme">Color del HUD</label><select id="cp-hud-theme" data-setting="hudTheme"><option value="olive" ${s.hudTheme !== 'classic' ? 'selected' : ''}>GoldSrc Olive</option><option value="classic" ${s.hudTheme === 'classic' ? 'selected' : ''}>CS 1.6 Classic</option></select><span></span></div>`;
    } else if (this.tab === 'server') {
      content.innerHTML = `
        <section class="cp-server" aria-label="Información del servidor local">
          <div class="cp-server-heading"><h2>Servidor local</h2><span>offline</span></div>
          <div class="cp-server-row"><span>Estado</span><b class="ok">● Listo</b></div>
          <div class="cp-server-row"><span>Mapa</span><b>aim_1v1</b></div>
          <div class="cp-server-row"><span>Modo</span><b>DUELO 1V1</b></div>
          <div class="cp-server-row"><span>Rondas</span><b>Primero a 13</b></div>
          <div class="cp-server-row"><span>Motor</span><b>GoldSrc assets | WebGL</b></div>
          <div class="cp-server-news">
            <h3>Noticias</h3>
            <p><b>DUELO RÁPIDO:</b> sin freeze, muerte animada y siguiente ronda al tocar el suelo. Primero a 13 o empate 12-12.</p>
            <p><b>ONLINE:</b> salas rápidas para jugar AIM con amigos.</p>
          </div>
        </section>`;
    } else if (this.tab === 'about') {
      content.innerHTML = `
        <section class="cp-about" aria-label="Acerca de DEUSHIMA STRIKE">
          <img class="cp-about-logo" src="/assets/branding/menu-logo-color.png" alt="DEUSHIMA STRIKE" draggable="false">
          <div class="cp-about-edition">DEUSHIMA ORIGINAL <span>·</span> BROWSER EDITION <span>·</span> 2026</div>
          <h2>Acerca del juego</h2>
          <p>DEUSHIMA STRIKE es un shooter de navegador inspirado en la experiencia de los FPS clásicos de PC, con duelos AIM 1V1, entrenamiento y partidas online 1V1 / 2V2 con amigos.</p>
          <div class="cp-about-details">
            <div><span>PROYECTO Y DIRECCIÓN</span><b>DEUSHIMA</b></div>
            <div><span>PLATAFORMA</span><b>WEBGL · NAVEGADOR</b></div>
            <div><span>EDICIÓN</span><b>2026 · BROWSER EDITION</b></div>
          </div>
          <h3>Derechos y créditos</h3>
          <p class="cp-about-legal">© 2026 DEUSHIMA. Derechos reservados sobre el nombre, la identidad visual y el arte original de DEUSHIMA STRIKE. Los modelos, sonidos, marcas y otros recursos de terceros conservan sus respectivas titularidades. Proyecto independiente inspirado en juegos clásicos, sin afiliación ni respaldo de Valve.</p>
          <h3>Weapons Creators</h3>
          <p class="cp-about-legal">Modelos 3D AK-47, M4A1, granada HE, flash, humo y C4: <a href="${WEAPON_ASSETS.ak47.source}" target="_blank" rel="noopener noreferrer">3dmodelscc0</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0 1.0</a>. Geometría y texturas adaptadas para este juego.</p>
          <p class="cp-about-legal">Modelos AWP, MP5, USP, escopeta automática y escopeta de corredera: <a href="${WEAPON_ASSETS.awp.source}" target="_blank" rel="noopener noreferrer">Maia Studios · Firearms Kit Free</a>, con permiso del autor para uso comercial, modificación y distribución.</p>
          <p class="cp-about-legal">Desert Eagle: <a href="${WEAPON_ASSETS.deagle.source}" target="_blank" rel="noopener noreferrer">SirDraco65</a>; Glock-18: <a href="${WEAPON_ASSETS.glock.source}" target="_blank" rel="noopener noreferrer">locarem</a>; cuchillo: <a href="${WEAPON_ASSETS.knife.source}" target="_blank" rel="noopener noreferrer">Aharabada / Simon Lübeß</a>, texturas de Yughues. Obras publicadas en OpenGameArt bajo CC0 1.0.</p>
          <p class="cp-about-legal">Modelos M249 y Scout: mallas y materiales originales de DEUSHIMA STRIKE.</p>
          <p class="cp-about-legal">Rig de brazos POV para SAS y Leet: <a href="https://github.com/wwwriks/wrad-arms" target="_blank" rel="noopener noreferrer">WRiKS · WRAD ARMS</a> · CC0 1.0. Colores de mangas y guantes adaptados para cada equipo.</p>
          <a class="cp-about-credits" href="/character-credits.html#weapons-creators" target="_blank" rel="noopener noreferrer">VER WEAPONS CREATORS Y CRÉDITOS COMPLETOS <span aria-hidden="true">↗</span></a>
        </section>`;
    } else {
      content.innerHTML = `
        <h2 class="cp-title">Juego</h2>
        <p class="cp-desc">AIM rápido con movimiento GoldSrc-like. En online 1v1 / 2v2 la ronda termina al eliminar al equipo rival y gana el primero en llegar a 13.</p>
        ${this._row('roundsToWin', 'Rondas para ganar', 1, 20, 1, 'range', 13)}
        <div class="cp-note">G tira el arma actual; podés recoger armas del suelo al acercarte si el slot está libre.</div>`;
    }
    if (this.fromMenu) {
      this.root.querySelector('[data-cp="resume"]').textContent = 'VOLVER';
      this.root.querySelector('[data-cp="close"]').style.display = 'none';
      this.root.querySelector('[data-cp="quit"]').style.display = 'none';
    } else {
      this.root.querySelector('[data-cp="resume"]').textContent = 'REANUDAR';
      this.root.querySelector('[data-cp="close"]').style.display = '';
      this.root.querySelector('[data-cp="quit"]').style.display = '';
    }
    this.root.querySelector('[data-cp="apply"]').style.display = ['server', 'about'].includes(this.tab) ? 'none' : '';
  }
  _apply() {
    const s = this.game.settings;
    this.root.querySelectorAll('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      s[key] = value;
    });
    s.volume = Math.max(0, Math.min(1, Number(s.volume)));
    s.sensitivity = Math.max(0.1, Number(s.sensitivity) || 1);
    s.fov = Math.max(60, Math.min(120, Number(s.fov) || 90));
    s.resolution = Math.max(0.5, Math.min(1, Number(s.resolution) || 0.85));
    this.game.input.sensitivity = s.sensitivity;
    this.game.audio?.setVolume?.(s.muted ? 0 : s.volume);
    if (this.game.camera) {
      this.game.camera.fov = s.fov;
      this.game.camera.updateProjectionMatrix();
    }
    try { this.game.renderer.setPixelRatio(this.game.pixelRatio()); } catch { /* ignore */ }
    try { localStorage.setItem('cs16-settings', JSON.stringify(s)); } catch { /* ignore */ }
    this.game.ui?.applySettings?.(s);
    this.game.ui?.toast?.('Configuración aplicada');
  }
}
export async function installClassic(game) {
  const hud = new ClassicHUD(game);
  const ok = await hud.load();
  if (!ok) console.warn('[classic] HUD sin assets; se mantiene el HUD de respaldo');
  const menu = new ClassicMenu(game, hud);
  const pause = new ClassicPause(game);
  game.classicUI = { hud, menu, pause };
  game.classicPause = pause;
  game.showClassicBanner = (title, subtitle = '', winner = null, ms = 3000) => {
    const el = document.getElementById('classic-banner');
    if (!el) return;
    el.innerHTML = `<div class="cb-kicker">DEUSHIMA STRIKE  1V1</div>
      <div class="cb-title">${title}</div>
      <div class="cb-sub">${subtitle}</div>`;
    el.classList.remove('ct', 't');
    if (winner === 'CT') el.classList.add('ct');
    if (winner === 'T') el.classList.add('t');
    el.classList.add('show');
    clearTimeout(game._classicBannerTimer);
    if (ms > 0) game._classicBannerTimer = setTimeout(() => el.classList.remove('show'), ms);
  };
  const originalKill = game.ui.addKillFeed?.bind(game.ui);
  if (originalKill) {
    game.ui.addKillFeed = (entry) => {
      hud.addKill(entry);
    };
  }
  const originalDamage = game.ui.showDamage?.bind(game.ui);
  if (originalDamage) game.ui.showDamage = (angle) => hud.addDamage(angle);
  const loop = (now) => {
    requestAnimationFrame(loop);
    hud.update(now);
    if (game.state === 'paused' && pause.root.classList.contains('hidden')) pause.show(false);
    if (game.state !== 'paused' && !pause.fromMenu && !pause.root.classList.contains('hidden')) pause.hide();
  };
  requestAnimationFrame(loop);
  document.getElementById('boot-screen')?.remove();
  console.info('[classic] UI 1.6 instalada');
  return { hud, menu };
}
