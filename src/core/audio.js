/**
 * WebAudio sound engine.
 * Prioriza samples WAV originales de CS 1.6 (assets/cs16/sound) y usa la
 * sÃ­ntesis procedural como fallback si un asset no estÃ¡ disponible.
 */
import { MenuMusic } from './menu-music.js';

const SAMPLE_BASE = '/assets/cs16/sound';

const WEAPON_FIRE = {
  ak47: 'weapons/ak47-1.wav',
  m4a1: 'weapons/m4a1-1.wav',
  awp: 'weapons/awp1.wav',
  deagle: 'weapons/deagle-1.wav',
  usp: 'weapons/usp1.wav',
  glock: 'weapons/glock18-1.wav',
  mp5: 'weapons/mp5-1.wav',
  xm1014: 'weapons/xm1014-1.wav',
  m3: 'weapons/m3-1.wav',
  scout: 'weapons/scout-1.wav',
  sg552: 'weapons/sg552-1.wav',
  sg550: 'weapons/sg550-1.wav',
  aug: 'weapons/aug-1.wav',
  famas: 'weapons/famas-1.wav',
  galil: 'weapons/galil-1.wav',
  m249: 'weapons/m249-1.wav',
  mac10: 'weapons/mac10-1.wav',
  p90: 'weapons/p90-1.wav',
  tmp: 'weapons/tmp-1.wav',
  ump45: 'weapons/ump45-1.wav',
  elite: 'weapons/elite_fire.wav',
  fiveseven: 'weapons/fiveseven-1.wav',
  p228: 'weapons/p228-1.wav',
  knife: 'weapons/knife_slash1.wav',
};

