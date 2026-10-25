const RED = '#ff493e';

function blend(from, to, amount) {
  const a = from.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16));
  const b = to.match(/[a-f\d]{2}/gi)?.map((part) => parseInt(part, 16));
  if (!a || !b || a.length !== 3 || b.length !== 3) return to;
  const t = Math.max(0, Math.min(1, amount));
  return `#${a.map((value, i) => Math.round(value + (b[i] - value) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** One timestamp per indicator. Repeated hits restart its pulse without timers. */
export class DamagePulse {
  constructor(duration = 520) {
    this.duration = duration;
    this.startedAt = -Infinity;
    this.strength = 0;
  }

  trigger(loss, now) {
    if (!(loss > 0)) return;
    this.startedAt = now;
    this.strength = Math.min(1, 0.7 + loss / 60);
  }

  reset() {
    this.startedAt = -Infinity;
    this.strength = 0;
  }

  color(normal, now, reducedMotion = false) {
    const age = now - this.startedAt;
    if (age < 0 || age >= this.duration) return normal;
    if (reducedMotion) return blend(normal, RED, this.strength * Math.min(1, (this.duration - age) / 180));
    const first = age < 110 ? 1 : age < 190 ? (190 - age) / 80 : 0;
    const second = age >= 190 && age < 300 ? (age - 190) / 110
      : age >= 300 && age < 390 ? (390 - age) / 90 : 0;
    const tail = age >= 390 ? (this.duration - age) / (this.duration - 390) * 0.35 : 0;
    return blend(normal, RED, Math.max(first, second, tail) * this.strength);
  }
}
