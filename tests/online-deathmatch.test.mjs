import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { OnlineMatch } from '../src/online/match.js';
import { OnlineSession } from '../src/online/session.js';

const makeRoster = (count) => Array.from({ length: count }, (_, index) => ({
  id: index === 0 ? 'host001' : `player${String(index).padStart(2, '0')}`,
  name: index === 0 ? 'Host' : `Player ${index}`,
  team: index < Math.ceil(count / 2) ? 'CT' : 'T',
  slot: index,
  ready: true,
  connected: true,
  isHost: index === 0,
}));

function makeSession(count) {
  let hostStart = null;
  const guestStarts = [];
  const session = new OnlineSession(null, {
    onStart(payload) { hostStart = payload; },
  });
  const roster = makeRoster(count);
  session._role = 'host';
  session._closed = false;
  session._code = 'ABCDE';
  session._playerId = 'host001';
  session._lobby = {
    code: 'ABCDE',
    mode: 'deathmatch',
    maxPlayers: 10,
    map: 'de_dust2_dm',
    targetKills: 0,
    hostId: 'host001',
    roster: Object.fromEntries(roster.map((player) => [player.id, { ...player }])),
  };
  for (const player of roster.slice(1)) {
    const conn = {
      open: true,
      send(message) { guestStarts.push({ playerId: player.id, message }); },
      close() {},
    };
    session._connections.set(player.id, conn);
    session._connPlayers.set(conn, player.id);
  }
  return { session, roster, guestStarts, getHostStart: () => hostStart };
}

// Deathmatch has capacity 10 but may start with any fully-ready roster of 2..10.
{
  const { session, guestStarts, getHostStart } = makeSession(2);
  session._startMatch();
  const start = getHostStart();
  assert.equal(session.started, true, 'deathmatch starts with two ready players');
  assert.equal(start?.mode, 'deathmatch');
  assert.equal(start?.maxPlayers, 10, 'payload advertises room capacity, not current roster size');
  assert.equal(start?.map, 'de_dust2_dm');
  assert.equal(start?.targetKills, 0, 'deathmatch is continuous instead of round-limited');
  assert.equal(start?.players.length, 2);
  assert.equal(guestStarts[0]?.message?.t, 'start');
  assert.equal(guestStarts[0]?.message?.mode, 'deathmatch');
}

// Ten players are retained and receive distinct initial rolls across the shared DM spawn pool.
{
  const { session, getHostStart } = makeSession(10);
  session._startMatch();
  const start = getHostStart();
  assert.equal(start?.players.length, 10);
  const rolls = start.players.map((player) => start.spawnRolls[player.id]);
  assert.equal(rolls.every((roll) => Number.isFinite(roll) && roll >= 0 && roll < 1), true);
  assert.equal(new Set(rolls).size, 10, 'initial FFA spawn rolls are unique for all ten seats');
}

// Guests cannot forge host-authoritative life/reward/purchase-result events, but requests reach the host.
{
  const routed = [];
  const guarded = new OnlineSession(null, {
    onMatchMessage(type, payload, senderId) { routed.push({ type, payload, senderId }); },
  });
  const fakeConn = { open: true };
  guarded._role = 'host';
  guarded._closed = false;
  guarded._started = true;
  guarded._playerId = 'host001';
  guarded._lobby = {
    code: 'ABCDE', mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm', targetKills: 0,
    hostId: 'host001',
    roster: Object.fromEntries(makeRoster(2).map((player) => [player.id, { ...player }])),
  };
  guarded._connPlayers.set(fakeConn, 'player01');
  guarded._onData({ t: 'respawn', p: { playerId: 'host001', x: 999, y: 0, z: 999 } }, fakeConn);
  assert.equal(routed.length, 0, 'guest respawn injection is discarded by OnlineSession');
  guarded._onData({ t: 'environmentDeath', p: { playerId: 'host001', deaths: 99 } }, fakeConn);
  assert.equal(routed.length, 0, 'guest environmentDeath injection is discarded by OnlineSession');
  guarded._onData({ t: 'kill', p: { killerId: 'player01', victimId: 'host001', killReward: true, killerHealth: 100 } }, fakeConn);
  assert.equal(routed.length, 0, 'guest cannot forge a kill/reward event');
  guarded._onData({ t: 'dmBuyResult', p: { playerId: 'player01', accepted: true, weaponId: 'awp' } }, fakeConn);
  assert.equal(routed.length, 0, 'guest cannot forge host purchase confirmation');
  guarded._onData({ t: 'selfDeath', p: { playerId: 'host001', pos: { x: 0, y: -7, z: 0 } } }, fakeConn);
  assert.equal(routed.at(-1)?.type, 'selfDeath', 'selfDeath remains a guest-to-host request');
  assert.equal(routed.at(-1)?.senderId, 'player01', 'session preserves the real sender identity');
  guarded._onData({ t: 'dmBuy', p: { id: 'ak47', seq: 1, playerId: 'host001' } }, fakeConn);
  assert.equal(routed.at(-1)?.type, 'dmBuy', 'dmBuy remains a guest-to-host request');
  assert.equal(routed.at(-1)?.senderId, 'player01', 'purchase request uses authenticated sender identity');
}

