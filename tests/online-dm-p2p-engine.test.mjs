import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OnlineMatch } from '../src/online/match.js';

const clone = (value) => structuredClone(value);

const HOST_ID = 'host-ct';
const GUEST_ID = 'guest-ct';
const roster = [
  { id: HOST_ID, name: 'HostCT', team: 'CT', slot: 0, isHost: true, connected: true },
  { id: GUEST_ID, name: 'GuestCT', team: 'CT', slot: 1, isHost: false, connected: true },
];

function makePlayer(name, x) {
  return {
    team: 'CT', name, alive: true, health: 100, armor: 100, helmet: false,
    kills: 0, deaths: 0, hasDefuseKit: false,
    pos: new THREE.Vector3(x, 0.05, 0),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouching: false, onGround: true, speed: 0,
    getVelocity2D() { return Math.hypot(this.vel.x, this.vel.z); },
    addShake() {},
  };
}

function makeWeapons(primaryId = 'm4a1') {
  const api = {
    inventory: {
      primary: { id: primaryId, magazine: 30, reserve: 999 },
      secondary: { id: 'deagle', magazine: 7, reserve: 999 },
      grenades: { he: 0, flash: 0, smoke: 0 },
      currentId: primaryId,
      lastId: null,
    },
    currentId: primaryId,
    reloading: false,
    getInventorySnapshot() { return clone(this.inventory); },
    applyInventorySnapshot(snapshot) {
      this.inventory = clone(snapshot);
      this.currentId = this.inventory.currentId || this.currentId;
      return true;
    },
    serializeDroppedWeapons() { return []; },
  };
  return api;
}

function makeGame(name, x) {
  const player = makePlayer(name, x);
  const weapons = makeWeapons();
  const spawns = [];
  const game = {
    scene: new THREE.Scene(),
    player,
    weapons,
    time: 0,
    map: {
      id: 'de_dust2_dm',
      bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
      deathmatchSpawns: [
        { x: -30, y: 0.05, z: 0, yaw: 90 },
        { x: 30, y: 0.05, z: 0, yaw: -90 },
        { x: 0, y: 0.05, z: 30, yaw: 180 },
      ],
      spawns: {
        CT: [{ x: -10, y: 0.05, z: 0, yaw: 90 }, { x: 10, y: 0.05, z: 0, yaw: -90 }],
        T: [{ x: 0, y: 0.05, z: 10, yaw: 180 }],
      },
    },
    physics: {
      raycast() { return null; },
      isPositionFree() { return true; },
    },
    audio: { play() {} },
    ui: {
      toast() {}, showCenterMessage() {}, showKillConfirm() {}, showHitmarker() {}, flashDamage() {},
    },
    classicUI: { hud: { notifyDamage() {} } },
    effects: {},
    showClassicBanner() {},
    addKillFeed() {},
    spawnOnlinePlayer(team, spawn) {
      spawns.push({ team, ...spawn });
      player.team = team;
      player.pos.set(spawn.x, spawn.y, spawn.z);
      player.vel.set(0, 0, 0);
      player.health = 100;
      player.armor = 100;
      player.alive = true;
      player.onGround = true;
    },
  };
  return { game, player, weapons, spawns };
}

const hostSide = makeGame('HostCT', -5);
const guestSide = makeGame('GuestCT', 5);
const wire = [];
let hostMatch;
let guestMatch;

function deliver(to, type, payload, senderId) {
  to.handleMessage(type, clone(payload), senderId);
}

const hostSession = {
  role: 'host', localPlayerId: HOST_ID, code: 'DMLOOP',
  broadcast(type, payload, exceptId = null) {
    wire.push({ from: HOST_ID, to: '*', type, payload: clone(payload), exceptId });
    if (exceptId !== GUEST_ID) deliver(guestMatch, type, payload, HOST_ID);
    return true;
  },
  sendTo(playerId, type, payload) {
    wire.push({ from: HOST_ID, to: playerId, type, payload: clone(payload) });
    if (playerId === GUEST_ID) deliver(guestMatch, type, payload, HOST_ID);
    return playerId === GUEST_ID;
  },
};

