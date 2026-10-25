import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { WeaponSystem } from '../src/weapons.js';
import { DroppedWeaponSystem } from '../src/world/dropped-weapons.js';

const game = {
  scene: null,
  player: {
    alive: true,
    pos: new THREE.Vector3(0, 0.05, 0),
    yaw: 0,
  },
  ui: { toast() {} },
};

const drops = new DroppedWeaponSystem(game, {
  getWeaponInfo: (id) => id === 'm4a1' ? { slot: 1 } : null,
  localPickupEnabled: false,
});

const first = drops.spawn({
  id: 'network-drop',
  weaponId: 'm4a1',
  ammo: { magazine: 11, reserve: 37 },
  position: [1, 0.1, 1],
  grounded: true,
});
assert.ok(first);
const replacement = drops.spawn({
  id: 'network-drop',
  weaponId: 'm4a1',
  ammo: { magazine: 9, reserve: 22 },
  position: [2, 0.1, 2],
  grounded: true,
});
assert.equal(drops.items.length, 1, 'same network id is de-duplicated at the primitive boundary');
assert.equal(replacement.ammo.magazine, 9);
assert.equal(replacement.pos.x, 2);

const beforeSnapshot = drops.time;
drops.applySnapshot([{
  id: 'network-drop',
  weaponId: 'm4a1',
  ammo: { magazine: 9, reserve: 22 },
  position: [2, 0.1, 2],
  velocity: [0, 0, 0],
  grounded: true,
  armed: true,
  pickableAt: beforeSnapshot + 3600,
  pickableIn: 0.25,
}]);
assert.ok(
  drops.items[0].pickableAt >= beforeSnapshot && drops.items[0].pickableAt < beforeSnapshot + 1,
  'snapshot prefers relative pickup delay over the host wall clock',
);

const weapons = new WeaponSystem(game);
weapons.inventory.primary = { id: 'm4a1', magazine: 30, reserve: 90 };
weapons.inventory.secondary = { id: 'deagle', magazine: 7, reserve: 35 };
assert.equal(weapons._canPickupDrop({ weaponId: 'm4a1' }), false, 'occupied primary slot blocks pickup');
assert.equal(weapons._canPickupDrop({ weaponId: 'deagle' }), false, 'occupied secondary slot blocks pickup');
weapons.inventory.secondary = null;
assert.equal(weapons._canPickupDrop({ weaponId: 'deagle' }), true, 'empty secondary slot allows pickup');

const networkDrop = weapons.spawnNetworkDrop({
  id: 'clock-skew-drop',
  weaponId: 'm4a1',
  ammo: { magazine: 17, reserve: 53 },
  position: [0, 0.1, 0],
  velocity: [0, 0, 0],
  createdAt: 1_700_000_000_000,
  pickableAt: 1_700_000_000.55,
  grounded: true,
  armed: true,
});
assert.ok(networkDrop.pickableAt - weapons.droppedWeapons.time >= 0.5);
assert.ok(networkDrop.pickableAt - weapons.droppedWeapons.time < 0.7, 'network drop converts host timestamps into a local relative delay');
assert.equal(networkDrop.ammo.magazine, 17);
assert.equal(networkDrop.ammo.reserve, 53);

weapons.dispose();
drops.dispose();
console.log('dropped-weapons OK: id de-duplication, slot pickup rules, ammo and clock-safe pickup delay');