const events = [];
const sent = [];
const hostPlayer = {
  team: 'CT', name: 'Host', alive: true, health: 100, armor: 100, helmet: false,
  kills: 0, deaths: 0,
  pos: new THREE.Vector3(0, 0.05, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  crouching: false, onGround: true, speed: 0,
  getVelocity2D() { return Math.hypot(this.vel.x, this.vel.z); },
  addShake() {},
};
const inventory = {
  primary: { id: 'm4a1', magazine: 30, reserve: 999 },
  secondary: { id: 'deagle', magazine: 7, reserve: 999 },
  grenades: { he: 0, flash: 0, smoke: 0 },
  currentId: 'm4a1', lastId: null,
};
const weapons = {
  currentId: 'm4a1',
  reloading: false,
  getInventorySnapshot() { return structuredClone(inventory); },
  serializeDroppedWeapons() { return []; },
};
const hostGame = {
  scene: new THREE.Scene(),
  player: hostPlayer,
  weapons,
  time: 0,
  map: {
    id: 'de_dust2_dm',
    deathmatchSpawns: [
      { x: 10, y: 0.05, z: 0, yaw: 90 },
      { x: 35, y: 0.05, z: 0, yaw: 90 },
      { x: 100, y: 0.05, z: 0, yaw: 90 },
    ],
    spawns: {
      CT: [{ x: 10, y: 0.05, z: 0, yaw: 90 }],
      T: [{ x: -10, y: 0.05, z: 0, yaw: -90 }],
    },
  },
  physics: {
    raycast() { return null; },
    isPositionFree() { return true; },
  },
  audio: { play() {} },
  ui: { toast() {}, showCenterMessage() {}, showKillConfirm() {}, showHitmarker() {}, flashDamage() {} },
  classicUI: { hud: { notifyDamage() {} } },
  effects: {},
  showClassicBanner() {},
  addKillFeed() {},
  spawnOnlinePlayer(team, spawn) {
    hostPlayer.team = team;
    hostPlayer.pos.set(spawn.x, spawn.y, spawn.z);
    hostPlayer.health = 100;
    hostPlayer.armor = 100;
    hostPlayer.alive = true;
  },
};
const hostSession = {
  role: 'host', localPlayerId: 'host001', code: 'ABCDE',
  broadcast(type, payload, exceptId) { events.push({ type, payload, exceptId }); return true; },
  sendTo(playerId, type, payload) { sent.push({ playerId, type, payload }); return true; },
};
const tenPlayers = makeRoster(10);
const match = new OnlineMatch(hostGame, hostSession, {
  role: 'host', localPlayerId: 'host001', mode: 'deathmatch', maxPlayers: 10,
  map: 'de_dust2_dm', players: tenPlayers, targetKills: 0,
});
match._started = true;
match.phase = 'live';
match._spawnRemote = (record, spawn) => { record.__lastSpawn = { ...spawn }; };

assert.equal(match.mode, 'deathmatch');
assert.equal(match.maxPlayers, 10);
assert.equal(match.getRoster().length, 10, 'OnlineMatch keeps all ten FFA players');

// CT/T remain visual identities in Deathmatch: a CT can damage another CT.
const sameVisualTeamTarget = match.players.get('player01');
match._deathmatchRaycast = () => ({
  type: 'remote',
  entity: { onlinePlayerId: sameVisualTeamTarget.id },
  part: 'chest',
  damageMult: 1,
  point: new THREE.Vector3(2, 1, 0),
});
match._hostResolveShot(
  'host001',
  new THREE.Vector3(0, 1.6, 0),
  new THREE.Vector3(1, 0, 0),
  'm4a1',
  null,
  1,
);
assert.ok(sameVisualTeamTarget.health < 100, 'FFA damage ignores matching CT/T visual team');
assert.equal(match.phase, 'live');

// A host-confirmed PvP kill increments score, heals the killer to the 100/100 cap,
// and schedules only the victim for a fast respawn.
const hostRecord = match.players.get('host001');
hostRecord.health = 23;
hostRecord.armor = 17;
hostPlayer.health = 23;
hostPlayer.armor = 17;
match._hostKill('host001', 'player01', 'm4a1', true);
assert.equal(hostRecord.kills, 1);
assert.equal(hostRecord.health, 100);
assert.equal(hostRecord.armor, 100);
assert.equal(hostPlayer.health, 100, 'host killer receives authoritative health reward locally');
assert.equal(hostPlayer.armor, 100, 'host killer receives authoritative armor reward locally');
assert.equal(sameVisualTeamTarget.deaths, 1);
assert.equal(sameVisualTeamTarget.alive, false);
assert.ok(sameVisualTeamTarget.respawnAt > Date.now());
assert.equal(match.phase, 'live', 'deathmatch kill never ends a team round');
assert.deepEqual(match.teamScores, { CT: 0, T: 0 }, 'FFA score does not mutate team-round score');
const rewardedKill = events.findLast((event) => event.type === 'kill');
assert.equal(rewardedKill?.payload?.killReward, true);
assert.equal(rewardedKill?.payload?.killerHealth, 100);
assert.equal(rewardedKill?.payload?.killerArmor, 100);

// Host-side duplicate protection: the same already-dead victim cannot grant a second frag/heal.
hostRecord.health = 41;
hostRecord.armor = 9;
hostPlayer.health = 41;
hostPlayer.armor = 9;
const killEventsBeforeDuplicate = events.filter((event) => event.type === 'kill').length;
match._hostKill('host001', 'player01', 'm4a1', false);
assert.equal(hostRecord.kills, 1, 'duplicate kill does not increment score');
assert.equal(hostRecord.health, 41, 'duplicate kill does not re-trigger health reward');
assert.equal(hostRecord.armor, 9, 'duplicate kill does not re-trigger armor reward');
assert.equal(events.filter((event) => event.type === 'kill').length, killEventsBeforeDuplicate);

// Host chooses a safe spawn and publishes an authoritative respawn.
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  sameVisualTeamTarget.respawnAt = Date.now() - 1;
  match._hostUpdateDeathmatchRespawns(Date.now());
} finally {
  Math.random = originalRandom;
}
assert.equal(sameVisualTeamTarget.alive, true);
assert.equal(sameVisualTeamTarget.health, 100);
assert.equal(sameVisualTeamTarget.__lastSpawn?.x, 100, 'respawn prefers the spawn furthest from living opponents');
const respawnEvent = events.findLast((event) => event.type === 'respawn');
assert.equal(respawnEvent?.payload?.playerId, 'player01');
assert.equal(respawnEvent?.payload?.x, 100);

