import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OnlineMatch } from '../src/online/match.js';
import { OnlineSession } from '../src/online/session.js';
import { WeaponSystem } from '../src/weapons.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const physicalDrops = [];
const sent = [];
const broadcasts = [];

const hostInventory = {
  primary: { id: 'm4a1', magazine: 30, reserve: 999 },
  secondary: { id: 'deagle', magazine: 7, reserve: 999 },
  grenades: { he: 0, flash: 0, smoke: 0 },
  currentId: 'm4a1',
  lastId: null,
};

const hostPlayer = {
  team: 'CT',
  name: 'Host',
  alive: true,
  health: 100,
  armor: 100,
  helmet: false,
  pos: new THREE.Vector3(0, 0.05, 8),
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  crouching: false,
  onGround: true,
  addShake() {},
};

const hostWeapons = {
  currentId: 'm4a1',
  inventory: hostInventory,
  getInventorySnapshot() { return copy(hostInventory); },
  serializeDroppedWeapons() { return physicalDrops.map(copy); },
  spawnNetworkDrop(drop) {
    const row = copy(drop);
    const index = physicalDrops.findIndex((item) => item.id === row.id);
    if (index >= 0) physicalDrops[index] = row;
    else physicalDrops.push(row);
    return row;
  },
  removeNetworkDrop(id) {
    const index = physicalDrops.findIndex((item) => item.id === id);
    if (index >= 0) physicalDrops.splice(index, 1);
    return index >= 0;
  },
  applyDroppedWeaponsSnapshot(rows) {
    physicalDrops.splice(0, physicalDrops.length, ...rows.map(copy));
  },
  removeWeapon(id) {
    if (hostInventory.primary?.id === id) hostInventory.primary = null;
    if (hostInventory.secondary?.id === id) hostInventory.secondary = null;
    this.currentId = hostInventory.primary?.id || hostInventory.secondary?.id || 'knife';
    hostInventory.currentId = this.currentId;
    return true;
  },
  acceptPickup(entry) {
    const slot = entry.id === 'deagle' ? 'secondary' : 'primary';
    hostInventory[slot] = { ...entry };
    hostInventory.currentId = entry.id;
    this.currentId = entry.id;
    return true;
  },
};

const map = {
  spawns: {
    CT: [{ x: -4, y: 0.05, z: 10, yaw: 180 }, { x: 4, y: 0.05, z: 10, yaw: 180 }],
    T: [{ x: -4, y: 0.05, z: -10, yaw: 0 }, { x: 4, y: 0.05, z: -10, yaw: 0 }],
  },
};

const hostGame = {
  player: hostPlayer,
  weapons: hostWeapons,
  map,
  ui: { toast() {}, showCenterMessage() {} },
  audio: { play() {} },
  effects: {},
  showClassicBanner() {},
};

const hostSession = {
  role: 'host',
  localPlayerId: 'host',
  code: 'ABCDE',
  broadcast(type, payload, exceptId) {
    broadcasts.push({ type, payload: copy(payload), exceptId });
    return true;
  },
  sendTo(playerId, type, payload) {
    sent.push({ playerId, type, payload: copy(payload) });
    return true;
  },
};

const roster = [
  { id: 'host', name: 'Host', team: 'CT', slot: 0, isHost: true, connected: true },
  { id: 'guest', name: 'Guest', team: 'T', slot: 1, isHost: false, connected: true },
];

const hostMatch = new OnlineMatch(hostGame, hostSession, {
  role: 'host',
  localPlayerId: 'host',
  players: roster,
  map: 'aim_forge',
});
hostMatch._started = true;
hostMatch.phase = 'live';
hostMatch._spawnLocal = () => {};
hostMatch._spawnRemote = () => {};

const guestState = {
  playerId: 'guest',
  pos: { x: 0, y: 0.05, z: -8 },
  yaw: 0,
  pitch: 0,
  crouch: false,
  onGround: true,
  moveSpeed: 0,
  weaponId: 'ak47',
  alive: true,
  inventory: {
    primary: { id: 'ak47', magazine: 13, reserve: 44 },
    secondary: { id: 'deagle', magazine: 5, reserve: 21 },
    grenades: {},
    currentId: 'ak47',
    lastId: 'deagle',
  },
};

const guestRecord = hostMatch.players.get('guest');
guestRecord.inventory.primary.magazine=13;guestRecord.inventory.primary.reserve=44;
guestState.inventory.primary.magazine=999;guestState.inventory.primary.reserve=999;
hostMatch._acceptState('guest', guestState);
assert.equal(guestRecord.inventory.primary.magazine,13,'untrusted state cannot refill authoritative ammo');
assert.equal(guestRecord.inventory.primary.reserve,44,'untrusted state cannot refill reserve');

