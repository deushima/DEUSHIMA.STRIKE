import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { WeaponSystem } from '../src/weapons.js';
import { UI } from '../src/ui/ui.js';

function makeGame(mode = 'deathmatch', online = false) {
  const game = Object.create(Game.prototype);
  const purchases = [];
  const messages = [];
  game.state = 'playing';
  game.matchConfig = { mode, onlineMode: online ? mode : null };
  game.deathmatch = mode === 'deathmatch' && !online ? {} : null;
  game.online = online ? { isDeathmatch: mode === 'deathmatch', notifyLocalPurchase(id) { purchases.push(id); } } : null;
  game.player = {
    alive: true, team: 'CT', money: 0, armor: 75, helmet: false,
    addMoney(n) { this.money = Math.min(16000, Math.max(0, this.money + n)); },
  };
  game.weapons = new WeaponSystem(game);
  game.weapons.giveWeapon('m4a1', { silent: true });
  game.weapons.giveWeapon('deagle', { silent: true });
  game.rounds = { getHudState() { return { phase: 'live', buyTimeLeft: 0 }; } };
  game.map = { buyZones: {} };
  game.input = { exitPointerLock() {} };
  game.audio = { play() {} };
  game.ui = { showBuyMenu(data) { messages.push(data); }, toast() {}, updateBuyMenu() {} };
  return { game, purchases, messages };
}

for (const online of [false, true]) {
  const { game, purchases, messages } = makeGame('deathmatch', online);
  assert.equal(game.canBuy(), true, 'Deathmatch should allow buying anywhere, at any time');
  assert.equal(game.buyZoneFor('CT'), true, 'Deathmatch has no buy zone');
  assert.equal(game.openBuyMenu(), true, 'B menu should open during Deathmatch');
  assert.equal(messages[0].deathmatch, true);
  const rifles = game.getBuyMenuData().categories.find((cat) => cat.key === '4').items;
  assert.equal(rifles.find((w) => w.id === 'ak47').available, true, 'CT can equip T rifle in FFA');
  assert.equal(rifles.find((w) => w.id === 'ak47').price, 0, 'Deathmatch arsenal has no economy limit');
  assert.equal(game.buyItem('ak47').ok, true, 'can replace equipped primary');
  assert.equal(game.weapons.inventory.primary.id, 'ak47');
  assert.equal(game.weapons.inventory.primary.reserve, 999);
  assert.equal(game.buyItem('glock').ok, true, 'can replace equipped secondary');
  assert.equal(game.weapons.inventory.secondary.id, 'glock');
  assert.equal(game.player.money, 0, 'free Deathmatch loadout does not deduct money');
  assert.deepEqual(purchases, online ? ['ak47', 'glock'] : []);
  let buyShortcutOpened = 0;
  game.input.consumePressed = (key) => key === 'KeyB';
  game.ui.isBuyMenuOpen = false;
  game.ui.toggleConsole = null;
  game.openBuyMenu = () => { buyShortcutOpened++; return true; };
  game._maybeGlobalKeys();
  assert.equal(buyShortcutOpened, 1, 'KeyB must work in offline and online Deathmatch');
  game.player.alive = false;
  assert.equal(game.canBuy(), false, 'dead players cannot buy until respawn');
  assert.equal(game.buyItem('awp').ok, false);
}

const { game: classic } = makeGame('aim', false);
classic.player.money = 16000;
assert.equal(classic.canBuy(), false, 'standard modes keep buy-time restriction');
assert.equal(classic.buyItem('ak47').ok, false, 'normal buy stays disabled outside time and zone');
classic.rounds = { getHudState() { return { phase: 'live', buyTimeLeft: 15 }; } };
classic.map.buyZones.CT = { min: { x: -10, z: -10 }, max: { x: 10, z: 10 } };
classic.player.pos = { x: 0, z: 0 };
assert.equal(classic.canBuy(), true);
assert.equal(classic.weapons.buyItem('ak47').ok, false, 'CT cannot buy T weapons in classic mode');
assert.equal(classic.weapons.buyItem('awp').ok, false, 'classic cannot replace equipped primary');
const { game: onlineClassic } = makeGame('aim', true);
onlineClassic.input.consumePressed = (key) => key === 'KeyB';
onlineClassic.ui.isBuyMenuOpen = false;
onlineClassic.ui.toggleConsole = null;
onlineClassic.openBuyMenu = () => { throw new Error('Online classic should not open shop'); };
onlineClassic._maybeGlobalKeys();

const ui = Object.create(UI.prototype);
ui._buyData = { deathmatch: true };
ui._buyOpen = true;
ui._refs = { buyTimer: { classList: { remove() {} } } };
const texts = {};
ui._t = (key, text) => { texts[key] = text; };
assert.equal(ui._buyTimeLeft(), null, 'Deathmatch has no buy timer');
ui._tickBuyTimer({ round: { buyTimeLeft: 0 } });
assert.equal(texts.buyTimerVal, 'LIBRE', 'Deathmatch buy timer never auto-closes');

console.log('Deathmatch arsenal OK: offline/online B at any time, team-neutral free replacements; classic restrictions preserved');