const hud = match.getHudState();
assert.equal(hud.mode, 'deathmatch');
assert.equal(hud.scoreYou, 1);
assert.equal(hud.scoreLeader, 1);
assert.equal(hud.leaderId, 'host001');
const board = match.getScoreboardData();
assert.equal(board.freeForAll, true);
assert.equal(board.ffa.length, 10);
assert.equal(board.ffa[0].id, 'host001');

// Guest killer applies the host-confirmed reward immediately, and authoritySeq
// prevents a duplicated kill packet from healing again.
{
  const guestPlayer = {
    team: 'CT', name: 'RewardGuest', alive: true, health: 14, armor: 3, helmet: false,
    kills: 0, deaths: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouching: false, onGround: true,
  };
  const guestGame = {
    player: guestPlayer,
    map: hostGame.map,
    weapons: { currentId: 'm4a1', getInventorySnapshot() { return structuredClone(inventory); } },
    audio: { play() {} }, ui: { toast() {}, showCenterMessage() {} }, addKillFeed() {},
  };
  const guestMatch = new OnlineMatch(guestGame, { role: 'guest', localPlayerId: 'player02', code: 'ABCDE' }, {
    role: 'guest', localPlayerId: 'player02', mode: 'deathmatch', maxPlayers: 10,
    map: 'de_dust2_dm', players: tenPlayers,
  });
  guestMatch._started = true;
  guestMatch.phase = 'live';
  const killPayload = {
    authoritySeq: 1,
    killerId: 'player02', victimId: 'player03', weapon: 'ak47', headshot: false,
    kills: 1, deaths: 1, lifeSeq: 1, respawnIn: 1.35,
    killReward: true, killerHealth: 100, killerArmor: 100,
  };
  guestMatch.handleMessage('kill', killPayload, 'host001');
  assert.equal(guestPlayer.health, 100);
  assert.equal(guestPlayer.armor, 100);
  assert.equal(guestMatch.local.kills, 1);

  guestPlayer.health = 54;
  guestPlayer.armor = 22;
  guestMatch.local.health = 54;
  guestMatch.local.armor = 22;
  guestMatch.handleMessage('kill', killPayload, 'host001');
  assert.equal(guestPlayer.health, 54, 'duplicate authoritySeq cannot re-heal guest killer');
  assert.equal(guestPlayer.armor, 22);
  assert.equal(guestMatch.local.kills, 1);
}