const drop = hostMatch._hostCreateDrop('guest', {
  entry: { id: 'ak47', magazine: 999, reserve: 999 },
  pos: { x: 0, y: 0.05, z: -8 },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
});
assert.ok(drop?.id, 'guest drop is accepted for the weapon in the authoritative slot');
assert.equal(drop.entry.magazine, 13, 'drop magazine comes from host mirror, not request payload');
assert.equal(drop.entry.reserve, 44, 'drop reserve comes from host mirror, not request payload');
assert.equal(guestRecord.inventory.primary, null, 'authoritative drop clears the remote primary slot');

hostMatch._acceptState('guest', guestState);
assert.equal(guestRecord.inventory.primary, null, 'stale pre-ack state cannot resurrect the dropped primary');
assert.notEqual(guestRecord.weaponId, 'ak47', 'stale current weapon cannot resurrect dropped ownership');
assert.equal(
  hostMatch._hostCreateDrop('guest', {
    entry: { id: 'ak47', magazine: 13, reserve: 44 },
    pos: { x: 0, y: 0.05, z: -8 },
  }),
  null,
  'duplicate drop request is rejected after authoritative slot clear',
);

const physicalDrop = physicalDrops.find((item) => item.id === drop.id);
physicalDrop.pickableAt = Date.now() / 1000 - 1;
physicalDrop.position = [0, 0.05, -8];
physicalDrop.pos = { x: 0, y: 0.05, z: -8 };
drop.pickableAt = physicalDrop.pickableAt;
drop.position = [...physicalDrop.position];
drop.pos = { ...physicalDrop.pos };
assert.equal(hostMatch._hostGrantPickup('guest', drop.id), true, 'first simultaneous pickup wins');
assert.equal(hostMatch._hostGrantPickup('guest', drop.id), false, 'second simultaneous pickup loses after atomic removal');
assert.equal(guestRecord.inventory.primary?.id, 'ak47');
assert.equal(guestRecord.inventory.primary?.magazine, 13);
assert.equal(guestRecord.inventory.primary?.reserve, 44);

// A reconnect can happen after the peer missed roundStart. The host stores the
// authoritative spawn/loadout and sends it directly when the seat reconnects.
hostMatch.phase = 'roundover';
hostMatch.roundResetAt = Date.now();
hostMatch._hostStartNextRound();
const authoritativeGuestState = copy(hostMatch.players.get('guest').lastState);
assert.ok(authoritativeGuestState?.pos, 'next round stores authoritative spawn state');

const syncDrop = {
  id: 'sync-drop',
  weaponId: 'deagle',
  entry: { id: 'deagle', magazine: 3, reserve: 11 },
  ammo: { magazine: 3, reserve: 11 },
  pos: { x: 1, y: 0.05, z: 1 },
  position: [1, 0.05, 1],
  velocity: [0, 0, 0],
  pickableAt: Date.now() / 1000 - 1,
  armed: true,
  grounded: true,
};
physicalDrops.splice(0, physicalDrops.length, copy(syncDrop));
hostMatch.drops.set(syncDrop.id, copy(syncDrop));
sent.length = 0;
assert.equal(hostMatch.setPlayerConnected('guest', true), true);
const syncEvent = sent.findLast((event) => event.type === 'playerSync');
assert.ok(syncEvent, 'reconnected guest receives targeted playerSync');
assert.equal(syncEvent.playerId, 'guest');
assert.equal(syncEvent.payload.phase, 'countdown');
assert.equal(syncEvent.payload.roundNumber, 2);
assert.deepEqual(syncEvent.payload.player.state.pos, authoritativeGuestState.pos);
assert.equal(syncEvent.payload.player.inventory.primary?.id, 'ak47');
assert.equal(syncEvent.payload.player.inventory.secondary?.id, 'deagle');
assert.equal(syncEvent.payload.drops.length, 1);
assert.equal(syncEvent.payload.drops[0].id, 'sync-drop');

