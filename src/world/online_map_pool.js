// Shared by the host lobby, guest, game loader and HUD. Keep IDs stable on the wire.
export const ONLINE_MAPS = Object.freeze([
  Object.freeze({ id: 'aim_redline', label: 'AIM_REDLINE' }),
  Object.freeze({ id: 'aim_forge', label: 'AIM_FORGE' }),
  Object.freeze({ id: 'aim_1v1', label: 'AIM_MAP' }),
  Object.freeze({ id: 'cs_assault', label: 'ASSAULT' }),
  Object.freeze({ id: 'cs_office', label: 'CS_OFFICE' }),
]);

export const DEFAULT_ONLINE_MAP = 'aim_1v1';

export function isOnlineMap(id) {
  return ONLINE_MAPS.some((map) => map.id === id);
}

export function onlineMapLabel(id) {
  return ONLINE_MAPS.find((map) => map.id === id)?.label || id;
}
