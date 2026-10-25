import assert from 'node:assert/strict';
import { OnlineSession } from '../src/online/session.js';
import { DeathmatchUI } from '../src/ui/deathmatch-ui.js';
import { OnlineUI } from '../src/ui/online-ui.js';

const CODE_RE = /^[A-Z2-9]{5}$/;

class FakePeer {
  constructor(id) {
    this.id = id || 'guest-peer';
    this.handlers = new Map();
    this.destroyed = false;
    queueMicrotask(() => this.emit('open', this.id));
  }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, list = []);
    list.push(fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type) || [];
    this.handlers.set(type, list.filter((entry) => entry !== fn));
  }
  emit(type, ...args) {
    for (const fn of this.handlers.get(type) || []) fn(...args);
  }
  destroy() { this.destroyed = true; }
}

function rosterPlayer(index, ready = false) {
  return {
    id: index === 0 ? 'host001' : `guest${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'Host' : `Guest ${index}`,
    team: index % 2 === 0 ? 'CT' : 'T',
    slot: index,
    ready,
    connected: true,
    isHost: index === 0,
  };
}

function syntheticSession({ mode, maxPlayers, count, ready = false }) {
  const starts = [];
  const session = new OnlineSession(null, { onStart(payload) { starts.push(payload); } });
  const players = Array.from({ length: count }, (_, index) => rosterPlayer(index, ready));
  session._role = 'host';
  session._closed = false;
  session._code = 'ABCDE';
  session._playerId = 'host001';
  session._mode = mode;
  session._maxPlayers = maxPlayers;
  session._lobby = {
    code: 'ABCDE',
    mode,
    maxPlayers,
    map: mode === 'deathmatch' ? 'de_dust2_dm' : 'aim_1v1',
    targetKills: mode === 'deathmatch' ? 0 : 13,
    hostId: 'host001',
    roster: Object.fromEntries(players.map((player) => [player.id, { ...player }])),
    players: players.map((player) => ({ ...player })),
    host: { ...players[0] },
    guest: players[1] ? { ...players[1] } : null,
  };
  const messages = new Map();
  for (const player of players.slice(1)) {
    const sent = [];
    const conn = {
      open: true,
      peer: `peer-${player.id}`,
      metadata: { playerId: player.id },
      send(message) { sent.push(message); },
      close() {},
    };
    messages.set(player.id, sent);
    session._connections.set(player.id, conn);
    session._connPlayers.set(conn, player.id);
  }
  return { session, players, starts, messages };
}

// Creating a Deathmatch room must produce a shareable code/link and pin the
// room contract to Dust2 with capacity ten.
{
  const previousLocation = globalThis.location;
  globalThis.location = { origin: 'https://strike.example', pathname: '/play' };
  const peers = [];
  const session = new OnlineSession(null, {
    peerFactory(id) {
      const peer = new FakePeer(id);
      peers.push(peer);
      return peer;
    },
  });
  const result = await session.host('Host', { mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm' });
  assert.match(result.code, CODE_RE, 'host receives a five-character invitation code');
  assert.equal(result.link, `https://strike.example/play?join=${result.code}`, 'invite link carries the room code');
  assert.equal(session.lobby.mode, 'deathmatch');
  assert.equal(session.lobby.maxPlayers, 10);
  assert.equal(session.lobby.map, 'de_dust2_dm');
  assert.equal(session.lobby.targetKills, 0);
  assert.equal(session.setMaxPlayers(4), false, 'Deathmatch capacity cannot be downgraded to a classic room');
  assert.equal(session.setMap('aim_1v1'), false, 'Deathmatch room cannot switch away from Dust2');
  session.close('test');
  assert.equal(peers[0].destroyed, true, 'closing invitation room disposes its Peer');
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
}

// READY is authoritative for all ten seats. The tenth READY starts once and
// sends the same 10-player roster to every guest.
{
  const { session, players, starts, messages } = syntheticSession({
    mode: 'deathmatch', maxPlayers: 10, count: 10, ready: false,
  });
  session._setTimer = (fn) => { fn(); return null; };
  assert.equal(session.setReady(true), true);
  assert.equal(session.started, false, 'host READY alone cannot start Deathmatch');
  for (const player of players.slice(1)) {
    const conn = session._connections.get(player.id);
    session._onReadyMessage({ t: 'ready', ready: true, playerId: player.id }, conn);
  }
  assert.equal(session.started, true, 'ten READY players start Deathmatch');
  assert.equal(starts.length, 1, 'host receives exactly one start payload');
  assert.equal(starts[0].players.length, 10);
  assert.equal(starts[0].maxPlayers, 10);
  assert.equal(starts[0].mode, 'deathmatch');
  assert.equal(starts[0].map, 'de_dust2_dm');
  for (const player of players.slice(1)) {
    const startsForGuest = messages.get(player.id).filter((message) => message.t === 'start');
    assert.equal(startsForGuest.length, 1, `${player.id} receives one start message`);
    assert.equal(startsForGuest[0].players.length, 10);
  }
}

// Seat 11 is rejected instead of silently expanding a Deathmatch room.
{
  const { session } = syntheticSession({ mode: 'deathmatch', maxPlayers: 10, count: 10, ready: false });
  const sent = [];
  let closed = false;
  const overflow = {
    open: true,
    peer: 'overflow-peer',
    metadata: { playerId: 'guest999' },
    send(message) { sent.push(message); },
    close() { closed = true; },
  };
  session._pendingConnections.add(overflow);
  session._onHello({ t: 'hello', name: 'Overflow', playerId: 'guest999' }, overflow);
  assert.equal(sent.some((message) => message.t === 'full' && message.maxPlayers === 10), true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(closed, true, 'overflow connection is closed after full-room response');
  assert.equal(Object.keys(session.lobby.roster).length, 10);
}

// Classic start rules remain exact: 1v1 requires two and 2v2 requires four.
{
  const one = syntheticSession({ mode: '1v1', maxPlayers: 2, count: 1, ready: true });
  one.session._startMatch();
  assert.equal(one.session.started, false, '1v1 cannot start with one player');

  const two = syntheticSession({ mode: '1v1', maxPlayers: 2, count: 2, ready: true });
  two.session._startMatch();
  assert.equal(two.session.started, true, '1v1 still starts with exactly two players');
  assert.equal(two.starts[0].mode, '1v1');
  assert.equal(two.starts[0].targetKills, 13);

  const three = syntheticSession({ mode: '2v2', maxPlayers: 4, count: 3, ready: true });
  three.session._startMatch();
  assert.equal(three.session.started, false, '2v2 cannot start with only three players');

  const four = syntheticSession({ mode: '2v2', maxPlayers: 4, count: 4, ready: true });
  four.session._startMatch();
  assert.equal(four.session.started, true, '2v2 still starts with exactly four players');
  assert.equal(four.starts[0].players.length, 4);
  assert.equal(four.starts[0].mode, '2v2');
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      if (force === undefined) force = !values.has(name);
      if (force) values.add(name); else values.delete(name);
      return force;
    },
    contains(name) { return values.has(name); },
  };
}