// Suicide is not a confirmed PvP kill and never grants score or restoration.
{
  hostRecord.alive = true;
  hostRecord.health = 37;
  hostRecord.armor = 12;
  hostPlayer.alive = true;
  hostPlayer.health = 37;
  hostPlayer.armor = 12;
  const killsBefore = hostRecord.kills;
  const deathsBefore = hostRecord.deaths;
  const killEventsBefore = events.filter((event) => event.type === 'kill').length;
  match._hostKill('host001', 'host001', 'm4a1', false);
  assert.equal(hostRecord.kills, killsBefore);
  assert.equal(hostRecord.deaths, deathsBefore);
  assert.equal(hostRecord.health, 37);
  assert.equal(hostRecord.armor, 12);
  assert.equal(events.filter((event) => event.type === 'kill').length, killEventsBefore);
}

// Deathmatch online purchase ownership is authorized by the host and team-neutral.
{
  const buyer = match.players.get('player02'); // visual CT
  buyer.alive = true;
  buyer.connected = true;
  buyer.lastPurchaseSeq = 0;
  match.handleMessage('dmBuy', { id: 'ak47', seq: 1, playerId: 'host001' }, buyer.id);
  assert.equal(buyer.inventory.primary?.id, 'ak47', 'CT can buy T rifle in FFA Deathmatch');
  assert.equal(buyer.weaponId, 'ak47');
  const accepted = sent.findLast((event) => event.playerId === buyer.id && event.type === 'dmBuyResult');
  assert.equal(accepted?.payload?.accepted, true);
  assert.equal(accepted?.payload?.inventory?.primary?.id, 'ak47');

  match.handleMessage('dmBuy', { id: 'm249', seq: 1 }, buyer.id);
  assert.equal(buyer.inventory.primary?.id, 'ak47', 'replayed purchase seq cannot replace slot twice');

  match.handleMessage('dmBuy', { id: 'knife', seq: 2 }, buyer.id);
  assert.equal(buyer.inventory.primary?.id, 'ak47', 'knife is not an authorized buy request');
  const rejected = sent.findLast((event) => event.playerId === buyer.id && event.type === 'dmBuyResult');
  assert.equal(rejected?.payload?.accepted, false);

  match.handleMessage('dmBuy', { id: 'assaultsuit', seq: 3 }, buyer.id);
  assert.equal(buyer.armor, 100);
  assert.equal(buyer.helmet, true);

  // A rejected/unapproved state cannot spoof slot ownership after purchase validation.
  buyer.lastStateAt = Date.now();
  match.handleMessage('state', {
    playerId: 'host001',
    pos: { x: 5, y: 0.05, z: 5 }, yaw: 0, pitch: 0, crouch: false, onGround: true,
    moveSpeed: 0, weaponId: 'm249', reloading: false, alive: true,
    inventory: {
      primary: { id: 'm249', magazine: 100, reserve: 999 },
      secondary: buyer.inventory.secondary,
      grenades: buyer.inventory.grenades,
      currentId: 'm249', lastId: 'ak47',
    },
  }, buyer.id);
  assert.equal(buyer.inventory.primary?.id, 'ak47', 'state sync cannot replace host-authorized primary slot');
  assert.equal(buyer.weaponId, 'ak47', 'spoofed selected weapon is rejected by recordOwnsWeapon');

  // Ordered dmBuy -> shot: the newly authorized AK is valid immediately for the remote guest.
  const purchasedTarget = match.players.get('player04');
  purchasedTarget.alive = true;
  purchasedTarget.health = 10;
  purchasedTarget.armor = 0;
  buyer.health = 19;
  buyer.armor = 7;
  buyer.lastShotAt = 0;
  buyer.lastState = {
    pos: { x: 5, y: 0.05, z: 5 }, yaw: 0, pitch: 0, crouch: false, onGround: true,
    moveSpeed: 0, weaponId: 'ak47', reloading: false, alive: true,
  };
  buyer.lastStateAt = Date.now();
  match._deathmatchRaycast = () => ({
    type: 'remote', entity: { onlinePlayerId: purchasedTarget.id }, part: 'chest', damageMult: 1,
    point: new THREE.Vector3(7, 1, 5),
  });
  const buyerKillsBefore = buyer.kills;
  match._hostResolveShot(
    buyer.id,
    new THREE.Vector3(5, 1.67, 5),
    new THREE.Vector3(1, 0, 0),
    'ak47',
    null,
    77,
  );
  assert.equal(purchasedTarget.alive, false, 'host accepts shot from newly authorized purchased weapon');
  assert.equal(buyer.kills, buyerKillsBefore + 1);
  assert.equal(buyer.health, 100, 'remote killer record gets authoritative HP reward');
  assert.equal(buyer.armor, 100, 'remote killer record gets authoritative armor reward');
  match._sendSnapshot(Date.now());
  const rewardSnapshot = events.findLast((event) => event.type === 'snapshot');
  const buyerSnapshot = rewardSnapshot?.payload?.players?.find((player) => player.id === buyer.id);
  assert.equal(buyerSnapshot?.health, 100, 'snapshot preserves rewarded health authority');
  assert.equal(buyerSnapshot?.armor, 100, 'snapshot preserves rewarded armor authority');
  assert.equal(buyerSnapshot?.weaponId, 'ak47', 'snapshot exposes the host-authorized purchased weapon');
}

