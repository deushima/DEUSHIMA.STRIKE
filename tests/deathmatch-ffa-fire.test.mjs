import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Game } from '../src/game.js';
import { BotManager } from '../src/bots.js';
import { Deathmatch } from '../src/deathmatch.js';
import { Player } from '../src/core/player.js';

function makeBot(id, z, team = 'CT', health = 100) {
  return {
    isBot: true,
    isPlayer: false,
    id,
    name: `Bot ${id}`,
    team,
    alive: true,
    health,
    armor: 0,
    helmet: false,
    pos: new THREE.Vector3(0, 0, z),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    aimYaw: 0,
    aimPitch: 0,
    height: 1.56,
    radius: 0.25,
    hitboxRadius: 0.38,
    weaponId: 'm4a1',
    ammo: 30,
    magazine: 30,
    reserve: 90,
    fireTimer: 0,
    burstLeft: 1,
    burstPause: 0,
    reloading: 0,
    _moving: false,
    target: null,
    targetVisible: true,
    reactTimer: 0,
    lastSeen: new THREE.Vector3(),
    deaths: 0,
    kills: 0,
    score: 0,
    corpseTimer: 0,
    deathTime: 0,
    state: 'live',
  };
}

const killFeed = [];
const game = {
  state: 'playing',
  time: 1,
  map: { id: 'de_dust2_dm' },
  matchConfig: { mode: 'deathmatch', map: 'de_dust2_dm' },
  physics: { raycast() { return null; } },
  effects: {
    muzzleFlash() {},
    tracer() {},
    bulletImpact() {},
    blood() {},
  },
  audio: { play() {} },
  ui: {
    showDamage() {},
    flashDamage() {},
    showCenterMessage() {},
    showKillConfirm() {},
    addKillFeed(entry) { killFeed.push(entry); },
  },
  classicUI: { hud: { notifyDamage() {} } },
  weapons: {
    dropAll() {},
    getName(id) { return id; },
  },
  addKillFeed(entry) { killFeed.push(entry); },
  notifyKill(...args) { return Game.prototype.notifyKill.call(this, ...args); },
  damagePlayer(...args) { return Game.prototype.damagePlayer.call(this, ...args); },
  damageBot(...args) { return Game.prototype.damageBot.call(this, ...args); },
  raycastShot(...args) { return Game.prototype.raycastShot.call(this, ...args); },
  getPlayerHitboxes(entity) { return Game.prototype.getPlayerHitboxes.call(this, entity); },
};

game.player = new Player(game);
game.player.name = 'Player';
game.player.team = 'CT';
game.player.pos.set(0, 0, -4);
game.player.alive = true;
game.player.health = 20;
game.player.armor = 0;
game.player.spawnProtection = 0;

const manager = new BotManager(game);
manager.profile = { ...manager.profile, spreadMult: 0 };
game.bots = manager;
game.deathmatch = new Deathmatch(game);
game.rounds = game.deathmatch;

// Bot -> player, same visual team. The shooter must never intercept its own
// ray at t~=0 when FFA makes same-team actors hittable.
const shooter = makeBot(1, 0, 'CT', 55);
manager.bots = [shooter];
manager._fire(shooter, manager._weapon(shooter));
assert.equal(game.player.alive, false, 'Deathmatch bot must kill a same-team player');
assert.equal(game.player.health, 0);
assert.equal(shooter.kills, 1, 'bot kill is credited in Deathmatch');
assert.equal(shooter.health, 100, 'valid killer keeps Deathmatch 100 HP refill');
assert.equal(shooter.armor, 100, 'valid killer keeps Deathmatch 100 armor refill');

// Bot -> bot, same visual team.
game.player.alive = false;
const botShooter = makeBot(2, 0, 'T', 61);
const botVictim = makeBot(3, -4, 'T', 20);
manager.bots = [botShooter, botVictim];
manager._fire(botShooter, manager._weapon(botShooter));
assert.equal(botVictim.alive, false, 'Deathmatch bot must kill a same-team bot');
assert.equal(botVictim.health, 0);
assert.equal(botShooter.kills, 1);
assert.equal(botShooter.health, 100);
assert.equal(botShooter.armor, 100);

// Player -> bot, same visual team, through the normal local hitscan/damage path.
game.player.team = 'CT';
game.player.pos.set(0, 0, 0);
game.player.alive = true;
game.player.health = 48;
game.player.armor = 12;
const playerVictim = makeBot(4, -4, 'CT', 20);
manager.bots = [playerVictim];
const origin = new THREE.Vector3(0, game.player.eyeHeight, 0);
const direction = new THREE.Vector3(0, 0, -1);
const playerHit = game.raycastShot(origin, direction, 20, game.player.team);
assert.equal(playerHit?.entity, playerVictim, 'Deathmatch player hits same-team bot');
game.damageBot(playerVictim, 40, game.player, playerHit.part, 'm4a1');
assert.equal(playerVictim.alive, false);
assert.equal(game.player.kills, 1);
assert.equal(game.player.health, 100);
assert.equal(game.player.armor, 100);

// Classic regression: same-team actors remain friendly and therefore cannot
// be hit merely because shooter exclusion exists.
game.deathmatch = null;
game.rounds = null;
game.matchConfig = { mode: 'aim', map: 'aim_redline' };
game.player.team = 'CT';
game.player.pos.set(0, 0, -4);
game.player.alive = true;
game.player.health = 100;
const classicShooter = makeBot(5, 0, 'CT', 100);
manager.bots = [classicShooter];
manager._fire(classicShooter, manager._weapon(classicShooter));
assert.equal(game.player.health, 100, 'classic same-team bot cannot damage player');

manager.dispose();
console.log('Deathmatch FFA fire OK: bot/player/bot same-team damage works; shooter self-hit excluded; classic preserved');