const guestSession = {
  role: 'guest', localPlayerId: GUEST_ID, code: 'DMLOOP',
  sendToHost(type, payload) {
    wire.push({ from: GUEST_ID, to: HOST_ID, type, payload: clone(payload) });
    deliver(hostMatch, type, payload, GUEST_ID);
    return true;
  },
};

const startPayload = {
  mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm', targetKills: 0,
  players: roster,
};
hostMatch = new OnlineMatch(hostSide.game, hostSession, {
  ...startPayload, role: 'host', localPlayerId: HOST_ID,
});
guestMatch = new OnlineMatch(guestSide.game, guestSession, {
  ...startPayload, role: 'guest', localPlayerId: GUEST_ID,
});

// This is an engine/P2P protocol test, not a renderer test. Keep remote-avatar
// construction out while preserving every OnlineMatch state transition/message.
hostMatch._ensureRemotePlayer = () => null;
guestMatch._ensureRemotePlayer = () => null;
hostMatch._spawnRemote = (record, spawn) => { record.__remoteSpawn = { ...spawn }; };
guestMatch._spawnRemote = (record, spawn) => { record.__remoteSpawn = { ...spawn }; };
hostMatch._started = true;
guestMatch._started = true;
hostMatch.phase = 'live';
guestMatch.phase = 'live';

assert.equal(hostMatch.local.team, 'CT');
assert.equal(guestMatch.local.team, 'CT');
assert.equal(hostMatch.players.get(GUEST_ID).team, 'CT');
assert.equal(guestMatch.players.get(HOST_ID).team, 'CT');

// Host raycast authority decides the other CT is the target. This isolates the
// protocol and damage authority while still exercising notifyLocalShot -> shot.
hostMatch._deathmatchRaycast = (_origin, _dir, _range, shooterId) => {
  if (shooterId === GUEST_ID) {
    return {
      type: 'player', entity: hostSide.player, part: 'head', damageMult: 4,
      point: new THREE.Vector3(hostSide.player.pos.x, hostSide.player.pos.y + 1.7, hostSide.player.pos.z),
    };
  }
  return {
    type: 'remote', entity: { onlinePlayerId: GUEST_ID }, part: 'head', damageMult: 4,
    point: new THREE.Vector3(guestSide.player.pos.x, guestSide.player.pos.y + 1.7, guestSide.player.pos.z),
  };
};

// B-buy is applied locally first (Game.buyItem contract), then notifyLocalPurchase
// asks the host to authorize ownership. The ordered transport must process dmBuy
// before a subsequent shot from the same client.
guestSide.weapons.inventory.primary = { id: 'ak47', magazine: 30, reserve: 999 };
guestSide.weapons.inventory.lastId = 'm4a1';
guestSide.weapons.inventory.currentId = 'ak47';
guestSide.weapons.currentId = 'ak47';
assert.equal(guestMatch.notifyLocalPurchase('ak47'), true);
assert.equal(hostMatch.players.get(GUEST_ID).inventory.primary?.id, 'ak47');
assert.equal(hostMatch.players.get(GUEST_ID).weaponId, 'ak47');
assert.equal(guestMatch.local.inventory.primary?.id, 'ak47');
assert.equal(guestMatch.local.weaponId, 'ak47');
assert.deepEqual(
  wire.filter((packet) => packet.type === 'dmBuy' || packet.type === 'dmBuyResult').map((packet) => packet.type),
  ['dmBuy', 'dmBuyResult'],
  'purchase request/authority confirmation keeps ordered P2P delivery',
);
const firstBuyRequest = wire.find((packet) => packet.type === 'dmBuy');
const buyResultsBeforeReplay = wire.filter((packet) => packet.type === 'dmBuyResult').length;
deliver(hostMatch, 'dmBuy', firstBuyRequest.payload, GUEST_ID);
assert.equal(hostMatch.players.get(GUEST_ID).inventory.primary?.id, 'ak47');
assert.equal(
  wire.filter((packet) => packet.type === 'dmBuyResult').length,
  buyResultsBeforeReplay,
  'replayed purchase seq is ignored without duplicating confirmation/state changes',
);

