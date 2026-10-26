// Client simulation timestamps preserve cadence under packet batching. The host
// still bounds the clock, enforces fire rate, ownership, ammo and damage.
export const SHOT_JITTER_MS = 250;
export function shotClock(record, seconds, now, cycle, local = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const time = seconds * 1000;
  const previous = record.acceptedShotSeq ? record.shotClock : null;
  if (previous && time + 0.01 < previous.next) return null;
  const offset = !previous || now - previous.received > 1500
    ? now - time : previous.offset;
  if (!local && time > now - offset + SHOT_JITTER_MS) return null;
  return { time, next: time + cycle, received: now, offset };
}

export function shotMotion(player, scoped = false) {
  return {
    speed: Math.max(0, player?.getVelocity2D?.() ?? player?.speed ??
      Math.hypot(player?.vel?.x || 0, player?.vel?.z || 0)),
    crouching: !!player?.crouching,
    onGround: player?.onGround !== false,
    landingTime: Math.max(0, player?.landingTime || 0),
    scoped: !!scoped,
  };
}
