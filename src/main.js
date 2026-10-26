import { Game } from './game.js';
import { installClassic } from './ui/classic.js';
import { installShortcutGuard } from './ui/shortcut-guard.js';


const canvas = document.getElementById('game-canvas');

function fatal(message) {
  const boot = document.getElementById('boot-screen');
  if (boot) {
    boot.innerHTML = `
      <div class="boot-inner">
        <h1>ERROR</h1>
        <p style="max-width:520px;line-height:1.6">${message}</p>
      </div>`;
    return;
  }
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;background:#080a09;color:#d8c9a4;font:14px monospace;padding:24px;text-align:center;z-index:999';
  el.textContent = message;
  document.body.appendChild(el);
}

if (!canvas) {
  fatal('No se encontrÃ³ el canvas del juego.');
} else {
  try {
    const game = new Game(canvas);
    installShortcutGuard(game);
    window.__CS16__ = game;
    window.game = game;
    game
      .init()
      .then(() => installClassic(game))
      .then(async () => {
        if (!globalThis.__DEUSHIMA_PUBLIC__ && ['127.0.0.1','localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('debugHitboxes')) {
          const {installHitboxDebug}=await import('../dev/debug-hitboxes.js');
          installHitboxDebug(game);
        }
      })
      .catch((err) => {
        console.error(err);
        fatal('Error iniciando el juego: ' + err.message);
      });
    const unlockAudio = () => {
      game.audio.init();
      game.audio.resumeMenuMusic();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
  } catch (err) {
    console.error(err);
    fatal('Este navegador no pudo iniciar WebGL o el motor del juego. ProbÃ¡ con Chrome/Edge actualizado. Detalle: ' + err.message);
  }
}

