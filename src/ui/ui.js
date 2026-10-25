/**
 * DEUSHIMA STRIKE — Interfaz
 * -----------------------------------------------------------------------------
 * La UI no simula juego: sólo presenta el estado y delega acciones en `Game`.
 * Todo el DOM se construye dentro de #ui-root; los estilos viven en ui.css.
 * Sin assets externos: SVG inline, CSS y un canvas para el radar.
 *
 * API pública (ver UI_API.md):
 *   init, showMainMenu, showCreateGame, showOptions, showLoading, hideLoading,
 *   showHUD, hideHUD, updateHUD, showBuyMenu, updateBuyMenu, closeBuyMenu,
 *   openScoreboard, updateScoreboard, closeScoreboard, showPauseMenu,
 *   hidePauseMenu, showRoundBanner, hideRoundBanner, showRoundResult,
 *   hideRoundResult, showMatchEnd, addKillFeed, showDamage, flash, flashDamage,
 *   showActionProgress, hideActionProgress, toast, showCenterMessage,
 *   showKillConfirm, showFatalError, toggleConsole, consoleLog, applySettings,
 *   dispose. Getters: isOverlayOpen, isBuyMenuOpen, isScoreboardVisible,
 *   lockedForGameplay. Extras: hideAll, showHowToPlay, hideCenterMessage,
 *   setCrosshair, showHitmarker.
 */

/* ========================================================================== */
/* Constantes y utilidades                                                    */
/* ========================================================================== */

const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  volume: 0.65,
  fov: 90,
  resolution: 0.85,
  invertY: false,
  jumpWheelUp: false,
  jumpWheelDown: false,
  hudTheme: 'olive',
  crosshairColor: '#78ff63',
  crosshairSize: 1,
  language: 'es',
};

const MAPS = [
  {
    id: 'de_dust2',
    label: 'de_dust2',
    mode: 'bomb',
    modeLabel: 'BOMBARDEO',
    desc: 'Arena desértica. Sitios A y B, mid, long y túneles. El clásico definitivo.',
  },
  {
    id: 'cs_office',
    label: 'cs_office',
    mode: 'hostage',
    modeLabel: 'REHENES',
    desc: 'Oficina urbana. Rescatá a los rehenes o impedí el rescate. Combate cerrado.',
  },
];

const DIFFICULTIES = [
  { id: 'easy', label: 'Fácil', sub: 'Bots lentos' },
  { id: 'normal', label: 'Normal', sub: 'Equilibrado' },
  { id: 'hard', label: 'Difícil', sub: 'Precisos' },
  { id: 'expert', label: 'Experto', sub: 'Despiadados' },
];

const TEAM_OPTIONS = [
  { id: 'auto', label: 'AUTO', sub: 'Aleatorio' },
  { id: 'CT', label: 'CT', sub: 'Anti-terrorista' },
  { id: 'T', label: 'T', sub: 'Terrorista' },
];

const TEAM_SIZES = [3, 4, 5];
const ROUND_OPTIONS = [5, 8, 16];

const CROSS_COLORS = [
  { v: '#78ff63', n: 'Verde' },
  { v: '#ffd24a', n: 'Ãmbar' },
  { v: '#63e0ff', n: 'Cian' },
  { v: '#ffffff', n: 'Blanco' },
  { v: '#ff5c4d', n: 'Rojo' },
  { v: '#ff7bf0', n: 'Magenta' },
  { v: '#b8ff3c', n: 'Lima' },
  { v: '#ff9f43', n: 'Naranja' },
];

const LOADING_TIPS = [
  'Comprá durante los primeros 15 segundos de la ronda: la zona de compra es tu spawn.',
  'Los tiros a la cabeza hacen 4× daño. La precisión se paga.',
  'Mantené pulsado TAB para ver el marcador completo de la partida.',
  'Shift te hace caminar en silencio; los bots escuchan tus pasos al correr.',
  'Como T, plantá la bomba con E dentro de un sitio y defendela hasta que explote.',
  'Como CT, desactivá la bomba con E: 10 segundos, o 5 si llevás kit.',
  'Las armas ganan valor ronda a ronda: una buena economía decide partidas.',
  'Los disparos a la cabeza con AWP son letales. No te quedes quieto después de disparar.',
  'La consola (~) muestra el registro del motor y acepta comandos como help o clear.',
  'En cs_office, escoltá a los rehenes hasta la zona de rescate manteniendo E.',
];

const REASON_MAP = {
  bomb_exploded: 'La bomba explotó',
  bomb_explode: 'La bomba explotó',
  exploded: 'La bomba explotó',
  bomb_defused: 'La bomba fue desactivada',
  defused: 'La bomba fue desactivada',
  all_t: 'Todos los terroristas fueron eliminados',
  all_t_killed: 'Todos los terroristas fueron eliminados',
  all_ct: 'Todos los contraterroristas fueron eliminados',
  all_ct_killed: 'Todos los contraterroristas fueron eliminados',
  time: 'Se terminó el tiempo',
  timeout: 'Se terminó el tiempo',
  time_expired: 'Se terminó el tiempo',
  hostages: 'Rehenes rescatados',
  hostages_rescued: 'Todos los rehenes fueron rescatados',
  target_saved: 'Objetivo asegurado',
  elimination: 'Equipo enemigo eliminado',
  match_over: 'Fin de la partida',
  surrender: 'Rendición',
};

const OVERLAY_SCREENS = new Set(['main', 'create', 'options', 'howto', 'quit', 'loading', 'pause', 'buy', 'matchEnd', 'fatal']);
const MENU_SCREENS = ['main', 'create', 'options', 'howto', 'quit', 'loading', 'pause', 'buy', 'matchEnd', 'fatal'];

const SVG = {
  heart:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.3 3.9 13.2a5.2 5.2 0 0 1 7.4-7.3l.7.7.7-.7a5.2 5.2 0 0 1 7.4 7.3L12 21.3Z"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.8 20.5 5v6.1c0 5.1-3.5 9.2-8.5 11.1-5-1.9-8.5-6-8.5-11.1V5L12 1.8Zm0 2.2L5.5 6.2v4.9c0 4.1 2.7 7.5 6.5 9.2 3.8-1.7 6.5-5.1 6.5-9.2V6.2L12 4Z"/></svg>',
  person:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a4.2 4.2 0 1 0 0-8.4A4.2 4.2 0 0 0 12 12Zm0 2c-4.2 0-7.6 2.3-7.6 5.1V21h15.2v-1.9c0-2.8-3.4-5.1-7.6-5.1Z"/></svg>',
  skull:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C7.6 2 4 5.3 4 9.6c0 2.4 1.2 4.4 3.2 5.8V19c0 .6.5 1 1 1h1v1.6c0 .5.4.9.9.9h3.8c.5 0 .9-.4.9-.9V20h1c.5 0 1-.4 1-1v-3.6c2-1.4 3.2-3.4 3.2-5.8C20 5.3 16.4 2 12 2Zm-3 10.4a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8Zm6 0a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8Zm-4.6 3.8 1-2.2h1.2l1 2.2h-3.2Z"/></svg>',
  c4:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 9h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm1 3v5h3v-5H7Zm5 0v5h5v-5h-5Zm-2-4h6V6H10V8Zm2-4h2v2h-2V4Z"/></svg>',
  kit:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.7 5.3a5 5 0 0 1-6.6 6.6l-8 8a2.12 2.12 0 0 1-3-3l8-8a5 5 0 0 1 6.6-6.6l-2.9 2.9 1.5 1.5 2.9-2.9 1.5 1.5Z"/></svg>',
  grenade:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 8h3l1 1.5H17V18a3.5 3.5 0 0 1-3.5 3.5h-3A3.5 3.5 0 0 1 7 18V9.5h2.5L10.5 8ZM11 4h2l.5-2h2v2.3l-2.2.7-.8.9h-1l-.7-.9L11 4Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  target:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>',
};

const WEAPON_SHAPES = {
  pistol:
    '<path d="M8 10h19l1 3-4 1-2 2h-5l-1-2h-3l-1 4H7l1-4H8V10Z"/><path d="M17 16h5l-2 8h-5l1-4 1-2Z" opacity=".72"/>',
  rifle:
    '<path d="M3 12h9l2-2h9l1 1v3l-1 1h-7l-3 2h-2l-1 3H5l1-5H3v-3Z"/><path d="M20 13h14v2H20z"/><path d="M18 17h5l-2 7h-4z" opacity=".8"/>',
  sniper:
    '<path d="M2 13h10l2-2h12l2 1v2l-2 1H15l-3 2h-2l-1 3H4l1-5H2v-2Z"/><path d="M22 10h8v3h-8z"/><path d="M23 13h6v1h-6z" opacity=".7"/><path d="M17 18h5l-2 6h-4z" opacity=".8"/>',
  shotgun:
    '<path d="M3 12h12l2-2h10l1 1v3l-1 1H16l-3 2h-2l-1 3H5l1-5H3v-3Z"/><path d="M23 13h14v3H23z"/>',
  smg:
    '<path d="M5 12h9l2-2h7l1 1v3l-1 1h-6l-3 2h-2l-1 3H7l1-5H5v-3Z"/><path d="M20 16h4l-2 7h-4z" opacity=".8"/>',
  mg:
    '<path d="M2 12h10l3-2h10l1 1v3l-1 1h-8l-3 2h-2l-1 3H4l1-5H2v-3Z"/><path d="M25 12h9v2h-9z"/><path d="M17 17h6l-2 7h-5z" opacity=".8"/><path d="M9 16l-3 5M14 16l-3 5" stroke="currentColor" stroke-width="1.4" fill="none"/>',
  knife:
    '<path d="M10 20 30 6l5 2-20 15-5-3Z"/><path d="M8 21l-3 3 2 2 4-4-3-1Z"/>',
  grenade:
    '<circle cx="20" cy="16" r="7.5"/><path d="M18 8h4v3h-4z"/><path d="M24 7h6v2h-6z" opacity=".8"/>',
  c4: '<rect x="8" y="6" width="26" height="16" rx="1.5"/><path d="M12 10h6v8h-6z" fill="#000" opacity=".5"/><path d="M24 10h5v4h-5z" opacity=".6"/><path d="M17 22v4M24 22v4" stroke="currentColor" stroke-width="2" fill="none"/>',
  armor:
    '<path d="M18 4l8 3v7c0 6-3.8 9.6-8 12-4.2-2.4-8-6-8-12V7l8-3Z"/><path d="M18 9l4 1.6v3.9c0 3.1-1.8 5.2-4 6.5-2.2-1.3-4-3.4-4-6.5v-3.9L18 9Z" fill="#000" opacity=".35"/>',
  ammo:
    '<path d="M10 22V9l4-5 4 5v13zM22 22V11l4-5 4 5v11z"/><path d="M6 22h40v4H6z"/>',
  fallback: '<path d="M8 13h32v3H8z"/><path d="M12 9h9v4h-9z"/><path d="M28 16h8v3h-8z" opacity=".7"/>',
};

