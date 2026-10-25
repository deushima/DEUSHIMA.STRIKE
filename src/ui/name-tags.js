import * as THREE from '../../vendor/three.module.js';

/**
 * Etiquetas de compaÃ±eros de equipo (estilo ESP de aliados).
 * Se dibujan en DOM, por encima del canvas WebGL, asÃ­ que se ven a travÃ©s de
 * paredes y objetos. Solo se muestran para el MISMO equipo del jugador.
 */
export class NameTagLayer {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('name-tags');
    this.tags = new Map();
    this._v = new THREE.Vector3();
    this._visible = true;
  }

  _ensure(key, name, team) {
    let entry = this.tags.get(key);
    if (entry && entry.name === name && entry.team === team) return entry;
    if (!entry) {
      const el = document.createElement('div');
      el.className = `nt nt-${String(team || '').toLowerCase()}`;
      el.innerHTML = `<span class="nt-name"></span><span class="nt-hp"><i></i></span>`;
      this.root.appendChild(el);
      entry = { el, name: null, team: null, hp: -1 };
      this.tags.set(key, entry);
    }
    entry.name = name;
    entry.team = team;
    entry.el.className = `nt nt-${String(team || '').toLowerCase()}`;
    entry.el.querySelector('.nt-name').textContent = name;
    return entry;
  }

  _isDeathmatch() {
    const game = this.game;
    return !!(
      game?.deathmatch ||
      game?.matchConfig?.mode === 'deathmatch' ||
      game?.matchConfig?.onlineMode === 'deathmatch' ||
      game?.online?.mode === 'deathmatch' ||
      game?.online?.startPayload?.mode === 'deathmatch'
    );
  }

  update() {
    if (!this.root) return;
    const game = this.game;
    const active = game.state === 'playing' || game.state === 'roundover';
    if (!active || this._isDeathmatch()) {
      this._setAll(false);
      return;
    }
    this._visible = true;
    const player = game.player;
    if (!player) return;
    const seen = new Set();
    const cam = game.camera;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const allies = [];
    for (const bot of (game.bots?.getBots?.() || [])) {
      if (!bot.alive) continue;
      if (bot.team !== player.team) continue;
      allies.push({ key: `b${bot.id}`, name: bot.name, team: bot.team, pos: bot.pos, health: bot.health });
    }
    const remote = game.online?.remoteAvatar;
    if (remote?.alive && remote.team === player.team) {
      allies.push({ key: 'remote', name: remote.name || 'ALIADO', team: remote.team, pos: remote.pos, health: remote.health ?? 100 });
    }

    for (const ally of allies) {
      seen.add(ally.key);
      const entry = this._ensure(ally.key, ally.name, ally.team);
      this._v.set(ally.pos.x, ally.pos.y + 2.5, ally.pos.z).project(cam);
      const onScreen = this._v.z > -1 && this._v.z < 1 &&
        this._v.x > -1.15 && this._v.x < 1.15 && this._v.y > -1.15 && this._v.y < 1.15;
      if (!onScreen) {
        entry.el.style.display = 'none';
        continue;
      }
      const x = (this._v.x * 0.5 + 0.5) * width;
      const y = (-this._v.y * 0.5 + 0.5) * height;
      entry.el.style.display = 'block';
      entry.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const hp = Math.round(Math.max(0, Math.min(100, ally.health ?? 100)));
      if (hp !== entry.hp) {
        entry.hp = hp;
        const bar = entry.el.querySelector('.nt-hp i');
        if (bar) bar.style.width = `${hp}%`;
      }
    }
    for (const [key, entry] of this.tags) {
      if (!seen.has(key)) entry.el.style.display = 'none';
    }
  }

  _setAll(show) {
    if (this._visible === show) return;
    this._visible = show;
    for (const entry of this.tags.values()) entry.el.style.display = show ? 'block' : 'none';
  }

  dispose() {
    for (const entry of this.tags.values()) entry.el.remove();
    this.tags.clear();
  }
}