// Guest API emits dmBuy before future shots; host confirmation reconciles the local inventory.
{
  const requests = [];
  const applied = [];
  const localPlayer = {
    team: 'T', alive: true, health: 100, armor: 100, helmet: false, hasDefuseKit: false,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, crouching: false, onGround: true,
  };
  const localInventory = structuredClone(inventory);
  const game = {
    player: localPlayer,
    map: hostGame.map,
    weapons: {
      currentId: 'm4a1',
      getInventorySnapshot() { return structuredClone(localInventory); },
      applyInventorySnapshot(next) { applied.push(structuredClone(next)); },
    },
    audio: { play() {} }, ui: { toast() {}, showCenterMessage() {} },
  };
  const session = {
    role: 'guest', localPlayerId: 'player06', code: 'ABCDE',
    sendToHost(type, payload) { requests.push({ type, payload }); return true; },
  };
  const guestMatch = new OnlineMatch(game, session, {
    role: 'guest', localPlayerId: 'player06', mode: 'deathmatch', maxPlayers: 10,
    map: 'de_dust2_dm', players: tenPlayers,
  });
  guestMatch._started = true;
  guestMatch.phase = 'live';
  assert.equal(guestMatch.notifyLocalPurchase('awp'), true);
  assert.equal(requests.at(-1)?.type, 'dmBuy');
  assert.equal(requests.at(-1)?.payload?.id, 'awp');
  assert.equal(requests.at(-1)?.payload?.seq, 1);

  guestMatch.handleMessage('dmBuyResult', {
    authoritySeq: 1, playerId: 'player06', id: 'awp', seq: 1, accepted: true,
    weaponId: 'awp', armor: 100, helmet: false, hasDefuseKit: false,
    inventory: {
      primary: { id: 'awp', magazine: 10, reserve: 999 },
      secondary: { id: 'deagle', magazine: 7, reserve: 999 },
      grenades: { he: 0, flash: 0, smoke: 0 }, currentId: 'awp', lastId: 'm4a1',
    },
  }, 'host001');
  assert.equal(guestMatch.local.inventory.primary?.id, 'awp');
  assert.equal(guestMatch.local.weaponId, 'awp');
  assert.equal(applied.at(-1)?.primary?.id, 'awp');
}

