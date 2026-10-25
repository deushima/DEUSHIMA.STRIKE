import assert from 'node:assert/strict';
import { Duel } from '../src/duel.js';

const player = {
  team: 'CT', alive: true, health: 100, armor: 100, helmet: false, money: 0,
  kills: 0, deaths: 0, pos: { x: 0, y: 0, z: 0 }, spawnProtection: 0,
  reset(team, spawn) { this.team = team; this.pos = { ...spawn }; this.alive = true; },
};
const bot = { team: 'T', alive: true, health: 100, armor: 100, helmet: false, state: 'freeze' };
const game = {
  player, state: 'menu', settings: { fov: 90 },
  camera: { fov: 90, updateProjectionMatrix() {} },
  map: {
    id: 'aim_1v1',
    spawns: {
      CT: [{ x: -4, y: 0.05, z: 0, yaw: 0 }],
      T: [{ x: 4, y: 0.05, z: 0, yaw: 0 }],
    },
  },
  weapons: { resetForMatch() {}, giveWeapon() {}, _equip() {} },
  bots: {
    getBots: () => [bot],
    resetRound() { bot.alive = true; bot.state = 'freeze'; },
    _giveBotWeapon() {}, _syncEquipment() {}, _equipWeaponVisual() {},
  },
  ui: { hideAll() {}, showHUD() {}, hideRoundResult() {}, hideRoundBanner() {} },
  audio: { play() {} }, input: { locked: true },
  setCameraShake() {}, flashPlayer() {},
  getAliveCounts: () => ({ CT: player.alive ? 1 : 0, T: bot.alive ? 1 : 0 }),
  getScoreboardData() { return {}; }, showMatchEnd() {},
};

const duel = new Duel(game);
duel.startMatch({ roundsToWin: 13 });
assert.equal(duel.roundNumber, 1);
assert.equal(duel.phase, 'live');
assert.equal(duel.freezeLeft, 0);
assert.equal(duel.canControlPlayer(), true);

// Un kill entra en dying; la ronda siguiente arranca al terminar la caída.
duel.onBotKilled();
assert.equal(duel.phase, 'dying');
assert.equal(duel.scoreCT, 0);
duel.update(1.0);
assert.equal(duel.scoreCT, 1);
assert.equal(duel.roundNumber, 2);
assert.equal(duel.phase, 'live');

// Muerte del jugador: gana el bot y se reinicia sin freeze.
duel.onPlayerKilled();
assert.equal(duel.phase, 'dying');
duel.update(1.0);
assert.equal(duel.scoreT, 1);
assert.equal(duel.roundNumber, 3);
assert.equal(duel.phase, 'live');

// Primero a 13.
for (let i = 0; i < 12; i++) {
  duel.onBotKilled();
  duel.update(1.0);
}
assert.equal(duel.scoreCT, 13);
assert.equal(duel.matchOver, true);

// 12-12 después de 24 rondas = empate.
const drawGame = { ...game };
const drawDuel = new Duel(drawGame);
drawDuel.startMatch({ roundsToWin: 13 });
for (let i = 0; i < 24; i++) {
  if (i % 2 === 0) drawDuel.onBotKilled();
  else drawDuel.onPlayerKilled();
  drawDuel.update(1.0);
}
assert.equal(drawDuel.scoreCT, 12);
assert.equal(drawDuel.scoreT, 12);
assert.equal(drawDuel.matchOver, true);

console.log('duel-logic OK: no freeze, death delay, auto next round, first to 13, 12-12 draw');