const SAMPLE_ALIASES = {
  gun_rifle: 'weapons/ak47-1.wav',
  gun_pistol: 'weapons/glock18-1.wav',
  gun_smg: 'weapons/mp5-1.wav',
  gun_sniper: 'weapons/awp1.wav',
  gun_shotgun: 'weapons/m3-1.wav',
  gun_lmg: 'weapons/m249-1.wav',
  headshot: 'player/headshot1.wav',
  death: 'player/die1.wav',
  hurt: 'player/bhit_flesh-1.wav',
  bodyfall: 'player/pl_die1.wav',
  jump: 'player/pl_jump1.wav',
  footstep: 'player/pl_dirt1.wav',
  hit: 'player/bhit_flesh-1.wav',
  flesh: 'player/bhit_flesh-1.wav',
  empty: 'weapons/dryfire_pistol.wav',
  knife_hit: 'weapons/knife_hit1.wav',
  knife_swing: 'weapons/knife_slash1.wav',
  round_start: 'radio/letsgo.wav',
  round_win: 'radio/ctwin.wav',
  round_lose: 'radio/terwin.wav',
  round_draw: 'radio/rounddraw.wav',
  buy: 'ui/buttonclick.wav',
  scope: 'ui/buttonclick.wav',
  land: 'player/pl_dirt1.wav',
  flashbang: 'weapons/flashbang-1.wav',
  c4_beep: 'weapons/c4_beep1.wav',
  c4_explode: 'weapons/c4_explode1.wav',
  ui_click: 'ui/buttonclick.wav',
  ui_hover: 'ui/buttonrollover.wav',
  ui_rollover: 'ui/buttonrollover.wav',
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.reverb = null;
    this.reverbReturn = null;
    this.noiseBuffer = null;
    this.volume = 0.7;
    this.muted = false;
    this.ambient = null;
    this.ambientTimer = null;
    this._last = Object.create(null);
    this._playCount = 0;
    this.ready = false;
    this._buffers = new Map();
    this._loading = new Set();
    this._samplesEnabled = true;
    this.menuMusic = new MenuMusic();
  }

  _samplePathFor(name, opts = {}) {
    if (opts.sample) return String(opts.sample).replace(/^sound\//, '');
    // Todas las armas comparten el mismo efecto de recarga.
    if (name === 'reload_start') return 'weapons/reload_pistol.mp3';
    if (name === 'reload_end') return null;
    if (opts.weaponId && WEAPON_FIRE[opts.weaponId] && /^gun_|knife_swing/.test(name)) {
      return WEAPON_FIRE[opts.weaponId];
    }
    if (name === 'weapon_switch' && opts.weaponId) {
      const w = opts.weaponId;
      if (w === 'ak47') return 'weapons/ak47_boltpull.wav';
      if (w === 'm4a1') return 'weapons/m4a1_deploy.wav';
      if (w === 'awp') return 'weapons/awp_deploy.wav';
      if (w === 'deagle') return 'weapons/de_deploy.wav';
      if (w === 'usp') return 'weapons/usp_sliderelease.wav';
      if (w === 'glock') return 'weapons/glock_sliderelease.wav';
      if (w === 'knife') return 'weapons/knife_deploy1.wav';
      return 'ui/buttonclick.wav';
    }
    if (name === 'reload_start' && opts.weaponId) {
      if (['ak47', 'm4a1', 'aug', 'famas', 'galil', 'sg552'].includes(opts.weaponId)) return `weapons/${opts.weaponId}_clipout.wav`;
      if (opts.weaponId === 'awp') return 'weapons/awp_clipout.wav';
      if (opts.weaponId === 'deagle') return 'weapons/de_clipout.wav';
      if (opts.weaponId === 'usp') return 'weapons/usp_clipout.wav';
      if (opts.weaponId === 'glock') return 'weapons/glock_clipout.wav';
      return 'weapons/generic_reload.wav';
    }
    if (name === 'reload_end' && opts.weaponId) {
      if (['ak47', 'm4a1', 'aug', 'famas', 'galil', 'sg552'].includes(opts.weaponId)) return `weapons/${opts.weaponId}_clipin.wav`;
      if (opts.weaponId === 'awp') return 'weapons/awp_clipin.wav';
      if (opts.weaponId === 'deagle') return 'weapons/de_clipin.wav';
      if (opts.weaponId === 'usp') return 'weapons/usp_clipin.wav';
      if (opts.weaponId === 'glock') return 'weapons/glock_clipin.wav';
      return 'weapons/generic_reload.wav';
    }
    return SAMPLE_ALIASES[name] || null;
  }

  async loadSample(rel) {
    if (!rel || !this.ctx) return null;
    if (this._buffers.has(rel)) return this._buffers.get(rel);
    if (this._loading.has(rel)) return null;
    this._loading.add(rel);
    try {
      const res = await fetch(`${SAMPLE_BASE}/${rel}`);
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this._buffers.set(rel, buf);
      return buf;
    } catch {
      this._buffers.set(rel, null);
      return null;
    } finally {
      this._loading.delete(rel);
    }
  }

  preload(list) {
    if (!this.ctx) return;
    for (const rel of list) this.loadSample(rel);
  }

  playSample(rel, opts = {}) {
    if (!this._samplesEnabled || !rel) return false;
    if (!this.ctx) this.init();
    if (!this.ctx) return false;
    const buf = this._buffers.get(rel);
    if (!buf) {
      this.loadSample(rel);
      return false;
    }
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = opts.rate || 1;
      const gain = this.ctx.createGain();
      gain.gain.value = (opts.volume ?? 1) * 0.9;
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = Math.max(-1, Math.min(1, opts.pan || 0));
        src.connect(gain).connect(pan).connect(this.master);
      } else {
        src.connect(gain).connect(this.master);
      }
      if (opts.reverb) {
        const send = this.ctx.createGain();
        send.gain.value = 0.16;
        gain.connect(send).connect(this.reverb);
      }
      src.start();
      if (Number(opts.duration) > 0) {
        const end = this.ctx.currentTime + Number(opts.duration);
        const fade = Math.max(0.02, Math.min(0.12, Number(opts.duration) * 0.08));
        gain.gain.setValueAtTime(gain.gain.value, Math.max(this.ctx.currentTime, end - fade));
        gain.gain.linearRampToValueAtTime(0.0001, end);
        src.stop(end + 0.01);
      }
      return true;
    } catch {
      return false;
    }
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 20;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    // Small procedural reverb for the concrete / desert spaces.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(0.85, 2.6);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = 0.24;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    this.noiseBuffer = this._makeNoise(2.0);
    this.ready = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // Precarga los sonidos que más se usan.
    setTimeout(() => {
      this.preload([
        'ui/buttonclick.wav', 'ui/buttonrollover.wav',
        'weapons/ak47-1.wav', 'weapons/m4a1-1.wav', 'weapons/deagle-1.wav',
        'weapons/glock18-1.wav', 'weapons/usp1.wav', 'weapons/awp1.wav',
        'weapons/knife_slash1.wav', 'weapons/knife_hit1.wav',
        'weapons/reload_pistol.mp3',
        'player/bhit_flesh-1.wav', 'player/headshot1.wav',
        'radio/letsgo.wav', 'radio/ctwin.wav', 'radio/terwin.wav',
      ]);
    }, 50);
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }

  _makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(1, len, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _ensure() {
    if (!this.ctx) this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ready;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    this.menuMusic.setVolume(this.muted ? 0 : this.volume);
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    this.menuMusic.setVolume(this.muted ? 0 : this.volume);
  }

  syncMenuMusic(inMenu) {
    this.menuMusic.setActive(inMenu);
  }

  resumeMenuMusic() {
    this.menuMusic.resume();
  }

  _panner(pan = 0, gainNode) {
    if (!pan || !this.ctx.createStereoPanner) {
      gainNode.connect(this.master);
      return;
    }
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    gainNode.connect(p);
    p.connect(this.master);
  }

  _env(node, t, attack, decay, peak, destination) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    if (destination) g.connect(destination);
    return g;
  }

  _noise(t, duration, { type = 'bandpass', freq = 1200, q = 0.8, gain = 0.7, pan = 0, send = 0.15 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filt);
    filt.connect(g);
    const p = this._panner(pan, g);
    if (send > 0 && this.reverb) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      filt.connect(s);
      s.connect(this.reverb);
    }
    src.start(t);
    src.stop(t + duration + 0.02);
    return g;
  }

  _tone(t, duration, { type = 'sine', freq = 440, endFreq = null, gain = 0.2, attack = 0.004, pan = 0, send = 0 } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    const p = this._panner(pan, g);
    if (send > 0 && this.reverb) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return p;
  }

  play(name, opts = {}) {
    if (!this._ensure()) return;
    const sampleRel = this._samplePathFor(name, opts);
    if (sampleRel) {
      const worked = this.playSample(sampleRel, {
        volume: opts.volume ?? 1,
        pan: opts.pan ?? 0,
        rate: opts.rate,
        duration: opts.duration,
        reverb: name.startsWith('gun_') || name === 'c4_explode',
      });
      if (worked) return;
    }
    const now = this.ctx.currentTime + 0.001;
    const vol = opts.volume ?? 1;
    const pan = opts.pan ?? 0;
    const key = `${name}:${Math.floor(now * 17)}`;
    if (this._last[key] && now - this._last[key] < 0.004) return;
    this._last[key] = now;
    if (++this._playCount > 400) {
      this._playCount = 0;
      for (const k of Object.keys(this._last)) {
        if (now - this._last[k] > 2) delete this._last[k];
      }
    }

    switch (name) {
      case 'ui_click':
        this._tone(now, 0.035, { type: 'square', freq: 780, endFreq: 540, gain: 0.06 * vol });
        this._noise(now, 0.02, { type: 'highpass', freq: 2400, gain: 0.05 * vol, send: 0 });
        break;
      case 'ui_hover':
        this._tone(now, 0.025, { type: 'sine', freq: 1200, endFreq: 920, gain: 0.025 * vol });
        break;
      case 'buy':
        this._tone(now, 0.05, { type: 'square', freq: 880, gain: 0.05 * vol });
        this._tone(now + 0.06, 0.09, { type: 'square', freq: 1320, gain: 0.05 * vol });
        break;
      case 'gun_pistol':
        this._gunshot(now, opts, { boom: 80, boomGain: 0.4, body: 0.13, freq: 1500, send: 0.1 });
        break;
      case 'gun_smg':
        this._gunshot(now, opts, { boom: 90, boomGain: 0.35, body: 0.11, freq: 1700, send: 0.1 });
        break;
      case 'gun_rifle':
        this._gunshot(now, opts, { boom: 70, boomGain: 0.65, body: 0.2, freq: 1100, send: 0.2 });
        break;
      case 'gun_lmg':
        this._gunshot(now, opts, { boom: 60, boomGain: 0.75, body: 0.24, freq: 900, send: 0.22 });
        break;
      case 'gun_shotgun':
        this._gunshot(now, opts, { boom: 55, boomGain: 0.9, body: 0.34, freq: 700, send: 0.28, spread: 0.5 });
        break;
      case 'gun_sniper':
        this._gunshot(now, opts, { boom: 45, boomGain: 1.0, body: 0.5, freq: 650, send: 0.4, extra: 0.22 });
        break;
      case 'knife_swing':
        this._noise(now, 0.16, { type: 'bandpass', freq: 700, q: 1.6, gain: 0.14 * vol, pan, send: 0 });
        this._noise(now + 0.04, 0.16, { type: 'highpass', freq: 2000, q: 1, gain: 0.05 * vol, pan, send: 0 });
        break;
      case 'knife_hit':
        this._noise(now, 0.08, { type: 'bandpass', freq: 300, q: 1.3, gain: 0.25 * vol, pan, send: 0.05 });
        this._tone(now, 0.08, { type: 'triangle', freq: 180, endFreq: 80, gain: 0.1 * vol, pan });
        break;
      case 'hit':
        this._tone(now, 0.035, { type: 'square', freq: 1600, endFreq: 1300, gain: 0.06 * vol });
        break;
      case 'headshot':
        this._tone(now, 0.11, { type: 'triangle', freq: 2200, endFreq: 1700, gain: 0.12 * vol });
        this._tone(now, 0.05, { type: 'square', freq: 3200, gain: 0.05 * vol });
        break;
      case 'hurt':
        this._noise(now, 0.1, { type: 'lowpass', freq: 500, gain: 0.18 * vol, send: 0 });
        this._tone(now, 0.1, { type: 'sawtooth', freq: 130, endFreq: 80, gain: 0.05 * vol });
        break;
      case 'death':
        this._noise(now, 0.35, { type: 'lowpass', freq: 380, gain: 0.3 * vol, send: 0.2 });
        this._tone(now + 0.08, 0.5, { type: 'sine', freq: 110, endFreq: 45, gain: 0.12 * vol });
        break;
      case 'footstep': {
        const f = name === 'footstep' ? 420 + Math.random() * 180 : 300;
        this._noise(now, 0.06, { type: 'lowpass', freq: f, q: 0.8, gain: 0.12 * vol, pan, send: 0.04 });
        this._noise(now + 0.012, 0.035, { type: 'highpass', freq: 1800, gain: 0.02 * vol, pan });
        break;
      }
      case 'jump':
        this._noise(now, 0.09, { type: 'lowpass', freq: 600, gain: 0.09 * vol, pan, send: 0.02 });
        break;
      case 'land':
        this._noise(now, 0.13, { type: 'lowpass', freq: 300, gain: 0.22 * vol, pan, send: 0.06 });
        this._tone(now, 0.09, { type: 'sine', freq: 95, endFreq: 55, gain: 0.08 * vol, pan });
        break;
      case 'reload_start':
        this._tone(now, 0.04, { type: 'square', freq: 420, gain: 0.035 * vol });
        this._noise(now + 0.03, 0.06, { type: 'bandpass', freq: 1200, q: 2, gain: 0.05 * vol });
        break;
      case 'reload_end':
        this._tone(now, 0.035, { type: 'square', freq: 640, gain: 0.04 * vol });
        this._tone(now + 0.07, 0.04, { type: 'square', freq: 420, gain: 0.035 * vol });
        break;
      case 'weapon_switch':
        this._noise(now, 0.05, { type: 'bandpass', freq: 1800, q: 2, gain: 0.04 * vol, send: 0 });
        break;
      case 'empty':
        this._tone(now, 0.03, { type: 'square', freq: 260, gain: 0.035 * vol });
        break;
      case 'scope':
        this._tone(now, 0.03, { type: 'square', freq: 1500, gain: 0.045 * vol });
        this._noise(now + 0.01, 0.03, { type: 'highpass', freq: 3000, gain: 0.03 * vol });
        break;
      case 'bomb_beep':
        this._tone(now, 0.055, { type: 'sine', freq: 1760, gain: 0.1 * vol });
        break;
      case 'bomb_plant':
        this._tone(now, 0.12, { type: 'square', freq: 1200, gain: 0.06 * vol });
        this._tone(now + 0.18, 0.12, { type: 'square', freq: 900, gain: 0.06 * vol });
        break;
      case 'bomb_defuse':
        this._tone(now, 0.1, { type: 'triangle', freq: 720, endFreq: 1200, gain: 0.08 * vol });
        break;
      case 'explosion': {
        const t = now;
        this._noise(t, 1.4, { type: 'lowpass', freq: 130, q: 0.7, gain: 0.85 * vol, send: 0.5 });
        this._tone(t, 0.9, { type: 'sine', freq: 65, endFreq: 28, gain: 0.4 * vol, send: 0.3 });
        this._noise(t + 0.03, 0.4, { type: 'highpass', freq: 1200, gain: 0.22 * vol, send: 0.3 });
        break;
      }
      case 'flashbang':
        this._noise(now, 0.55, { type: 'highpass', freq: 2200, q: 0.6, gain: 0.35 * vol, send: 0.35 });
        this._tone(now, 0.7, { type: 'sine', freq: 3400, endFreq: 2600, gain: 0.08 * vol });
        break;
      case 'smoke':
        this._noise(now, 0.8, { type: 'lowpass', freq: 900, gain: 0.16 * vol, send: 0.2 });
        break;
      case 'round_start':
        this._tone(now, 0.1, { type: 'square', freq: 660, gain: 0.06 * vol });
        this._tone(now + 0.14, 0.16, { type: 'square', freq: 880, gain: 0.07 * vol });
        break;
      case 'round_win':
        this._tone(now, 0.18, { type: 'triangle', freq: 523, gain: 0.1 * vol, send: 0.2 });
        this._tone(now + 0.15, 0.18, { type: 'triangle', freq: 659, gain: 0.1 * vol, send: 0.2 });
        this._tone(now + 0.3, 0.42, { type: 'triangle', freq: 784, gain: 0.11 * vol, send: 0.3 });
        break;
      case 'round_lose':
        this._tone(now, 0.22, { type: 'triangle', freq: 392, gain: 0.09 * vol, send: 0.2 });
        this._tone(now + 0.18, 0.3, { type: 'triangle', freq: 311, gain: 0.09 * vol, send: 0.2 });
        this._tone(now + 0.42, 0.55, { type: 'sine', freq: 233, gain: 0.09 * vol, send: 0.25 });
        break;
      case 'hostage':
        this._tone(now, 0.09, { type: 'sine', freq: 880, endFreq: 1100, gain: 0.05 * vol });
        break;
      case 'radio':
        this._noise(now, 0.08, { type: 'bandpass', freq: 1300, q: 3, gain: 0.06 * vol, send: 0 });
        this._tone(now + 0.04, 0.05, { type: 'square', freq: 900, gain: 0.03 * vol });
        break;
      case 'glass':
        this._noise(now, 0.2, { type: 'highpass', freq: 2400, q: 0.8, gain: 0.2 * vol, send: 0.1 });
        break;
      case 'ricochet':
        this._tone(now, 0.1, { type: 'sine', freq: 2200 + Math.random() * 800, endFreq: 900, gain: 0.04 * vol, pan });
        break;
      case 'bodyfall':
        this._noise(now, 0.2, { type: 'lowpass', freq: 260, gain: 0.25 * vol, send: 0.1 });
        break;
      default:
        break;
    }
  }

  _gunshot(t, opts, o) {
    const vol = opts.volume ?? 1;
    const pan = opts.pan ?? 0;
    this._noise(t, o.body, { type: 'bandpass', freq: o.freq, q: 0.55, gain: 0.8 * vol, pan, send: o.send });
    this._noise(t, 0.035, { type: 'highpass', freq: 3800, q: 0.7, gain: 0.4 * vol, pan, send: 0.02 });
    this._noise(t + 0.005, o.body * 0.8, {
      type: 'lowpass',
      freq: 340 + (o.spread || 0) * 500,
      q: 0.6,
      gain: 0.55 * vol,
      pan,
      send: o.send * 0.7,
    });
    this._tone(t, 0.16, { type: 'sine', freq: o.boom + 30, endFreq: o.boom * 0.6, gain: o.boomGain * vol, pan, send: 0.15 });
    if (o.extra) {
      this._noise(t + 0.01, o.extra, { type: 'lowpass', freq: 900, q: 0.4, gain: 0.25 * vol, pan, send: 0.4 });
      this._tone(t + 0.02, 0.35, { type: 'sine', freq: 120, endFreq: 55, gain: 0.15 * vol, send: 0.35 });
    }
  }

  startAmbient(mapId) {
    if (!this._ensure() || this.ambient) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mapId === 'cs_office' ? 300 : 480;
    filter.Q.value = 0.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.025, t + 1.8);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    src.start();
    this.ambient = { src, gain, lfo, filter };

    // Distant sporadic gunfire / wind gusts.
    this.ambientTimer = setInterval(() => {
      if (!this.ctx || this.muted || Math.random() > 0.35) return;
      const now = this.ctx.currentTime;
      const pan = Math.random() * 1.6 - 0.8;
      this._noise(now, 0.18 + Math.random() * 0.25, {
        type: 'lowpass',
        freq: 260 + Math.random() * 300,
        gain: 0.02 + Math.random() * 0.02,
        pan,
        send: 0.5,
      });
    }, 6500);
  }

  stopAmbient() {
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    this.ambientTimer = null;
    if (this.ambient) {
      try {
        this.ambient.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1);
        setTimeout(() => {
          try {
            this.ambient?.src.stop();
            this.ambient?.lfo.stop();
          } catch {
            /* ignore */
          }
          this.ambient = null;
        }, 400);
      } catch {
        this.ambient = null;
      }
    }
  }
}


