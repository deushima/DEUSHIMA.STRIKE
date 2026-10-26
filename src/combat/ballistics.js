import { CS2_PROFILES } from './cs2-data.js';
// Same world calibration as movement: 72 Source units = 1.8 world units.
export const CS_UNITS_PER_WORLD = 40;
export const HITGROUP = Object.freeze({ generic:0, head:1, chest:2, stomach:3, leftarm:4, rightarm:5, leftleg:6, rightleg:7, neck:8, gear:10 });
export const profileFor = id => CS2_PROFILES[id] || null;
export function hitgroupMultiplier(id, part) {
  if (part === 'head') return profileFor(id)?.headshotMultiplier ?? 4;
  if (part === 'stomach') return 1.25;
  if (['legs','leftleg','rightleg'].includes(part)) return .75;
  // Neck is assigned chest damage by this model adapter. CS2 neck parity is unverified.
  return 1;
}
export function rangedDamage(id, distanceWorld, base = profileFor(id)?.baseDamage || 0) {
  const p = profileFor(id);
  return base * (p ? Math.pow(p.rangeModifier, Math.max(0, distanceWorld) * CS_UNITS_PER_WORLD / 500) : 1);
}
export function armorCovers(target, part) {
  if (!(target.armor > 0) || ['legs','leftleg','rightleg','gear'].includes(part)) return false;
  return part === 'head' ? !!target.helmet : target.kevlar !== false;
}
// Input is ranged, hitgroup-scaled damage. No intermediate HP rounding.
// Normal kevlar only: heavy armor is not sold or modeled in this game.
export function resolveArmorDamage(raw, target, part, weaponId, protection = 1) {
  raw = Math.max(0, Number(raw) || 0);
  let healthFloat = raw, armorFloat = 0;
  if (weaponId !== 'fall' && armorCovers(target, part)) {
    const ratio = Math.min(1, (profileFor(weaponId)?.armorRatio ?? 1) * .5);
    healthFloat = raw * ratio;
    armorFloat = (raw - healthFloat) * .5;
    if (armorFloat > target.armor) {
      armorFloat = target.armor;
      healthFloat = raw - armorFloat / .5;
    }
  }
  const healthDamage = Math.floor(healthFloat * protection);
  const armorDamage = Math.floor(armorFloat);
  return {raw, healthFloat, armorFloat, healthDamage, armorDamage,
    healthRemaining:Math.max(0, (target.health ?? 100) - healthDamage),
    armorRemaining:Math.max(0, (target.armor || 0) - armorDamage),
    overkill:Math.max(0,healthDamage-(target.health ?? 100))};
}
export function calculateBulletDamage(id, part, distance, target, protection = 1) {
  return resolveArmorDamage(rangedDamage(id,distance)*hitgroupMultiplier(id,part),target,part,id,protection);
}
