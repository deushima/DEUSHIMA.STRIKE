/** Música de menú en streaming; no decodifica la pista completa en WebAudio. */
const MENU_TRACK = '/assets/music/menu-theme.mp3';
const MUSIC_GAIN = 0.11;

export class MenuMusic {
  constructor() {
    this.audio = null;
    this.active = false;
    this.masterVolume = 0.65;
    this.level = 0;
    this.fadeFrame = null;
  }

  setActive(active) {
    if (this.active === !!active) return;
    this.active = !!active;
    if (this.active) this.resume();
    else this.fadeTo(0, 300, () => {
      if (!this.active) this.audio?.pause();
    });
  }

  setVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    this.applyVolume();
  }

  applyVolume() {
    if (this.audio) this.audio.volume = MUSIC_GAIN * this.masterVolume * this.level;
  }

  resume() {
    if (!this.active) return;
    if (!this.audio) {
      this.audio = new Audio(MENU_TRACK);
      this.audio.loop = true;
      this.audio.preload = 'none';
      this.audio.volume = 0;
    }
    if (!this.audio.paused) {
      this.fadeTo(1, 900);
      return;
    }
    // La primera llamada puede bloquearse por la política de autoplay.
    // Se reintenta durante la primera interacción real del usuario.
    const start = this.audio.play();
    if (start?.then) {
      start.then(() => {
        if (this.active) this.fadeTo(1, 900);
        else this.audio.pause();
      }).catch(() => {});
    } else {
      this.fadeTo(1, 900);
    }
  }

  fadeTo(target, duration, onComplete) {
    if (this.fadeFrame !== null) cancelAnimationFrame(this.fadeFrame);
    this.fadeFrame = null;
    if (!this.audio) return;
    const from = this.level;
    if (from === target) {
      onComplete?.();
      return;
    }
    let started;
    const step = (now) => {
      if (started === undefined) started = now;
      const progress = Math.min(1, (now - started) / duration);
      const smooth = progress * progress * (3 - 2 * progress);
      this.level = from + (target - from) * smooth;
      this.applyVolume();
      if (progress < 1) this.fadeFrame = requestAnimationFrame(step);
      else {
        this.fadeFrame = null;
        onComplete?.();
      }
    };
    this.fadeFrame = requestAnimationFrame(step);
  }
}
