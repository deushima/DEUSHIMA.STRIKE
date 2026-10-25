/** Protect an active match from accidental tab closure where the browser allows it. */
export function installShortcutGuard(game) {
  window.addEventListener('keydown', (event) => {
    const closeTab = (event.ctrlKey || event.metaKey) &&
      (event.code === 'KeyW' || String(event.key).toLowerCase() === 'w');
    if (!closeTab) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('beforeunload', (event) => {
    if (!['playing', 'paused', 'roundover'].includes(game?.state)) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