// Reconnection keeps the seat and receives authoritative state plus a quick respawn deadline.
match.setPlayerConnected('player01', false);
assert.equal(sameVisualTeamTarget.alive, false);
match.setPlayerConnected('player01', true);
assert.ok(sameVisualTeamTarget.respawnAt > Date.now());
const reconnectSync = sent.findLast((event) => event.playerId === 'player01' && event.type === 'playerSync');
assert.ok(reconnectSync?.payload?.player?.respawnIn > 0);

// A fall is harmless; other explicitly reported environmental deaths still use the host pipeline.
{
  const killsBefore = hostRecord.kills;
  const deathsBefore = hostRecord.deaths;
  hostPlayer.pos.set(0, -7, 0);
  hostPlayer.alive = false;
  assert.equal(match.onKill(null, hostPlayer, 'fall', false), false);
  assert.equal(hostRecord.deaths, deathsBefore, 'fall must not count as a death');
  assert.equal(match.onKill(null, hostPlayer, 'environment', false), true);
  assert.equal(hostRecord.alive, false);
  assert.equal(hostRecord.health, 0);
  assert.equal(hostRecord.deaths, deathsBefore + 1);
  assert.equal(hostRecord.kills, killsBefore, 'environmental death never awards a frag');
  assert.ok(hostRecord.respawnAt > Date.now());
  const hostLifeAfterDeath = hostRecord.lifeSeq;
  match._hostUpdateDeathmatchRespawns(Date.now() + 2000);
  assert.equal(hostRecord.alive, true, 'host recovers from its own fall');
  assert.equal(hostPlayer.alive, true);
  assert.equal(hostPlayer.onGround, true);
  assert.ok(hostRecord.lifeSeq > hostLifeAfterDeath, 'respawn advances authoritative life version');
}

