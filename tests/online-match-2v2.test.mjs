import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OnlineMatch } from '../src/online/match.js';
import { OnlineSession } from '../src/online/session.js';

const player = {
  team: 'CT', name: 'Host', alive: true, health: 100, armor: 100, helmet: false,
  pos: new THREE.Vector3(-3, .05, 9), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0,
  crouching: false, onGround: true, speed: 0,
  getVelocity2D() { return Math.hypot(this.vel.x, this.vel.z); },
  addShake() {},
};
const inventory = {
  primary: { id: 'm4a1', magazine: 19, reserve: 71 },
  secondary: { id: 'deagle', magazine: 7, reserve: 35 },
  grenades: {}, currentId: 'm4a1', lastId: null,
};
const drops = [];
const broadcasts = [];
const weapons = {
  currentId: 'm4a1', reloading: false, inventory,
  getInventorySnapshot() { return JSON.parse(JSON.stringify(inventory)); },
  serializeDroppedWeapons() { return drops.map((d) => ({ ...d })); },
  spawnNetworkDrop(drop) {
    const row = { ...drop, position: drop.position || [drop.pos.x, drop.pos.y, drop.pos.z] };
    const i = drops.findIndex((d) => d.id === row.id);
    if (i >= 0) drops[i] = row; else drops.push(row);
    return row;
  },
  removeNetworkDrop(id) {
    const i = drops.findIndex((d) => d.id === id);
    if (i >= 0) drops.splice(i, 1);
  },
  applyDroppedWeaponsSnapshot(rows) {
    drops.splice(0, drops.length, ...rows.map((d) => ({ ...d })));
  },
  removeWeapon(id) {
    if (inventory.primary?.id === id) inventory.primary = null;
    if (inventory.secondary?.id === id) inventory.secondary = null;
    this.currentId = inventory.primary?.id || inventory.secondary?.id || 'knife';
    inventory.currentId = this.currentId;
    return true;
  },
  acceptPickup(entry) {
    inventory.primary = { ...entry };
    this.currentId = entry.id;
    inventory.currentId = entry.id;
    return true;
  },
};
const game = {
  scene: new THREE.Scene(), player, weapons, time: 0,
  map: {
    id: 'aim_forge',
    spawns: {
      CT: [
        { x: -4, y: .05, z: 10, yaw: 180 }, { x: 4, y: .05, z: 10, yaw: 180 },
        { x: -7, y: .05, z: 8, yaw: 180 }, { x: 7, y: .05, z: 8, yaw: 180 },
      ],
      T: [
        { x: -4, y: .05, z: -10, yaw: 0 }, { x: 4, y: .05, z: -10, yaw: 0 },
        { x: -7, y: .05, z: -8, yaw: 0 }, { x: 7, y: .05, z: -8, yaw: 0 },
      ],
    },
  },
  audio: { play() {} },
  ui: { toast() {}, showCenterMessage() {}, showKillConfirm() {}, flashDamage() {} },
  effects: {},
  showClassicBanner() {},
  addKillFeed() {},
  spawnOnlinePlayer(team, spawn) {
    player.team = team;
    player.pos.set(spawn.x, spawn.y, spawn.z);
    player.health = 100;
    player.armor = 100;
    player.alive = true;
  },
};
const session = {
  role: 'host', localPlayerId: 'h', code: 'ABCDE',
  broadcast(type, payload) { broadcasts.push({ type, payload }); return true; },
  sendTo() { return true; },
  resetToLobby() { return true; },
};
const players = [
  { id: 'h', name: 'Host', team: 'CT', slot: 0, isHost: true },
  { id: 'c2', name: 'Mate', team: 'CT', slot: 1 },
  { id: 'g1', name: 'Enemy1', team: 'T', slot: 0 },
  { id: 'g2', name: 'Enemy2', team: 'T', slot: 1 },
];
const match = new OnlineMatch(game, session, {
  role: 'host', localPlayerId: 'h', mode: '2v2', maxPlayers: 4,
  targetRounds: 3, map: 'aim_forge', players, spawnRolls: {},
});
match.start();
match.phase = 'live';

