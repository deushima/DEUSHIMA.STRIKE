/** Stable local 1v1 map contract used by the classic menu and Game.startOffline(). */
export const OFFLINE_DUEL_MAPS = Object.freeze([
  Object.freeze({ id: 'aim_1v1', label: 'AIM_MAP', hint: 'CLÁSICO' }),
  Object.freeze({ id: 'aim_redline', label: 'AIM_REDLINE', hint: 'REDLINE' }),
  Object.freeze({ id: 'aim_forge', label: 'AIM_FORGE', hint: 'TRAINING YARD' }),
  Object.freeze({ id: 'cs_assault', label: 'ASSAULT', hint: 'ALMACÉN' }),
  Object.freeze({ id: 'cs_office', label: 'CS_OFFICE', hint: 'OFFICE' }),
  Object.freeze({ id: 'de_dust2', label: 'DUST2', hint: 'CLÁSICO · PROCEDURAL' }),
  Object.freeze({ id: 'dust_short', label: 'DUST SHORT', hint: 'DUST · SHORT' }),
]);

export const DEFAULT_OFFLINE_DUEL_MAP = 'aim_1v1';

export function isOfflineDuelMap(id) {
  return OFFLINE_DUEL_MAPS.some((map) => map.id === id);
}

export function offlineDuelMapLabel(id) {
  return OFFLINE_DUEL_MAPS.find((map) => map.id === id)?.label || id;
}
