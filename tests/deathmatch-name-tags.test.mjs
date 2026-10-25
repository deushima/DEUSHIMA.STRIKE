import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { NameTagLayer } from '../src/ui/name-tags.js';

function makeTagElement() {
  const name = { textContent: '' };
  const bar = { style: { width: '' } };
  return {
    className: '',
    innerHTML: '',
    style: { display: '', transform: '' },
    removed: false,
    querySelector(selector) {
      if (selector === '.nt-name') return name;
      if (selector === '.nt-hp i') return bar;
      return null;
    },
    remove() { this.removed = true; },
    _name: name,
    _bar: bar,
  };
}

const root = {
  children: [],
  appendChild(node) { this.children.push(node); },
};

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
globalThis.document = {
  getElementById(id) { return id === 'name-tags' ? root : null; },
  createElement() { return makeTagElement(); },
};
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

try {
  const camera = new THREE.PerspectiveCamera(90, 1280 / 720, 0.05, 300);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -5);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const player = {
    alive: true,
    team: 'CT',
    pos: new THREE.Vector3(0, 0, 0),
  };
  const allyBot = {
    id: 7,
    name: 'Classic Ally',
    team: 'CT',
    alive: true,
    health: 73,
    pos: new THREE.Vector3(0, 0, -5),
  };
  const enemyBot = {
    id: 8,
    name: 'Enemy',
    team: 'T',
    alive: true,
    health: 100,
    pos: new THREE.Vector3(1, 0, -5),
  };
  const game = {
    state: 'playing',
    player,
    camera,
    deathmatch: null,
    matchConfig: { mode: 'aim', onlineMode: null },
    bots: { getBots() { return [allyBot, enemyBot]; } },
    online: null,
  };

  const layer = new NameTagLayer(game);

  // Classic offline keeps the existing teammate-only ESP behavior.
  layer.update();
  assert.equal(layer.tags.size, 1, 'classic mode still creates only the allied bot tag');
  const botTag = layer.tags.get('b7');
  assert.ok(botTag, 'classic allied bot tag exists');
  assert.equal(botTag.el.style.display, 'block', 'classic allied bot tag is visible');
  assert.equal(botTag.el._name.textContent, 'Classic Ally');
  assert.equal(botTag.el._bar.style.width, '73%');
  assert.equal(layer.tags.has('b8'), false, 'classic enemy still has no allied name tag');

  // Offline Deathmatch hides every existing floating tag and creates none.
  game.deathmatch = {};
  layer.update();
  assert.equal(botTag.el.style.display, 'none', 'offline Deathmatch hides existing allied name tags');
  assert.equal(layer.tags.size, 1, 'offline Deathmatch does not create any additional tags');

  // Returning to classic must restore the pre-existing behavior unchanged.
  game.deathmatch = null;
  layer.update();
  assert.equal(botTag.el.style.display, 'block', 'leaving Deathmatch restores classic allied tag rendering');

  // Online Deathmatch is also neutral FFA. This signal is independent from
  // the local Deathmatch controller and covers the actual online match object.
  game.bots = { getBots() { return []; } };
  game.online = {
    mode: 'deathmatch',
    remoteAvatar: {
      name: 'Remote CT', team: 'CT', alive: true, health: 100,
      pos: new THREE.Vector3(0, 0, -4),
    },
  };
  layer.update();
  assert.equal(botTag.el.style.display, 'none', 'online Deathmatch hides all previously rendered tags');
  assert.equal(layer.tags.has('remote'), false, 'online Deathmatch never creates a remote floating tag');

  // Classic online 2v2 remains untouched: same-team remote avatars may still
  // receive the allied floating tag used by existing team modes.
  game.online.mode = '2v2';
  game.matchConfig = { mode: 'aim', onlineMode: '2v2' };
  layer.update();
  const remoteTag = layer.tags.get('remote');
  assert.ok(remoteTag, 'classic online teammate tag still exists');
  assert.equal(remoteTag.el.style.display, 'block', 'classic online teammate tag remains visible');

  // The matchConfig signal covers the brief transition where online state may
  // not yet expose its mode object but Game has already entered DM semantics.
  game.online = { remoteAvatar: game.online.remoteAvatar };
  game.matchConfig = { mode: 'deathmatch', onlineMode: 'deathmatch' };
  layer.update();
  assert.equal(remoteTag.el.style.display, 'none', 'Deathmatch matchConfig also suppresses all name tags');

  // Non-active states keep the historical hide behavior and do not affect any
  // scoreboard/HUD container because NameTagLayer only owns #name-tags.
  game.matchConfig = { mode: 'aim', onlineMode: '2v2' };
  game.state = 'menu';
  layer.update();
  assert.equal(remoteTag.el.style.display, 'none', 'menu state hides floating tags');

  layer.dispose();
  assert.equal(layer.tags.size, 0);
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}

console.log('Deathmatch name tags OK: offline/online FFA hidden; classic teammate tags preserved');