assert.equal(match.getRoster().length, 4);
assert.equal(match.getRemoteEntities().length, 3);
match._hostKill('h', 'g1', 'm4a1', false);
assert.equal(match.phase, 'live', 'round continues while one T is alive');
match._hostKill('c2', 'g2', 'm4a1', false);
assert.equal(match.phase, 'roundover');
assert.equal(match.teamScores.CT, 1);
match._hostStartNextRound();
assert.equal(match.roundNumber, 2);
assert.equal([...match.players.values()].every((p) => p.alive), true);
const roundStart = broadcasts.findLast((event) => event.type === 'roundStart')?.payload;
assert.ok(roundStart, 'host broadcasts the authoritative next-round spawns');
for (const team of ['CT', 'T']) {
  const teamIds = players.filter((p) => p.team === team).map((p) => p.id);
  const positions = roundStart.respawns
    .filter((spawn) => teamIds.includes(spawn.playerId))
    .map((spawn) => `${spawn.x},${spawn.z}`);
  assert.equal(new Set(positions).size, teamIds.length, `${team} teammates receive unique round spawns`);
}

match.local.inventory = weapons.getInventorySnapshot();
match.local.weaponId = 'm4a1';
const drop = match._hostCreateDrop('h', {
  entry: { id: 'm4a1', magazine: 19, reserve: 71 },
  pos: { x: player.pos.x, y: player.pos.y + .2, z: player.pos.z - .6 },
  velocity: { x: 0, y: .4, z: -1 }, yaw: 0,
});
assert.ok(drop?.id);
assert.equal(inventory.primary, null, 'accepted drop removes owner weapon');
assert.equal(
  match._hostCreateDrop('h', { entry: { id: 'm4a1', magazine: 19, reserve: 71 }, pos: drop.pos }),
  null,
  'duplicate drop rejected',
);

drop.pickableAt = Date.now() / 1000 - .01;
drop.pos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
drop.position = [player.pos.x, player.pos.y, player.pos.z];
match.drops.set(drop.id, drop);
weapons.applyDroppedWeaponsSnapshot([drop]);
assert.equal(match._hostGrantPickup('h', drop.id), true);
assert.equal(inventory.primary?.id, 'm4a1');
assert.equal(inventory.primary?.magazine, 19);
assert.equal(inventory.primary?.reserve, 71);
assert.equal(match.drops.has(drop.id), false);

// Host must ignore client-forged authoritative weapon events.
const hostPrimary = inventory.primary?.id;
match.handleMessage('weaponDropAccepted', { playerId: 'h', weaponId: hostPrimary }, 'g1');
assert.equal(inventory.primary?.id, hostPrimary, 'guest cannot force the host to drop a weapon');
match.handleMessage('weaponPickupGranted', {
  playerId: 'h', dropId: 'fake-drop', entry: { id: 'ak47', magazine: 30, reserve: 90 },
}, 'g1');
assert.equal(inventory.primary?.id, hostPrimary, 'guest cannot grant a weapon to the host');

match.dispose();

// Session-level authority: READY cannot mutate an active match and host-only
// match events arriving from a guest connection are discarded before dispatch.
const sessionEvents = [];
const sessionErrors = [];
const guardedSession = new OnlineSession(null, {
  onMatchMessage(type, payload, senderId) { sessionEvents.push({ type, payload, senderId }); },
  onError(message) { sessionErrors.push(message); },
});
const hostId = 'host001';
const guestId = 'guest01';
const fakeConn = { open: true };
guardedSession._role = 'host';
guardedSession._closed = false;
guardedSession._started = true;
guardedSession._playerId = hostId;
guardedSession._lobby = {
  code: 'ABCDE', mode: '1v1', maxPlayers: 2, map: 'aim_forge', targetKills: 13, hostId,
  roster: {
    [hostId]: { id: hostId, name: 'Host', team: 'CT', slot: 0, ready: true, connected: true, isHost: true },
    [guestId]: { id: guestId, name: 'Guest', team: 'T', slot: 1, ready: true, connected: true, isHost: false },
  },
};
guardedSession._connPlayers.set(fakeConn, guestId);
guardedSession._onData({ t: 'ready', ready: false }, fakeConn);
assert.equal(guardedSession._lobby.roster[guestId].ready, true, 'READY is frozen once the match starts');
guardedSession._onData({ t: 'playerDisconnected', p: { playerId: hostId } }, fakeConn);
guardedSession._onData({ t: 'weaponDropAccepted', p: { playerId: hostId, weaponId: 'm4a1' } }, fakeConn);
assert.equal(sessionEvents.length, 0, 'guest cannot inject host-authoritative match events');
guardedSession._onData({ t: 'state', p: { playerId: guestId, pos: { x: 0, y: 0, z: 0 } } }, fakeConn);
assert.equal(sessionEvents.at(-1)?.type, 'state', 'guest state still reaches the match handler');
guardedSession._onData({ t: 'full', message: 'forged' }, fakeConn);
assert.equal(sessionErrors.length, 0, 'guest cannot surface a forged room-full error on the host');