const guestInventory = {
  primary: null,
  secondary: null,
  grenades: { he: 0, flash: 0, smoke: 0 },
  currentId: 'knife',
  lastId: null,
};
const guestDrops = [];
const guestMatchEnds = [];
const guestPlayer = {
  team: 'T',
  alive: false,
  health: 0,
  armor: 0,
  helmet: false,
  pos: new THREE.Vector3(50, 0.05, 50),
  vel: new THREE.Vector3(4, 0, 4),
  yaw: 1,
  pitch: 0.2,
  crouching: true,
  onGround: false,
};
const guestGame = {
  player: guestPlayer,
  map,
  weapons: {
    inventory: guestInventory,
    applyInventorySnapshot(snapshot) {
      Object.assign(guestInventory, copy(snapshot));
      return true;
    },
    applyDroppedWeaponsSnapshot(rows) {
      guestDrops.splice(0, guestDrops.length, ...rows.map(copy));
      return true;
    },
  },
  ui: { showCenterMessage() {} },
  audio: { play() {} },
  input: { exitPointerLock() {} },
  onOnlineMatchEnd(data) { guestMatchEnds.push(data); },
};
const guestSession = { role: 'guest', localPlayerId: 'guest', code: 'ABCDE' };
const guestMatch = new OnlineMatch(guestGame, guestSession, {
  role: 'guest',
  localPlayerId: 'guest',
  players: roster,
  map: 'aim_forge',
});
guestMatch._started = true;
guestMatch.local.alive = false;
guestMatch.local.health = 0;
guestMatch.handleMessage('playerSync', syncEvent.payload, 'host');
assert.equal(guestMatch.phase, 'countdown');
assert.equal(guestMatch.roundNumber, 2);
assert.equal(guestPlayer.alive, true, 'rejoin restores authoritative alive state');
assert.equal(guestPlayer.health, 100);
assert.deepEqual(
  { x: guestPlayer.pos.x, y: guestPlayer.pos.y, z: guestPlayer.pos.z },
  authoritativeGuestState.pos,
  'rejoin restores the round spawn that was missed while disconnected',
);
assert.equal(guestPlayer.vel.lengthSq(), 0, 'rejoin clears stale movement velocity');
assert.equal(guestInventory.primary?.id, 'ak47');
assert.equal(guestInventory.secondary?.id, 'deagle');
assert.deepEqual(guestDrops.map((item) => item.id), ['sync-drop']);

hostMatch.phase = 'over';
hostMatch.roundWinner = 'CT';
hostMatch.teamScores.CT = hostMatch.targetRounds;
sent.length = 0;
hostMatch.setPlayerConnected('guest', true);
const endSync = sent.findLast((event) => event.type === 'playerSync');
assert.equal(endSync?.payload.winnerTeam, 'CT');
guestMatch.handleMessage('playerSync', endSync.payload, 'host');
assert.equal(guestMatch._over, true, 'rejoin after missed matchEnd restores terminal match state');
assert.equal(guestMatchEnds.length, 1, 'rejoin after missed matchEnd restores match-end UI callback');

// Session must reject forged host-authoritative resync packets from guests.
const routed = [];
const guardedSession = new OnlineSession(null, {
  onMatchMessage(type, payload, senderId) { routed.push({ type, payload, senderId }); },
});
const fakeConn = { open: true };
guardedSession._role = 'host';
guardedSession._closed = false;
guardedSession._started = true;
guardedSession._playerId = 'host001';
guardedSession._lobby = {
  code: 'ABCDE', maxPlayers: 2, hostId: 'host001',
  roster: {
    host001: { id: 'host001', name: 'Host', team: 'CT', slot: 0, isHost: true, connected: true },
    guest01: { id: 'guest01', name: 'Guest', team: 'T', slot: 1, isHost: false, connected: true },
  },
};
guardedSession._connPlayers.set(fakeConn, 'guest01');
guardedSession._onData({ t: 'playerSync', p: { playerId: 'host001' } }, fakeConn);
assert.equal(routed.length, 0, 'guest cannot forge playerSync into the host match');

// Secondary is a single slot in the buy rules, matching drop/pickup semantics.
const buyPlayer = {
  team: 'CT', money: 5000, alive: true,
  pos: new THREE.Vector3(), yaw: 0,
  addMoney(delta) { this.money += delta; },
};
const buyGame = { scene: null, player: buyPlayer, ui: { toast() {} } };
const buyWeapons = new WeaponSystem(buyGame);
buyWeapons.resetForMatch('CT');
const moneyBefore = buyPlayer.money;
assert.equal(buyWeapons._buyItemInfo('deagle', 'CT', buyPlayer.money)?.available, false);
const buyResult = buyWeapons.buyItem('deagle');
assert.equal(buyResult.ok, false, 'occupied secondary slot blocks buying another pistol');
assert.equal(buyWeapons.inventory.secondary?.id, 'usp');
assert.equal(buyPlayer.money, moneyBefore);
buyWeapons.dispose();

console.log('online-authority-sync OK: authoritative inventory, de-dup, rejoin sync and secondary slot');