const WEAPON_KIND_BY_ID = {
  knife: 'knife',
  glock: 'pistol',
  usp: 'pistol',
  deagle: 'pistol',
  elite: 'pistol',
  fiveseven: 'pistol',
  p228: 'pistol',
  mp5: 'smg',
  tmp: 'smg',
  p90: 'smg',
  ump45: 'smg',
  mac10: 'smg',
  ak47: 'rifle',
  m4a1: 'rifle',
  galil: 'rifle',
  famas: 'rifle',
  sg552: 'rifle',
  aug: 'rifle',
  awp: 'sniper',
  scout: 'sniper',
  sg550: 'sniper',
  g3sg1: 'sniper',
  xm1014: 'shotgun',
  m3: 'shotgun',
  m249: 'mg',
  he: 'grenade',
  flash: 'grenade',
  smoke: 'grenade',
  c4: 'c4',
  kevlar: 'armor',
  kevlar_helmet: 'armor',
  assault: 'armor',
  defusekit: 'kit',
  kit: 'kit',
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const fmtMoney = (n) => `$${Math.round(num(n, 0)).toLocaleString('en-US')}`;

const fmtClock = (seconds) => {
  const s = Math.max(0, Math.ceil(num(seconds, 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const esc = (str) =>
  String(str == null ? '' : str).replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });

function crosshairHTML() {
  return (
    '<span class="xh t"></span><span class="xh b"></span>' +
    '<span class="xh l"></span><span class="xh r"></span>'
  );
}

function hitmarkerHTML() {
  return '<span class="hm-line a"></span><span class="hm-line b"></span><span class="hm-line c"></span><span class="hm-line d"></span>';
}

function weaponKind(id, name) {
  const key = String(id || '').toLowerCase().trim();
  if (WEAPON_KIND_BY_ID[key]) return WEAPON_KIND_BY_ID[key];
  if (WEAPON_SHAPES[key]) return key;
  const s = `${key} ${String(name || '').toLowerCase()}`;
  if (s.includes('knife') || s.includes('cuchillo')) return 'knife';
  if (s.includes('awp') || s.includes('scout') || s.includes('sniper') || s.includes('franco')) return 'sniper';
  if (s.includes('shotgun') || s.includes('escopeta') || s.includes('xm1014') || /(^|\s)m3(\s|$)/.test(s)) return 'shotgun';
  if (s.includes('m249') || s.includes('machine') || s.includes('ametralladora') || s.includes(' lmg')) return 'mg';
  if (s.includes('mp5') || s.includes('smg') || s.includes('subfusil') || s.includes('p90') || s.includes('ump')) return 'smg';
  if (s.includes('glock') || s.includes('usp') || s.includes('deagle') || s.includes('eagle') || s.includes('pistol') || s.includes('pistola')) return 'pistol';
  if (s.includes('grenade') || s.includes('granada') || s.includes('flash') || s.includes('smoke') || s.includes('he ')) return 'grenade';
  if (s.includes('c4') || s.includes('bomba') || s.includes('bomb')) return 'c4';
  if (s.includes('kevlar') || s.includes('chaleco') || s.includes('armor') || s.includes('helmet') || s.includes('casco')) return 'armor';
  if (s.includes('ammo') || s.includes('munic')) return 'ammo';
  if (s.includes('kit') || s.includes('defuse') || s.includes('desfuse')) return 'kit';
  if (s.includes('ak') || s.includes('m4') || s.includes('rifle') || s.includes('fusil')) return 'rifle';
  return 'fallback';
}

function weaponSvg(id, name, extraClass) {
  const kind = weaponKind(id, name);
  const path = WEAPON_SHAPES[kind] || WEAPON_SHAPES.fallback;
  return `<svg class="${extraClass || ''}" viewBox="0 0 48 28" fill="currentColor" aria-hidden="true">${path}</svg>`;
}

function icon(kind) {
  return SVG[kind] || '';
}

function mapThumbSvg(id) {
  if (id === 'cs_office') {
    return (
      '<svg viewBox="0 0 132 88" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="132" height="88" fill="#131a15"/>' +
      '<g fill="#28352b" stroke="#3c4d3f" stroke-width=".8">' +
      '<rect x="4" y="4" width="46" height="30"/><rect x="54" y="4" width="34" height="20"/>' +
      '<rect x="92" y="4" width="36" height="26"/><rect x="4" y="40" width="24" height="22"/>' +
      '<rect x="60" y="30" width="26" height="22"/><rect x="92" y="36" width="36" height="20"/>' +
      '<rect x="34" y="66" width="44" height="18"/><rect x="86" y="62" width="42" height="22"/>' +
      '</g>' +
      '<g stroke="#6e7d5f" stroke-width="1.1" fill="none" opacity=".8">' +
      '<path d="M50 19h4M88 14h4M50 51h10M86 41h6M56 75h30"/>' +
      '</g>' +
      '<g stroke="#86d95f" stroke-width="1.4" fill="rgba(134,217,95,.13)">' +
      '<path d="M8 78h18v8H8z"/><circle cx="22" cy="78" r="5"/>' +
      '</g>' +
      '<g fill="#9fdb75" stroke="#0c130e" stroke-width=".8">' +
      '<circle cx="44" cy="58" r="2.4"/><circle cx="118" cy="50" r="2.4"/>' +
      '</g>' +
      '<g fill="#cfa75f" font-family="Tahoma, sans-serif" font-size="8" font-weight="bold">' +
      '<text x="99" y="16">A</text><text x="8" y="20">B</text><text x="12" y="84">R</text>' +
      '</g>' +
      '</svg>'
    );
  }
  return (
    '<svg viewBox="0 0 132 88" preserveAspectRatio="none" aria-hidden="true">' +
    '<rect width="132" height="88" fill="#241d12"/>' +
    '<g fill="#332a1a" stroke="#5c4a29" stroke-width=".8">' +
    '<rect x="5" y="5" width="28" height="17"/><rect x="98" y="4" width="29" height="18"/>' +
    '<rect x="101" y="62" width="26" height="21"/><rect x="7" y="68" width="20" height="15"/>' +
    '<rect x="52" y="45" width="28" height="18"/>' +
    '</g>' +
    '<g stroke="#5c4a29" stroke-width="1" fill="none" opacity=".85">' +
    '<path d="M0 26h46V0M0 60h36V40h24v20h32V32h40M84 88V60h48"/>' +
    '<path d="M26 0v26M46 26h38v14H46zM100 0v26h32"/>' +
    '</g>' +
    '<g stroke="#a98a4d" stroke-width="1.3" opacity=".6">' +
    '<path d="M30 40h30v6H30z"/><path d="M82 30h22v6H82z"/><path d="M10 52h16"/>' +
    '</g>' +
    '<g fill="#cfa75f" font-family="Tahoma, sans-serif" font-size="9" font-weight="bold">' +
    '<text x="108" y="17">A</text><text x="12" y="80">B</text>' +
    '</g>' +
    '</svg>'
  );
}

function rangeRow(label, ref, outRef, setting, opts) {
  return (
    `<div class="range-row"><span class="range-label">${label}</span>` +
    `<input type="range" data-setting="${setting}" data-ref="${ref}" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${opts.value}" />` +
    `<output class="range-val" data-ref="${outRef}"></output></div>`
  );
}

function switchRow(label, ref, setting, checked) {
  return (
    `<label class="switch-row"><span>${label}</span>` +
    `<span class="switch" data-switch="${setting}"><input type="checkbox" data-setting="${setting}" data-ref="${ref}"${checked ? ' checked' : ''} /></span></label>`
  );
}

function segGroup(field, options) {
  return (
    `<div class="seg">` +
    options
      .map(
        (o) =>
          `<button type="button" class="seg-btn" data-field="${field}" data-value="${esc(o.value ?? o.id)}">` +
          `<span>${esc(o.label)}</span>${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</button>`,
      )
      .join('') +
    `</div>`
  );
}

function keyRow(keys, text) {
  const caps = keys.map((k) => `<span class="keycap">${esc(k)}</span>`).join('');
  return `<span class="keys">${caps}</span><span>${esc(text)}</span>`;
}

function loadLastConfig() {
  try {
    const raw = localStorage.getItem('cs16-ui-lastconfig');
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && typeof cfg === 'object') {
        return {
          map: cfg.map === 'cs_office' ? 'cs_office' : 'de_dust2',
          team: cfg.team === 'CT' || cfg.team === 'T' ? cfg.team : 'auto',
          difficulty: DIFFICULTIES.some((d) => d.id === cfg.difficulty) ? cfg.difficulty : 'normal',
          teamSize: TEAM_SIZES.includes(Number(cfg.teamSize)) ? Number(cfg.teamSize) : 5,
          roundsToWin: ROUND_OPTIONS.includes(Number(cfg.roundsToWin)) ? Number(cfg.roundsToWin) : 8,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { map: 'de_dust2', team: 'auto', difficulty: 'normal', teamSize: 5, roundsToWin: 8 };
}

/* ========================================================================== */
/* UI                                                                         */
/* ========================================================================== */

export class UI {
  constructor(game) {
    this.game = game || null;
    this._initialized = false;
    this._root = null;
    this._refs = {};
    this._screens = {};
    this._listeners = [];
    this._timers = new Set();

    this._screen = null; // main|create|options|howto|quit|loading|pause|buy|matchEnd|fatal
    this._buyOpen = false;
    this._scoreOpen = false;
    this._consoleOpen = false;
    this._pauseOpen = false;
    this._loadingOpen = false;
    this._roundResultOpen = false;

    this._hud = null;
    this._hudVisible = false;
    this._settings = { ...DEFAULT_SETTINGS, ...(game && game.settings ? game.settings : {}) };

    this._create = loadLastConfig();
    this._lastConfig = { ...this._create };
    this._optionsReturn = 'main';

    this._buyData = null;
    this._buyCat = 0;
    this._buySel = 0;
    this._buyStartTimeLeft = null;
    this._buyAutoClosed = false;

    this._radarCtx = null;
    this._lastMoney = null;
    this._lastSlotKey = '';
    this._lastGrenadeKey = '';
    this._lastGearKey = '';
    this._lastObjective = null;
    this._lastRoundMsg = '';
    this._flashFade = 0;
    this._startTime = Date.now();
    this._loadingTip = '';

    this._onKeyCapture = this._onKeyCapture.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onPointerOver = this._onPointerOver.bind(this);
  }

  /* ====================================================================== */
  /* Ciclo de vida                                                           */
  /* ====================================================================== */

  init() {
    if (this._initialized) return this;
    let root = document.getElementById('ui-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'ui-root';
      document.body.appendChild(root);
    }
    this._root = root;
    root.innerHTML = this._buildMarkup();

    // Cachear nodos referenciados.
    this._refs = {};
    for (const node of root.querySelectorAll('[data-ref]')) {
      this._refs[node.dataset.ref] = node;
    }
    this._screens = {};
    for (const node of root.querySelectorAll('[data-screen]')) {
      this._screens[node.dataset.screen] = node;
    }

    if (this._refs.radar) {
      try {
        this._radarCtx = this._refs.radar.getContext('2d');
      } catch {
        this._radarCtx = null;
      }
    }

    this._bind();
    this._initialized = true;

    // Aplicar ajustes actuales a los controles (no toca el game).
    this.applySettings(this._settings);
    this._refreshCreateUI();
    this._logConsole('Consola de DEUSHIMA STRIKE lista. Escribí "help".', 'sys');

    // El HUD arranca oculto; la pantalla de carga la maneja Game.
    this._resetTransients();
    return this;
  }

  dispose() {
    for (const [target, type, fn, opts] of this._listeners) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        /* ignore */
      }
    }
    this._listeners.length = 0;
    this._clearTimers();
    if (this._root) {
      try {
        this._root.innerHTML = '';
      } catch {
        /* ignore */
      }
    }
    this._initialized = false;
    this._refs = {};
    this._screens = {};
    this._screen = null;
    this._buyOpen = false;
    this._scoreOpen = false;
    this._consoleOpen = false;
    this._hud = null;
  }

  _on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      try {
        fn();
      } catch (err) {
        console.warn('[UI]', err);
      }
    }, ms);
    this._timers.add(id);
    return id;
  }

  _clearTimer(id) {
    if (id != null) {
      clearTimeout(id);
      this._timers.delete(id);
    }
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  }

  _bind() {
    this._on(this._root, 'click', this._onClick);
    this._on(this._root, 'input', this._onInput);
    this._on(this._root, 'change', this._onChange);
    this._on(this._root, 'pointerover', this._onPointerOver);
    this._on(this._root, 'pointerout', (e) => {
      if (this._lastHover && this._lastHover.contains(e.target) &&
          !this._lastHover.contains(e.relatedTarget)) this._lastHover = null;
    });
    this._on(window, 'keydown', this._onKeyCapture, true);

    // Enter en la consola.
    const input = this._refs.consoleInput;
    if (input) {
      this._on(input, 'keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const cmd = input.value.trim();
          input.value = '';
          if (cmd) {
            this._consoleHistory ||= [];
            this._consoleHistory.push(cmd);
            if (this._consoleHistory.length > 60) this._consoleHistory.shift();
            this._consoleHistoryIndex = this._consoleHistory.length;
            this._runConsoleCommand(cmd);
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const history = this._consoleHistory || [];
          if (!history.length) return;
          const delta = e.key === 'ArrowUp' ? -1 : 1;
          this._consoleHistoryIndex = Math.max(0, Math.min(history.length,
            (this._consoleHistoryIndex ?? history.length) + delta));
          input.value = history[this._consoleHistoryIndex] || '';
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }

    // Redibujar radar al cambiar el tamaño de ventana.
    this._on(window, 'resize', () => {
      if (this._hud && this._hudVisible) this._drawRadar(this._hud.radar);
    });
  }

  /* ====================================================================== */
  /* Getters de integración                                                  */
  /* ====================================================================== */

  get isOverlayOpen() {
    if (this._consoleOpen) return true;
    return !!(this._screen && OVERLAY_SCREENS.has(this._screen));
  }

  get isBuyMenuOpen() {
    return this._buyOpen;
  }

  get isScoreboardVisible() {
    return this._scoreOpen;
  }

  get lockedForGameplay() {
    return !this.isOverlayOpen;
  }

  /* ====================================================================== */
  /* Markup                                                                  */
  /* ====================================================================== */

  _buildMarkup() {
    return (
      this._hudMarkup() +
      this._mainMenuMarkup() +
      this._createMarkup() +
      this._optionsMarkup() +
      this._howtoMarkup() +
      this._quitMarkup() +
      this._loadingMarkup() +
      this._pauseMarkup() +
      this._buyMarkup() +
      this._scoreboardMarkup() +
      this._roundResultMarkup() +
      this._matchEndMarkup() +
      '<div class="ui-toasts" data-ref="toasts"></div>' +
      this._consoleMarkup() +
      this._fatalMarkup()
    );
  }

  _hudMarkup() {
    return `
<div class="hud u-hidden" data-ref="hud" data-hud="root">
  <div class="hud-topleft" data-hud="topleft">
    <div class="hud-money" data-ref="money" data-hud="money"><span class="cur">$</span><span data-ref="moneyVal">0</span></div>
    <div class="radar-box" data-hud="radar">
      <div class="radar-head"><span class="rh-map" data-ref="radarMap">de_dust2</span><span class="rh-north">N ↑</span></div>
      <canvas id="ui-radar" data-ref="radar" data-hud="radar-canvas" width="396" height="396"></canvas>
    </div>
  </div>

  <div class="hud-top" data-hud="top">
    <div class="hud-scorebar" data-hud="scorebar">
      <div class="hud-team ct">
        <span class="ht-tag">CT</span>
        <span class="ht-alive">${icon('person')}<b data-ref="aliveCT">0</b></span>
        <span class="ht-score" data-ref="scoreCT">0</span>
      </div>
      <div class="hud-clock" data-ref="clock">
        <span class="clock-time" data-ref="clockTime">0:00</span>
        <span class="clock-sub" data-ref="clockSub">RONDA 1</span>
      </div>
      <div class="hud-team t">
        <span class="ht-score" data-ref="scoreT">0</span>
        <span class="ht-alive">${icon('person')}<b data-ref="aliveT">0</b></span>
        <span class="ht-tag">T</span>
      </div>
    </div>
    <div class="hud-objective">
      <span class="obj-dot"></span>
      <span data-ref="objective">Esperando la ronda…</span>
      <span class="obj-buy u-hidden" data-ref="buyHint">COMPRA</span>
    </div>
    <div class="hud-bombtimer u-hidden" data-ref="bombTimer">
      <span class="bt-icon">${icon('c4')}</span>
      <span class="bt-site" data-ref="bombSite">SITIO A</span>
      <span class="bt-time" data-ref="bombTime">0:40</span>
    </div>
  </div>

  <div class="hud-killfeed" data-ref="killfeed" data-hud="killfeed"></div>

  <div class="hud-vitals" data-ref="vitals" data-hud="vitals">
    <div class="vital health">
      <span class="vital-icon">${icon('heart')}</span>
      <div class="vital-body">
        <span class="vital-num" data-ref="hpNum">100</span>
        <span class="vital-bar"><i data-ref="hpBar"></i></span>
        <span class="vital-tag">SALUD</span>
      </div>
    </div>
    <div class="vital armor" data-ref="armorVital">
      <span class="vital-icon">${icon('shield')}</span>
      <div class="vital-body">
        <span class="vital-num" data-ref="arNum">0</span>
        <span class="vital-bar"><i data-ref="arBar"></i></span>
        <span class="vital-tag">CHALECO <span class="helmet" data-ref="helmetTag"></span></span>
      </div>
    </div>
  </div>

  <div class="hud-weapon" data-hud="weapon">
    <div class="wpn-panel">
      <span class="wpn-name" data-ref="wpnName">SIN ARMA</span>
      <div class="wpn-ammo" data-ref="wpnAmmo">
        <span class="ammo-mag" data-ref="ammoMag">0</span>
        <span class="ammo-sep">/</span>
        <span class="ammo-res" data-ref="ammoRes">0</span>
      </div>
      <div class="wpn-slots" data-ref="slots"></div>
      <div class="wpn-gear" data-ref="gear"></div>
      <div class="wpn-grenades" data-ref="grenades"></div>
    </div>
  </div>

  <div class="hud-crosshair hidden" data-ref="crosshair" data-hud="crosshair">${crosshairHTML()}</div>
  <div class="hud-hitmarker" data-ref="hitmarker" data-hud="hitmarker">${hitmarkerHTML()}</div>
  <div class="hud-killconfirm" data-ref="killconfirm" data-hud="killconfirm">
    <span class="kc-icon">${icon('skull')}</span>
    <span class="kc-text" data-ref="kcText">ELIMINADO</span>
  </div>
  <div class="hud-damage" data-ref="damage" data-hud="damage"></div>
  <div class="hud-roundmsg" data-ref="roundMsg" data-hud="roundmsg"></div>

  <div class="hud-banner hidden" data-ref="banner" data-hud="banner">
    <div class="hb-title" data-ref="bannerTitle"></div>
    <div class="hb-sub" data-ref="bannerSub"></div>
  </div>
  <div class="hud-center" data-ref="centerMsg" data-hud="center"></div>
  <div class="hud-action" data-ref="action" data-hud="action">
    <span class="ha-label" data-ref="actionLabel"></span>
    <span class="ha-bar"><i class="ha-fill" data-ref="actionFill"></i></span>
  </div>
  <div class="hud-scope u-hidden" data-ref="scope" data-hud="scope"></div>

  <div class="hud-lowhp" data-ref="lowhp" data-hud="lowhp"></div>
  <div class="hud-dmgv" data-ref="dmgv" data-hud="dmgv"></div>
  <div class="hud-flash" data-ref="flash" data-hud="flash"></div>
</div>`;
  }

  _mainMenuMarkup() {
    const news = [
      ['Bienvenido a Browser Edition', 'El clásico de 1999 reconstruido en HTML5. Sin descargas, sin plugins.'],
      ['Economía de ronda', 'Ganar paga $3250. Perder acumula bonus. Administrá tu dinero como en 1.6.'],
      ['Dos escenarios', 'de_dust2 para bombardeo y cs_office para rescate de rehenes.'],
    ];
    return `
<div class="screen main-menu u-hidden" data-screen="main">
  <div class="fx-vignette"></div>
  <div class="fx-scan"></div>
  <div class="menu-inner">
    <div class="menu-left">
      <div class="logo-block">
        <div class="logo-kicker">Browser Edition · WebGL</div>
        <h1 class="logo-title">COUNTER<span class="dash">-</span>STRIKE</h1>
        <div class="logo-subline">
          <span class="logo-16">1.6</span>
          <span class="logo-edition">Browser Edition</span>
        </div>
        <div class="logo-rule"></div>
        <p class="logo-tagline">El shooter táctico que definió una generación, reconstruido para el navegador. Elegí bando, comprá armas y ganá la ronda.</p>
      </div>

      <nav class="menu-nav">
        <button type="button" class="menu-btn primary" data-action="main-play"><span class="mb-index">01</span>JUGAR<span class="mb-hint">ENTRAR</span></button>
        <button type="button" class="menu-btn" data-action="main-options"><span class="mb-index">02</span>OPCIONES<span class="mb-hint">AJUSTES</span></button>
        <button type="button" class="menu-btn" data-action="main-howto"><span class="mb-index">03</span>CÓMO JUGAR<span class="mb-hint">AYUDA</span></button>
        <button type="button" class="menu-btn" data-action="main-quit"><span class="mb-index">04</span>SALIR<span class="mb-hint">FIN</span></button>
      </nav>

      <div class="menu-foot">
        <span>v1.6 · <b>HTML5 / WebGL</b> · sin descargas</span>
        <div class="foot-keys">
          <span><span class="keycap">TAB</span> marcador</span>
          <span><span class="keycap">B</span> comprar</span>
          <span><span class="keycap">~</span> consola</span>
        </div>
      </div>
    </div>

    <aside class="side-panel">
      <div class="side-title">Servidor local<span class="side-tag">offline</span></div>
      <div class="server-rows">
        <div class="server-row"><span>Estado</span><b class="green"><span class="status-dot"></span><span data-ref="menuStatus">Listo</span></b></div>
        <div class="server-row"><span>Mapa</span><b data-ref="menuMap">de_dust2</b></div>
        <div class="server-row"><span>Modo</span><b data-ref="menuMode">BOMBARDEO</b></div>
        <div class="server-row"><span>Jugadores</span><b data-ref="menuPlayers">10 (local)</b></div>
        <div class="server-row"><span>Dificultad</span><b class="amber" data-ref="menuDifficulty">Normal</b></div>
        <div class="server-row"><span>Motor</span><b>Three.js · 60 fps</b></div>
      </div>
      <div class="side-title">Noticias<span class="side-tag">cs16</span></div>
      <div class="news-list">
        ${news
          .map(([title, text]) => `<div class="news-item"><b>${esc(title)}</b>${esc(text)}</div>`)
          .join('')}
      </div>
      <div class="side-tip"><b>Consejo:</b> mantené TAB para ver el marcador y ~ para abrir la consola del motor.</div>
    </aside>
  </div>
</div>`;
  }

  _createMarkup() {
    const maps = MAPS.map((m) => {
      return `
      <div class="map-card" data-map="${m.id}" role="button" tabindex="0">
        <span class="map-check">◆ ELEGIDO</span>
        <div class="map-thumb">${mapThumbSvg(m.id)}</div>
        <div class="map-meta">
          <span class="map-name">${esc(m.label)}</span>
          <span class="map-desc">${esc(m.desc)}</span>
          <span class="map-badge">${esc(m.modeLabel)}</span>
        </div>
      </div>`;
    }).join('');

    return `
<div class="screen center-screen u-hidden" data-screen="create">
  <div class="fx-vignette"></div>
  <div class="fx-scan"></div>
  <div class="panel cg-panel">
    <div class="panel-head">
      <h2 class="panel-title">Crear partida<span class="thin">Elegí el escenario y las reglas del combate</span></h2>
      <span class="panel-kicker">Partida local · offline</span>
    </div>

    <div class="cg-grid">
      <div class="cg-col">
        <h3 class="cg-section-title">Escenario</h3>
        <div class="cg-maps">${maps}</div>
      </div>

      <div class="cg-col cg-side">
        <h3 class="cg-section-title">Equipo</h3>
        <div class="field">${segGroup('team', TEAM_OPTIONS.map((t) => ({ value: t.id, label: t.label, sub: t.sub })))}</div>

        <h3 class="cg-section-title">Dificultad de los bots</h3>
        <div class="field">${segGroup('difficulty', DIFFICULTIES.map((d) => ({ value: d.id, label: d.label, sub: d.sub })))}</div>

        <div class="field">
          <div class="field-label">Tamaño de equipo <span class="hint">bots por bando</span></div>
          ${segGroup('teamSize', TEAM_SIZES.map((n) => ({ value: String(n), label: `${n} v ${n}` })))}
        </div>

        <div class="field">
          <div class="field-label">Rondas para ganar <span class="hint">primero a…</span></div>
          ${segGroup('roundsToWin', ROUND_OPTIONS.map((n) => ({ value: String(n), label: String(n) })))}
        </div>

        <div class="cg-summary" data-ref="cgSummary"></div>
      </div>
    </div>

    <div class="panel-foot">
      <span class="panel-note">Los bots ocupan los lugares libres del equipo elegido. Los enfrentamientos son 5v5 como máximo.</span>
      <div class="cg-start-row">
        <button type="button" class="btn" data-action="cg-back">VOLVER</button>
        <button type="button" class="btn primary big" data-action="cg-start">EMPEZAR</button>
      </div>
    </div>
  </div>
</div>`;
  }

  _optionsMarkup() {
    const s = this._settings;
    const swatches = CROSS_COLORS.map(
      (c) =>
        `<button type="button" class="swatch" data-color="${c.v}" title="${esc(c.n)}" style="--sw:${c.v}" aria-label="Color ${esc(c.n)}"></button>`,
    ).join('');

    return `
<div class="screen center-screen u-hidden" data-screen="options">
  <div class="fx-vignette"></div>
  <div class="fx-scan"></div>
  <div class="panel opt-panel">
    <div class="panel-head">
      <h2 class="panel-title">Opciones<span class="thin">Ajustes de control, vídeo, audio y mira</span></h2>
      <span class="panel-kicker">Se guardan automáticamente</span>
    </div>

    <div class="opt-grid">
      <section class="opt-section">
        <h3>Controles</h3>
        ${rangeRow('Sensibilidad', 'sensInput', 'sensOut', 'sensitivity', { min: '0.1', max: '5', step: '0.05', value: s.sensitivity })}
        ${switchRow('Invertir eje Y', 'invertCheck', 'invertY', !!s.invertY)}
        ${switchRow('Saltar con rueda arriba', 'jumpWheelUpCheck', 'jumpWheelUp', s.jumpWheelUp === true)}
        ${switchRow('Saltar con rueda abajo', 'jumpWheelDownCheck', 'jumpWheelDown', s.jumpWheelDown === true)}
        <p class="panel-note">Cada dirección activada salta en vez de cambiar de arma.</p>
      </section>

      <section class="opt-section">
        <h3>Vídeo</h3>
        ${rangeRow('Campo de visión (FOV)', 'fovInput', 'fovOut', 'fov', { min: '60', max: '110', step: '1', value: s.fov })}
        <div class="field" style="margin-top:10px">
          <div class="field-label">Resolución de render <span class="hint">escala interna</span></div>
          <select class="ui-select" data-setting="resolution" data-ref="resSelect">
            <option value="0.6">60% · máximo rendimiento</option>
            <option value="0.75">75% · equilibrado</option>
            <option value="0.85">85% · recomendado</option>
            <option value="1">100% · nítido</option>
          </select>
        </div>
      </section>

      <section class="opt-section">
        <h3>Audio</h3>
        ${rangeRow('Volumen general', 'volInput', 'volOut', 'volume', { min: '0', max: '1', step: '0.01', value: s.volume })}
        <p class="panel-note" style="margin-top:8px">Los sonidos son sintetizados en tiempo real: disparos, pasos, radio y ambiente.</p>
      </section>

      <section class="opt-section">
        <h3>Mira</h3>
        <div class="field">
          <div class="field-label">Color</div>
          <div class="swatch-row" data-ref="swatchRow">${swatches}</div>
        </div>
        ${rangeRow('Tamaño', 'xhSizeInput', 'xhSizeOut', 'crosshairSize', { min: '0.5', max: '2', step: '0.1', value: s.crosshairSize })}
      </section>

      <section class="opt-section wide">
        <h3>Vista previa de la mira</h3>
        <div class="xhair-preview">
          <div class="hud-crosshair" data-ref="xhairPreview">${crosshairHTML()}</div>
          <span class="preview-label">VISTA PREVIA</span>
        </div>
      </section>
    </div>

    <div class="panel-foot">
      <span class="opt-foot-note">Los cambios se aplican al instante. La resolución afecta el render interno del motor, no tu ventana.</span>
      <button type="button" class="btn" data-action="opt-reset">RESTABLECER</button>
      <button type="button" class="btn primary" data-action="opt-back">VOLVER</button>
    </div>
  </div>
</div>`;
  }

  _howtoMarkup() {
    return `
<div class="screen center-screen u-hidden" data-screen="howto">
  <div class="fx-vignette"></div>
  <div class="fx-scan"></div>
  <div class="panel howto-panel">
    <div class="panel-head">
      <h2 class="panel-title">Cómo jugar<span class="thin">Controles, objetivos y economía</span></h2>
      <span class="panel-kicker">Guía rápida</span>
    </div>

    <div class="howto-grid">
      <div class="howto-section">
        <h3>Controles</h3>
        <div class="keys-list">
          ${keyRow(['W', 'A', 'S', 'D'], 'Moverse')}
          ${keyRow(['RATÓN'], 'Apuntar y disparar')}
          ${keyRow(['R'], 'Recargar')}
          ${keyRow(['1', '2', '3', '4', '5'], 'Cambiar de arma / granada / C4')}
          ${keyRow(['B'], 'Abrir la tienda')}
          ${keyRow(['E'], 'Usar, plantar o desactivar la bomba')}
          ${keyRow(['G'], 'Tirar el arma actual')}
          ${keyRow(['CTRL'], 'Agacharse')}
          ${keyRow(['SHIFT'], 'Caminar en silencio')}
          ${keyRow(['SPACE'], 'Saltar')}
          ${keyRow(['TAB'], 'Marcador (mantener)')}
          ${keyRow(['ESC'], 'Pausa')}
          ${keyRow(['~'], 'Consola del motor')}
        </div>
      </div>

      <div class="howto-section">
        <h3>Objetivos</h3>
        <div class="howto-copy">
          <p><b class="accent">de_dust2 · Bombardeo.</b> Los terroristas deben plantar el C4 en el sitio A o B; los contraterroristas deben impedirlo o desactivarlo.</p>
          <p><b class="accent">cs_office · Rehenes.</b> Los CT escoltan a los rehenes hasta la zona de rescate. Los T deben evitarlo.</p>
          <p><b>Fin de ronda:</b> eliminación del equipo rival, bomba detonada/desactivada, rehenes rescatados o tiempo agotado.</p>
        </div>

        <h3 style="margin-top:14px">Economía</h3>
        <div class="howto-copy">
          <ul>
            <li>Ronda ganada: <b>$3250</b> por jugador.</li>
            <li>Ronda perdida: bonus acumulado de <b>$1400</b> en adelante.</li>
            <li>Baja con arma: <b>$300</b> (AWP paga menos, cuchillo paga más).</li>
            <li>Plantar la bomba o rescatar rehenes otorga dinero extra.</li>
          </ul>
          <p>Comprá durante los primeros <b>15 segundos</b> dentro de la zona de compra de tu spawn.</p>
        </div>

        <h3 style="margin-top:14px">Consejos</h3>
        <div class="howto-copy">
          <p>Apuntá a la cabeza, controlá el retroceso en ráfagas cortas y usá las granadas para bloquear líneas de visión. Los bots escuchan tus pasos: Shift es tu amigo.</p>
        </div>
      </div>
    </div>

    <div class="panel-foot">
      <span class="panel-note">Todos los textos de la interfaz están en español; los nombres de armas y mapas conservan su forma original.</span>
      <button type="button" class="btn primary" data-action="howto-back">VOLVER</button>
    </div>
  </div>
</div>`;
  }

  _quitMarkup() {
    return `
<div class="screen center-screen u-hidden" data-screen="quit">
  <div class="fx-vignette"></div>
  <div class="fx-scan"></div>
  <div class="panel quit-panel">
    <div class="quit-logo">GRACIAS POR JUGAR</div>
    <p>DEUSHIMA STRIKE. Podés volver al menú para seguir jugando o cerrar la pestaña para salir.</p>
    <div class="quit-actions">
      <button type="button" class="btn primary" data-action="quit-back">VOLVER AL MENÚ</button>
      <button type="button" class="btn" data-action="quit-close">CERRAR PESTAÑA</button>
    </div>
    <div class="panel-note" style="margin-top:14px">El navegador puede bloquear el cierre automático de pestañas abiertas manualmente.</div>
  </div>
</div>`;
  }

  _loadingMarkup() {
    return `
<div class="screen loading-screen u-hidden" data-screen="loading">
  <div class="fx-vignette"></div>
  <div class="loading-inner">
    <div class="loading-logo">COUNTER<span class="dash">-</span>STRIKE <span style="color:var(--amber-hi)">1.6</span></div>
    <div class="loading-sub">Browser Edition</div>
    <div class="loading-text" data-ref="loadingText">Cargando…</div>
    <div class="loading-bar"><i></i></div>
    <div class="loading-tip"><b>Consejo</b><br /><span data-ref="loadingTip"></span></div>
  </div>
</div>`;
  }

  _pauseMarkup() {
    return `
<div class="screen pause-screen u-hidden" data-screen="pause">
  <div class="fx-vignette"></div>
  <div class="panel pause-panel">
    <div class="pause-title">Juego en pausa</div>
    <div class="pause-sub">La partida continúa cuando reanudes</div>
    <div class="pause-stats" data-ref="pauseStats"></div>
    <div class="pause-actions">
      <button type="button" class="btn primary" data-action="pause-resume">REANUDAR</button>
      <button type="button" class="btn" data-action="pause-options">OPCIONES</button>
      <button type="button" class="btn" data-action="pause-buy" data-ref="pauseBuy">COMPRAR</button>
      <button type="button" class="btn" data-action="pause-quit">SALIR AL MENÚ</button>
    </div>
    <div class="pause-foot">ESC · reanudar &nbsp;·&nbsp; B · tienda</div>
  </div>
</div>`;
  }

  _buyMarkup() {
    return `
<div class="screen buy-screen u-hidden" data-screen="buy">
  <div class="panel buy-panel">
    <div class="buy-head">
      <div class="buy-title">TIENDA <span class="buy-team" data-ref="buyTeam">CT</span></div>
      <div class="buy-money" data-ref="buyMoney">$0</div>
      <div class="buy-timer" data-ref="buyTimer"><span>Compra</span><b data-ref="buyTimerVal">15s</b></div>
      <button type="button" class="btn small" data-action="buy-close">CERRAR [ESC]</button>
    </div>
    <div class="buy-body">
      <div class="buy-cats" data-ref="buyCats"></div>
      <div class="buy-main">
        <div class="buy-cat-title"><span data-ref="buyCatTitle">Pistolas</span><span class="cat-desc" data-ref="buyCatDesc"></span></div>
        <div class="buy-warning u-hidden" data-ref="buyWarning">FUERA DE ZONA DE COMPRA</div>
        <div class="buy-items" data-ref="buyItems"></div>
        <div class="buy-detail" data-ref="buyDetail"></div>
      </div>
    </div>
    <div class="buy-foot">
      <span><span class="keycap">1-8</span> categoría</span>
      <span><span class="keycap">↑↓</span> elegir</span>
      <span><span class="keycap">ENTER</span> comprar</span>
      <span><span class="keycap">ESC</span> cerrar</span>
      <span class="foot-right">Clic para comprar · <b style="color:#9fdb75">verde</b> = tenés dinero</span>
    </div>
  </div>
</div>`;
  }

  _scoreboardMarkup() {
    return `
<div class="screen scoreboard u-hidden" data-screen="scoreboard">
  <div class="panel sb-panel">
    <div class="sb-head">
      <div class="sb-map"><span data-ref="sbMap">de_dust2</span><span data-ref="sbMode">BOMBARDEO · SERVIDOR LOCAL</span></div>
      <span class="sb-round" data-ref="sbRound">RONDA 1</span>
      <div class="sb-scoreline">
        <div class="sb-teamscore ct"><span>CT</span><b data-ref="sbScoreCT">0</b></div>
        <span class="sb-vs">VS</span>
        <div class="sb-teamscore t"><span>T</span><b data-ref="sbScoreT">0</b></div>
      </div>
    </div>
    <div class="sb-teams" data-ref="sbTeams"></div>
    <div class="sb-foot">
      <span>TAB · mantener para ver el marcador</span>
      <span>Servidor local · Browser Edition</span>
    </div>
  </div>
</div>`;
  }

  _roundResultMarkup() {
    return `
<div class="screen round-result u-hidden" data-screen="roundResult">
  <div class="rr-inner" data-ref="rrInner">
    <div class="rr-title" data-ref="rrTitle">RONDA TERMINADA</div>
    <div class="rr-reason" data-ref="rrReason"></div>
    <div class="rr-score" data-ref="rrScore"></div>
    <div class="rr-next">SIGUIENTE RONDA EN BREVE</div>
  </div>
</div>`;
  }

  _matchEndMarkup() {
    return `
<div class="screen match-end u-hidden" data-screen="matchEnd">
  <div class="panel match-end-panel">
    <div class="me-head">
      <div class="me-verdict" data-ref="meVerdict">FIN DE LA PARTIDA</div>
      <h2 class="me-title" data-ref="meTitle">COUNTER-TERRORISTS WIN</h2>
      <div class="me-sub" data-ref="meSub"></div>
      <div class="me-score" data-ref="meScore"></div>
    </div>
    <div class="me-body" data-ref="meBody"></div>
    <div class="me-actions">
      <button type="button" class="btn primary big" data-action="match-rematch">REVANCHA</button>
      <button type="button" class="btn" data-action="match-menu">MENÚ PRINCIPAL</button>
    </div>
  </div>
</div>`;
  }

  _fatalMarkup() {
    return `
<div class="screen fatal-screen u-hidden" data-screen="fatal">
  <div class="panel fatal-panel">
    <h2 class="fatal-title">Error fatal</h2>
    <pre class="fatal-msg" data-ref="fatalMsg"></pre>
    <div class="fatal-note">El motor no pudo continuar. Revisá la consola del navegador para más detalles.</div>
    <button type="button" class="btn primary" data-action="fatal-reload">REINTENTAR</button>
  </div>
</div>`;
  }

  _consoleMarkup() {
    return `
<div class="ui-console u-hidden" data-ref="console">
  <div class="console-head"><span>Consola · DEUSHIMA STRIKE</span><span class="ch-hint">~ cerrar · Enter ejecutar · ↑↓ historial</span><button class="console-close" type="button" data-console-close aria-label="Cerrar consola">×</button></div>
  <div class="console-out" data-ref="consoleOut"></div>
  <div class="console-in"><span class="prompt">&gt;</span><input type="text" data-ref="consoleInput" autocomplete="off" spellcheck="false" maxlength="240" /></div>
</div>`;
  }

  /* ====================================================================== */
  /* Utilidades DOM                                                          */
  /* ====================================================================== */

  _node(name) {
    return this._refs[name] || null;
  }

  _t(name, value) {
    const node = this._refs[name];
    if (!node) return;
    const v = value == null ? '' : String(value);
    if (node.__uiText === v) return;
    node.__uiText = v;
    node.textContent = v;
  }

  _showNode(name, visible) {
    const node = this._refs[name];
    if (!node) return;
    node.classList.toggle('u-hidden', !visible);
  }

  _showMenuScreen(name) {
    for (const key of MENU_SCREENS) {
      const el = this._screens[key];
      if (el) el.classList.toggle('u-hidden', key !== name);
    }
    // Por si algún día se agrega una pantalla fuera de MENU_SCREENS.
    const named = this._screens[name];
    if (named) named.classList.remove('u-hidden');
    this._screen = name;
  }

  _hideMenuScreens() {
    for (const key of MENU_SCREENS) {
      const el = this._screens[key];
      if (el) el.classList.add('u-hidden');
    }
    this._screen = null;
    this._buyOpen = false;
    this._pauseOpen = false;
    this._loadingOpen = false;
  }

  _showScreen(name, visible) {
    const el = this._screens[name];
    if (!el) return;
    el.classList.toggle('u-hidden', !visible);
  }

  _resetTransients() {
    this.hideRoundBanner();
    this.hideRoundResult();
    this.hideActionProgress();
    this._hideCenterMessage();
    this._setScope(false);
    if (this._refs.killfeed) this._refs.killfeed.innerHTML = '';
    this._lastKill = null;
    this._setFlash(0);
    this._setDamageVignette(0);
    if (this._refs.lowhp) this._refs.lowhp.classList.remove('show');
    if (this._refs.crosshair) this._refs.crosshair.classList.add('hidden');
    if (this._refs.toasts) this._refs.toasts.innerHTML = '';
    this._lastRoundMsg = '';
    if (this._refs.roundMsg) this._refs.roundMsg.classList.remove('show');
  }

  _sound(name) {
    const audio = this.game && this.game.audio;
    if (audio && typeof audio.play === 'function') {
      try {
        audio.play(name);
      } catch {
        /* ignore */
      }
    }
  }

  _btnSound() {
    this._sound('ui_click');
  }

  /* ====================================================================== */
  /* Eventos                                                                 */
  /* ====================================================================== */

  _onClick(e) {
    const target = e.target;
    if (!target || !target.closest) return;

    const actionEl = target.closest('[data-action]');
    if (actionEl) {
      const isButton = actionEl.tagName === 'BUTTON' || actionEl.classList.contains('menu-btn');
      if (isButton) this._btnSound();
      this._handleAction(actionEl.dataset.action, actionEl, e);
      return;
    }

    const mapCard = target.closest('[data-map]');
    if (mapCard) {
      this._btnSound();
      this._setCreateField('map', mapCard.dataset.map);
      return;
    }

    const fieldBtn = target.closest('[data-field]');
    if (fieldBtn) {
      this._btnSound();
      this._setCreateField(fieldBtn.dataset.field, fieldBtn.dataset.value);
      return;
    }

    const colorBtn = target.closest('[data-color]');
    if (colorBtn) {
      this._btnSound();
      this._setSetting('crosshairColor', colorBtn.dataset.color);
      return;
    }

    const catBtn = target.closest('[data-cat-index]');
    if (catBtn) {
      this._btnSound();
      this._buySelectCategory(Number(catBtn.dataset.catIndex) || 0);
      return;
    }

    const itemRow = target.closest('[data-item-index]');
    if (itemRow) {
      this._btnSound();
      this._buyClickItem(Number(itemRow.dataset.itemIndex) || 0);
      return;
    }
  }

  _onInput(e) {
    const target = e.target;
    if (!target || !target.dataset) return;
    const setting = target.dataset.setting;
    if (!setting) return;
    if (target.type === 'range') {
      this._setSetting(setting, Number(target.value));
    }
  }

  _onChange(e) {
    const target = e.target;
    if (!target || !target.dataset) return;
    const setting = target.dataset.setting;
    if (!setting) return;
    if (target.type === 'checkbox') this._setSetting(setting, !!target.checked);
    else if (setting === 'resolution') this._setSetting(setting, Number(target.value));
    else this._setSetting(setting, target.value);
  }

  _onPointerOver(e) {
    const target = e.target;
    if (!target || !target.closest) return;
    const el = target.closest('button, .menu-btn, .seg-btn, .map-card, .buy-item, .buy-cat');
    if (!el || el.disabled || el === this._lastHover || el.contains(e.relatedTarget)) return;
    this._lastHover = el;
    const audio = this.game && this.game.audio;
    if (audio && audio.ready) this._sound('ui_hover');
  }

  _onKeyCapture(e) {
    if (!this._initialized) return;
    const code = e.code;

    // Consola abierta: sólo interceptamos su cierre.
    if (this._consoleOpen) {
      if (code === 'Escape' || code === 'Backquote') {
        e.preventDefault();
        e.stopPropagation();
        this._closeConsole();
      }
      return;
    }

    // Buy menu: categorías con 1-8, flechas, enter, escape.
    if (this._buyOpen) {
      if (code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._exitBuyMenu();
        return;
      }
      if (/^Digit[1-8]$/.test(code)) {
        e.preventDefault();
        e.stopPropagation();
        this._buySelectCategory(Number(code.slice(5)) - 1);
        return;
      }
      if (/^Numpad[1-8]$/.test(code)) {
        e.preventDefault();
        e.stopPropagation();
        this._buySelectCategory(Number(code.slice(6)) - 1);
        return;
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        this._buyMove(code === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        this._buyBuySelected();
        return;
      }
      // B lo maneja Game para cerrar; el resto sigue su curso.
      return;
    }

    if (code !== 'Escape' || e.repeat) return;

    // Escape cierra nuestros overlays sin que Game reanude la partida.
    if (this._screen === 'options') {
      e.preventDefault();
      e.stopPropagation();
      this._backFromOptions();
    } else if (this._screen === 'create') {
      e.preventDefault();
      e.stopPropagation();
      this.showMainMenu();
    } else if (this._screen === 'howto' || this._screen === 'quit') {
      e.preventDefault();
      e.stopPropagation();
      this.showMainMenu();
    }
    // En pausa, Game se encarga de Escape (reanudar).
  }

  _handleAction(action) {
    const game = this.game;
    switch (action) {
      case 'main-play':
        this.showCreateGame();
        break;
      case 'main-options':
        this.showOptions('main');
        break;
      case 'main-howto':
        this.showHowToPlay();
        break;
      case 'main-quit':
        this.showQuit();
        break;
      case 'cg-back':
        this.showMainMenu();
        break;
      case 'cg-start':
        this._startMatchFromCreate();
        break;
      case 'opt-back':
        this._backFromOptions();
        break;
      case 'opt-reset':
        this._resetSettings();
        break;
      case 'howto-back':
        this.showMainMenu();
        break;
      case 'quit-back':
        this.showMainMenu();
        break;
      case 'quit-close':
        try {
          window.close();
        } catch {
          /* ignore */
        }
        this.toast('Cerrá la pestaña para salir del juego');
        break;
      case 'pause-resume':
        if (game && typeof game.resume === 'function') game.resume();
        else this.hidePauseMenu();
        break;
      case 'pause-options':
        this.showOptions('pause');
        break;
      case 'pause-buy':
        if (game && typeof game.openBuyMenu === 'function') game.openBuyMenu();
        else this.toast('No se puede abrir la tienda ahora');
        break;
      case 'pause-quit':
        this.hidePauseMenu();
        if (game && typeof game.quitToMenu === 'function') game.quitToMenu();
        else this.showMainMenu();
        break;
      case 'buy-close':
        this._exitBuyMenu();
        break;
      case 'match-rematch':
        this._rematch();
        break;
      case 'match-menu':
        if (game && typeof game.quitToMenu === 'function') game.quitToMenu();
        else this.showMainMenu();
        break;
      case 'fatal-reload':
        try {
          window.location.reload();
        } catch {
          /* ignore */
        }
        break;
      default:
        break;
    }
  }

  /* ====================================================================== */
  /* Menús principales                                                       */
  /* ====================================================================== */

  showMainMenu() {
    // #boot-screen puede seguir ahí si Game todavía no lo quitó.
    const boot = document.getElementById('boot-screen');
    if (boot) boot.remove();

    this._hideMenuScreens();
    this._showScreen('scoreboard', false);
    this._showScreen('roundResult', false);
    this._scoreOpen = false;
    this.hideHUD();
    this._resetTransients();
    this._closeConsole(true);

    this._updateMenuInfo();
    this._showMenuScreen('main');
  }

  _updateMenuInfo() {
    const mapId = (this.game && this.game.map && this.game.map.id) || this._lastConfig.map || 'de_dust2';
    const info = MAPS.find((m) => m.id === mapId) || MAPS[0];
    const cfg = this._lastConfig || {};
    const size = Number(cfg.teamSize) || 5;
    const diff = DIFFICULTIES.find((d) => d.id === cfg.difficulty) || DIFFICULTIES[1];
    this._t('menuMap', info.label);
    this._t('menuMode', info.modeLabel);
    this._t('menuPlayers', `${size * 2} (local)`);
    this._t('menuDifficulty', diff.label);
    this._t('menuStatus', 'Listo');
  }

  showCreateGame() {
    this._hideMenuScreens();
    this._refreshCreateUI();
    this._showMenuScreen('create');
  }

  showQuit() {
    this._hideMenuScreens();
    this._showMenuScreen('quit');
  }

  showHowToPlay() {
    this._hideMenuScreens();
    this._showMenuScreen('howto');
  }

  showOptions(returnTo) {
    const from = returnTo || (this._screen === 'pause' ? 'pause' : 'main');
    this._optionsReturn = from === 'pause' ? 'pause' : 'main';
    this._hideMenuScreens();
    this._refreshOptions();
    this._showMenuScreen('options');
  }

  _backFromOptions() {
    if (this._optionsReturn === 'pause') {
      this._showPauseScreen();
    } else {
      this.showMainMenu();
    }
  }

  /* ---- Crear partida ---------------------------------------------------- */

  _setCreateField(field, value) {
    if (!field) return;
    if (field === 'map') {
      this._create.map = value === 'cs_office' ? 'cs_office' : 'de_dust2';
    } else if (field === 'team') {
      this._create.team = value === 'CT' || value === 'T' ? value : 'auto';
    } else if (field === 'difficulty') {
      if (DIFFICULTIES.some((d) => d.id === value)) this._create.difficulty = value;
    } else if (field === 'teamSize') {
      const n = Number(value);
      if (TEAM_SIZES.includes(n)) this._create.teamSize = n;
    } else if (field === 'roundsToWin') {
      const n = Number(value);
      if (ROUND_OPTIONS.includes(n)) this._create.roundsToWin = n;
    }
    this._refreshCreateUI();
    try {
      localStorage.setItem('cs16-ui-lastconfig', JSON.stringify(this._create));
    } catch {
      /* ignore */
    }
  }

  _refreshCreateUI() {
    const c = this._create;
    for (const card of this._root.querySelectorAll('[data-map]')) {
      card.classList.toggle('active', card.dataset.map === c.map);
    }
    for (const btn of this._root.querySelectorAll('[data-field]')) {
      const field = btn.dataset.field;
      let active = false;
      if (field === 'team') active = String(btn.dataset.value) === String(c.team);
      else if (field === 'difficulty') active = String(btn.dataset.value) === String(c.difficulty);
      else if (field === 'teamSize') active = Number(btn.dataset.value) === Number(c.teamSize);
      else if (field === 'roundsToWin') active = Number(btn.dataset.value) === Number(c.roundsToWin);
      btn.classList.toggle('active', active);
    }
    const info = MAPS.find((m) => m.id === c.map) || MAPS[0];
    const diff = DIFFICULTIES.find((d) => d.id === c.difficulty) || DIFFICULTIES[1];
    const teamLabel = c.team === 'auto' ? 'AUTO (aleatorio)' : c.team === 'CT' ? 'CT · Anti-terrorista' : 'T · Terrorista';
    const rows = [
      ['Mapa', info.label],
      ['Modo', info.modeLabel],
      ['Equipo', teamLabel],
      ['Dificultad', `${diff.label} · ${diff.sub}`],
      ['Tamaño', `${c.teamSize} v ${c.teamSize}`],
      ['Rondas para ganar', String(c.roundsToWin)],
    ];
    if (this._refs.cgSummary) {
      this._refs.cgSummary.innerHTML = rows
        .map(([k, v]) => `<div class="sum-line"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
        .join('');
    }
  }

  _startMatchFromCreate() {
    const game = this.game;
    if (!game || typeof game.startMatch !== 'function') {
      this.toast('El motor todavía no está listo', 'bad');
      return;
    }
    const config = {
      map: this._create.map,
      team: this._create.team,
      difficulty: this._create.difficulty,
      teamSize: Number(this._create.teamSize),
      roundsToWin: Number(this._create.roundsToWin),
    };
    this._lastConfig = { ...config };
    try {
      localStorage.setItem('cs16-ui-lastconfig', JSON.stringify(config));
    } catch {
      /* ignore */
    }
    try {
      game.startMatch(config);
    } catch (err) {
      console.error('[UI] startMatch', err);
      this.showFatalError('No se pudo iniciar la partida: ' + (err && err.message ? err.message : err));
    }
  }

  _currentConfig() {
    const live = (this.game && this.game.matchConfig) || {};
    const base = this._lastConfig || {};
    return {
      map: live.map || base.map || 'de_dust2',
      team: live.team || base.team || 'auto',
      difficulty: live.difficulty || base.difficulty || 'normal',
      teamSize: Number(live.teamSize || base.teamSize || 5),
      roundsToWin: Number(live.roundsToWin || base.roundsToWin || 8),
    };
  }

  _rematch() {
    const game = this.game;
    if (!game || typeof game.startMatch !== 'function') {
      this.toast('No se puede reiniciar la partida', 'bad');
      return;
    }
    const config = this._currentConfig();
    this._lastConfig = { ...config };
    try {
      game.startMatch(config);
    } catch (err) {
      console.error('[UI] rematch', err);
      this.showFatalError('No se pudo reiniciar: ' + (err && err.message ? err.message : err));
    }
  }

  /* ---- Opciones --------------------------------------------------------- */

  _refreshOptions() {
    this.applySettings(this._settings);
  }

  _setSetting(key, value) {
    if (!key) return;
    this._settings[key] = value;
    this._refreshSettingVisual(key);
    const game = this.game;
    if (game && typeof game.applySettings === 'function') {
      try {
        game.applySettings({ [key]: value });
      } catch (err) {
        console.warn('[UI] game.applySettings', err);
        this.applySettings(this._settings);
      }
    } else {
      this.applySettings(this._settings);
    }
  }

  _resetSettings() {
    const defaults = { ...DEFAULT_SETTINGS };
    this._settings = { ...this._settings, ...defaults };
    const game = this.game;
    if (game && typeof game.applySettings === 'function') {
      try {
        game.applySettings(defaults);
      } catch {
        /* ignore */
      }
    }
    this.applySettings(this._settings);
    this.toast('Opciones restablecidas', 'info');
  }

  applySettings(settings) {
    this._settings = { ...DEFAULT_SETTINGS, ...(this._settings || {}), ...(settings || {}) };
    if (!this._initialized) return;
    const s = this._settings;

    // Sliders.
    this._syncRange('sensInput', s.sensitivity);
    this._syncRange('fovInput', s.fov);
    this._syncRange('volInput', s.volume);
    this._syncRange('xhSizeInput', s.crosshairSize);
    this._syncRange('sensOut', (num(s.sensitivity, 1)).toFixed(2), true);
    this._syncRange('fovOut', `${Math.round(num(s.fov, 90))}°`, true);
    this._syncRange('volOut', `${Math.round(num(s.volume, 0.65) * 100)}%`, true);
    this._syncRange('xhSizeOut', `${num(s.crosshairSize, 1).toFixed(1)}×`, true);

    // Select de resolución.
    const res = this._refs.resSelect;
    if (res) {
      res.value = String(num(s.resolution, 0.85));
      if (!res.value) res.value = '0.85';
    }

    // Switch invertir Y.
    const inv = this._refs.invertCheck;
    if (inv) {
      if (document.activeElement !== inv) inv.checked = !!s.invertY;
      const wrap = inv.closest('.switch');
      if (wrap) wrap.classList.toggle('on', !!s.invertY);
    }

    for (const [ref, key] of [['jumpWheelUpCheck', 'jumpWheelUp'], ['jumpWheelDownCheck', 'jumpWheelDown']]) {
      const control = this._refs[ref];
      if (!control) continue;
      if (document.activeElement !== control) control.checked = s[key] === true;
      control.closest('.switch')?.classList.toggle('on', s[key] === true);
    }

    // Swatches de color.
    const swatchRow = this._refs.swatchRow;
    if (swatchRow) {
      for (const btn of swatchRow.querySelectorAll('[data-color]')) {
        btn.classList.toggle('active', String(btn.dataset.color).toLowerCase() === String(s.crosshairColor || '').toLowerCase());
      }
    }

    this._refreshPreviewCrosshair();

    if (this._hud) {
      this._applyCrosshair({ ...(this._hud.crosshair || {}), color: s.crosshairColor, size: s.crosshairSize });
    }
  }

  _syncRange(name, value, isOutput) {
    const node = this._refs[name];
    if (!node) return;
    if (isOutput) {
      this._t(name, value);
      return;
    }
    if (document.activeElement !== node) node.value = value;
    const min = num(node.min, 0);
    const max = num(node.max, 100);
    const val = num(node.value, 0);
    const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    node.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  }

  _refreshSettingVisual(key) {
    const s = this._settings;
    if (key === 'sensitivity') {
      this._syncRange('sensOut', num(s.sensitivity).toFixed(2), true);
      this._syncRange('sensInput', s.sensitivity);
    } else if (key === 'fov') {
      this._syncRange('fovOut', `${Math.round(num(s.fov))}°`, true);
      this._syncRange('fovInput', s.fov);
    } else if (key === 'volume') {
      this._syncRange('volOut', `${Math.round(num(s.volume) * 100)}%`, true);
      this._syncRange('volInput', s.volume);
    } else if (key === 'crosshairSize') {
      this._syncRange('xhSizeOut', `${num(s.crosshairSize).toFixed(1)}×`, true);
      this._syncRange('xhSizeInput', s.crosshairSize);
      this._refreshPreviewCrosshair();
    } else if (key === 'crosshairColor') {
      const row = this._refs.swatchRow;
      if (row) {
        for (const btn of row.querySelectorAll('[data-color]')) {
          btn.classList.toggle('active', String(btn.dataset.color).toLowerCase() === String(s.crosshairColor).toLowerCase());
        }
      }
      this._refreshPreviewCrosshair();
    } else if (key === 'invertY') {
      const wrap = this._refs.invertCheck && this._refs.invertCheck.closest('.switch');
      if (wrap) wrap.classList.toggle('on', !!s.invertY);
    }
  }

  _refreshPreviewCrosshair() {
    const el = this._refs.xhairPreview;
    if (!el) return;
    this._applyCrosshairVars(el, {
      color: this._settings.crosshairColor,
      size: this._settings.crosshairSize,
      spreadPx: 7,
    });
  }

  /* ====================================================================== */
  /* Loading / HUD                                                          */
  /* ====================================================================== */

  showLoading(text) {
    this._hideMenuScreens();
    this._showScreen('scoreboard', false);
    this._showScreen('roundResult', false);
    this._scoreOpen = false;
    this._loadingTip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)] || '';
    this._t('loadingTip', this._loadingTip);
    this._t('loadingText', text || 'Cargando…');
    this._showMenuScreen('loading');
    this._loadingOpen = true;
  }

  hideLoading() {
    this._showScreen('loading', false);
    if (this._screen === 'loading') this._screen = null;
    this._loadingOpen = false;
  }

  showHUD() {
    if (!this._refs.hud) return;
    this._refs.hud.classList.remove('u-hidden');
    this._hudVisible = true;
    if (this._refs.crosshair) this._refs.crosshair.classList.remove('hidden');
  }

  hideHUD() {
    if (!this._refs.hud) return;
    this._refs.hud.classList.add('u-hidden');
    this._hudVisible = false;
    this._setScope(false);
    if (this._refs.lowhp) this._refs.lowhp.classList.remove('show');
    if (this._refs.crosshair) this._refs.crosshair.classList.add('hidden');
  }

  hideAll() {
    this._hideMenuScreens();
    this._showScreen('scoreboard', false);
    this._showScreen('roundResult', false);
    this._scoreOpen = false;
    this.hideHUD();
    this._closeConsole(true);
    // No ocultamos el banner de ronda: Game.startMatch() llama hideAll() justo
    // después de rounds.startMatch(), y el HUD ya está oculto, así que el banner
    // de la ronda 1 debe sobrevivir hasta showHUD().
    this.hideActionProgress();
    this._hideCenterMessage();
    this._setFlash(0);
    this._setDamageVignette(0);
    this._roundResultOpen = false;
    if (this._refs.killfeed) this._refs.killfeed.innerHTML = '';
    this._lastRoundMsg = '';
    if (this._refs.roundMsg) this._refs.roundMsg.classList.remove('show');
  }

  /* ====================================================================== */
  /* HUD                                                                    */
  /* ====================================================================== */

  updateHUD(hud) {
    if (!hud || !this._initialized) return;
    this._hud = hud;
    this._tickBuyTimer(hud);
    if (!this._hudVisible) return;

    const w = hud.weapon || {};
    const r = hud.round || {};
    const radar = hud.radar || null;
    const ch = hud.crosshair || {};
    const alive = hud.alive !== false;

    /* Dinero ------------------------------------------------------------- */
    const money = Math.round(num(hud.money, 0));
    this._t('moneyVal', money.toLocaleString('en-US'));
    if (this._lastMoney != null && money > this._lastMoney) {
      const el = this._refs.money;
      if (el) {
        el.classList.add('bump');
        this._later(() => el.classList.remove('bump'), 420);
      }
    }
    this._lastMoney = money;

    /* Vitales ------------------------------------------------------------ */
    const health = clamp(Math.round(num(hud.health, 0)), 0, 9999);
    const armor = clamp(Math.round(num(hud.armor, 0)), 0, 9999);
    this._t('hpNum', health);
    this._t('arNum', armor);
    const hpBar = this._refs.hpBar;
    if (hpBar) hpBar.style.width = `${clamp(health, 0, 100)}%`;
    const arBar = this._refs.arBar;
    if (arBar) arBar.style.width = `${clamp(armor, 0, 100)}%`;
    const vitals = this._refs.vitals;
    if (vitals) {
      vitals.classList.toggle('crit', alive && health <= 25);
      vitals.classList.toggle('warn', alive && health > 25 && health <= 50);
    }
    const armorVital = this._refs.armorVital;
    if (armorVital) armorVital.classList.toggle('zero', armor <= 0);
    const arNum = this._refs.arNum;
    if (arNum) arNum.classList.toggle('zero', armor <= 0);
    this._t('helmetTag', hud.helmet && armor > 0 ? '· CASCO' : '');

    /* Reloj / marcador ---------------------------------------------------- */
    const phase = r.phase || 'live';
    const roundNumber = num(r.roundNumber, num(r.round, 1)) || 1;
    let timeVal;
    if (phase === 'freeze') timeVal = num(r.freezeLeft, num(r.timeLeft, 0));
    else if (phase === 'over' || phase === 'matchover') timeVal = num(r.timeLeft, 0);
    else timeVal = num(r.timeLeft, 0);
    if (phase === 'live' && timeVal <= 0 && r.bomb && r.bomb.planted) timeVal = num(r.bomb.timeLeft, 0);

    this._t('clockTime', fmtClock(timeVal));
    const clock = this._refs.clock;
    if (clock) {
      clock.classList.toggle('freeze', phase === 'freeze' && timeVal > 0);
      clock.classList.toggle('closing', phase === 'live' && timeVal > 0 && timeVal <= 10);
    }
    this._t('clockSub', phase === 'freeze' && timeVal > 0 ? `CONGELADO · RONDA ${roundNumber}` : `RONDA ${roundNumber}`);

    this._t('scoreCT', num(r.scoreCT, num(hud.scores && hud.scores.CT, 0)));
    this._t('scoreT', num(r.scoreT, num(hud.scores && hud.scores.T, 0)));
    const teamAlive = r.teamAlive || hud.teamAlive || {};
    this._t('aliveCT', num(teamAlive.CT, 0));
    this._t('aliveT', num(teamAlive.T, 0));

    /* Objetivo ------------------------------------------------------------ */
    let objective = r.objective;
    if (!objective || typeof objective !== 'string') {
      objective = phase === 'freeze' ? 'Ronda congelada: comprá y preparate' : phase === 'over' ? 'Fin de la ronda' : 'Eliminá a todos los enemigos';
    }
    this._t('objective', objective);
    const buyLeft = num(r.buyTimeLeft, 0);
    if (buyLeft > 0 && (phase === 'freeze' || phase === 'live')) {
      this._showNode('buyHint', true);
      this._t('buyHint', `COMPRA ${Math.ceil(buyLeft)}s`);
      if (this._refs.buyHint) this._refs.buyHint.classList.toggle('urgent', buyLeft <= 5);
    } else {
      this._showNode('buyHint', false);
    }

    /* Bomba --------------------------------------------------------------- */
    const bomb = r.bomb || null;
    if (bomb && bomb.planted) {
      this._showNode('bombTimer', true);
      this._t('bombSite', `SITIO ${bomb.site || '?'}`);
      this._t('bombTime', fmtClock(bomb.timeLeft));
      if (this._refs.bombTimer) this._refs.bombTimer.classList.toggle('defusing', !!bomb.defusing);
    } else {
      this._showNode('bombTimer', false);
    }

    /* Mensajes de ronda (RoundManager) ------------------------------------ */
    // Algunos anuncios ya tienen su propio indicador; evitamos duplicarlos.
    let roundMsg = typeof r.message === 'string' ? r.message.trim() : '';
    if (phase === 'over' || phase === 'matchover') roundMsg = '';
    if (/^tiempo de compra/i.test(roundMsg)) roundMsg = '';
    if (/^[¡!]?c4 plantada/i.test(roundMsg)) roundMsg = '';
    if (/^(plantando|desactivando)/i.test(roundMsg)) roundMsg = '';
    if (roundMsg !== this._lastRoundMsg) {
      this._lastRoundMsg = roundMsg;
      this._t('roundMsg', roundMsg);
      const msgNode = this._refs.roundMsg;
      if (msgNode) msgNode.classList.toggle('show', !!roundMsg);
    }

    /* Arma ---------------------------------------------------------------- */
    const weaponName = w.name || w.weaponId || 'SIN ARMA';
    this._t('wpnName', weaponName);
    const wid = String(w.weaponId || '').toLowerCase();
    const melee = wid === 'knife' || wid === 'c4';
    const grenadeSlot = wid === 'he' || wid === 'flash' || wid === 'smoke';
    const ammo = num(w.ammo, 0);
    const reserve = num(w.reserve, 0);
    this._t('ammoMag', melee ? '—' : ammo);
    this._t('ammoRes', melee || grenadeSlot ? '—' : reserve);
    const wpnAmmo = this._refs.wpnAmmo;
    if (wpnAmmo) wpnAmmo.classList.toggle('empty', !melee && !grenadeSlot && ammo <= 0);
    this._renderSlots(w.slots);
    this._renderGrenades(w.grenades);
    this._renderGear(w);

    /* Mira ---------------------------------------------------------------- */
    this._applyCrosshair(ch);

    /* Salud baja ---------------------------------------------------------- */
    if (this._refs.lowhp) {
      this._refs.lowhp.classList.toggle('show', alive && health > 0 && health <= 30);
    }

    /* Radar --------------------------------------------------------------- */
    this._drawRadar(radar);
  }

  _renderSlots(slots) {
    const list = Array.isArray(slots) ? slots : [];
    const key = list.map((s) => `${s && s.slot}:${s && s.id}:${s && s.active ? 1 : 0}`).join('|');
    if (key === this._lastSlotKey) return;
    this._lastSlotKey = key;
    const node = this._refs.slots;
    if (!node) return;
    if (!list.length) {
      node.innerHTML = '';
      return;
    }
    node.innerHTML = list
      .slice(0, 5)
      .map(
        (s) =>
          `<span class="wpn-slot${s && s.active ? ' active' : ''}"><span class="s-num">${esc(s && s.slot)}</span>${esc(
            (s && (s.name || s.id)) || '',
          )}</span>`,
      )
      .join('');
  }

  _renderGrenades(grenades) {
    const list = Array.isArray(grenades) ? grenades : [];
    const key = list.map((g) => `${g && g.id}:${g && g.count}`).join('|');
    if (key === this._lastGrenadeKey) return;
    this._lastGrenadeKey = key;
    const node = this._refs.grenades;
    if (!node) return;
    node.innerHTML = list
      .filter((g) => g && num(g.count, 0) > 0)
      .map((g) => {
        const id = String((g && g.id) || '').toLowerCase();
        const cls = id.includes('he') ? 'he' : id.includes('flash') ? 'flash' : id.includes('smoke') ? 'smoke' : '';
        const short = id.includes('he') ? 'HE' : id.includes('flash') ? 'FLASH' : id.includes('smoke') ? 'SMOKE' : esc((g.name || id || '').slice(0, 7));
        return `<span class="gren-chip ${cls}">${icon('grenade')}${esc(short)} ×${num(g.count, 0)}</span>`;
      })
      .join('');
  }

  _renderGear(w) {
    const hasC4 = !!w.hasC4;
    const hasKit = !!w.hasKit;
    const key = `${hasC4 ? 1 : 0}${hasKit ? 1 : 0}`;
    if (key === this._lastGearKey) return;
    this._lastGearKey = key;
    const node = this._refs.gear;
    if (!node) return;
    let html = '';
    if (hasC4) html += `<span class="gear-chip">${icon('c4')}C4</span>`;
    if (hasKit) html += `<span class="gear-chip kit">${icon('kit')}KIT</span>`;
    node.innerHTML = html;
  }

  _applyCrosshair(ch) {
    const el = this._refs.crosshair;
    if (!el) return;
    const size = clamp(num(ch && ch.size, num(this._settings.crosshairSize, 1)), 0.5, 3);
    const color = (ch && ch.color) || this._settings.crosshairColor || '#78ff63';
    // weapons.currentSpread() devuelve grados de imprecisión (0 = perfecto).
    const spreadDeg = Math.max(0, num(ch && ch.spread, 0));
    const spreadPx = Math.min(26, spreadDeg * 2.0);
    this._applyCrosshairVars(el, { color, size, spreadPx });
    const hidden =
      !!(ch && ch.hidden) ||
      this._buyOpen ||
      this._scoreOpen ||
      this._roundResultOpen ||
      (this._hud && this._hud.alive === false);
    el.classList.toggle('hidden', hidden);
    const scoped =
      !!ch &&
      !!ch.sniper &&
      !this._buyOpen &&
      !this._scoreOpen &&
      !this._roundResultOpen &&
      (!this._hud || this._hud.alive !== false);
    this._setScope(scoped);
  }

  _applyCrosshairVars(el, opts) {
    if (!el) return;
    const size = clamp(num(opts.size, 1), 0.5, 3);
    const spreadPx = clamp(num(opts.spreadPx, 0), 0, 26);
    const gap = Math.max(2, Math.round((4 + spreadPx) * size));
    const len = Math.max(3, Math.round(7 * size));
    const thick = Math.max(1, Math.round(2 * Math.max(0.9, size)));
    const dot = Math.max(1, Math.round(2 * Math.max(0.9, size)));
    el.style.setProperty('--ch-color', opts.color || this._settings.crosshairColor || '#78ff63');
    el.style.setProperty('--ch-gap', `${gap}px`);
    el.style.setProperty('--ch-len', `${len}px`);
    el.style.setProperty('--ch-thick', `${thick}px`);
    el.style.setProperty('--ch-dot', `${dot}px`);
  }

  _setScope(on) {
    const el = this._refs.scope;
    if (!el) return;
    el.classList.toggle('u-hidden', !on);
  }

  setCrosshair(crosshair) {
    this._applyCrosshair(crosshair || {});
  }

  /* ====================================================================== */
  /* Radar                                                                  */
  /* ====================================================================== */

  _drawRadar(radar) {
    const canvas = this._refs.radar;
    const ctx = this._radarCtx;
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const pad = 22;
    ctx.clearRect(0, 0, W, H);

    // Fondo.
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.44, W * 0.05, W * 0.5, H * 0.5, W * 0.72);
    bg.addColorStop(0, '#101a13');
    bg.addColorStop(0.65, '#08110c');
    bg.addColorStop(1, '#040907');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const bounds = (radar && radar.bounds) || { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    const minX = num(bounds.minX, -50);
    const maxX = num(bounds.maxX, 50);
    const minZ = num(bounds.minZ, -50);
    const maxZ = num(bounds.maxZ, 50);
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const sx = (W - pad * 2) / spanX;
    const sz = (H - pad * 2) / spanZ;
    const sAvg = (sx + sz) / 2;
    const tx = (x) => pad + (num(x, 0) - minX) * sx;
    const ty = (z) => pad + (num(z, 0) - minZ) * sz;

    // Grilla.
    ctx.save();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const major = i % 2 === 0;
      ctx.strokeStyle = major ? 'rgba(130,160,125,0.16)' : 'rgba(130,160,125,0.07)';
      const gx = pad + ((W - pad * 2) * i) / 8;
      const gy = pad + ((H - pad * 2) * i) / 8;
      ctx.beginPath();
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, H - pad);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(W - pad, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(190,170,110,0.42)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    ctx.restore();

    // Zona de rescate.
    const rescue = radar && radar.rescueZone;
    if (rescue && Number.isFinite(num(rescue.x, NaN)) && Number.isFinite(num(rescue.z, NaN))) {
      const rz = Math.max(8, num(rescue.radius, 3) * sAvg);
      ctx.save();
      ctx.beginPath();
      ctx.arc(tx(rescue.x), ty(rescue.z), rz, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(134,217,95,0.12)';
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(134,217,95,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Sitios de bomba.
    const sites = (radar && radar.bombsites) || [];
    for (const site of sites) {
      if (!site) continue;
      const bx = tx(site.x);
      const by = ty(site.z);
      const radius = Math.max(11, num(site.radius, 4) * sAvg);
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(211,146,50,0.1)';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(211,146,50,0.6)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f0d9a0';
      ctx.font = 'bold 22px Tahoma, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(site.name || '?'), bx, by + 1);
      ctx.restore();
    }

    // Rehenes.
    const hostages = (radar && radar.hostages) || [];
    for (const hostage of hostages) {
      if (!hostage) continue;
      const hx = tx(hostage.x);
      const hy = ty(hostage.z);
      ctx.save();
      if (hostage.rescued) {
        ctx.fillStyle = 'rgba(134,217,95,0.35)';
      } else {
        ctx.fillStyle = '#a9e58a';
      }
      ctx.beginPath();
      ctx.moveTo(hx, hy - 5);
      ctx.lineTo(hx + 5, hy);
      ctx.lineTo(hx, hy + 5);
      ctx.lineTo(hx - 5, hy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // Bomba plantada.
    const bomb = radar && radar.bomb;
    if (bomb) {
      const blink = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 220));
      const bx = tx(bomb.x);
      const by = ty(bomb.z);
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6a4a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,180,150,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Jugadores.
    const players = (radar && radar.players) || [];
    for (const p of players) {
      if (!p) continue;
      const px = tx(p.x);
      const py = ty(p.z);
      const teamColor = p.team === 'T' ? '#d99b4a' : '#6f9fd8';
      const yaw = num(p.yaw, 0);
      const fx = -Math.sin(yaw);
      const fy = -Math.cos(yaw);
      const rx = -fy;
      const ry = fx;
      if (p.isPlayer) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px + fx * 10, py + fy * 10);
        ctx.lineTo(px - fx * 5 + rx * 6, py - fy * 5 + ry * 6);
        ctx.lineTo(px - fx * 2, py - fy * 2);
        ctx.lineTo(px - fx * 5 - rx * 6, py - fy * 5 - ry * 6);
        ctx.closePath();
        ctx.fillStyle = '#f4eed8';
        ctx.fill();
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = teamColor;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = teamColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (p.hasBomb) {
        ctx.beginPath();
        ctx.arc(px + 6, py - 6, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a52';
        ctx.fill();
      }
    }

    // Coordenadas de esquina.
    ctx.save();
    ctx.fillStyle = 'rgba(160,178,150,0.55)';
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('N', pad + 3, pad + 3);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', W - pad - 3, H - pad - 3);
    ctx.restore();

    if (radar && radar.mapName) this._t('radarMap', radar.mapName);
  }

  /* ====================================================================== */
  /* Overlays del HUD                                                       */
  /* ====================================================================== */

  addKillFeed(entry) {
    const node = this._refs.killfeed;
    if (!node || !entry) return;
    const killer = entry.killer || 'Mundo';
    const victim = entry.victim || '???';
    const killerTeam = entry.killerTeam === 'CT' || entry.killerTeam === 'T' ? entry.killerTeam : '';
    const victimTeam = entry.victimTeam === 'CT' || entry.victimTeam === 'T' ? entry.victimTeam : '';
    const row = document.createElement('div');
    row.className = 'kf-row';
    if (killerTeam) row.classList.add(killerTeam.toLowerCase());
    if (entry.teamKill) row.classList.add('teamkill');
    if (entry.isPlayerVictim) row.classList.add('is-victim');

    const killerCls = `kf-name killer${killerTeam ? ' ' + killerTeam.toLowerCase() : ''}${entry.isPlayerKiller ? ' me' : ''}`;
    const weaponHtml = `<span class="kf-weapon">${weaponSvg(entry.weapon, entry.weapon)}<span>${esc(entry.weapon || '')}</span></span>`;
    const hsHtml = entry.headshot ? `<span class="kf-hs">${icon('skull')}</span>` : '';
    const victimCls = `kf-name victim${victimTeam ? ' ' + victimTeam.toLowerCase() : ''}`;
    row.innerHTML = `<span class="${killerCls}">${esc(killer)}</span>${weaponHtml}${hsHtml}<span class="${victimCls}">${esc(victim)}</span>`;

    node.appendChild(row);
    while (node.children.length > 6) node.removeChild(node.firstElementChild);
    const timer = this._later(() => {
      if (row.parentNode) row.parentNode.removeChild(row);
    }, 6800);
    row.__uiTimer = timer;
  }

  showHitmarker(headshot) {
    const el = this._refs.hitmarker;
    if (!el) return;
    el.classList.remove('show', 'headshot');
    void el.offsetWidth; // reiniciar animación
    this._renderHitmarkerLines();
    el.classList.toggle('headshot', !!headshot);
    el.classList.add('show');
    this._later(() => el.classList.remove('show'), 240);
  }

  _renderHitmarkerLines() {
    // Las líneas viven en el markup inicial; nada que reconstruir salvo que falten.
    const el = this._refs.hitmarker;
    if (el && !el.querySelector('.hm-line')) el.innerHTML = hitmarkerHTML();
  }

  showKillConfirm(headshot) {
    const el = this._refs.killconfirm;
    if (el) {
      el.classList.remove('show', 'headshot');
      void el.offsetWidth;
      el.classList.toggle('headshot', !!headshot);
      el.classList.add('show');
      this._later(() => el.classList.remove('show'), 1200);
    }
    this._t('kcText', headshot ? 'TIRO A LA CABEZA' : 'ELIMINADO');
    if (this._refs.kcText) this._refs.kcText.classList.toggle('amber', !!headshot);
    this.showHitmarker(headshot);
  }

  showDamage(angleDeg) {
    const container = this._refs.damage;
    if (!container) return;
    let rel = num(angleDeg, 0);
    const player = this.game && this.game.player;
    if (player && Number.isFinite(num(player.yaw, NaN))) {
      const yawDeg = (num(player.yaw, 0) * 180) / Math.PI;
      rel = yawDeg + 180 - rel;
    }
    rel = (((rel + 180) % 360) + 360) % 360 - 180;

    const ind = document.createElement('div');
    ind.className = 'dmg-ind';
    ind.style.transform = `rotate(${rel.toFixed(1)}deg)`;
    ind.innerHTML = '<span class="dmg-arc"></span><span class="dmg-dot"></span>';
    container.appendChild(ind);
    while (container.children.length > 6) container.removeChild(container.firstElementChild);
    this._later(() => {
      if (ind.parentNode) ind.parentNode.removeChild(ind);
    }, 1300);
  }

  flash(alpha) {
    this._fadeInOverlay(this._refs.flash, alpha, 2400);
  }

  flashDamage(alpha) {
    this._fadeInOverlay(this._refs.dmgv, alpha, 620);
  }

  _setFlash(alpha) {
    const el = this._refs.flash;
    if (el) {
      el.style.transition = 'none';
      el.style.opacity = String(clamp(num(alpha, 0), 0, 1));
    }
  }

  _setDamageVignette(alpha) {
    const el = this._refs.dmgv;
    if (el) {
      el.style.transition = 'none';
      el.style.opacity = String(clamp(num(alpha, 0), 0, 1));
    }
  }

  _fadeInOverlay(el, alpha, ms) {
    if (!el) return;
    const a = clamp(num(alpha, 0), 0, 1);
    el.style.transition = 'none';
    el.style.opacity = String(a);
    // Forzar reflow y lanzar el fade en el siguiente frame.
    void el.offsetWidth;
    el.style.transition = `opacity ${Math.max(180, num(ms, 900))}ms ease-out`;
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
  }

  showActionProgress(label, progress) {
    const wrap = this._refs.action;
    if (!wrap) return;
    this._t('actionLabel', label || '');
    const pct = clamp(num(progress, 0), 0, 1) * 100;
    if (this._refs.actionFill) this._refs.actionFill.style.width = `${pct.toFixed(1)}%`;
    wrap.classList.toggle('defuse', /desfus|defus|desactiv|rescate|reh[eé]n/i.test(String(label || '')));
    wrap.classList.add('show');
  }

  hideActionProgress() {
    const wrap = this._refs.action;
    if (wrap) wrap.classList.remove('show');
  }

  showRoundBanner(title, subtitle, winner) {
    const banner = this._refs.banner;
    if (!banner) return;
    this._t('bannerTitle', title || '');
    this._t('bannerSub', subtitle || '');
    banner.classList.remove('ct', 't');
    if (winner === 'CT') banner.classList.add('ct');
    else if (winner === 'T') banner.classList.add('t');
    banner.classList.remove('hidden');
    this._clearTimer(this._bannerTimer);
    this._bannerTimer = this._later(() => this.hideRoundBanner(), 3200);
  }

  hideRoundBanner() {
    this._clearTimer(this._bannerTimer);
    this._bannerTimer = null;
    const banner = this._refs.banner;
    if (banner) banner.classList.add('hidden');
  }

  showCenterMessage(text, ms) {
    const el = this._refs.centerMsg;
    if (!el) return;
    this._clearTimer(this._centerTimer);
    if (!text) {
      el.classList.remove('show');
      return;
    }
    el.textContent = String(text);
    el.classList.add('show');
    this._centerTimer = this._later(() => el.classList.remove('show'), Math.max(400, num(ms, 2200)));
  }

  _hideCenterMessage() {
    this._clearTimer(this._centerTimer);
    this._centerTimer = null;
    const el = this._refs.centerMsg;
    if (el) el.classList.remove('show');
    this._t('centerMsg', '');
  }

  toast(text, kind) {
    if (!text) return;
    const box = this._refs.toasts;
    if (!box) return;
    const msg = String(text);
    // Evitar duplicados inmediatos.
    const last = box.lastElementChild;
    if (last && last.dataset.text === msg && performance.now() - num(last.dataset.at, 0) < 900) return;

    const el = document.createElement('div');
    el.className = `toast${kind ? ' ' + kind : ''}`;
    el.dataset.text = msg;
    el.dataset.at = String(performance.now());
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstElementChild);
    this._later(() => {
      el.classList.add('out');
      this._later(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    }, 3400);
  }

  /* ====================================================================== */
  /* Resultado de ronda / fin de partida                                    */
  /* ====================================================================== */

  showRoundResult(data) {
    const d = data || {};
    const scoreCT = num(d.scoreCT, 0);
    const scoreT = num(d.scoreT, 0);
    let winner = d.winner;
    if (winner !== 'CT' && winner !== 'T') winner = scoreCT >= scoreT ? 'CT' : 'T';
    const title = winner === 'CT' ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN';
    const reasonRaw = d.reason == null ? '' : String(d.reason);
    const reason = REASON_MAP[reasonRaw] || reasonRaw;

    this.hideRoundBanner();
    this._t('rrTitle', title);
    if (this._refs.rrTitle) {
      this._refs.rrTitle.classList.remove('ct', 't', 'lose');
      this._refs.rrTitle.classList.add(winner === 'CT' ? 'ct' : 't');
    }
    this._t('rrReason', reason);
    const scoreEl = this._refs.rrScore;
    if (scoreEl) {
      scoreEl.innerHTML =
        `<span class="ct">CT ${scoreCT}</span><span class="sep">:</span><span class="t">${scoreT} T</span>`;
    }
    const inner = this._refs.rrInner;
    if (inner) {
      const playerTeam = d.playerTeam || (this.game && this.game.player && this.game.player.team);
      inner.classList.toggle('lose', !!playerTeam && winner !== playerTeam);
    }
    this._roundResultOpen = true;
    if (this._refs.crosshair) this._refs.crosshair.classList.add('hidden');
    this._setScope(false);
    this._showScreen('roundResult', true);
  }

  hideRoundResult() {
    this._roundResultOpen = false;
    this._showScreen('roundResult', false);
    if (this._hud && this._refs.crosshair && !this._buyOpen && !this._scoreOpen) {
      this._applyCrosshair(this._hud.crosshair || {});
    }
  }

  showMatchEnd(data) {
    const d = data || {};
    const game = this.game;
    const scoreCT = num(d.scoreCT, num(d.scores && d.scores.CT, 0));
    const scoreT = num(d.scoreT, num(d.scores && d.scores.T, 0));
    const playerTeam = d.playerTeam || (game && game.player && game.player.team) || 'CT';
    const draw = !!d.draw || (d.result === 'draw');
    let winner = d.winner || d.matchWinner;
    if (winner !== 'CT' && winner !== 'T') winner = draw || scoreCT === scoreT ? '' : scoreCT > scoreT ? 'CT' : 'T';
    const win = !!winner && winner === playerTeam;
    const matchConfig = (game && game.matchConfig) || this._lastConfig || {};
    const mapId = matchConfig.map || 'de_dust2';
    const mapInfo = MAPS.find((m) => m.id === mapId) || MAPS[0];
    const mapLabel = d.mapName || d.map || mapInfo.label;
    const modeLabel = d.mode === 'hostage' ? 'REHENES' : mapInfo.modeLabel;
    const roundsToWin = num(d.roundsToWin, num(matchConfig.roundsToWin, 8));

    this._hideMenuScreens();
    this._showScreen('scoreboard', false);
    this._showScreen('roundResult', false);
    this._scoreOpen = false;
    this._roundResultOpen = false;
    this._closeConsole(true);
    this.hideHUD();
    this.hideRoundBanner();
    this.hideActionProgress();

    const verdict = this._refs.meVerdict;
    if (verdict) {
      verdict.classList.remove('win', 'lose');
      verdict.classList.toggle('win', win);
      verdict.classList.toggle('lose', !win && !!winner && !draw);
      verdict.textContent = draw ? 'EMPATE' : winner ? (win ? 'VICTORIA' : 'DERROTA') : 'FIN DE LA PARTIDA';
    }
    this._t('meTitle', draw ? 'EMPATE TÉCNICO' : winner === 'CT' ? 'COUNTER-TERRORISTS WIN' : winner === 'T' ? 'TERRORISTS WIN' : 'FIN DE LA PARTIDA');
    if (this._refs.meTitle) {
      this._refs.meTitle.classList.remove('ct', 't');
      if (winner) this._refs.meTitle.classList.add(winner === 'CT' ? 'ct' : 't');
    }
    this._t('meSub', `${mapLabel} · ${modeLabel} · primero a ${roundsToWin} rondas`);
    const scoreEl = this._refs.meScore;
    if (scoreEl) {
      scoreEl.innerHTML = `<div class="me-side ct"><span>CT</span><b>${scoreCT}</b></div><div class="me-dash">:</div><div class="me-side t"><b>${scoreT}</b><span>T</span></div>`;
    }

    // Equipos: data.teams o el scoreboard actual.
    let teams = d.teams;
    if ((!teams || !teams.CT || !teams.T) && game && typeof game.getScoreboardData === 'function') {
      try {
        const sb = game.getScoreboardData();
        if (sb && sb.teams) teams = sb.teams;
      } catch {
        /* ignore */
      }
    }
    const body = this._refs.meBody;
    if (body) {
      const hasTeams = !!(teams && (Array.isArray(teams.CT) || Array.isArray(teams.T)));
      let html = '';
      if (hasTeams) {
        html +=
          '<div class="me-minis">' +
          this._miniTeamHTML('CT', teams.CT || [], scoreCT) +
          this._miniTeamHTML('T', teams.T || [], scoreT) +
          '</div>';
      }
      const player = (game && game.player) || {};
      const stats = d.stats && typeof d.stats === 'object' ? d.stats : {};
      const pstats = stats.player && typeof stats.player === 'object' ? stats.player : {};
      const roundsPlayed = num(d.round, num(player.roundNumber, scoreCT + scoreT));
      const rows = [
        ['Bajas', num(pstats.kills, num(stats.kills, num(player.kills, 0)))],
        ['Muertes', num(pstats.deaths, num(stats.deaths, num(player.deaths, 0)))],
        ['Asistencias', num(pstats.assists, num(stats.assists, num(player.assists, 0)))],
        ['Rondas jugadas', roundsPlayed],
        ['Resultado', draw ? 'Empate' : win ? 'Victoria' : 'Derrota'],
        ['Dinero final', fmtMoney(num(pstats.money, num(stats.money, num(player.money, 0))))],
        ['Mapa', mapLabel],
        ['Modo', modeLabel],
      ];
      html +=
        `<div class="me-mini me-stats"${hasTeams ? '' : ' style="grid-column:1 / -1"'}>` +
        '<h4>Estadísticas</h4>' +
        rows
          .map(([k, v]) => `<div class="me-stat-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
          .join('') +
        '</div>';
      body.innerHTML = html;
    }

    this._showMenuScreen('matchEnd');
  }

  _miniTeamHTML(teamKey, players, score) {
    const list = Array.isArray(players) ? players.slice(0, 8) : [];
    const rows = list
      .map(
        (p) =>
          `<div class="sb-row${p.isPlayer ? ' is-player' : ''}${p.alive === false ? ' dead' : ''}">` +
          `<span class="sbr-name">${esc(p.name || 'Bot')}</span>` +
          `<span class="sbr-kd">${num(p.kills, 0)}</span>` +
          `<span class="sbr-kd deaths">${num(p.deaths, 0)}</span>` +
          `<span class="sbr-money">${fmtMoney(p.money)}</span>` +
          `</div>`,
      )
      .join('');
    return (
      `<div class="me-mini"><h4>${teamKey} · ${score}</h4>` +
      `<div class="sb-cols"><span>JUGADOR</span><span>K</span><span>D</span><span>$</span></div>` +
      `<div>${rows || '<div class="buy-empty">Sin datos</div>'}</div></div>`
    );
  }

  /* ====================================================================== */
  /* Pausa                                                                  */
  /* ====================================================================== */

  showPauseMenu() {
    this._showScreen('scoreboard', false);
    this._scoreOpen = false;
    this._hideMenuScreens();
    this._showPauseScreen();
  }

  _showPauseScreen() {
    const hud = this._hud || {};
    const round = hud.round || {};
    const stats = this._refs.pauseStats;
    if (stats) {
      const scoreCT = num(round.scoreCT, num(hud.scores && hud.scores.CT, 0));
      const scoreT = num(round.scoreT, num(hud.scores && hud.scores.T, 0));
      const roundNumber = num(round.roundNumber, num(round.round, 1)) || 1;
      const mapName = hud.mapName || (this.game && this.game.map && this.game.map.displayName) || 'de_dust2';
      stats.innerHTML =
        `<div class="pause-stat"><span>Ronda</span><b>${roundNumber}</b></div>` +
        `<div class="pause-stat"><span>CT</span><b class="ct">${scoreCT}</b></div>` +
        `<div class="pause-stat"><span>T</span><b class="t">${scoreT}</b></div>` +
        `<div class="pause-stat"><span>Mapa</span><b style="font-size:11px">${esc(mapName)}</b></div>`;
    }
    const canBuy = !!(hud.buy && hud.buy.canBuy);
    this._showNode('pauseBuy', canBuy);
    this._showMenuScreen('pause');
    this._pauseOpen = true;
  }

  hidePauseMenu() {
    this._showScreen('pause', false);
    if (this._screen === 'pause') this._screen = null;
    this._pauseOpen = false;
  }

  /* ====================================================================== */
  /* Buy menu                                                               */
  /* ====================================================================== */

  showBuyMenu(data) {
    let d = data;
    if (!d && this.game && typeof this.game.getBuyMenuData === 'function') {
      try {
        d = this.game.getBuyMenuData();
      } catch {
        d = null;
      }
    }
    this._buyData = d && typeof d === 'object' ? d : { money: 0, team: 'CT', canBuy: false, categories: [] };
    this._showScreen('scoreboard', false);
    this._scoreOpen = false;
    this._hideMenuScreens();
    this._buyOpen = true;
    this._buyCat = 0;
    this._buySel = 0;
    this._buyAutoClosed = false;
    this._buyStartTimeLeft = this._buyTimeLeft();
    this._renderBuy();
    this._screen = 'buy';
    this._showMenuScreen('buy');
    this._buyOpen = true;
  }

  updateBuyMenu(data) {
    if (data && typeof data === 'object') {
      this._buyData = data;
    } else if (this.game && typeof this.game.getBuyMenuData === 'function') {
      try {
        this._buyData = this.game.getBuyMenuData();
      } catch {
        /* ignore */
      }
    }
    if (this._buyOpen) {
      this._renderBuy();
      this._buyOpen = true;
    }
  }

  closeBuyMenu() {
    this._showScreen('buy', false);
    if (this._screen === 'buy') this._screen = null;
    this._buyOpen = false;
    this._buyAutoClosed = false;
  }

  _exitBuyMenu() {
    const game = this.game;
    if (game && typeof game.closeBuyMenu === 'function') {
      game.closeBuyMenu();
    } else {
      this.closeBuyMenu();
      if (game && game.state === 'playing' && typeof game.requestPointerLock === 'function') {
        game.requestPointerLock();
      }
    }
  }

  _buyTimeLeft() {
    const game = this.game;
    const rounds = game && game.rounds;
    let t = rounds ? rounds.buyTimeLeft : null;
    if (t == null && rounds && typeof rounds.getHudState === 'function') {
      try {
        t = rounds.getHudState().buyTimeLeft;
      } catch {
        t = null;
      }
    }
    if (t == null && this._hud && this._hud.round) t = this._hud.round.buyTimeLeft;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  _tickBuyTimer(hud) {
    if (!this._buyOpen) return;
    const raw = hud && hud.round ? hud.round.buyTimeLeft : undefined;
    let t = raw == null ? this._buyTimeLeft() : Number(raw);
    if (!Number.isFinite(t)) t = this._buyTimeLeft();
    if (t == null || !Number.isFinite(t)) {
      this._t('buyTimerVal', '—');
      return;
    }
    const secs = Math.max(0, Math.ceil(t));
    this._t('buyTimerVal', secs > 0 ? `${secs}s` : '0s');
    const timerEl = this._refs.buyTimer;
    if (timerEl) timerEl.classList.toggle('closed', secs <= 0);
    if (secs <= 0 && this._buyStartTimeLeft != null && this._buyStartTimeLeft > 0 && !this._buyAutoClosed) {
      this._buyAutoClosed = true;
      this.toast('Tiempo de compra agotado', 'bad');
      this._exitBuyMenu();
    }
  }

  _renderBuy() {
    const d = this._buyData || {};
    const cats = Array.isArray(d.categories) ? d.categories : [];
    if (this._buyCat >= cats.length) this._buyCat = Math.max(0, cats.length - 1);
    const cat = cats[this._buyCat] || null;
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    if (this._buySel >= items.length) this._buySel = Math.max(0, items.length - 1);

    this._t('buyMoney', fmtMoney(d.money));
    const team = d.team === 'T' ? 'T' : 'CT';
    this._t('buyTeam', team);
    if (this._refs.buyTeam) {
      this._refs.buyTeam.classList.toggle('t', team === 'T');
      this._refs.buyTeam.classList.toggle('ct', team === 'CT');
    }
    this._t('buyCatTitle', cat ? cat.name || 'Categoría' : 'Sin artículos');
    this._t('buyCatDesc', cat ? `${items.length} artículos` : '');
    this._showNode('buyWarning', d.canBuy === false);
    if (d.canBuy === false) this._t('buyWarning', 'FUERA DE ZONA DE COMPRA O TIEMPO AGOTADO');

    const timerVal = this._buyTimeLeft();
    this._t('buyTimerVal', timerVal == null ? '—' : `${Math.max(0, Math.ceil(timerVal))}s`);
    if (this._refs.buyTimer) this._refs.buyTimer.classList.toggle('closed', timerVal != null && timerVal <= 0);

    // Categorías 1-8.
    const catsNode = this._refs.buyCats;
    if (catsNode) {
      if (!cats.length) {
        catsNode.innerHTML = '<div class="buy-empty">Sin categorías</div>';
      } else {
        catsNode.innerHTML = cats
          .map((c, i) => {
            const count = c && Array.isArray(c.items) ? c.items.length : 0;
            return (
              `<button type="button" class="buy-cat${i === this._buyCat ? ' active' : ''}" data-cat-index="${i}">` +
              `<span class="cat-key">${i + 1}</span><span class="cat-name">${esc((c && c.name) || `Categoría ${i + 1}`)}</span>` +
              `<span class="cat-count">${count}</span></button>`
            );
          })
          .join('');
      }
    }

    this._renderBuyItems();
    this._renderBuyDetail();
  }

  _itemStatus(item, money) {
    const price = num(item && item.price, 0);
    if (item && item.owned) return { cls: 'owned', text: 'COMPRADO' };
    if (!item || item.available === false) {
      if (price > money && price > 0) return { cls: 'cant', text: 'SIN DINERO' };
      return { cls: 'locked', text: 'BLOQUEADO' };
    }
    if (price > money) return { cls: 'cant', text: 'SIN DINERO' };
    return { cls: '', text: 'DISPONIBLE' };
  }

  _renderBuyItems() {
    const node = this._refs.buyItems;
    if (!node) return;
    const d = this._buyData || {};
    const money = num(d.money, 0);
    const cats = Array.isArray(d.categories) ? d.categories : [];
    const cat = cats[this._buyCat];
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    if (!items.length) {
      node.innerHTML = '<div class="buy-empty">No hay artículos en esta categoría</div>';
      this._buySel = 0;
      return;
    }
    if (this._buySel < 0) this._buySel = 0;
    if (this._buySel >= items.length) this._buySel = items.length - 1;
    node.innerHTML = items
      .map((item, i) => {
        const status = this._itemStatus(item, money);
        const price = num(item && item.price, 0);
        const team = item && (item.team === 'CT' || item.team === 'T') ? item.team : '';
        const teamBadge = `<span class="item-team${team ? ' ' + team.toLowerCase() : ''}">${team}</span>`;
        const cls = ['buy-item'];
        if (i === this._buySel) cls.push('selected');
        if (status.cls) cls.push(status.cls);
        return (
          `<div class="${cls.join(' ')}" data-item-index="${i}" role="button" tabindex="-1">` +
          `<span class="item-key">${i === this._buySel ? '▸' : '·'}</span>` +
          `<span class="item-icon">${weaponSvg(item && (item.icon || item.id), item && item.name)}</span>` +
          `<span class="item-main"><span class="item-name">${esc((item && item.name) || 'Artículo')}</span>` +
          `<span class="item-desc">${esc((item && item.description) || '')}</span></span>` +
          teamBadge +
          `<span class="item-price">${price > 0 ? fmtMoney(price) : 'GRATIS'}</span>` +
          `<span class="item-status ${status.cls}">${status.text}</span>` +
          `</div>`
        );
      })
      .join('');
  }

  _renderBuyDetail() {
    const node = this._refs.buyDetail;
    const d = this._buyData || {};
    const money = num(d.money, 0);
    const cats = Array.isArray(d.categories) ? d.categories : [];
    const cat = cats[this._buyCat];
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    const item = items[this._buySel];
    if (!node) return;
    if (!item) {
      node.innerHTML = '<div class="detail-main"><div class="detail-name">Elegí un artículo</div><div class="detail-text">Usá las flechas o el mouse para navegar el catálogo.</div></div>';
      return;
    }
    const status = this._itemStatus(item, money);
    const price = num(item.price, 0);
    let hint = 'ENTER o CLIC para comprar';
    if (status.cls === 'owned') hint = 'Ya tenés este artículo';
    else if (status.cls === 'cant') hint = 'No tenés dinero suficiente';
    else if (status.cls === 'locked') hint = 'No disponible para tu equipo';
    node.innerHTML =
      `<div class="detail-icon">${weaponSvg(item.icon || item.id, item.name)}</div>` +
      `<div class="detail-main"><div class="detail-name">${esc(item.name || 'Artículo')}</div>` +
      `<div class="detail-text">${esc(item.description || '')}${price > 0 ? ` · Precio ${fmtMoney(price)}` : ''}</div></div>` +
      `<div class="detail-hint">${hint}</div>`;
  }

  _buySelectCategory(index) {
    const cats = (this._buyData && this._buyData.categories) || [];
    if (!cats.length) return;
    const i = clamp(Math.round(num(index, 0)), 0, cats.length - 1);
    this._buyCat = i;
    this._buySel = 0;
    this._renderBuy();
    if (this._refs.buyItems) this._refs.buyItems.scrollTop = 0;
  }

  _buyMove(delta) {
    const cats = (this._buyData && this._buyData.categories) || [];
    const cat = cats[this._buyCat];
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    if (!items.length) return;
    this._buySel = (this._buySel + num(delta, 1) + items.length) % items.length;
    this._renderBuyItems();
    this._renderBuyDetail();
    const row = this._refs.buyItems && this._refs.buyItems.querySelector(`[data-item-index="${this._buySel}"]`);
    if (row && typeof row.scrollIntoView === 'function') {
      try {
        row.scrollIntoView({ block: 'nearest' });
      } catch {
        /* ignore */
      }
    }
  }

  _buyClickItem(index) {
    const cats = (this._buyData && this._buyData.categories) || [];
    const cat = cats[this._buyCat];
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    if (!items.length) return;
    this._buySel = clamp(Math.round(num(index, 0)), 0, items.length - 1);
    this._renderBuyItems();
    this._renderBuyDetail();
    this._buyBuySelected();
  }

  _buyBuySelected() {
    const cats = (this._buyData && this._buyData.categories) || [];
    const cat = cats[this._buyCat];
    const items = cat && Array.isArray(cat.items) ? cat.items : [];
    const item = items[this._buySel];
    if (!item) return;
    const status = this._itemStatus(item, num(this._buyData && this._buyData.money, 0));
    if (status.cls === 'owned') {
      this.toast('Ya tenés ese artículo', 'info');
      return;
    }
    if (status.cls === 'locked' || status.cls === 'cant') {
      this.toast(status.cls === 'cant' ? 'No tenés dinero suficiente' : 'No disponible', 'bad');
      return;
    }
    const game = this.game;
    if (!game || typeof game.buyItem !== 'function') {
      this.toast('No se puede comprar ahora', 'bad');
      return;
    }
    const keepIndex = this._buySel;
    try {
      game.buyItem(item.id);
    } catch (err) {
      console.warn('[UI] buyItem', err);
      this.toast('Error al comprar', 'bad');
    }
    let fresh = null;
    if (typeof game.getBuyMenuData === 'function') {
      try {
        fresh = game.getBuyMenuData();
      } catch {
        fresh = null;
      }
    }
    if (fresh) {
      this._buyData = fresh;
      this._buySel = keepIndex;
      this._renderBuy();
    } else {
      this._renderBuy();
    }
  }

  /* ====================================================================== */
  /* Scoreboard                                                             */
  /* ====================================================================== */

  openScoreboard(data) {
    this._scoreOpen = true;
    this._renderScoreboard(data);
    this._showScreen('scoreboard', true);
    if (this._refs.crosshair) this._refs.crosshair.classList.add('hidden');
  }

  updateScoreboard(data) {
    if (!this._scoreOpen) return;
    this._renderScoreboard(data);
  }

  closeScoreboard() {
    this._scoreOpen = false;
    this._showScreen('scoreboard', false);
    if (this._hud && !this._buyOpen && !this._roundResultOpen) {
      this._applyCrosshair(this._hud.crosshair || {});
    }
  }

  _renderScoreboard(data) {
    const game = this.game;
    let d = data;
    if (!d && game && typeof game.getScoreboardData === 'function') {
      try {
        d = game.getScoreboardData();
      } catch {
        d = null;
      }
    }
    d = d || {};
    const teams = d.teams || { CT: [], T: [] };
    const scoreCT = num(d.scoreCT, 0);
    const scoreT = num(d.scoreT, 0);
    this._t('sbMap', d.mapName || (game && game.map && game.map.displayName) || 'de_dust2');
    this._t('sbMode', `${d.mode === 'hostage' ? 'REHENES' : 'BOMBARDEO'} · SERVIDOR LOCAL · ${d.phase === 'freeze' ? 'CONGELADO' : d.phase === 'over' ? 'FIN DE RONDA' : 'EN JUEGO'}`);
    this._t('sbRound', `RONDA ${num(d.round, 1)}`);
    this._t('sbScoreCT', scoreCT);
    this._t('sbScoreT', scoreT);
    const node = this._refs.sbTeams;
    if (!node) return;
    node.innerHTML = this._scoreboardTeamHTML('CT', teams.CT || [], scoreCT) + this._scoreboardTeamHTML('T', teams.T || [], scoreT);
  }

  _scoreboardTeamHTML(teamKey, players, score) {
    const list = Array.isArray(players) ? players : [];
    const alive = list.filter((p) => p && p.alive !== false).length;
    const rows = list
      .map((p) => {
        if (!p) return '';
        const isPlayer = !!p.isPlayer;
        const dead = p.alive === false;
        const gear = `${p.hasBomb ? `<span class="sbr-gear" title="C4">${icon('c4')}</span>` : ''}${p.hasKit ? `<span class="sbr-gear kit" title="Kit">${icon('kit')}</span>` : ''}`;
        const ping = clamp(Math.round(num(p.ping, 30)), 1, 999);
        const pingBar = clamp(Math.round(8 - Math.log10(ping) * 2.5), 2, 8);
        return (
          `<div class="sb-row${isPlayer ? ' is-player' : ''}${dead ? ' dead' : ''}">` +
          `<span class="sbr-name"><span class="state${dead ? ' dead' : ''}">${dead ? icon('skull') : icon('person')}</span>` +
          `<span>${esc(p.name || 'Bot')}</span>${gear}</span>` +
          `<span class="sbr-kd">${num(p.kills, 0)}</span>` +
          `<span class="sbr-kd deaths">${num(p.deaths, 0)}</span>` +
          `<span class="sbr-money">${fmtMoney(p.money)}</span>` +
          `<span class="sbr-ping"><span class="ping-bar" style="height:${pingBar}px"></span>${ping}</span>` +
          `<span class="sbr-status ${dead ? 'dead' : 'alive'}">${dead ? 'MUERTO' : 'VIVO'}</span>` +
          `</div>`
        );
      })
      .join('');
    return (
      `<section class="sb-team ${teamKey.toLowerCase()}">` +
      `<div class="sb-team-head"><span class="st-name">${teamKey === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS'}</span>` +
      `<span class="st-alive">${icon('person')}<b>${alive}</b></span>` +
      `<span class="st-score">${score}</span></div>` +
      `<div class="sb-cols"><span>JUGADOR</span><span>K</span><span>D</span><span>$</span><span>PING</span><span>ESTADO</span></div>` +
      `<div class="sb-rows">${rows || '<div class="buy-empty">Sin jugadores</div>'}</div>` +
      `</section>`
    );
  }

  /* ====================================================================== */
  /* Consola                                                                */
  /* ====================================================================== */

  toggleConsole() {
    if (this._consoleOpen) this._closeConsole();
    else this._openConsole();
  }

  _openConsole() {
    if (!this._refs.console) return;
    this._consoleOpen = true;
    this._refs.console.classList.remove('u-hidden');
    this._root.classList.add('console-open');
    this._refs.console.querySelector('[data-console-close]').onclick = () => this._closeConsole();
    this._logConsole('Consola abierta. Escribí "help" para ver los comandos.', 'sys');
    const input = this._refs.consoleInput;
    if (input) {
      setTimeout(() => {
        try {
          input.focus();
        } catch {
          /* ignore */
        }
      }, 30);
    }
    const game = this.game;
    if (game && typeof game.releasePointerLock === 'function') {
      try {
        game.releasePointerLock();
      } catch {
        /* ignore */
      }
    } else if (game && game.input && typeof game.input.exitPointerLock === 'function') {
      try {
        game.input.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
    this._scrollConsole();
  }

  _closeConsole(fromHide) {
    if (!this._consoleOpen) {
      if (this._refs.console) this._refs.console.classList.add('u-hidden');
      return;
    }
    this._consoleOpen = false;
    this._root.classList.remove('console-open');
    if (this._refs.console) this._refs.console.classList.add('u-hidden');
    const input = this._refs.consoleInput;
    if (input) {
      try {
        input.blur();
      } catch {
        /* ignore */
      }
    }
    if (!fromHide) {
      const game = this.game;
      if (game && game.state === 'playing' && !this.isOverlayOpen && typeof game.requestPointerLock === 'function') {
        try {
          game.requestPointerLock();
        } catch {
          /* ignore */
        }
      }
    }
  }

  consoleLog(text) {
    this._logConsole(text);
  }

  _logConsole(text, kind) {
    const out = this._refs.consoleOut;
    if (!out) return;
    const line = document.createElement('div');
    line.className = `console-line${kind ? ' ' + kind : ''}`;
    const elapsed = (Date.now() - this._startTime) / 1000;
    const stamp = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
    line.innerHTML = `<span class="ts">[${stamp}]</span> ${esc(text == null ? '' : String(text))}`;
    out.appendChild(line);
    while (out.children.length > 260) out.removeChild(out.firstElementChild);
    this._scrollConsole();
  }

  _scrollConsole() {
    const out = this._refs.consoleOut;
    if (out) out.scrollTop = out.scrollHeight;
  }

  _runConsoleCommand(raw) {
    const cmd = String(raw == null ? '' : raw).trim();
    if (!cmd) return;
    this._logConsole(`] ${cmd}`, 'sys');
    const parts = cmd.split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    switch (name) {
      case 'help':
        this._logConsole('Comandos disponibles:', 'sys');
        this._logConsole('  help  — muestra esta ayuda');
        this._logConsole('  clear — limpia la consola');
        this._logConsole('  version — versión de DEUSHIMA STRIKE');
        this._logConsole('  fps — fotogramas por segundo, si están disponibles');
        this._logConsole('  netinfo — estado de la sesión online');
        this._logConsole('  settings — ajustes guardados');
        break;
      case 'clear':
      case 'cls':
        if (this._refs.consoleOut) this._refs.consoleOut.innerHTML = '';
        break;
      case 'version':
        this._logConsole('DEUSHIMA STRIKE · Browser Edition · 2026');
        break;
      case 'fps': {
        const fps = this.game?._uiFps;
        this._logConsole(Number.isFinite(fps) ? `${Math.round(fps)} FPS` : 'Contador FPS no disponible en esta sesión.');
        break;
      }
      case 'netinfo': {
        const online = this.game?.onlineSession;
        this._logConsole(`Partida: ${this.game?.state || 'sin iniciar'} · Online: ${online ? 'sesión creada' : 'sin sesión'}`);
        break;
      }
      case 'settings': {
        const s = this.game?.settings || {};
        this._logConsole(`Volumen ${Math.round((Number(s.volume) || 0) * 100)}% · FOV ${s.fov ?? '—'} · Sensibilidad ${s.sensitivity ?? '—'} · HUD ${s.hudTheme === 'classic' ? 'CS 1.6 Classic' : 'GoldSrc Olive'}`);
        break;
      }
      default:
        this._logConsole(`Comando desconocido: "${name}". Probá "help".`, 'err');
        break;
    }
  }

  /* ====================================================================== */
  /* Error fatal                                                            */
  /* ====================================================================== */

  showFatalError(text) {
    this._hideMenuScreens();
    this._showScreen('scoreboard', false);
    this._showScreen('roundResult', false);
    this.hideHUD();
    this._closeConsole(true);
    this._t('fatalMsg', String(text == null ? 'Error desconocido' : text));
    this._showMenuScreen('fatal');
  }
}

export default UI;