// Initial 2v2 spawn rolls are separated per team so teammates cannot overlap.
let hostStartPayload = null;
const lifecycleEvents = [];
const startSession = new OnlineSession(null, {
  onStart(payload) { hostStartPayload = payload; },
  onMatchMessage(type, payload, senderId) { lifecycleEvents.push({ type, payload, senderId }); },
});
const initialPlayers = [
  { id: 'host001', name: 'Host', team: 'CT', slot: 0, ready: true, connected: true, isHost: true },
  { id: 'guest01', name: 'Enemy', team: 'T', slot: 1, ready: true, connected: true, isHost: false },
  { id: 'mate002', name: 'Mate', team: 'CT', slot: 2, ready: true, connected: true, isHost: false },
  { id: 'enemy02', name: 'Enemy2', team: 'T', slot: 3, ready: true, connected: true, isHost: false },
];
startSession._role = 'host';
startSession._closed = false;
startSession._code = 'ABCDE';
startSession._playerId = 'host001';
startSession._lobby = {
  code: 'ABCDE', mode: '2v2', maxPlayers: 4, map: 'aim_forge', targetKills: 13, hostId: 'host001',
  roster: Object.fromEntries(initialPlayers.map((p) => [p.id, { ...p }])),
};
for (const p of initialPlayers.slice(1)) {
  const conn = { open: true, send() {}, close() {} };
  startSession._connections.set(p.id, conn);
  startSession._connPlayers.set(conn, p.id);
}
startSession._startMatch();
assert.ok(hostStartPayload, 'host receives the same authoritative start payload');
for (const team of ['CT', 'T']) {
  const ids = initialPlayers.filter((p) => p.team === team).map((p) => p.id);
  const spawnIndexes = ids.map((id) => Math.floor(hostStartPayload.spawnRolls[id] * 2));
  assert.equal(new Set(spawnIndexes).size, ids.length, `${team} teammates cannot overlap with two team spawns`);
}

// Rejoin preserves the authoritative seat/team during the grace period.
let expiryCallback = null;
startSession._setTimer = (fn) => {
  expiryCallback = fn;
  const token = {};
  startSession._timers.add(token);
  return token;
};
const oldGuestConn = startSession._connections.get('guest01');
startSession._onConnClose(oldGuestConn);
assert.equal(startSession._lobby.roster.guest01.connected, false);
const rejoinConn = { open: true, send() {}, close() {} };
startSession._onHello({ name: 'Enemy', playerId: 'guest01', reconnect: true }, rejoinConn);
assert.equal(startSession._lobby.roster.guest01.connected, true);
assert.equal(startSession._lobby.roster.guest01.team, 'T');
assert.equal(startSession._lobby.roster.guest01.slot, 1);
expiryCallback?.();
assert.ok(startSession._lobby.roster.guest01, 'stale expiry cannot remove a rejoined player');

// A player that misses the grace period is removed without closing a 2v2 room.
expiryCallback = null;
const lostConn = startSession._connections.get('enemy02');
startSession._onConnClose(lostConn);
assert.equal(startSession._lobby.roster.enemy02.connected, false);
expiryCallback?.();
assert.equal(startSession._lobby.roster.enemy02, undefined);
assert.equal(startSession.started, true, '2v2 continues after one permanent disconnect');
assert.equal(lifecycleEvents.at(-1)?.type, 'playerDisconnected');

// Rematch returns the surviving roster to the lobby with READY reset.
assert.equal(startSession.resetToLobby(), true);
assert.equal(startSession.started, false);
assert.equal(Object.keys(startSession._lobby.roster).length, 3);
assert.equal(Object.values(startSession._lobby.roster).every((p) => p.ready === false), true);

console.log('online-match-2v2 OK: authority, balanced spawns, team rounds and drops');