// Guest cannot emit a fall death; an unrelated environmental report remains sender-scoped.
{
  const requests = [];
  const guestPlayer = {
    team: 'CT', name: 'FallingGuest', alive: false, health: 100, armor: 0, helmet: false,
    kills: 0, deaths: 0, pos: new THREE.Vector3(12, -6.2, 4), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouching: false, onGround: false,
  };
  const guestGame = {
    player: guestPlayer,
    map: hostGame.map,
    weapons: { currentId: 'm4a1', getInventorySnapshot() { return structuredClone(inventory); } },
    audio: { play() {} }, ui: { toast() {}, showCenterMessage() {} },
  };
  const guestSession = {
    role: 'guest', localPlayerId: 'player03', code: 'ABCDE',
    sendToHost(type, payload) { requests.push({ type, payload }); return true; },
  };
  const guestMatch = new OnlineMatch(guestGame, guestSession, {
    role: 'guest', localPlayerId: 'player03', mode: 'deathmatch', maxPlayers: 10,
    map: 'de_dust2_dm', players: tenPlayers,
  });
  guestMatch._started = true;
  guestMatch.phase = 'live';
  assert.equal(guestMatch.onKill(null, guestPlayer, 'fall', false), false);
  assert.equal(requests.length,0,'fall cannot send selfDeath');
  assert.equal(guestMatch.onKill(null, guestPlayer, 'environment', false), true);
  const request = requests.at(-1);
  assert.equal(request?.type, 'selfDeath');
  assert.equal(request?.payload?.lifeSeq, 0);
  assert.equal(request?.payload?.pos?.y, -6.2);

  const guestRecord = match.players.get('player03');
  const otherRecord = match.players.get('player04');
  guestRecord.alive = true;
  guestRecord.health = 100;
  guestRecord.respawnAt = 0;
  guestRecord.lastState = {
    pos: { x: 12, y: -5.7, z: 4 }, yaw: 0, pitch: 0, crouch: false,
    onGround: false, moveSpeed: 0, weaponId: 'm4a1', reloading: false, alive: true,
  };
  guestRecord.lastStateAt = Date.now();
  const guestDeathsBefore = guestRecord.deaths;
  const otherDeathsBefore = otherRecord.deaths;
  match.handleMessage('selfDeath', { ...request.payload, playerId: otherRecord.id }, guestRecord.id);
  assert.equal(guestRecord.deaths, guestDeathsBefore + 1, 'host applies selfDeath only to authenticated sender');
  assert.equal(otherRecord.deaths, otherDeathsBefore, 'claimed victim id cannot kill another player');
  assert.equal(guestRecord.alive, false);
  assert.ok(guestRecord.respawnAt > Date.now());
  match._hostUpdateDeathmatchRespawns(Date.now() + 2000);
  assert.equal(guestRecord.alive, true, 'guest receives a host-authoritative respawn after environmental death');
}

// An unverified selfDeath becomes safe recovery with no extra death or frag.
{
  const record = match.players.get('player04');
  record.alive = true;
  record.health = 100;
  record.respawnAt = 0;
  record.lastState = {
    pos: { x: 35, y: 0.05, z: 0 }, yaw: 0, pitch: 0, crouch: false,
    onGround: true, moveSpeed: 0, weaponId: 'm4a1', reloading: false, alive: true,
  };
  record.lastSafeState = { ...record.lastState, pos: { ...record.lastState.pos } };
  record.lastStateAt = Date.now();
  const deathsBefore = record.deaths;
  const killsBefore = [...match.players.values()].reduce((sum, player) => sum + player.kills, 0);
  match.handleMessage('selfDeath', {
    playerId: 'host001',
    lifeSeq: record.lifeSeq,
    reason: 'environment',
    pos: { x: 999, y: -100, z: 999 },
  }, record.id);
  assert.equal(record.deaths, deathsBefore, 'unverified death does not increment score');
  assert.equal(record.alive, true);
  assert.equal(record.__lastSpawn?.x, 35, 'recovery uses last safe host-known position');
  assert.equal(
    [...match.players.values()].reduce((sum, player) => sum + player.kills, 0),
    killsBefore,
    'recovery cannot manufacture a kill',
  );
  const recovery = events.findLast((event) => event.type === 'respawn' && event.payload?.playerId === record.id);
  assert.equal(recovery?.payload?.recovery, true);
}