// Deathmatch gateway routes Offline to local bots and Online to the dedicated
// online home without conflating it with classic 1v1/2v2.
{
  const previousDocument = globalThis.document;
  const listeners = {};
  const status = { textContent: '' };
  const bots = { value: '9' };
  const difficulty = { value: 'hard' };
  const offlineButton = { focus() {} };
  const overlay = {
    className: '',
    classList: classList(),
    setAttribute() {},
    innerHTML: '',
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector(selector) {
      if (selector === '[data-dm="status"]') return status;
      if (selector === '[data-dm="bots"]') return bots;
      if (selector === '[data-dm="difficulty"]') return difficulty;
      if (selector === '[data-dm-action="offline"]') return offlineButton;
      return null;
    },
  };
  globalThis.document = {
    createElement() { return overlay; },
    body: { appendChild() {} },
    addEventListener() {},
    querySelector() { return null; },
  };
  const calls = [];
  const game = {
    state: 'playing',
    onlineUI: { isOpen: false },
    input: { exitPointerLock() {} },
    ui: { hideAll() {}, showMainMenu() {}, showFatalError() {} },
    openOnlineHome(mode) { calls.push(['online', mode]); },
    startDeathmatch(options) { calls.push(['offline', options]); return Promise.resolve(); },
  };
  const gateway = new DeathmatchUI(game);
  gateway.init();
  listeners.click({ target: { closest() { return { dataset: { dmAction: 'online' } }; } } });
  assert.deepEqual(calls.shift(), ['online', 'deathmatch'], 'Online selector opens the Deathmatch online flow');
  listeners.click({ target: { closest() { return { dataset: { dmAction: 'offline' } }; } } });
  assert.deepEqual(calls.shift(), ['offline', { bots: 9, difficulty: 'hard' }], 'Offline selector starts local Deathmatch config');
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

// OnlineUI forwards the dedicated Deathmatch contract to OnlineSession and
// recognizes invitation links before the user presses Join.
{
  let hostOptions = null;
  const fakeSession = {
    code: 'AB234',
    lobby: {
      code: 'AB234', mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm', targetKills: 0,
      host: { id: 'host001', name: 'Host', slot: 0, ready: false, connected: true, isHost: true },
      guest: null,
    },
    async host(_name, options) {
      hostOptions = options;
      return { code: 'AB234', link: 'https://strike.example/play?join=AB234' };
    },
  };
  const ui = new OnlineUI({});
  ui._mode = 'deathmatch';
  ui._readName = () => 'Host';
  ui._saveName = () => {};
  ui._setBusy = (value) => { ui._busy = !!value; };
  ui._setView = () => {};
  ui._setStatus = () => {};
  ui._session = () => fakeSession;
  ui._sessionLobby = () => fakeSession.lobby;
  let hostShown = false;
  ui._showHost = () => { hostShown = true; };
  await ui._create();
  assert.deepEqual(hostOptions, { mode: 'deathmatch', maxPlayers: 10, map: 'de_dust2_dm' });
  assert.equal(ui._hostCode, 'AB234');
  assert.equal(ui._hostLink, 'https://strike.example/play?join=AB234');
  assert.equal(hostShown, true);

  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      search: '?join=ZX234',
      href: 'https://strike.example/play?legacy=1#old',
      origin: 'https://strike.example',
      pathname: '/play',
    },
  };
  const hintClasses = classList();
  const inviteUi = new OnlineUI({});
  inviteUi._refs = {
    codeInput: { value: '' },
    inviteCode: { textContent: '' },
    inviteHint: { classList: hintClasses },
  };
  inviteUi._readInvite();
  assert.equal(inviteUi._joinCode, 'ZX234');
  assert.equal(inviteUi._refs.codeInput.value, 'ZX234');
  assert.equal(inviteUi._refs.inviteCode.textContent, 'ZX234');
  assert.equal(hintClasses.contains('online-hidden'), false, 'valid invite hint is visible');
  assert.equal(inviteUi._buildLink('AB234'), 'https://strike.example/play?join=AB234', 'copied link strips stale query/hash');
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}

console.log('Deathmatch lobby flow OK: invite, 10 seats, ready/start, selector and classic regressions');
