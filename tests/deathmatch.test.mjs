import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { chooseDeathmatchSpawn, Deathmatch, DEATHMATCH_RESPAWN_SECONDS } from '../src/deathmatch.js';
import { Game } from '../src/game.js';
import { BotManager } from '../src/bots.js';

const map = {
  deathmatchSpawns: [
    { x: 0, y: 0.05, z: 0 },
    { x: 50, y: 0.05, z: 0 },
    { x: 100, y: 0.05, z: 0 },
    { x: 150, y: 0.05, z: 0 },
  ],
};
const enemies = [{ alive: true, pos: { x: 0, y: 0, z: 0 } }];
assert.equal(chooseDeathmatchSpawn(map, enemies, null, () => 0).x, 150,
  'respawn must prefer distance from live opponents');
assert.equal(chooseDeathmatchSpawn(map, enemies, {
  isPositionFree(point) { return point.x !== 150; },
}, () => 0).x, 100, 'respawn must reject blocked locations');
assert.throws(() => chooseDeathmatchSpawn({ deathmatchSpawns: [] }), /puntos de respawn/);

const player = { isPlayer: true, alive: false, deaths: 0, kills: 0, pos: { x: 0, z: 0 }, team: 'CT' };
let respawns = 0;
const game = {
  player,
  state: 'playing',
  map,
  bots: { getBots() { return []; } },
  physics: { isPositionFree() { return true; } },
  ui: { showCenterMessage() {}, addKillFeed() {} },
  addKillFeed() {},
  weapons: { getName(v) { return v; } },
  spawnPlayer(team, spawn) { assert.equal(team, 'CT'); assert.ok(spawn); player.alive = true; respawns++; },
  setupOnlineLoadout() {},
};
const dm = new Deathmatch(game);
dm.onKill(null, player, 'fall', false);
assert.equal(player.deaths, 0, 'fall cannot create a deathmatch death');
dm.onKill(null, player, 'environment', false);
dm.onKill(null, player, 'environment', false);
assert.equal(player.deaths, 1, 'one death event cannot be counted twice');
dm.update(DEATHMATCH_RESPAWN_SECONDS * 0.5);
assert.equal(respawns, 0, 'player stays dead until the respawn delay expires');
dm.update(DEATHMATCH_RESPAWN_SECONDS * 0.51);
assert.equal(respawns, 1, 'player respawns exactly once when the timer expires');
assert.equal(dm.canControlPlayer(), true);
dm.dispose();

// Confirmed Deathmatch kills are FFA regardless of CT/T and refill the killer
// to exactly 100 health + 100 armor. Duplicate death notifications, suicides
// and world deaths must never grant the refill.
const ffaPlayer = {
  isPlayer: true, alive: true, name: 'Player', team: 'CT',
  health: 23, armor: 7, kills: 0, score: 0, deaths: 0,
  pos: new THREE.Vector3(0, 0, 0),
};
const ffaGame = {
  ...game,
  player: ffaPlayer,
  audio: { play() {} },
  ui: { showCenterMessage() {}, showKillConfirm() {} },
};
const ffa = new Deathmatch(ffaGame);
const sameTeamVictim = {
  isBot: true, alive: false, name: 'CT Ally', team: 'CT',
  health: 0, armor: 0, kills: 0, score: 0, deaths: 0,
  pos: new THREE.Vector3(2, 0, 0),
};
ffa.onKill(ffaPlayer, sameTeamVictim, 'm4a1', false);
assert.equal(ffaPlayer.kills, 1, 'same-team CT kill counts in Deathmatch FFA');
assert.equal(ffaPlayer.score, 1);
assert.equal(ffaPlayer.health, 100, 'confirmed kill refills health to 100');
assert.equal(ffaPlayer.armor, 100, 'confirmed kill refills armor to 100');

ffaPlayer.health = 155;
ffaPlayer.armor = 160;
const secondVictim = { ...sameTeamVictim, name: 'CT Ally 2', deaths: 0, pos: new THREE.Vector3(3, 0, 0) };
ffa.onKill(ffaPlayer, secondVictim, 'm4a1', false);
assert.equal(ffaPlayer.health, 100, 'kill refill can never leave health above 100');
assert.equal(ffaPlayer.armor, 100, 'kill refill can never leave armor above 100');
ffaPlayer.health = 54;
ffaPlayer.armor = 42;
ffa.onKill(ffaPlayer, secondVictim, 'm4a1', false);
assert.equal(ffaPlayer.health, 54, 'duplicate kill notification cannot refill health again');
assert.equal(ffaPlayer.armor, 42, 'duplicate kill notification cannot refill armor again');

const botKiller = {
  isBot: true, alive: true, name: 'T Bot A', team: 'T',
  health: 9, armor: 3, kills: 0, score: 0, deaths: 0,
  pos: new THREE.Vector3(4, 0, 0),
};
const botVictim = {
  isBot: true, alive: false, name: 'T Bot B', team: 'T',
  health: 0, armor: 0, deaths: 0, pos: new THREE.Vector3(5, 0, 0),
};
ffa.onKill(botKiller, botVictim, 'ak47', false);
assert.equal(botKiller.kills, 1, 'bot-vs-bot same-team kill counts in Deathmatch FFA');
assert.equal(botKiller.health, 100, 'bot killer also refills health');
assert.equal(botKiller.armor, 100, 'bot killer also refills armor');