// Snapshot/player life reconciliation: host-authoritative alive state can recover a dead local,
// while stale life versions cannot undo a newer respawn.
{
  let spawnCount = 0;
  const localPlayer = {
    team: 'T', name: 'GuestSync', alive: false, health: 0, armor: 0, helmet: false,
    kills: 0, deaths: 1, pos: new THREE.Vector3(0, -7, 0), vel: new THREE.Vector3(3, -8, 2),
    yaw: 0, pitch: 0, crouching: false, onGround: false,
  };
  const syncGame = {
    player: localPlayer,
    map: hostGame.map,
    weapons: {
      currentId: 'ak47',
      inventory: structuredClone(inventory),
      applyInventorySnapshot() { return true; },
      getInventorySnapshot() { return structuredClone(inventory); },
    },
    spawnOnlinePlayer(team, spawn) {
      spawnCount++;
      localPlayer.team = team;
      localPlayer.pos.set(spawn.x, spawn.y, spawn.z);
      localPlayer.vel.set(0, 0, 0);
      localPlayer.health = 100;
      localPlayer.armor = 100;
      localPlayer.alive = true;
      localPlayer.onGround = true;
    },
    audio: { play() {} }, ui: { toast() {}, showCenterMessage() {} },
  };
  const syncSession = { role: 'guest', localPlayerId: 'player05', code: 'ABCDE' };
  const syncMatch = new OnlineMatch(syncGame, syncSession, {
    role: 'guest', localPlayerId: 'player05', mode: 'deathmatch', maxPlayers: 10,
    map: 'de_dust2_dm', players: tenPlayers,
  });
  syncMatch._started = true;
  syncMatch.phase = 'live';
  syncMatch.local.alive = false;
  syncMatch.local.health = 0;
  syncMatch.local.lifeSeq = 1;

  const safeState = {
    pos: { x: 35, y: 0.05, z: 0 }, yaw: 0, pitch: 0, crouch: false,
    onGround: true, moveSpeed: 0, weaponId: 'ak47', reloading: false, alive: true,
  };
  syncMatch.handleMessage('snapshot', {
    authoritySeq: 10,
    phase: 'live',
    players: [{
      id: 'player05', alive: true, health: 100, armor: 100, kills: 2, deaths: 1,
      lifeSeq: 2, respawnIn: 0, weaponId: 'ak47', connected: true, state: safeState,
    }],
  }, 'host001');
  assert.equal(localPlayer.alive, true, 'authoritative alive snapshot respawns a locally dead player');
  assert.equal(localPlayer.onGround, true);
  assert.equal(spawnCount, 1);
  assert.equal(localPlayer.pos.x, 35);
  assert.equal(syncMatch.local.lifeSeq, 2);

  syncMatch.handleMessage('snapshot', {
    authoritySeq: 11,
    phase: 'live',
    players: [{
      id: 'player05', alive: false, health: 0, armor: 0, kills: 2, deaths: 2,
      lifeSeq: 1, respawnIn: 1, weaponId: 'ak47', connected: true,
      state: { ...safeState, alive: false },
    }],
  }, 'host001');
  assert.equal(localPlayer.alive, true, 'older lifeSeq cannot overwrite a newer respawn');
  assert.equal(syncMatch.local.lifeSeq, 2);
  assert.equal(syncMatch.local.deaths, 1);

  localPlayer.alive = false;
  localPlayer.health = 0;
  syncMatch._pendingSelfDeath = { lifeSeq: 2, at: Date.now() };
  syncMatch.handleMessage('snapshot', {
    authoritySeq: 12,
    phase: 'live',
    players: [{
      id: 'player05', alive: true, health: 100, armor: 100, kills: 2, deaths: 1,
      lifeSeq: 2, respawnIn: 0, weaponId: 'ak47', connected: true, state: safeState,
    }],
  }, 'host001');
  assert.equal(localPlayer.alive, false, 'same-life snapshot cannot race ahead of a pending selfDeath request');
  assert.equal(spawnCount, 1);

  syncMatch.handleMessage('respawn', {
    authoritySeq: 13,
    playerId: 'player05', lifeSeq: 3,
    x: 10, y: 0.05, z: 0, yaw: 90, yawRad: Math.PI / 2,
    health: 100, armor: 100, protectionMs: 1000,
  }, 'host001');
  assert.equal(localPlayer.alive, true);
  assert.equal(localPlayer.onGround, true);
  assert.equal(localPlayer.pos.x, 10);
  assert.equal(spawnCount, 2);
  assert.equal(syncMatch._pendingSelfDeath, null);
}

console.log('online-deathmatch OK: 10-seat FFA, environmental selfDeath, safe respawn, stale-sync protection and reconnect');
