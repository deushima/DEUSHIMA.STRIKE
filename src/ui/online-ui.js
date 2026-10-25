/**
 * DEUSHIMA STRIKE — UI Online PvP
 * -----------------------------------------------------------------------------
 * Módulo independiente de src/ui/ui.js. Se instancia como `game.onlineUI` y se
 * inicializa DESPUÉS de `ui.init()`, porque inyecta el botón ONLINE en el
 * menú principal ya construido y añade su propio overlay dentro de #ui-root.
 *
 * Flujo: menú → home (crear/unirse) → host esperando código → lobby READY →
 * partida (HUD online propio) → fin de partida (revancha/salir).
 *
 * No simula lógica de red ni de partida: delega en `game.onlineSession`,
 * `game.online` y `game.leaveOnline`. Sin assets externos.
 */

/* ========================================================================== */
/* Constantes                                                                 */
/* ========================================================================== */

import { ONLINE_MAPS, DEFAULT_ONLINE_MAP, isOnlineMap, onlineMapLabel } from '../world/online_map_pool.js';

const ONLINE_NAME_KEY = 'cs16-online-name';
const CODE_RE = /^[A-Z2-9]{5}$/;
const VIEWS = ['home', 'host', 'lobby', 'error', 'matchEnd'];
const DEFAULT_TARGET = 13;

const STATUS_DEFAULT = {
  creating: 'CREANDO SALA…',
  waiting: 'ESPERANDO JUGADOR…',
  connecting: 'CONECTANDO…',
  connected: 'CONECTADO',
  error: 'ERROR DE CONEXIÓN',
  closed: 'CONEXIÓN CERRADA',
};

const STATUS_REF = {
  home: { text: 'homeStatus', dot: 'homeStatusDot' },
  host: { text: 'hostStatus', dot: 'hostStatusDot' },
  lobby: { text: 'lobbyStatus', dot: 'lobbyStatusDot' },
  matchEnd: { text: 'endStatus', dot: null },
};

const PEER_ERRORS = {
  'unavailable-id': 'Ese código de sala ya está en uso. Probá crear otra.',
  'peer-unavailable': 'No se encontró la sala. Verificá el código e intentá de nuevo.',
  network: 'Sin conexión con el servidor de emparejamiento. Revisá tu internet.',
  'server-error': 'El servidor de emparejamiento no responde. Intentá más tarde.',
  disconnected: 'Se perdió la conexión con el servidor de emparejamiento.',
  'browser-incompatible': 'Este navegador no soporta conexiones P2P (WebRTC).',
  timeout: 'No se pudo conectar con la sala. Intentá de nuevo.',
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const cleanName = (value) =>
  String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);

const normalizeCode = (value) =>
  String(value == null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 5);

/* ========================================================================== */
/* OnlineUI                                                                   */
/* ========================================================================== */

export class OnlineUI {
  constructor(game) {
    this.game = game || null;

    this._initialized = false;
    this._root = null;
    this._overlay = null;
    this._onlineHud = null;
    this._refs = {};
    this._hudRefs = {};
    this._views = [];
    this._button = null;
    this._screen = null; // 'home'|'host'|'lobby'|'error'|'matchEnd'|null
    this._mode = 'classic';

    this._busy = false;
    this._role = null; // 'host'|'guest'|null
    this._myName = '';
    this._lobby = null;
    this._lastHud = null;
    this._lastMatchEnd = null;
    this._hostCode = '';
    this._hostLink = '';
    this._joinCode = '';
    this._lastStatus = null;
    this._statusKind = 'idle';
    this._creatingHost = false;
    this._opSeq = 0;

    this._listeners = [];
    this._timers = new Set();
    this._injectTimer = null;
    this._readyLockTimer = null;

    this._overlayClick = (event) => this._handleOverlayClick(event);
    this._windowKeydown = (event) => this._handleKeydown(event);
    this._buttonClick = (event) => {
      event.preventDefault();
      this._openFromMenu();
    };
  }

  /* ====================================================================== */
  /* Ciclo de vida                                                          */
  /* ====================================================================== */

  init() {
    if (this._initialized) return this;
    this._root = document.getElementById('ui-root');
    if (!this._root) return this;

    this._buildOverlay();
    this._buildOnlineHud();
    this._ensureMenuButton();
    this._bind();
    this._initialized = true;
    this._loadSavedName();
    this._readInvite();
    return this;
  }