// Send the real guest state so the host can validate the shot origin.
guestMatch._sendState(true);
assert.equal(hostMatch.players.get(GUEST_ID).lastState?.weaponId, 'ak47');
assert.equal(hostMatch.players.get(GUEST_ID).lastState?.pos?.x, guestSide.player.pos.x);

// GUEST CT kills HOST CT. Guest starts wounded to prove the confirmed kill refill.
guestSide.player.health = 18;
guestSide.player.armor = 6;
guestMatch.local.health = 18;
guestMatch.local.armor = 6;
hostMatch.players.get(GUEST_ID).health = 18;
hostMatch.players.get(GUEST_ID).armor = 6;
hostSide.player.health = 35;
hostSide.player.armor = 11;
hostMatch.local.health = 35;
hostMatch.local.armor = 11;

const guestKillStartedAt = Date.now();
guestMatch.notifyLocalShot({
  origin: { x: guestSide.player.pos.x, y: guestSide.player.pos.y + 1.62, z: guestSide.player.pos.z },
  dir: { x: -1, y: 0, z: 0 },
  weaponId: 'ak47',
});

const hostDeathDeadline = hostMatch.local.respawnAt;
assert.equal(hostSide.player.alive, false, 'guest CT can kill host CT in FFA');
assert.equal(hostMatch.local.deaths, 1);
assert.equal(guestMatch.players.get(HOST_ID).deaths, 1);
assert.equal(hostMatch.players.get(GUEST_ID).kills, 1);
assert.equal(guestMatch.local.kills, 1);
assert.equal(guestSide.player.health, 100, 'guest killer gets authoritative 100 HP');
assert.equal(guestSide.player.armor, 100, 'guest killer gets authoritative 100 armor');
assert.equal(guestMatch.local.health, 100);
assert.equal(guestMatch.local.armor, 100);
assert.ok(
  hostDeathDeadline - guestKillStartedAt >= 1250 && hostDeathDeadline - guestKillStartedAt <= 1500,
  `host respawn deadline drifted from 1.35s: ${hostDeathDeadline - guestKillStartedAt}ms`,
);

const firstKillPacket = wire.find((packet) => packet.type === 'kill');
assert.ok(firstKillPacket, 'first authoritative kill packet exists');
assert.equal(firstKillPacket.payload.killerId, GUEST_ID);
assert.equal(firstKillPacket.payload.victimId, HOST_ID);
assert.equal(firstKillPacket.payload.killerHealth, 100);
assert.equal(firstKillPacket.payload.killerArmor, 100);

// Duplicate/replayed host kill packet cannot duplicate score or refill.
guestSide.player.health = 63;
guestSide.player.armor = 41;
guestMatch.local.health = 63;
guestMatch.local.armor = 41;
deliver(guestMatch, 'kill', firstKillPacket.payload, HOST_ID);
assert.equal(guestMatch.local.kills, 1);
assert.equal(guestSide.player.health, 63, 'replayed kill does not re-heal');
assert.equal(guestSide.player.armor, 41);

// Advance authoritative time to the exact Deathmatch respawn deadline.
hostMatch._hostUpdateDeathmatchRespawns(hostDeathDeadline + 1);
assert.equal(hostSide.player.alive, true);
assert.equal(hostSide.player.health, 100);
assert.equal(hostSide.player.armor, 100);
assert.equal(guestMatch.players.get(HOST_ID).alive, true, 'guest sees host authoritative respawn');
assert.equal(guestMatch.players.get(HOST_ID).health, 100);
assert.equal(guestMatch.players.get(HOST_ID).armor, 100);

// HOST CT now kills GUEST CT. Host also starts wounded to prove both directions.
hostSide.player.health = 24;
hostSide.player.armor = 9;
hostMatch.local.health = 24;
hostMatch.local.armor = 9;
guestSide.player.health = 20;
guestSide.player.armor = 0;
guestSide.player.alive = true;
guestMatch.local.health = 20;
guestMatch.local.armor = 0;
guestMatch.local.alive = true;
const authoritativeGuest = hostMatch.players.get(GUEST_ID);
authoritativeGuest.health = 20;
authoritativeGuest.armor = 0;
authoritativeGuest.alive = true;
authoritativeGuest.respawnAt = 0;

