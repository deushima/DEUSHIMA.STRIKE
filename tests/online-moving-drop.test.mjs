import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OnlineMatch } from '../src/online/match.js';

const player = { alive: true, pos: new THREE.Vector3(0, 0, 0) };
const accepted = [];
const removed = [];
const dropId = 'moving-pistol';
const entry = { id: 'deagle', magazine: 4, reserve: 19 };
const game = {
  player,
  weapons: {
    serializeDroppedWeapons: () => [{
      id: dropId,
      weaponId: entry.id,
      ammo: { magazine: entry.magazine, reserve: entry.reserve },
      position: [0.2, 0, 0],
      pickableAt: Date.now() / 1000 - 1,
    }],
    removeNetworkDrop: (id) => removed.push(id),
    acceptPickup: (pickup) => { accepted.push(pickup); return true; },
  },
};
const session = {
  role: 'host',
  localPlayerId: 'host',
  broadcast() {},
};
const match = new OnlineMatch(game, session, {
  role: 'host',
  players: [
    { id: 'host', team: 'CT', isHost: true },
    { id: 'guest', team: 'T' },
  ],
});
match.local.inventory = { primary: null, secondary: null, grenades: {} };
match.drops.set(dropId, {
  id: dropId,
  entry,
  pos: { x: 9, y: 0, z: 0 },
  pickableAt: Date.now() / 1000 - 1,
});

assert.equal(match._hostGrantPickup('host', dropId), true,
  'the host checks the current physical position of a moving drop');
assert.deepEqual(accepted, [entry]);
assert.deepEqual(removed, [dropId]);
assert.equal(match.local.inventory.secondary?.id, 'deagle');
assert.equal(match.drops.has(dropId), false);

console.log('online-moving-drop OK: moving secondary pickup uses current position');
