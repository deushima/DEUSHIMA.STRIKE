/** Deathmatch mode gateway: first choose OFFLINE or ONLINE. */
export class DeathmatchUI {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.button = null;
    this.isOpen = false;
    this._onKeydown = (event) => {
      if (event.key === 'Escape' && this.isOpen) {
        event.stopPropagation();
        this.hide();
      }
    };
  }

  init() {
    if (this.root) return;
    const overlay = document.createElement('div');
    overlay.className = 'deathmatch-gateway hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Elegir Deathmatch Online u Offline');
    overlay.innerHTML = `
      <div class="dm-panel">
        <div class="dm-eyebrow">DEUSHIMA STRIKE / NUEVO MODO</div>
        <h2>DEATHMATCH<span>.</span></h2>
        <p>Combate continuo. Respawn rápido en distintos puntos del mapa. Elegí cómo jugar.</p>
        <div class="dm-methods">
          <div class="dm-method">
            <span class="dm-method-number">01 / INDIVIDUAL</span>
            <h3>OFFLINE</h3>
            <p>Jugá contra bots sin conexión y practicá en Dust2.</p>
            <label>BOTS EN PARTIDA
              <select data-dm="bots"><option value="3">3 BOTS</option><option value="5" selected>5 BOTS</option><option value="9">9 BOTS</option></select>
            </label>
            <label>DIFICULTAD
              <select data-dm="difficulty"><option value="easy">FÁCIL</option><option value="normal" selected>NORMAL</option><option value="hard">DIFÍCIL</option></select>
            </label>
            <button type="button" data-dm-action="offline">JUGAR OFFLINE</button>
          </div>
          <div class="dm-method dm-method-online">
            <span class="dm-method-number">02 / MULTIJUGADOR</span>
            <h3>ONLINE</h3>
            <p>Creá una sala privada con hasta 10 jugadores y compartí un enlace o código de invitación.</p>
            <div class="dm-feature">02–10 JUGADORES</div>
            <div class="dm-feature">CÓDIGO DE SALA · LINK DIRECTO</div>
            <div class="dm-feature">RESPAWN CONTINUO</div>
            <button type="button" data-dm-action="online">JUGAR ONLINE</button>
          </div>
        </div>
        <button type="button" class="dm-back" data-dm-action="back">VOLVER AL MENÚ</button>
        <div class="dm-status" data-dm="status" aria-live="polite"></div>
      </div>`;
    overlay.addEventListener('click', (event) => {
      const action = event.target.closest('[data-dm-action]')?.dataset.dmAction;
      if (action === 'back') this.hide();
      if (action === 'online') {
        this.hide();
        this.game.openOnlineHome('deathmatch');
      }
      if (action === 'offline') {
        const status = overlay.querySelector('[data-dm="status"]');
        status.textContent = 'CARGANDO DEATHMATCH...';
        const bots = Number(overlay.querySelector('[data-dm="bots"]').value);
        const difficulty = overlay.querySelector('[data-dm="difficulty"]').value;
        this.hide();
        this.game.startDeathmatch({ bots, difficulty }).catch((error) => {
          console.error('[deathmatch]', error);
          this.game.ui.showFatalError?.(`No se pudo iniciar Deathmatch: ${error.message}`);
        });
      }
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', this._onKeydown, true);
    this.root = overlay;
    this.ensureButton();
  }

  ensureButton() {
    const nav = document.querySelector('#ui-root .menu-left nav');
    if (!nav) return;
    if (this.button?.isConnected && this.button.parentNode === nav) return;
    const existing = nav.querySelector('[data-action="deathmatch-play"]');
    if (existing) {
      this.button = existing;
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-btn';
    button.dataset.action = 'deathmatch-play';
    button.innerHTML = '<span class="mb-index">03</span>DEATHMATCH<span class="mb-hint">ONLINE / OFFLINE</span>';
    button.addEventListener('click', () => this.open());
    const online = nav.querySelector('[data-action="online-play"]');
    if (online) online.after(button);
    else nav.appendChild(button);
    this.button = button;
    this.game.onlineUI?._renumberMenu?.(nav);
  }

  open() {
    this.init();
    this.ensureButton();
    this.game.input?.exitPointerLock?.();
    this.game.ui?.hideAll?.();
    this.root.classList.remove('hidden');
    this.isOpen = true;
    this.root.querySelector('[data-dm-action="offline"]')?.focus();
  }

  hide() {
    if (!this.root) return;
    this.root.classList.add('hidden');
    this.isOpen = false;
    if (this.game.state === 'menu' && !this.game.onlineUI?.isOpen) this.game.ui?.showMainMenu?.();
  }
}
