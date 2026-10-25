export class MovementDebugHUD {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this._accum = 0;
    this.el = null;
    try {
      const query = new URLSearchParams(window.location.search);
      this.enabled =
        query.get('movementDebug') === '1' ||
        localStorage.getItem('cs16-movement-debug') === '1';
    } catch {
      this.enabled = false;
    }
    if (!this.enabled || typeof document === 'undefined') return;

    const el = document.createElement('pre');
    el.id = 'movement-debug';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      left: '10px',
      top: '10px',
      zIndex: '99999',
      margin: '0',
      padding: '8px 10px',
      pointerEvents: 'none',
      color: '#b9ffad',
      background: 'rgba(0,0,0,.72)',
      border: '1px solid rgba(185,255,173,.35)',
      font: '11px/1.35 Consolas, monospace',
      whiteSpace: 'pre',
    });
    document.body.appendChild(el);
    this.el = el;
  }

  update(dt) {
    if (!this.enabled || !this.el) return;
    this._accum += Math.max(0, Number(dt) || 0);
    if (this._accum < 0.08) return;
    this._accum = 0;
    const state = this.game?.player?.getMovementDebugState?.();
    if (!state) return;
    const online = this.game?.online?.getHudState?.();
    const ping = Number(online?.ping);
    this.el.textContent = [
      state.preset,
      `XY ${state.horizontalSpeed.toFixed(3)}  Y ${state.verticalSpeed.toFixed(3)}`,
      `ground ${state.grounded ? 1 : 0}  tick ${state.tick}`,
      `wish ${state.wishSpeed.toFixed(3)}  airaccel ${state.airAcceleration}`,
      `jump ${state.jumpCount}  held ${state.jumpHeld ? 1 : 0}  auto ${state.autoBhopEnabled ? 1 : 0}`,
      `dt ${state.fixedStep.toFixed(4)}  ping ${Number.isFinite(ping) ? Math.round(ping) + 'ms' : '-'}`,
    ].join('\n');
  }
}