const tradeKiller = {
  isBot: true, alive: false, name: 'Trade Killer', team: 'CT',
  health: 0, armor: 12, kills: 0, score: 0, deaths: 0,
  pos: new THREE.Vector3(5.5, 0, 0),
};
const tradeVictim = {
  isBot: true, alive: false, name: 'Trade Victim', team: 'T',
  health: 0, armor: 0, deaths: 0, pos: new THREE.Vector3(5.8, 0, 0),
};
ffa.onKill(tradeKiller, tradeVictim, 'ak47', false);
assert.equal(tradeKiller.kills, 1, 'simultaneous trade still credits the confirmed kill');
assert.equal(tradeKiller.health, 0, 'dead trade killer is not revived by the refill');
assert.equal(tradeKiller.armor, 12, 'dead trade killer armor is not rewritten');

const suicide = {
  isPlayer: true, alive: false, name: 'Suicide', team: 'CT',
  health: 18, armor: 11, kills: 0, score: 0, deaths: 0,
  pos: new THREE.Vector3(6, 0, 0),
};
ffa.onKill(suicide, suicide, 'fall', false);
assert.equal(suicide.health, 18, 'suicide must not refill health');
assert.equal(suicide.armor, 11, 'suicide must not refill armor');
assert.equal(suicide.kills, 0, 'suicide must not count as a kill');

ffaPlayer.health = 31;
ffaPlayer.armor = 19;
const worldVictim = {
  isBot: true, alive: false, name: 'World Victim', team: 'T',
  health: 0, armor: 0, deaths: 0, pos: new THREE.Vector3(7, 0, 0),
};
ffa.onKill(null, worldVictim, 'world', false);
assert.equal(ffaPlayer.health, 31, 'world death must not refill another player');
assert.equal(ffaPlayer.armor, 19, 'world death must not refill another player armor');

// Local hitscan must include actors with the same visual team while Deathmatch
// is active, then return to classic team filtering when Deathmatch is absent.
const rayPlayer = {
  alive: true, team: 'CT', pos: new THREE.Vector3(0, 0, 0),
  eyeHeight: 1.6, height: 1.8, radius: 0.38,
};
const rayBot = { alive: true, team: 'CT', pos: new THREE.Vector3(0, 0, -4) };
const rayGame = {
  deathmatch: {}, matchConfig: null, player: rayPlayer, online: null,
  physics: { raycast() { return null; } },
  getPlayerHitboxes(entity) { return Game.prototype.getPlayerHitboxes.call(this, entity); },
  bots: {
    getBots() { return [rayBot]; },
    getBotHitboxes() {
      return [{
        part: 'chest', damageMult: 1,
        box: new THREE.Box3(new THREE.Vector3(-0.3, 1.0, -4.3), new THREE.Vector3(0.3, 1.6, -3.7)),
      }];
    },
  },
};
const dmHit = Game.prototype.raycastShot.call(
  rayGame,
  new THREE.Vector3(0, 1.6, 0),
  new THREE.Vector3(0, 0, -1),
  20,
  'CT',
);
assert.equal(dmHit?.entity, rayBot, 'Deathmatch player hits same-team bot');
rayGame.deathmatch = null;
const classicHit = Game.prototype.raycastShot.call(
  rayGame,
  new THREE.Vector3(0, 1.6, 0),
  new THREE.Vector3(0, 0, -1),
  20,
  'CT',
);
assert.equal(classicHit, null, 'classic mode still filters same-team bot hits');

// Bot target acquisition follows the same FFA rule, so visual CT/T assignment
// never prevents bot-vs-player or bot-vs-bot combat in local Deathmatch.
const targetPlayer = { alive: true, team: 'CT', pos: new THREE.Vector3(0, 0, 0) };
const botManagerGame = { player: targetPlayer, deathmatch: {} };
const manager = new BotManager(botManagerGame);
const botA = { alive: true, team: 'CT', pos: new THREE.Vector3(1, 0, 0) };
const botB = {
  alive: true, team: 'CT', pos: new THREE.Vector3(2, 0, 0),
  health: 100, armor: 0, helmet: false,
  target: null, targetVisible: false, reactTimer: 0.3,
  lastSeen: new THREE.Vector3(),
};
manager.bots = [botA, botB];
assert.deepEqual(manager._gatherEnemies(botA), [targetPlayer, botB], 'Deathmatch bots target same-team actors');
assert.equal(manager.damageBot(botB, 20, botA, 'chest', 'm4a1'), 20, 'same-team bot damage applies in Deathmatch');
assert.equal(botB.health, 80, 'same-team bot actually loses health in Deathmatch');
assert.equal(botB.target, botA, 'damaged bot reacts to same-team attacker in Deathmatch');
botManagerGame.deathmatch = null;
assert.deepEqual(manager._gatherEnemies(botA), [], 'classic bots keep same-team actors friendly');
manager.dispose();
ffa.dispose();

console.log('Deathmatch FFA, respawn and kill-refill logic OK');