const hostKillStartedAt = Date.now();
hostMatch.notifyLocalShot({
  origin: { x: hostSide.player.pos.x, y: hostSide.player.pos.y + 1.62, z: hostSide.player.pos.z },
  dir: { x: 1, y: 0, z: 0 },
  weaponId: 'm4a1',
});

const guestDeathDeadline = authoritativeGuest.respawnAt;
assert.equal(guestSide.player.alive, false, 'host CT can kill guest CT in FFA');
assert.equal(authoritativeGuest.deaths, 1);
assert.equal(guestMatch.local.deaths, 1);
assert.equal(hostMatch.local.kills, 1);
assert.equal(guestMatch.players.get(HOST_ID).kills, 1);
assert.equal(hostSide.player.health, 100, 'host killer gets authoritative 100 HP');
assert.equal(hostSide.player.armor, 100, 'host killer gets authoritative 100 armor');
assert.ok(
  guestDeathDeadline - hostKillStartedAt >= 1250 && guestDeathDeadline - hostKillStartedAt <= 1500,
  `guest respawn deadline drifted from 1.35s: ${guestDeathDeadline - hostKillStartedAt}ms`,
);

const killPackets = wire.filter((packet) => packet.type === 'kill');
assert.equal(killPackets.length, 2, 'exactly one authoritative kill packet per confirmed death');
assert.deepEqual(
  killPackets.map((packet) => [packet.payload.killerId, packet.payload.victimId]),
  [[GUEST_ID, HOST_ID], [HOST_ID, GUEST_ID]],
);

// Guest respawns from the host event. Then replaying its old kill packet must not
// kill it again because the respawn carries a newer authoritySeq/lifeSeq.
hostMatch._hostUpdateDeathmatchRespawns(guestDeathDeadline + 1);
assert.equal(guestSide.player.alive, true);
assert.equal(guestSide.player.health, 100);
assert.equal(guestSide.player.armor, 100);
assert.equal(hostMatch.players.get(GUEST_ID).alive, true);
assert.equal(hostMatch.players.get(GUEST_ID).health, 100);
assert.equal(hostMatch.players.get(GUEST_ID).armor, 100);

const secondKillPacket = killPackets[1];
deliver(guestMatch, 'kill', secondKillPacket.payload, HOST_ID);
assert.equal(guestSide.player.alive, true, 'stale kill replay cannot undo newer respawn');
assert.equal(guestMatch.local.deaths, 1);
assert.equal(guestMatch.players.get(HOST_ID).kills, 1);

// Final snapshot is the same reconciliation path used during a real match.
hostMatch._sendSnapshot(Date.now());
assert.equal(hostMatch.local.kills, 1);
assert.equal(hostMatch.local.deaths, 1);
assert.equal(authoritativeGuest.kills, 1);
assert.equal(authoritativeGuest.deaths, 1);
assert.equal(guestMatch.players.get(HOST_ID).kills, 1);
assert.equal(guestMatch.players.get(HOST_ID).deaths, 1);
assert.equal(guestMatch.local.kills, 1);
assert.equal(guestMatch.local.deaths, 1);
assert.equal(hostSide.player.alive, true);
assert.equal(guestSide.player.alive, true);
assert.equal(hostSide.player.health, 100);
assert.equal(hostSide.player.armor, 100);
assert.equal(guestSide.player.health, 100);
assert.equal(guestSide.player.armor, 100);

const p2pTypes = wire.map((packet) => packet.type);
assert.ok(p2pTypes.indexOf('dmBuy') < p2pTypes.indexOf('shot'), 'purchase authority arrives before guest shot');
assert.equal(wire.filter((packet) => packet.type === 'respawn').length, 2, 'one authoritative respawn per death');

console.log(
  'Online DM engine P2P OK: CT/CT reciprocal kills, ordered buy authority, 100/100 refill, 1.35s respawns and replay de-duplication',
);
