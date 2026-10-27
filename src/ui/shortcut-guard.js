// Chromium solo entrega ciertos atajos reservados si Keyboard Lock está activo
// en fullscreen iniciado por la página (F11 no sirve para este fin).
const BROWSER_SHORTCUT_KEYS = [
  'KeyA', 'KeyD', 'KeyS', 'KeyW',
  'KeyB', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyL',
  'KeyN', 'KeyO', 'KeyP', 'KeyR', 'KeyT', 'KeyU',
  'Tab', 'F5', 'Escape',
];
const BLOCKED_SHORTCUTS = new Set(BROWSER_SHORTCUT_KEYS);
const EDITABLE = 'input, textarea, select, [contenteditable], [role="textbox"]';


export function installShortcutGuard(game) {
  const keyboard = navigator.keyboard;
  let pending = false;
  let granted = false;
  let generation = 0;
  let retryAfter = 0;
  let lastStatus = '';
  const intercepted = new Set();

  function report(status, reason = '') {
    document.documentElement.dataset.shortcutLock = status;
    document.dispatchEvent(new CustomEvent('deushima:shortcutlockchange', {
      detail: { status, reason },
    }));
    if (status !== lastStatus) {
      if (status === 'active') console.info('[shortcuts] Keyboard Lock activo en fullscreen');
      if (status === 'failed' || status === 'unsupported') {
        console.warn('[shortcuts] Keyboard Lock no disponible:', reason);
      }
      lastStatus = status;
    }
  }

  function requestLock(source) {
    if (!window.isSecureContext || typeof keyboard?.lock !== 'function') {
      report('unsupported', !window.isSecureContext ? 'requiere HTTPS o localhost' : 'API no implementada');
      return;
    }
    if (pending || (granted && document.fullscreenElement) || Date.now() < retryAfter) return;
    pending = true;
    const attempt = ++generation;
    report('requesting');

    // No diferir esta llamada: en Chromium el permiso depende del gesto de usuario.
    let result;
    try {
      result = keyboard.lock(BROWSER_SHORTCUT_KEYS);
    } catch (error) {
      pending = false;
      retryAfter = Date.now() + 4000;
      report('failed', `${source}: ${error?.name || error}`);
      return;
    }
    Promise.resolve(result).then(() => {
      if (attempt !== generation) return;
      pending = false;
      granted = true;
      report(document.fullscreenElement ? 'active' : 'pending');
    }).catch((error) => {
      if (attempt !== generation) return;
      pending = false;
      granted = false;
      retryAfter = Date.now() + 4000;
      report('failed', `${source}: ${error?.name || error} ${error?.message || ''}`.trim());
    });
  }

  report('windowed');

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      if (granted) report('active');
      else if (!pending) requestLock('fullscreenchange');
      return;
    }
    ++generation;
    pending = false;
    granted = false;
    keyboard?.unlock?.();
    report('windowed');
  });

  // Recuperación si Chromium denegó el primer intento por falta de activación.
  window.addEventListener('pointerdown', () => {
    if (document.fullscreenElement && !granted && !pending) requestLock('pointerdown');
  }, true);

  window.addEventListener('keydown', (event) => {
    if (document.fullscreenElement && !granted && !pending && event.isTrusted) {
      requestLock('keydown');
    }
    if (event.code === 'Escape' && document.fullscreenElement) {
      // Keyboard Lock (Escape) permite pausar sin salir de fullscreen en Chromium.
      event.preventDefault();
      return; // Propagar a UI y Game para que Escape conserve su acción normal.
    }
    if ((!event.ctrlKey && !event.metaKey) && event.code !== 'F5') return;
    if (event.altKey || document.designMode === 'on' ||
        event.target?.closest?.(EDITABLE)) return;
    const key = event.code?.startsWith('Key') || BLOCKED_SHORTCUTS.has(event.code)
      ? event.code
      : `Key${String(event.key || '').toUpperCase()}`;
    if (!BLOCKED_SHORTCUTS.has(key)) return;
    event.preventDefault(); // Sin stopPropagation: Ctrl+WASD sigue moviendo/agachando.
    if (!intercepted.has(key)) {
      intercepted.add(key);
      console.info('[shortcuts] evento interceptado:', key,
        'fullscreen:', !!document.fullscreenElement,
        'lock:', document.documentElement.dataset.shortcutLock);
    }
  }, true);

  window.addEventListener('beforeunload', (event) => {
    if (!['playing', 'paused', 'roundover'].includes(game?.state)) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
