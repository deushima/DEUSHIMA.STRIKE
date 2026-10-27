const BLOCKED_SHORTCUTS = new Set([
  'KeyA', 'KeyD', 'KeyS', 'KeyW',
  'KeyF', 'KeyG', 'KeyO', 'KeyP', 'KeyR', 'KeyU',
]);
const GAME_KEYBOARD_LOCK = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

export function installShortcutGuard(game) {
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.code?.startsWith('Key')
      ? event.code
      : `Key${String(event.key || '').toUpperCase()}`;
    if (!BLOCKED_SHORTCUTS.has(key)) return;
    if (key === 'KeyA' && (
      document.designMode === 'on' ||
      event.target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"]')
    )) return;
    event.preventDefault();
  }, true);

  document.addEventListener('fullscreenchange', () => {
    const keyboard = navigator.keyboard;
    if (!keyboard) return;
    if (!document.fullscreenElement) {
      keyboard.unlock?.();
      return;
    }
    keyboard.lock?.(GAME_KEYBOARD_LOCK)?.catch?.(() => {});
  });

  window.addEventListener('beforeunload', (event) => {
    if (!['playing', 'paused', 'roundover'].includes(game?.state)) return;
    event.preventDefault();
    event.returnValue = true;
  });
}