  dispose() {
    this._clearTimers();
    for (const [target, type, fn, opts] of this._listeners) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        /* ignore */
      }
    }
    this._listeners.length = 0;

    if (this._button) {
      try {
        this._button.removeEventListener('click', this._buttonClick);
        this._button.remove();
      } catch {
        /* ignore */
      }
      this._button = null;
    }
    if (this._overlay) {
      try {
        this._overlay.remove();
      } catch {
        /* ignore */
      }
      this._overlay = null;
    }
    if (this._onlineHud) {
      try {
        this._onlineHud.remove();
      } catch {
        /* ignore */
      }
      this._onlineHud = null;
    }
    this._removeMatchClass();
    this._initialized = false;
    this._screen = null;
    this._refs = {};
    this._hudRefs = {};
    this._views = [];
  }

  get isOpen() {
    return this._screen !== null;
  }

  /**
   * El botón ONLINE del menú delega en Game para que cree/recree la
   * OnlineSession antes de mostrar la pantalla de crear/unirse.
   */
  _openFromMenu() {
    const game = this.game;
    if (game && typeof game.openOnlineHome === 'function') {
      try {
        game.openOnlineHome();
        return;
      } catch (err) {
        console.warn('[OnlineUI] openOnlineHome', err);
      }
    }
    this.openHome();
  }

  /* ====================================================================== */
  /* Construcción de DOM                                                    */
  /* ====================================================================== */

  _buildOverlay() {
    if (!this._root || this._overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'online-overlay online-hidden';
    overlay.dataset.onlineOverlay = '';
    overlay.innerHTML = this._overlayMarkup();
    this._root.appendChild(overlay);
    this._overlay = overlay;
    this._refs = {};
    for (const node of overlay.querySelectorAll('[data-online-ref]')) {
      this._refs[node.dataset.onlineRef] = node;
    }
    this._views = [...overlay.querySelectorAll('[data-view]')];
  }

  _buildOnlineHud() {
    if (!this._root || this._onlineHud) return;
    const host = this._root.querySelector('.hud');
    const hud = document.createElement('div');
    hud.className = 'online-hud online-hidden';
    hud.dataset.onlineHud = '';
    hud.innerHTML = this._onlineHudMarkup();
    (host || this._root).appendChild(hud);
    this._onlineHud = hud;
    this._hudRefs = {};
    for (const node of hud.querySelectorAll('[data-oh]')) {
      this._hudRefs[node.dataset.oh] = node;
    }
  }

  _onlineHudMarkup() {
    return `
<div class="oh-bar">
  <div class="oh-side host">
    <span class="oh-role">HOST</span>
    <span class="oh-tag">CT</span>
    <span class="oh-name" data-oh="hostName">—</span>
    <span class="oh-you online-hidden" data-oh="hostYou">VOS</span>
  </div>
  <div class="oh-score">
    <b class="host" data-oh="scoreHost">0</b>
    <span class="oh-sep">:</span>
    <b class="guest" data-oh="scoreGuest">0</b>
  </div>
  <div class="oh-side guest">
    <span class="oh-you online-hidden" data-oh="guestYou">VOS</span>
    <span class="oh-name" data-oh="guestName">—</span>
    <span class="oh-tag">T</span>
    <span class="oh-role">GUEST</span>
  </div>
</div>
<div class="oh-sub">
  <span class="oh-target" data-oh="target">PRIMERO A 13 RONDAS</span>
  <span class="oh-dot">·</span>
  <span class="oh-ping" data-oh="ping">PING —</span>
  <span class="oh-phase online-hidden" data-oh="phase"></span>
  <span class="oh-respawn online-hidden" data-oh="respawn"></span>
</div>`;
  }

  _overlayMarkup() {
    return `
<div class="online-shell">
  <header class="online-head">
    <div class="online-head-left">
      <div class="online-kicker">Multijugador · PeerJS P2P</div>
      <h2 class="online-title">ONLINE <span>1V1 / 2V2</span></h2>
    </div>
    <div class="online-head-meta">
      <span class="online-chip"><b>${ONLINE_MAPS.map((map) => map.label).join(' · ')}</b></span>
      <span class="online-chip">PRIMERO A 13 RONDAS</span>
      <span class="online-chip">RONDA · REINICIO AUTOMÁTICO</span>
    </div>
  </header>

  <!-- ==================== HOME ==================== -->
  <section class="online-view" data-view="home">
    <div class="online-home-grid">
      <article class="online-panel online-panel-create">
        <div class="online-panel-head">
          <span class="online-step">01</span>
          <h3>CREAR SALA</h3>
          <span class="online-panel-tag">HOST</span>
        </div>
        <p class="online-copy">Creá una sala privada y compartí el código. El host puede jugar 1v1 o ampliar el lobby a 2v2.</p>
        <label class="online-field">
          <span class="online-label">TU NOMBRE</span>
          <input class="online-input" data-online-ref="nameInput" data-online-name="host" type="text" maxlength="16" placeholder="Jugador" autocomplete="off" spellcheck="false" />
        </label>
        <button type="button" class="btn primary big online-wide" data-online-ref="createBtn" data-online-action="create">CREAR SALA</button>
        <div class="online-hint">Te damos un código de 5 caracteres para compartir.</div>
      </article>

      <article class="online-panel online-panel-join">
        <div class="online-panel-head">
          <span class="online-step">02</span>
          <h3>UNIRSE</h3>
          <span class="online-panel-tag">GUEST</span>
        </div>
        <p class="online-copy">Pegá el código que te pasaron y usá tu nombre. El host te espera en el lobby.</p>
        <label class="online-field">
          <span class="online-label">CÓDIGO DE SALA</span>
          <input class="online-input online-input-code" data-online-ref="codeInput" type="text" maxlength="5" placeholder="ABC23" autocomplete="off" spellcheck="false" autocapitalize="characters" />
        </label>
        <label class="online-field">
          <span class="online-label">TU NOMBRE</span>
          <input class="online-input" data-online-ref="nameInputJoin" data-online-name="guest" type="text" maxlength="16" placeholder="Jugador" autocomplete="off" spellcheck="false" />
        </label>
        <button type="button" class="btn primary big online-wide" data-online-ref="joinBtn" data-online-action="join">UNIRSE</button>
        <div class="online-hint online-invite online-hidden" data-online-ref="inviteHint">INVITACIÓN DETECTADA · <b data-online-ref="inviteCode"></b></div>
      </article>
    </div>

    <div class="online-statusbar">
      <span class="online-status-dot" data-online-ref="homeStatusDot"></span>
      <span class="online-status-text" data-online-ref="homeStatus">ELEGÃ CREAR O UNIRTE A UNA SALA</span>
    </div>

    <div class="online-info">
      <div class="online-info-col">
        <h4>CÓMO FUNCIONA</h4>
        <ol>
          <li>Uno crea la sala y comparte el código o el link.</li>
          <li>Los demás se unen con ese código.</li>
          <li>Todos pulsan READY en el lobby.</li>
          <li>Gana el primer equipo que alcance el objetivo de rondas.</li>
        </ol>
      </div>
      <div class="online-info-col">
        <h4>REGLAS ONLINE</h4>
        <ul>
          <li>El host elige el mapa de la partida desde el lobby.</li>
          <li>La ronda termina cuando cae un equipo completo.</li>
          <li>Armamento inicial: rifle, pistola y cuchillo; podés recoger armas caídas.</li>
          <li>La siguiente ronda comienza tras una breve pausa.</li>
        </ul>
      </div>
    </div>

    <div class="online-home-foot">
      <span class="online-hint">Conexión P2P directa entre navegadores. Todos los jugadores deben estar online.</span>
      <button type="button" class="btn ghost" data-online-action="back">VOLVER AL MENÚ</button>
    </div>
  </section>

  <!-- ==================== HOST ESPERANDO ==================== -->
  <section class="online-view online-hidden" data-view="host">
    <div class="online-panel online-host-panel">
      <div class="online-panel-head">
        <span class="online-step">✓</span>
        <h3>SALA CREADA</h3>
        <span class="online-panel-tag">HOST</span>
      </div>
      <p class="online-copy">Compartí este código con tus amigos. Elegí 2 o 4 jugadores mientras esperás.</p>
      <div class="online-code-label">CÓDIGO DE SALA</div>
      <div class="online-code" data-online-ref="hostCode">-----</div>
      <div class="online-linkline"><span class="online-link" data-online-ref="hostLink"></span></div>
      <div class="online-host-actions">
        <button type="button" class="btn" data-online-action="copy-code">COPIAR CÓDIGO</button>
        <button type="button" class="btn" data-online-action="copy-link">COPIAR LINK</button>
      </div>
      <label class="online-map-field">
        <span class="online-label">TAMAÑO DE SALA · ELIGE EL HOST</span>
        <select class="online-input online-map-select" data-online-ref="hostMaxPlayersSelect" aria-label="Cantidad de jugadores">
          <option value="2">1V1 · 2 JUGADORES</option>
          <option value="4">2V2 · 4 JUGADORES</option>
          <option value="10">DEATHMATCH · 10 JUGADORES</option>
        </select>
      </label>
      <div class="online-statusbar online-host-status">
        <span class="online-status-dot is-busy" data-online-ref="hostStatusDot"></span>
        <span class="online-status-text" data-online-ref="hostStatus">ESPERANDO JUGADOR…</span>
      </div>
      <div class="online-host-tip">Dejá esta pestaña abierta. Cuando entre el primer jugador, vas a ver el lobby automáticamente.</div>
      <button type="button" class="btn ghost online-wide" data-online-action="back">CANCELAR Y VOLVER</button>
    </div>
  </section>

  <!-- ==================== LOBBY ==================== -->
  <section class="online-view online-hidden" data-view="lobby">
    <div class="online-panel online-lobby-panel">
      <div class="online-lobby-head">
        <div>
          <div class="online-kicker" data-online-ref="lobbyModeLabel">Lobby 1v1</div>
          <h3 data-online-ref="lobbyCode">SALA -----</h3>
        </div>
        <div class="online-lobby-meta">
          <span class="online-chip"><b data-online-ref="lobbyMapName">AIM_MAP</b></span>
          <span class="online-chip">PRIMERO A <b data-online-ref="lobbyTarget">13</b></span>
        </div>
      </div>

      <label class="online-map-field">
        <span class="online-label">MAPA DE LA PARTIDA · ELIGE EL HOST</span>
        <select class="online-input online-map-select" data-online-ref="mapSelect" aria-label="Mapa de la partida">
          ${ONLINE_MAPS.map(map => `<option value="${map.id}">${map.label}</option>`).join('')}
        </select>
      </label>

      <label class="online-map-field">
        <span class="online-label">JUGADORES · ELIGE EL HOST</span>
        <select class="online-input online-map-select" data-online-ref="maxPlayersSelect" aria-label="Cantidad de jugadores">
          <option value="2">1V1 · 2 JUGADORES</option>
          <option value="4">2V2 · 4 JUGADORES</option>
          <option value="10">DEATHMATCH · 10 JUGADORES</option>
        </select>
      </label>

      <div class="online-slots" data-online-ref="slotsGrid">
        <div class="online-slot" data-online-ref="slotHost">
          <div class="slot-top">
            <span class="slot-role">HOST</span>
            <span class="slot-team ct">CT</span>
            <span class="slot-you online-hidden" data-online-ref="hostYou">VOS</span>
          </div>
          <div class="slot-name" data-online-ref="hostName">—</div>
          <div class="slot-state is-pending" data-online-ref="hostReady">PENDIENTE</div>
        </div>
        <div class="online-vs" data-online-ref="slotsVs">VS</div>
        <div class="online-slot" data-online-ref="slotGuest">
          <div class="slot-top">
            <span class="slot-role">GUEST</span>
            <span class="slot-team t">T</span>
            <span class="slot-you online-hidden" data-online-ref="guestYou">VOS</span>
          </div>
          <div class="slot-name" data-online-ref="guestName">ESPERANDO JUGADOR</div>
          <div class="slot-state is-empty" data-online-ref="guestReady">SIN CONECTAR</div>
        </div>
        <div class="online-slot online-hidden" data-online-ref="slotPlayer3">
          <div class="slot-top">
            <span class="slot-role">JUGADOR 3</span>
            <span class="slot-team ct">CT</span>
            <span class="slot-you online-hidden" data-online-ref="player3You">VOS</span>
          </div>
          <div class="slot-name" data-online-ref="player3Name">ESPERANDO JUGADOR</div>
          <div class="slot-state is-empty" data-online-ref="player3Ready">SIN CONECTAR</div>
        </div>
        <div class="online-slot online-hidden" data-online-ref="slotPlayer4">
          <div class="slot-top">
            <span class="slot-role">JUGADOR 4</span>
            <span class="slot-team t">T</span>
            <span class="slot-you online-hidden" data-online-ref="player4You">VOS</span>
          </div>
          <div class="slot-name" data-online-ref="player4Name">ESPERANDO JUGADOR</div>
          <div class="slot-state is-empty" data-online-ref="player4Ready">SIN CONECTAR</div>
        </div>
      </div>

      <div class="online-statusbar online-lobby-status">
        <span class="online-status-dot" data-online-ref="lobbyStatusDot"></span>
        <span class="online-status-text" data-online-ref="lobbyStatus">ESPERANDO AL OTRO JUGADOR…</span>
      </div>

      <div class="online-lobby-actions">
        <button type="button" class="btn primary big" data-online-ref="readyBtn" data-online-action="ready" aria-pressed="false">READY</button>
        <button type="button" class="btn" data-online-action="copy-code">COPIAR CÓDIGO</button>
        <button type="button" class="btn" data-online-action="copy-link">COPIAR LINK</button>
        <button type="button" class="btn ghost" data-online-action="leave">SALIR</button>
      </div>
      <div class="online-lobby-tip" data-online-ref="lobbyTip">Cuando ambos estén LISTOS, la partida empieza automáticamente.</div>
    </div>
  </section>

  <!-- ==================== ERROR ==================== -->
  <section class="online-view online-hidden" data-view="error">
    <div class="online-panel online-error-panel">
      <div class="online-error-icon">!</div>
      <div class="online-kicker">Online 1v1 / 2v2</div>
      <h3 class="online-error-title">NO SE PUDO CONECTAR</h3>
      <p class="online-error-msg" data-online-ref="errorMsg">Revisá tu conexión e intentá de nuevo.</p>
      <div class="online-error-actions">
        <button type="button" class="btn primary big" data-online-action="leave">VOLVER AL MENÚ</button>
      </div>
      <div class="online-hint">Si el problema persiste, probá con otro código de sala o revisá que PeerJS no esté bloqueado.</div>
    </div>
  </section>

  <!-- ==================== FIN DE PARTIDA ==================== -->
  <section class="online-view online-hidden" data-view="matchEnd">
    <div class="online-panel online-end-panel">
      <div class="online-kicker" data-online-ref="endKicker">ONLINE 1V1 · FIN DE PARTIDA</div>
      <h3 class="online-end-title" data-online-ref="endTitle">PARTIDA FINALIZADA</h3>
      <div class="online-end-winner" data-online-ref="endWinner">—</div>
      <div class="online-end-score">
        <span class="online-end-name" data-online-ref="endHostName">HOST</span>
        <b class="host" data-online-ref="endScoreHost">0</b>
        <span class="online-end-sep">:</span>
        <b class="guest" data-online-ref="endScoreGuest">0</b>
        <span class="online-end-name" data-online-ref="endGuestName">GUEST</span>
      </div>
      <div class="online-end-status" data-online-ref="endStatus"></div>
      <div class="online-end-actions">
        <button type="button" class="btn primary big online-hidden" data-online-ref="rematchBtn" data-online-action="rematch">REVANCHA</button>
        <button type="button" class="btn" data-online-action="leave">SALIR AL MENÚ</button>
      </div>
    </div>
  </section>

  <footer class="online-foot">
    <span>CONEXIÓN DIRECTA ENTRE JUGADORES</span>
    <span>DEUSHIMA STRIKE</span>
  </footer>
</div>`;
  }

  /* ====================================================================== */
  /* Inyección del botón en el menú principal                               */
  /* ====================================================================== */

  _ensureMenuButton() {
    if (this._button && this._button.isConnected) return;
    const nav = this._root && this._root.querySelector('.menu-left nav');
    if (!nav) {
      this._scheduleInject();
      return;
    }
    this._clearInjectTimer();
    const existing = nav.querySelector('[data-action="online-play"]');
    if (existing) {
      if (this._button && this._button !== existing) {
        try {
          this._button.removeEventListener('click', this._buttonClick);
        } catch {
          /* ignore */
        }
      }
      if (this._button !== existing) existing.addEventListener('click', this._buttonClick);
      this._button = existing;
      this._renumberMenu(nav);
      return;
    }
    const play = nav.querySelector('[data-action="main-play"]');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.dataset.action = 'online-play';
    btn.innerHTML = '<span class="mb-index">02</span>ONLINE<span class="mb-hint">1V1 / 2V2</span>';
    btn.addEventListener('click', this._buttonClick);
    if (play && typeof play.after === 'function') {
      play.after(btn);
    } else if (play && play.parentNode) {
      play.parentNode.appendChild(btn);
    } else {
      nav.appendChild(btn);
    }
    this._button = btn;
    this._renumberMenu(nav);
  }

  _renumberMenu(nav) {
    const buttons = nav.querySelectorAll('.menu-btn');
    buttons.forEach((button, index) => {
      const tag = button.querySelector('.mb-index');
      if (tag) tag.textContent = String(index + 1).padStart(2, '0');
    });
  }

  _scheduleInject() {
    if (this._injectTimer) return;
    let tries = 0;
    this._injectTimer = setInterval(() => {
      tries++;
      if (!this._root) return;
      const nav = this._root.querySelector('.menu-left nav');
      if (nav) {
        this._clearInjectTimer();
        this._ensureMenuButton();
      } else if (tries > 50) {
        this._clearInjectTimer();
      }
    }, 100);
    this._timers.add(this._injectTimer);
  }

  _clearInjectTimer() {
    if (this._injectTimer) {
      clearInterval(this._injectTimer);
      this._timers.delete(this._injectTimer);
      this._injectTimer = null;
    }
  }

  /* ====================================================================== */
  /* Listeners                                                              */
  /* ====================================================================== */

  _bind() {
    this._on(this._overlay, 'click', this._overlayClick);
    this._on(window, 'keydown', this._windowKeydown);
    this._on(this._refs.mapSelect, 'change', () => {
      const session = this._session();
      const map = this._refs.mapSelect?.value;
      if (this._screen === 'lobby' && this._roleNow() === 'host' && isOnlineMap(map)) {
        if (!session?.setMap?.(map)) this._renderLobby();
      } else this._renderLobby();
    });
    for (const select of [this._refs.hostMaxPlayersSelect, this._refs.maxPlayersSelect]) {
      this._on(select, 'change', () => this._changeMaxPlayers(select));
    }

    for (const input of [this._refs.nameInput, this._refs.nameInputJoin]) {
      if (!input) continue;
      this._on(input, 'input', () => this._syncNames(input));
      this._on(input, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (this._refs.codeInput && this._refs.codeInput.value) this._join();
        else this._create();
      });
    }

    if (this._refs.nameInputJoin) {
      this._on(this._refs.nameInputJoin, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this._join();
      });
    }

    if (this._refs.codeInput) {
      this._on(this._refs.codeInput, 'input', () => {
        const input = this._refs.codeInput;
        const clean = normalizeCode(input.value);
        if (input.value !== clean) input.value = clean;
      });
      this._on(this._refs.codeInput, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this._join();
      });
    }
  }

  _changeMaxPlayers(select) {
    if (!select) return;
    const session = this._session();
    const next = this._mode === 'deathmatch' ? 10 : Number(select.value) === 4 ? 4 : 2;
    if (this._roleNow() !== 'host' || typeof session?.setMaxPlayers !== 'function') {
      this._syncMaxPlayersSelects();
      return;
    }
    if (!session.setMaxPlayers(next)) this._syncMaxPlayersSelects();
  }

  _on(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      try {
        fn();
      } catch (err) {
        console.warn('[OnlineUI]', err);
      }
    }, ms);
    this._timers.add(id);
    return id;
  }

  _clearTimers() {
    this._clearInjectTimer();
    this._clearTimer(this._readyLockTimer);
    this._readyLockTimer = null;
    for (const id of this._timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this._timers.clear();
  }

  _clearTimer(id) {
    if (!id) return;
    clearTimeout(id);
    this._timers.delete(id);
  }

  _handleOverlayClick(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    const button = target.closest('[data-online-action]');
    if (!button || !this._overlay || !this._overlay.contains(button)) return;
    event.preventDefault();
    this._sfx('ui_click');
    const action = button.dataset.onlineAction;
    switch (action) {
      case 'create':
        this._create();
        break;
      case 'join':
        this._join();
        break;
      case 'back':
        this._back();
        break;
      case 'leave':
        this._leaveToMenu();
        break;
      case 'copy-code':
        this._copyCode(button);
        break;
      case 'copy-link':
        this._copyLink(button);
        break;
      case 'ready':
        this._toggleReady();
        break;
      case 'rematch':
        this._requestRematch();
        break;
      default:
        break;
    }
  }

  _handleKeydown(event) {
    if (!this._screen || event.repeat) return;
    if (event.key !== 'Escape') return;
    if (this._screen === 'matchEnd') return; // hay que elegir REVANCHA o SALIR
    event.preventDefault();
    if (this._screen === 'home') this._back();
    else this._leaveToMenu();
  }

  _syncNames(source) {
    if (!source) return;
    const value = cleanName(source.value).slice(0, 16);
    for (const input of [this._refs.nameInput, this._refs.nameInputJoin]) {
      if (input && input !== source && input.value !== value) input.value = value;
    }
  }

  /* ====================================================================== */
  /* Vistas                                                                 */
  /* ====================================================================== */

  _setView(name) {
    if (!this._overlay) return;
    this._screen = name || null;
    this._overlay.classList.remove('online-hidden');
    if (name) this._overlay.dataset.view = name;
    for (const view of this._views) {
      view.classList.toggle('online-hidden', view.dataset.view !== name);
    }
  }

  _closeOverlay() {
    if (this._overlay) this._overlay.classList.add('online-hidden');
    this._screen = null;
    this._setBusy(false);
    try {
      const active = document.activeElement;
      if (active && this._overlay && this._overlay.contains(active) && typeof active.blur === 'function') active.blur();
    } catch {
      /* ignore */
    }
  }

  _addMatchClass() {
    document.documentElement.classList.add('online-match');
  }

  _removeMatchClass() {
    document.documentElement.classList.remove('online-match');
  }

  _showOnlineHud() {
    if (this._onlineHud) this._onlineHud.classList.remove('online-hidden');
  }

  _hideOnlineHud() {
    if (this._onlineHud) this._onlineHud.classList.add('online-hidden');
  }

  _setText(name, text) {
    const node = this._refs[name];
    if (!node) return;
    const value = text == null ? '' : String(text);
    if (node.textContent !== value) node.textContent = value;
  }

  _setHudText(name, text) {
    const node = this._hudRefs[name];
    if (!node) return;
    const value = text == null ? '' : String(text);
    if (node.textContent !== value) node.textContent = value;
  }

  _showNode(name, visible) {
    const node = this._refs[name];
    if (!node) return;
    node.classList.toggle('online-hidden', !visible);
  }

  _setStatus(message, kind) {
    this._statusKind = kind || 'idle';
    const ref = STATUS_REF[this._screen || 'home'] || STATUS_REF.home;
    this._setText(ref.text, message || '');
    if (ref.dot) {
      const dot = this._refs[ref.dot];
      if (dot) {
        dot.className = `online-status-dot${kind ? ` is-${kind}` : ''}`;
      }
    }
  }

  _setBusy(busy) {
    this._busy = !!busy;
    for (const name of ['createBtn', 'joinBtn']) {
      const button = this._refs[name];
      if (button) button.disabled = this._busy;
    }
    for (const name of ['nameInput', 'nameInputJoin', 'codeInput']) {
      const input = this._refs[name];
      if (input) input.readOnly = this._busy;
    }
  }

  /* ====================================================================== */
  /* Home                                                                   */
  /* ====================================================================== */

  openHome(mode = 'classic') {
    if (!this._initialized) this.init();
    this._mode = mode === 'deathmatch' ? 'deathmatch' : 'classic';
    this._applyModeView();
    this._opSeq++;
    this._ensureMenuButton();
    this._resetLocalState();
    this._loadSavedName();
    this._readInvite();
    this._setBusy(false);
    this._removeMatchClass();
    this._hideOnlineHud();
    this._setView('home');
    this._setStatus('ELEGÃ CREAR O UNIRTE A UNA SALA', 'idle');
    try {
      this.game?.ui?.hideAll?.();
    } catch (err) {
      console.warn('[OnlineUI] hideAll', err);
    }
    this._releaseLock();
    this._later(() => {
      const codeInput = this._refs.codeInput;
      const target = codeInput && codeInput.value ? codeInput : this._refs.nameInput;
      try {
        target?.focus?.();
      } catch {
        /* ignore */
      }
    }, 80);
  }

  _resetLocalState() {
    this._clearTimer(this._readyLockTimer);
    this._readyLockTimer = null;
    this._creatingHost = false;
    this._role = null;
    this._lobby = null;
    this._lastHud = null;
    this._lastMatchEnd = null;
    this._hostCode = '';
    this._hostLink = '';
    this._joinCode = '';
    this._busy = false;
    this._lastStatus = null;
    const rematch = this._refs.rematchBtn;
    if (rematch) {
      rematch.disabled = false;
      rematch.textContent = 'REVANCHA';
    }
  }

  _applyModeView() {
    if (!this._overlay) return;
    const dm = this._mode === 'deathmatch';
    this._overlay.classList.toggle('is-deathmatch', dm);
    const title = this._overlay.querySelector('.online-title');
    if (title) title.textContent = dm ? 'DEATHMATCH ONLINE' : 'ONLINE 1V1 / 2V2';
    const mapList = this._overlay.querySelector('.online-head-meta .online-chip b');
    if (mapList) mapList.textContent = dm
      ? 'DUST2 · DEATHMATCH'
      : ONLINE_MAPS.filter((map) => map.id !== 'de_dust2_dm').map((map) => map.label).join(' · ');
    const chips = this._overlay.querySelectorAll('.online-head-meta .online-chip');
    if (chips[1]) chips[1].textContent = dm ? 'HASTA 10 JUGADORES' : 'PRIMERO A 13 RONDAS';
    if (chips[2]) chips[2].textContent = dm ? 'RESPAWN CONTINUO' : 'RONDA · REINICIO AUTOMÁTICO';
    this._refs.lobbyTarget?.closest('.online-chip')?.classList.toggle('online-hidden', dm);
    const createCopy = this._overlay.querySelector('.online-panel-create .online-copy');
    if (createCopy) createCopy.textContent = dm
      ? 'Creá una sala Deathmatch de hasta 10 participantes. Compartí el código o enlace para invitarlos.'
      : 'Creá una sala privada y compartí el código. El host puede jugar 1v1 o ampliar el lobby a 2v2.';
    const hostCopy = this._overlay.querySelector('.online-host-panel .online-copy');
    if (hostCopy) hostCopy.textContent = dm
      ? 'Sala Deathmatch: hasta 10 jugadores. Compartí el enlace para que se unan tus amigos.'
      : 'Compartí este código con tus amigos. Elegí 2 o 4 jugadores mientras esperás.';
    for (const select of [this._refs.maxPlayersSelect, this._refs.hostMaxPlayersSelect]) {
      if (!select) continue;
      for (const opt of select.options) opt.hidden = dm ? opt.value !== '10' : opt.value === '10';
      if (dm) select.value = '10';
    }
    const rules = this._overlay.querySelectorAll('.online-info li');
    if (rules.length >= 8) {
      rules[3].textContent = dm ? 'Todos compiten en Deathmatch, con respawn rápido y sin rondas.' : 'Gana el primer equipo que alcance el objetivo de rondas.';
      rules[5].textContent = dm ? 'La partida sigue aunque un jugador sea eliminado.' : 'La ronda termina cuando cae un equipo completo.';
      rules[7].textContent = dm ? 'Respawn en distintos puntos del mapa.' : 'La siguiente ronda comienza tras una breve pausa.';
    }
    if (this._refs.mapSelect) {
      for (const opt of this._refs.mapSelect.options) opt.hidden = dm ? opt.value !== 'de_dust2_dm' : opt.value === 'de_dust2_dm';
      if (dm) this._refs.mapSelect.value = 'de_dust2_dm';
    }
  }

  _readName() {
    let value = '';
    if (this._refs.nameInput) value = this._refs.nameInput.value;
    if (!value && this._refs.nameInputJoin) value = this._refs.nameInputJoin.value;
    if (!value) value = this._myName;
    return cleanName(value);
  }

  _setNamesValue(name) {
    const value = cleanName(name);
    for (const input of [this._refs.nameInput, this._refs.nameInputJoin]) {
      if (input && input.value !== value) input.value = value;
    }
  }

  _loadSavedName() {
    let saved = '';
    try {
      saved = localStorage.getItem(ONLINE_NAME_KEY) || '';
    } catch {
      /* ignore */
    }
    const name = cleanName(saved) || 'Jugador';
    this._myName = name;
    this._setNamesValue(name);
  }

  _saveName(name) {
    this._myName = name;
    try {
      localStorage.setItem(ONLINE_NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }

  _readInvite() {
    let code = '';
    try {
      const params = new URLSearchParams(window.location.search || '');
      code = normalizeCode(params.get('join') || '');
    } catch {
      code = '';
    }
    this._joinCode = code;
    if (code) {
      if (this._refs.codeInput) this._refs.codeInput.value = code;
      this._setText('inviteCode', code);
      this._showNode('inviteHint', true);
    } else {
      this._showNode('inviteHint', false);
    }
  }

  /* ====================================================================== */
  /* Crear / unirse                                                         */
  /* ====================================================================== */

  async _create() {
    if (this._busy) return;
    const name = this._readName();
    if (!name) {
      this._setStatus('ESCRIBÃ UN NOMBRE PARA JUGAR', 'error');
      this._focusName();
      return;
    }
    const token = ++this._opSeq;
    this._saveName(name);
    this._setBusy(true);
    this._setView('home');
    this._setStatus('CREANDO SALA…', 'busy');
    this._creatingHost = true;

    const session = this._session();
    if (!session || typeof session.host !== 'function') {
      this._creatingHost = false;
      this.showError('El modo online no está disponible en este momento.');
      return;
    }

    try {
      const result = await session.host(name, this._mode === 'deathmatch'
        ? { mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm' }
        : { maxPlayers: 2 });
      if (token !== this._opSeq) return;
      this._creatingHost = false;
      const code = normalizeCode((result && result.code) || this._sessionCode(session) || '');
      if (!code || !CODE_RE.test(code)) {
        throw new Error('No se pudo obtener un código de sala válido.');
      }
      this._role = 'host';
      this._hostCode = code;
      this._hostLink = (result && result.link) || this._buildLink(code);
      this._setBusy(false);
      const lobby = this._sessionLobby(session);
      // session.host() emite un lobby con guest=null; el host debe ver primero
      // su código grande y esperar ahí hasta que entre el rival.
      if (lobby && lobby.guest) {
        this.showLobby(lobby);
        return;
      }
      if (lobby) this._lobby = lobby;
      this._showHost();
    } catch (err) {
      if (token !== this._opSeq) return; // cancelado desde la UI
      this._creatingHost = false;
      this._setBusy(false);
      this.showError(this._friendlyError(err));
    }
  }

  async _join() {
    if (this._busy) return;
    const name = this._readName();
    const raw = this._refs.codeInput ? this._refs.codeInput.value : '';
    const code = normalizeCode(raw);
    if (!name) {
      this._setStatus('ESCRIBÃ UN NOMBRE PARA JUGAR', 'error');
      this._focusName();
      return;
    }
    if (!CODE_RE.test(code)) {
      this._setStatus('CÓDIGO INVÁLIDO · 5 CARACTERES A-Z / 2-9', 'error');
      try {
        this._refs.codeInput?.focus?.();
      } catch {
        /* ignore */
      }
      return;
    }
    const token = ++this._opSeq;
    this._saveName(name);
    this._joinCode = code;
    this._setBusy(true);
    this._setView('home');
    this._setStatus('CONECTANDO…', 'busy');

    const session = this._session();
    if (!session || typeof session.join !== 'function') {
      this.showError('El modo online no está disponible en este momento.');
      return;
    }

    try {
      await session.join(code, name);
      if (token !== this._opSeq) return; // cancelado desde la UI
      this._role = this._roleNow() || 'guest';
      if (!this._hostCode) this._hostCode = code;
      this._setBusy(false);
      const lobby = this._sessionLobby(session);
      if (lobby) this.showLobby(lobby);
      else {
        this._lobby = {
          code,
          targetKills: DEFAULT_TARGET,
          host: null,
          guest: { name, ready: false, connected: true },
        };
        this._setView('lobby');
        this._renderLobby();
        this._setStatus('CONECTADO · ESPERANDO LOBBY…', 'busy');
      }
    } catch (err) {
      if (token !== this._opSeq) return; // cancelado desde la UI
      this._setBusy(false);
      this.showError(this._friendlyError(err));
    }
  }

  _focusName() {
    try {
      this._refs.nameInput?.focus?.();
    } catch {
      /* ignore */
    }
  }

  _showHost() {
    this._setView('host');
    this._setText('hostCode', this._hostCode || '-----');
    this._setText('hostLink', this._hostLink || '');
    this._syncMaxPlayersSelects();
    this._setStatus('ESPERANDO JUGADOR…', 'busy');
  }

  /* ====================================================================== */
  /* Lobby                                                                  */
  /* ====================================================================== */

  showLobby(lobby) {
    if (!lobby || typeof lobby !== 'object') return;
    this._mode = lobby.mode === 'deathmatch' ? 'deathmatch' : 'classic';
    this._applyModeView();
    this._lobby = lobby;
    this._resolveRole(lobby);
    const hasRemotePlayer = this._lobbyPlayers(lobby).some((player) => !player.isHost && player.slot !== 0);
    // El host conserva la pantalla con el código hasta que entre el primer rival.
    if ((this._creatingHost || this._screen === 'host') && this._role === 'host' && !hasRemotePlayer) {
      this._syncMaxPlayersSelects();
      return;
    }
    const wasLobby = this._screen === 'lobby';
    this._setBusy(false);
    // Actualizaciones de READY/lobby mientras ya estamos en el lobby: sólo
    // refrescamos datos para no reiniciar la vista ni soltar el pointer lock.
    if (wasLobby) {
      this._renderLobby();
      return;
    }
    this._clearTimer(this._readyLockTimer);
    this._readyLockTimer = null;
    this._removeMatchClass();
    this._hideOnlineHud();
    try {
      this.game?.ui?.hideAll?.();
    } catch (err) {
      console.warn('[OnlineUI] hideAll', err);
    }
    this._setView('lobby');
    this._renderLobby();
    this._releaseLock();
  }

  updateLobby(lobby) {
    if (!lobby || typeof lobby !== 'object') return;
    this._mode = lobby.mode === 'deathmatch' ? 'deathmatch' : 'classic';
    this._applyModeView();
    this._lobby = lobby;
    this._resolveRole(lobby);
    if (this._screen !== 'lobby') this.showLobby(lobby);
    else this._renderLobby();
  }

  _resolveRole(lobby) {
    let role = this._roleNow();
    if (role !== 'host' && role !== 'guest') role = this._role;
    if (role !== 'host' && role !== 'guest') {
      const myName = this._myName || this._readName();
      if (myName && lobby?.host?.name === myName) role = 'host';
      else if (myName && lobby?.guest?.name === myName) role = 'guest';
    }
    if (role === 'host' || role === 'guest') this._role = role;
  }

  _sessionPlayerId() {
    const session = this._session();
    if (!session) return '';
    try {
      return session.localPlayerId ? String(session.localPlayerId) : '';
    } catch {
      return '';
    }
  }

  _lobbyPlayers(lobby = this._lobby) {
    if (!lobby || typeof lobby !== 'object') return [];
    let players = [];
    if (Array.isArray(lobby.players)) players = lobby.players.filter(Boolean);
    else if (lobby.roster && typeof lobby.roster === 'object') players = Object.values(lobby.roster).filter(Boolean);
    else players = [lobby.host, lobby.guest].filter(Boolean);
    return [...players].sort((a, b) => num(a?.slot, 99) - num(b?.slot, 99));
  }

  _localLobbyPlayer(lobby = this._lobby) {
    const players = this._lobbyPlayers(lobby);
    const playerId = this._sessionPlayerId();
    if (playerId) {
      const byId = players.find((player) => player?.id === playerId);
      if (byId) return byId;
    }
    const role = this._roleNow() || this._role;
    if (role === 'host') return players.find((player) => player?.isHost || player?.slot === 0) || lobby?.host || null;
    if (role === 'guest') {
      const myName = this._myName || this._readName();
      return players.find((player) => !player?.isHost && player?.name === myName) || lobby?.guest || null;
    }
    return null;
  }

  _syncMaxPlayersSelects() {
    const lobby = this._lobby || this._sessionLobby(this._session());
    const maxPlayers = this._mode === 'deathmatch' ? 10 : Number(lobby?.maxPlayers) === 4 ? 4 : 2;
    const isHost = (this._roleNow() || this._role) === 'host';
    for (const select of [this._refs.hostMaxPlayersSelect, this._refs.maxPlayersSelect]) {
      if (!select) continue;
      select.value = String(maxPlayers);
      select.disabled = !isHost || this._mode === 'deathmatch';
    }
  }

  _ensureDeathmatchSlots() {
    const grid = this._refs.slotsGrid;
    if (!grid) return;
    for (let index = 5; index <= 10; index++) {
      if (this._refs[`slotPlayer${index}`]) continue;
      const node = document.createElement('div');
      node.className = 'online-slot online-hidden';
      node.dataset.onlineRef = `slotPlayer${index}`;
      node.innerHTML = `
        <div class="slot-top">
          <span class="slot-role">JUGADOR ${index}</span>
          <span class="slot-team">FFA</span>
          <span class="slot-you online-hidden" data-online-ref="player${index}You">VOS</span>
        </div>
        <div class="slot-name" data-online-ref="player${index}Name">ESPERANDO JUGADOR</div>
        <div class="slot-state is-empty" data-online-ref="player${index}Ready">SIN CONECTAR</div>`;
      grid.appendChild(node);
      this._refs[`slotPlayer${index}`] = node;
      for (const child of node.querySelectorAll('[data-online-ref]')) {
        this._refs[child.dataset.onlineRef] = child;
      }
    }
  }

  _renderLobby() {
    const lobby = this._lobby || {};
    const role = this._role;
    const players = this._lobbyPlayers(lobby);
    const maxPlayers = this._mode === 'deathmatch' ? 10 : Number(lobby.maxPlayers) === 4 ? 4 : 2;
    const host = players.find((player) => player?.isHost || player?.slot === 0) || lobby.host || null;
    const guest = players.find((player) => player?.slot === 1) || lobby.guest || null;
    const player3 = players.find((player) => player?.slot === 2) || null;
    const player4 = players.find((player) => player?.slot === 3) || null;
    const local = this._localLobbyPlayer(lobby);
    const localId = local?.id || '';
    const code = this._lobbyCode(lobby);
    const target = num(lobby.targetKills, DEFAULT_TARGET) || DEFAULT_TARGET;

    this._setText('lobbyCode', `SALA ${code || '-----'}`);
    this._setText('lobbyTarget', target);
    this._setText('lobbyModeLabel', this._mode === 'deathmatch' ? 'DEATHMATCH · HASTA 10' : maxPlayers === 4 ? 'Lobby 2v2' : 'Lobby 1v1');
    this._setText(
      'lobbyTip',
      this._mode === 'deathmatch'
        ? 'El host inicia la partida cuando hay al menos 2 jugadores conectados y todos están LISTOS.'
        : maxPlayers === 4
        ? 'Cuando los 4 jugadores estén LISTOS, la partida empieza automáticamente.'
        : 'Cuando ambos estén LISTOS, la partida empieza automáticamente.',
    );
    const map = isOnlineMap(lobby.map) ? lobby.map : DEFAULT_ONLINE_MAP;
    this._setText('lobbyMapName', onlineMapLabel(map));
    if (this._refs.mapSelect) {
      this._refs.mapSelect.value = map;
      this._refs.mapSelect.disabled = role !== 'host' || this._mode === 'deathmatch';
    }
    this._syncMaxPlayersSelects();
    this._ensureDeathmatchSlots();
    if (this._refs.slotsGrid) {
      this._refs.slotsGrid.style.gridTemplateColumns = maxPlayers >= 4
        ? 'repeat(2, minmax(0, 1fr))'
        : '';
    }
    if (this._refs.slotsVs) this._refs.slotsVs.classList.toggle('online-hidden', maxPlayers >= 4);
    for (const key of ['slotPlayer3', 'slotPlayer4']) {
      const node = this._refs[key];
      if (node) node.classList.toggle('online-hidden', maxPlayers < 4);
    }
    this._renderSlot('host', host, !!host && (localId ? host.id === localId : role === 'host'));
    this._renderSlot('guest', guest, !!guest && (localId ? guest.id === localId : role === 'guest'));
    this._renderSlot('player3', player3, !!player3 && !!localId && player3.id === localId);
    this._renderSlot('player4', player4, !!player4 && !!localId && player4.id === localId);
    for (let index = 5; index <= 10; index++) {
      const player = players.find((entry) => entry?.slot === index - 1) || null;
      this._refs[`slotPlayer${index}`]?.classList.toggle('online-hidden', maxPlayers !== 10);
      if (maxPlayers === 10) this._renderSlot(`player${index}`, player, !!player && !!localId && player.id === localId);
    }

    const localReady = !!(local && local.ready);
    const connectedPlayers = players.filter((player) => player?.connected !== false);
    const roomFull = this._mode === 'deathmatch'
      ? connectedPlayers.length >= 2 : players.length === maxPlayers && connectedPlayers.length === maxPlayers;
    const others = local ? players.filter((player) => player?.id !== local.id) : players;
    const othersReady = others.length > 0 && others.every((player) => player?.connected !== false && player?.ready);
    const allReady = roomFull && connectedPlayers.every((player) => player?.ready);

    const readyBtn = this._refs.readyBtn;
    if (readyBtn) {
      readyBtn.textContent = localReady ? 'LISTO ✓' : 'READY';
      readyBtn.classList.toggle('is-ready', localReady);
      readyBtn.setAttribute('aria-pressed', localReady ? 'true' : 'false');
      readyBtn.disabled = !(local && local.connected !== false);
    }

    let message;
    let kind;
    if (!roomFull) {
      message = `ESPERANDO JUGADORES · ${connectedPlayers.length}/${maxPlayers}`;
      kind = 'busy';
    } else if (allReady) {
      message = 'TODO LISTO · INICIANDO PARTIDA…';
      kind = 'ok';
    } else if (localReady && !othersReady) {
      message = 'ESPERANDO A QUE LOS DEMÁS ESTÉN LISTOS…';
      kind = 'busy';
    } else if (!localReady && othersReady) {
      message = 'LOS DEMÁS ESTÁN LISTOS · PULSÁ READY';
      kind = 'idle';
    } else {
      message = this._mode === 'deathmatch' ? 'PULSÁ READY CUANDO QUIERAS EMPEZAR' : 'LOBBY COMPLETO · PULSÁ READY';
      kind = 'idle';
    }
    this._setStatus(message, kind);
  }

  _renderSlot(role, data, isYou) {
    const refs = role === 'host'
      ? ['slotHost', 'hostName', 'hostReady', 'hostYou']
      : role === 'guest'
        ? ['slotGuest', 'guestName', 'guestReady', 'guestYou']
        : role === 'player3'
          ? ['slotPlayer3', 'player3Name', 'player3Ready', 'player3You']
        : role === 'player4'
          ? ['slotPlayer4', 'player4Name', 'player4Ready', 'player4You']
          : [`slot${role[0].toUpperCase()}${role.slice(1)}`, `${role}Name`, `${role}Ready`, `${role}You`];
    const [slotRef, nameRef, stateRef, youRef] = refs;
    const slot = this._refs[slotRef];
    const name = this._refs[nameRef];
    const state = this._refs[stateRef];
    const you = this._refs[youRef];
    const connected = !!(data && (data.connected !== false));
    const hasData = !!data && connected;
    if (slot) {
      slot.classList.toggle('is-empty', !hasData);
      slot.classList.toggle('is-you', !!isYou && hasData);
      slot.classList.toggle('is-ready', !!(data && data.ready));
    }
    if (name) {
      const label = data && data.name ? String(data.name) : role === 'host' ? '—' : 'ESPERANDO JUGADOR';
      if (name.textContent !== label) name.textContent = label;
    }
    if (state) {
      let label;
      let cls = 'slot-state';
      if (!hasData) {
        label = role === 'host' ? 'PENDIENTE' : 'SIN CONECTAR';
        cls += ' is-empty';
      } else if (data.ready) {
        label = 'LISTO';
        cls += ' is-ready';
      } else {
        label = 'PENDIENTE';
        cls += ' is-pending';
      }
      if (state.textContent !== label) state.textContent = label;
      state.className = cls;
    }
    if (you) you.classList.toggle('online-hidden', !(isYou && hasData));
  }

  async _toggleReady() {
    const session = this._session();
    if (!session || typeof session.setReady !== 'function') {
      this.showError('La sesión no está lista para empezar.');
      return;
    }
    // El pointer lock debe pedirse en el mismo gesto de usuario que el click:
    // así el navegador lo concede antes de que llegue el mensaje `start`.
    // Si la partida no arranca en ~1.6 s, lo soltamos para no bloquear el lobby.
    this._requestLock();
    this._clearTimer(this._readyLockTimer);
    this._readyLockTimer = this._later(() => {
      this._readyLockTimer = null;
      if (this._screen === 'lobby') this._releaseLock();
    }, 1600);
    const local = this._localLobbyPlayer(this._lobby);
    const next = !(local && local.ready);
    try {
      session.setReady(next);
    } catch (err) {
      this.showError(this._friendlyError(err));
      return;
    }
    // Refresco optimista mientras llega el lobby actualizado.
    if (this._lobby && local) {
      local.ready = next;
      if (local.id && this._lobby.roster?.[local.id]) this._lobby.roster[local.id].ready = next;
      if (Array.isArray(this._lobby.players)) {
        const current = this._lobby.players.find((player) => player?.id === local.id);
        if (current) current.ready = next;
      }
      if (this._lobby.host?.id === local.id) this._lobby.host.ready = next;
      if (this._lobby.guest?.id === local.id) this._lobby.guest.ready = next;
      this._renderLobby();
    }
  }

  _lobbyCode(lobby) {
    const fromLobby = lobby && typeof lobby.code === 'string' ? normalizeCode(lobby.code) : '';
    if (fromLobby) return fromLobby;
    const fromSession = normalizeCode(this._sessionCode(this._session()) || '');
    if (fromSession) return fromSession;
    return this._hostCode || this._joinCode || '';
  }

  /* ====================================================================== */
  /* Estado / errores                                                       */
  /* ====================================================================== */

  showStatus(phase, message) {
    if (!phase) return;
    if (phase === 'error') {
      this.showError(message || 'Error de conexión.');
      return;
    }
    if (phase === 'closed') {
      if (this._screen && this._screen !== 'matchEnd') {
        this.showError(message || 'Se cerró la conexión con la sala.');
      }
      return;
    }

    const text = message || STATUS_DEFAULT[phase] || '';
    this._lastStatus = { phase, message: text };
    if (!this._screen) return;

    if (phase === 'connected') {
      if (this._screen === 'host') this._setStatus('CONECTADO · PREPARANDO LOBBY…', 'ok');
      else this._setStatus(text || 'CONECTADO', 'ok');
      return;
    }
    if (this._screen === 'error' || this._screen === 'matchEnd') return;
    const busy = phase === 'creating' || phase === 'waiting' || phase === 'connecting';
    this._setStatus(text, busy ? 'busy' : 'idle');
  }

  showError(message) {
    this._setBusy(false);
    this._creatingHost = false;
    this._lastError = String(message == null ? 'No se pudo conectar.' : message);
    this._setText('errorMsg', this._lastError);
    this._hideOnlineHud();
    this._setView('error');
    this._releaseLock();
  }

  /* ====================================================================== */
  /* Partida                                                                */
  /* ====================================================================== */

  hide() {
    this._closeOverlay();
    this._hideOnlineHud();
    this._clearTimer(this._readyLockTimer);
    this._readyLockTimer = null;
    // Game también la quita al salir; hacerlo acá mantiene el estado coherente
    // tanto al empezar la partida como al volver al menú.
    this._removeMatchClass();
    this._lastMatchEnd = null;
    this._setBusy(false);
  }

  updateHud(onlineHud) {
    if (!this._initialized) return;
    let hud = onlineHud;
    if (hud && typeof hud === 'object' && hud.online && typeof hud.online === 'object') {
      hud = hud.online;
    }
    if (!hud || typeof hud !== 'object') return;

    this._lastHud = hud;
    if (!this._role && (hud.role === 'host' || hud.role === 'guest')) this._role = hud.role;

    if (this._screen) {
      this._hideOnlineHud();
      return;
    }

    this._addMatchClass();
    const refs = this._hudRefs;
    const lobbyNames = this._lobbyNames();
    const players = Array.isArray(hud.players) ? hud.players : [];
    if (hud.mode === 'deathmatch') {
      const leaders = [...players].sort((a, b) => num(b.kills) - num(a.kills));
      const leader = leaders[0];
      const you = players.find((p) => p?.id === this._sessionPlayerId()) || null;
      this._setHudText('hostName', leader?.name || 'LÍDER');
      this._setHudText('guestName', you?.name || 'VOS');
      this._setHudText('scoreHost', num(leader?.kills, num(hud.scoreThem, 0)));
      this._setHudText('scoreGuest', num(you?.kills, num(hud.scoreYou, 0)));
      this._setHudText('target', `DEATHMATCH · ${players.length || 1}/10 JUGADORES`);
      const ping = Number(hud.ping);
      this._setHudText('ping', Number.isFinite(ping) && ping > 0 ? `PING ${Math.round(ping)} MS` : 'PING —');
      if (refs.phase) refs.phase.classList.add('online-hidden');
      if (refs.respawn) {
        const time = num(hud.respawnIn, 0);
        const dead = hud.alive === false;
        refs.respawn.classList.toggle('online-hidden', !dead);
        if (dead) this._setHudText('respawn', time > 0 ? `RESPAWN ${time.toFixed(1)}` : 'REAPARECIENDO');
      }
      this._hudRefs.hostYou?.classList.add('online-hidden');
      this._hudRefs.guestYou?.classList.remove('online-hidden');
      this._showOnlineHud();
      return;
    }
    const teamMode = hud.mode === '2v2' || players.length > 2;
    const hostTeam = players.find((player) => player?.isHost)?.team === 'T' ? 'T' : 'CT';
    const guestTeam = hostTeam === 'CT' ? 'T' : 'CT';
    const localTeam = hud.team === 'T' ? 'T' : hud.team === 'CT' ? 'CT' : null;
    const hostName = teamMode
      ? `${hostTeam} TEAM`
      : String((hud.names && hud.names.host) || lobbyNames.host || 'HOST');
    const guestName = teamMode
      ? `${guestTeam} TEAM`
      : String((hud.names && hud.names.guest) || lobbyNames.guest || 'GUEST');
    const scores = this._resolveScores(hud, { host: 0, guest: 0 });
    this._setHudText('hostName', hostName);
    this._setHudText('guestName', guestName);
    this._setHudText('scoreHost', scores.host);
    this._setHudText('scoreGuest', scores.guest);
    this._setHudText('target', `PRIMERO A ${Math.max(1, Math.round(num(hud.targetKills, DEFAULT_TARGET)))}`);

    const ping = Number(hud.ping);
    this._setHudText(
      'ping',
      Number.isFinite(ping) && ping > 0 ? `PING ${Math.round(ping)} MS` : 'PING —',
    );

    const phase = hud.phase || 'live';
    const alive = hud.alive !== false;
    const respawnIn = num(hud.respawnIn, 0);
    const phaseEl = refs.phase;
    const respawnEl = refs.respawn;
    if (phaseEl) {
      const show = phase === 'countdown';
      phaseEl.classList.toggle('online-hidden', !show);
      if (show) this._setHudText('phase', 'PREPARATE');
    }
    if (respawnEl) {
      let show = false;
      let text = '';
      if (phase !== 'over') {
        if (!alive && respawnIn > 0) {
          show = true;
          text = `RESPAWN ${respawnIn.toFixed(1)}`;
        } else if (!alive) {
          show = true;
          text = 'ELIMINADO';
        }
      }
      respawnEl.classList.toggle('online-hidden', !show);
      if (show) this._setHudText('respawn', text);
    }

    const localSide = teamMode && localTeam
      ? localTeam === hostTeam ? 'host' : 'guest'
      : this._role;
    if (this._onlineHud) {
      this._onlineHud.classList.toggle('is-host', localSide === 'host');
      this._onlineHud.classList.toggle('is-guest', localSide === 'guest');
    }
    if (this._hudRefs.hostYou) this._hudRefs.hostYou.classList.toggle('online-hidden', localSide !== 'host');
    if (this._hudRefs.guestYou) this._hudRefs.guestYou.classList.toggle('online-hidden', localSide !== 'guest');

    this._showOnlineHud();
  }

  _hudScore() {
    return this._resolveScores(this._lastHud || {}, { host: 0, guest: 0 });
  }

  /**
   * Normaliza el marcador: usa scoreHost/scoreGuest si vienen; si no, mapea
   * scoreYou/scoreThem según el rol local (host/guest).
   */
  _resolveScores(hud, fallback) {
    const source = hud || {};
    const base = fallback || { host: 0, guest: 0 };
    let host = Number(source.scoreHost);
    let guest = Number(source.scoreGuest);
    if (!Number.isFinite(host) || !Number.isFinite(guest)) {
      const you = Number(source.scoreYou);
      const them = Number(source.scoreThem);
      if (Number.isFinite(you) && Number.isFinite(them)) {
        if (this._role === 'guest') {
          host = them;
          guest = you;
        } else {
          host = you;
          guest = them;
        }
      } else if (this._role === 'guest') {
        if (!Number.isFinite(host) && Number.isFinite(them)) host = them;
        if (!Number.isFinite(guest) && Number.isFinite(you)) guest = you;
      } else {
        if (!Number.isFinite(host) && Number.isFinite(you)) host = you;
        if (!Number.isFinite(guest) && Number.isFinite(them)) guest = them;
      }
    }
    return {
      host: Number.isFinite(host) ? Math.max(0, Math.round(host)) : Math.max(0, Math.round(num(base.host, 0))),
      guest: Number.isFinite(guest) ? Math.max(0, Math.round(guest)) : Math.max(0, Math.round(num(base.guest, 0))),
    };
  }

  /* ====================================================================== */
  /* Fin de partida                                                         */
  /* ====================================================================== */

  showMatchEnd(data) {
    const payload = data && typeof data === 'object' ? data : {};
    if (payload.mode === 'deathmatch') {
      this._mode = 'deathmatch';
      this._applyModeView();
    }
    this._lastMatchEnd = payload;
    if (payload.role === 'host' || payload.role === 'guest') this._role = payload.role;
    else this._role = this._roleNow() || this._role;

    const lobbyNames = this._lobbyNames();
    const endPlayers = Array.isArray(payload.players) ? payload.players : [];
    const teamMode = payload.mode === '2v2' || Number(payload.maxPlayers ?? this._lobby?.maxPlayers) === 4;
    const hostTeam = endPlayers.find((player) => player?.isHost)?.team === 'T' ? 'T' : 'CT';
    const guestTeam = hostTeam === 'CT' ? 'T' : 'CT';
    const names = {
      host: teamMode ? `${hostTeam} TEAM` : String((payload.names && payload.names.host) || lobbyNames.host || 'HOST'),
      guest: teamMode ? `${guestTeam} TEAM` : String((payload.names && payload.names.guest) || lobbyNames.guest || 'GUEST'),
    };
    const scores = this._resolveScores(payload, this._hudScore());
    const scoreHost = scores.host;
    const scoreGuest = scores.guest;

    const winner = payload.winner === 'host' || payload.winner === 'guest' ? payload.winner : null;
    // match.js incluye youWon/winnerName; usarlos evita desajustes de rol.
    const win =
      typeof payload.youWon === 'boolean'
        ? payload.youWon
        : winner && this._role
          ? winner === this._role
          : null;

    const kicker = this._refs.endKicker;
    if (kicker) {
      const maxPlayers = teamMode ? 4 : 2;
      kicker.textContent = payload.mode === 'deathmatch' ? 'DEATHMATCH · FIN DE PARTIDA' : `ONLINE ${maxPlayers === 4 ? '2V2' : '1V1'} · FIN DE PARTIDA`;
    }

    const title = this._refs.endTitle;
    if (title) {
      title.textContent = win === null ? 'PARTIDA FINALIZADA' : win ? 'VICTORIA' : 'DERROTA';
      title.classList.remove('win', 'lose', 'neutral');
      title.classList.add(win === null ? 'neutral' : win ? 'win' : 'lose');
    }

    const winnerLabel =
      payload.winnerName ||
      (winner ? (winner === 'host' ? names.host : names.guest) : '') ||
      (winner ? winner.toUpperCase() : '');
    this._setText('endWinner', winnerLabel ? `GANA ${winnerLabel}` : 'PARTIDA FINALIZADA');
    this._setText('endHostName', names.host);
    this._setText('endGuestName', names.guest);
    this._setText('endScoreHost', scoreHost);
    this._setText('endScoreGuest', scoreGuest);

    let endStatus = '';
    if (this._role === 'guest') endStatus = 'ESPERANDO REVANCHA DEL HOST…';
    else if (this._role === 'host') endStatus = 'PODÉS PEDIR LA REVANCHA O SALIR AL MENÚ';
    this._setText('endStatus', endStatus);

    const rematch = this._refs.rematchBtn;
    if (rematch) {
      const canRematch = this._role === 'host';
      rematch.classList.toggle('online-hidden', !canRematch);
      rematch.disabled = false;
      rematch.textContent = 'REVANCHA';
    }

    this._addMatchClass();
    this._hideOnlineHud();
    this._setView('matchEnd');
    this._releaseLock();
  }

  _requestRematch() {
    const button = this._refs.rematchBtn;
    if (button) {
      button.disabled = true;
      button.textContent = 'ESPERANDO…';
    }
    this._setText('endStatus', 'ESPERANDO AL OTRO JUGADOR…');
    const fail = (message) => {
      if (button) {
        button.disabled = false;
        button.textContent = 'REVANCHA';
      }
      this._setText('endStatus', message);
    };
    try {
      const online = this.game && this.game.online;
      if (online && typeof online.requestRematch === 'function') {
        const result = online.requestRematch();
        if (result === false) fail('NO SE PUDO PEDIR LA REVANCHA · PROBÃ DE NUEVO');
        return;
      }
      const session = this._session();
      if (session && typeof session.resetToLobby === 'function') {
        const result = session.resetToLobby();
        if (result === false) fail('NO SE PUDO VOLVER AL LOBBY');
        return;
      }
      throw new Error('La revancha no está disponible.');
    } catch (err) {
      fail(this._friendlyError(err));
    }
  }

  /* ====================================================================== */
  /* Copiar código / link                                                   */
  /* ====================================================================== */

  _copyCode(button) {
    const code = this._hostCode || this._lobbyCode(this._lobby) || '';
    if (!code) {
      this._setStatus('TODAVÃA NO HAY UN CÓDIGO PARA COPIAR', 'error');
      return;
    }
    this._copyText(code, 'CÓDIGO COPIADO', button);
  }

  _copyLink(button) {
    const code = this._hostCode || this._lobbyCode(this._lobby) || '';
    if (!code) {
      this._setStatus('TODAVÃA NO HAY UN LINK PARA COPIAR', 'error');
      return;
    }
    const link = this._hostLink || this._buildLink(code);
    this._copyText(link, 'LINK COPIADO', button);
  }

  _buildLink(code) {
    const clean = normalizeCode(code);
    if (!clean) return '';
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('join', clean);
      return url.toString();
    } catch {
      try {
        return `${window.location.origin}${window.location.pathname}?join=${clean}`;
      } catch {
        return `?join=${clean}`;
      }
    }
  }

  async _copyText(text, okMessage, button) {
    const value = String(text == null ? '' : text);
    if (!value) return;
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = this._legacyCopy(value);
    if (copied) {
      this._setStatus(okMessage, 'ok');
      this._flashButton(button, 'COPIADO ✓');
    } else {
      this._setStatus('NO SE PUDO COPIAR · COPIÃ MANUALMENTE', 'error');
    }
  }

  _legacyCopy(value) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(textarea);
      return !!ok;
    } catch {
      return false;
    }
  }

  _flashButton(button, text) {
    if (!button || !button.isConnected) return;
    const original = button.textContent;
    button.textContent = text;
    button.disabled = true;
    this._later(() => {
      if (!button.isConnected) return;
      button.textContent = original;
      button.disabled = false;
    }, 1400);
  }

  /* ====================================================================== */
  /* Salir / volver                                                         */
  /* ====================================================================== */

  _back() {
    if (this._screen === 'home') {
      this._exitNoSession();
      return;
    }
    this._leaveToMenu();
  }

  _exitNoSession() {
    // Si se cancela mientras host()/join() está en vuelo, cerramos la sesión
    // a medias e invalidamos la operación pendiente.
    this._opSeq++;
    if (this._creatingHost || this._busy) {
      try {
        this._session()?.close?.('Cancelaste la conexión');
      } catch {
        /* ignore */
      }
    }
    this._creatingHost = false;
    this._closeOverlay();
    this._removeMatchClass();
    this._hideOnlineHud();
    this._resetLocalState();
    try {
      this.game?.ui?.showMainMenu?.();
    } catch (err) {
      console.warn('[OnlineUI] showMainMenu', err);
    }
  }

  _leaveToMenu() {
    const game = this.game;
    const session = this._session();
    this._opSeq++;
    this._creatingHost = false;

    this._closeOverlay();
    this._removeMatchClass();
    this._hideOnlineHud();
    this._resetLocalState();

    let handled = false;
    try {
      if (game && typeof game.leaveOnline === 'function') {
        handled = true;
        game.leaveOnline('Saliste de la sala');
      }
    } catch (err) {
      console.warn('[OnlineUI] leaveOnline', err);
      handled = false;
    }
    if (!handled) {
      try {
        if (session && typeof session.close === 'function') session.close('Saliste de la sala');
      } catch (err) {
        console.warn('[OnlineUI] session.close', err);
      }
      try {
        this.game?.ui?.showMainMenu?.();
      } catch (err) {
        console.warn('[OnlineUI] showMainMenu', err);
      }
    }
  }

  /* ====================================================================== */
  /* Integración con Game                                                    */
  /* ====================================================================== */

  _session() {
    try {
      return (this.game && this.game.onlineSession) || null;
    } catch {
      return null;
    }
  }

  _roleNow() {
    const session = this._session();
    if (!session) return null;
    try {
      const role = session.role;
      return role === 'host' || role === 'guest' ? role : null;
    } catch {
      return null;
    }
  }

  _sessionCode(session) {
    if (!session) return '';
    try {
      return typeof session.code === 'string' ? session.code : session.code ? String(session.code) : '';
    } catch {
      return '';
    }
  }

  _sessionLobby(session) {
    if (!session) return null;
    try {
      const lobby = session.lobby;
      return lobby && typeof lobby === 'object' ? lobby : null;
    } catch {
      return null;
    }
  }

  _lobbyNames() {
    const lobby = this._lobby;
    return {
      host: lobby && lobby.host && lobby.host.name ? String(lobby.host.name) : '',
      guest: lobby && lobby.guest && lobby.guest.name ? String(lobby.guest.name) : '',
    };
  }

  _releaseLock() {
    try {
      if (typeof document !== 'undefined' && document.pointerLockElement && this.game && typeof this.game.releasePointerLock === 'function') {
        this.game.releasePointerLock();
      }
    } catch {
      /* ignore */
    }
  }

  _requestLock() {
    try {
      if (this.game && typeof this.game.requestPointerLock === 'function') this.game.requestPointerLock();
    } catch {
      /* ignore */
    }
  }

  _sfx(name) {
    const audio = this.game && this.game.audio;
    if (!audio || typeof audio.play !== 'function') return;
    try {
      audio.play(name);
    } catch {
      /* ignore */
    }
  }

  _friendlyError(err) {
    const raw = err == null ? '' : typeof err === 'string' ? err : err.message || String(err);
    const text = String(raw || 'No se pudo conectar.');
    const lower = text.toLowerCase();
    for (const key of Object.keys(PEER_ERRORS)) {
      if (lower.includes(key)) return PEER_ERRORS[key];
    }
    if (lower.includes('timeout')) return PEER_ERRORS.timeout;
    if (lower.includes('sala no encontrada') || lower.includes('not found')) return PEER_ERRORS['peer-unavailable'];
    return text;
  }
}

export default OnlineUI;




