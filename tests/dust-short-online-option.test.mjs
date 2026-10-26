import assert from 'node:assert/strict';
import { ONLINE_MAPS, isOnlineMap, onlineMapLabel } from '../src/world/online_map_pool.js';
import { OnlineSession } from '../src/online/session.js';

assert.equal(ONLINE_MAPS.filter(({ id }) => id === 'dust_short').length, 1,
  'Dust Short must appear exactly once in the shared host/guest map pool');
assert.equal(isOnlineMap('dust_short'), true);
assert.equal(onlineMapLabel('dust_short'), 'DUST SHORT');
assert.equal(isOnlineMap('de_dust2_dm'), true, 'Deathmatch map remains registered');

let start = null;
const lobbyMessages = [];
const session = new OnlineSession(null, { onStart(payload) { start = payload; } });
session._role = 'host';
session._closed = false;
session._playerId = 'host001';
session._code = 'ABCDE';
session._lobby = {
  code: 'ABCDE', mode: '1v1', maxPlayers: 2, map: 'aim_1v1',
  targetKills: 13, hostId: 'host001',
  roster: {
    host001: { id: 'host001', name: 'Host', slot: 0, team: 'CT', ready: false, connected: true, isHost: true },
    guest001: { id: 'guest001', name: 'Guest', slot: 1, team: 'T', ready: false, connected: true, isHost: false },
  },
};
const conn = { open: true, send(value) { lobbyMessages.push(value); }, close() {} };
session._connections.set('guest001', conn);
session._connPlayers.set(conn, 'guest001');
assert.equal(session.setMap('dust_short'), true, 'host can select Dust Short without creating a new session');
assert.equal(session.lobby.map, 'dust_short');
assert.equal(lobbyMessages.some((msg) => JSON.stringify(msg).includes('dust_short')), true,
  'host map choice is propagated over the existing lobby channel');
assert.equal(session.setMaxPlayers(4), true, 'host can change to classic 2v2 without breaking the room');
assert.equal(session.lobby.map, 'aim_1v1', 'Dust Short one-spawn-per-team cannot remain selected in 2v2');
assert.equal(session.setMap('dust_short'), false, 'Dust Short is 1v1-only online');
assert.equal(session.setMaxPlayers(2), true);
assert.equal(session.setMap('dust_short'), true);
session._lobby.roster.host001.ready = true;
session._lobby.roster.guest001.ready = true;
session._startMatch();
assert.equal(session.started, true);
assert.equal(start?.map, 'dust_short', 'host match starts with the chosen imported map');
assert.equal(start?.mode, '1v1');
assert.equal(start?.maxPlayers, 2);
assert.equal(start?.players?.length, 2);

session._started = false;
session._lobby.mode = 'deathmatch';
session._lobby.map = 'de_dust2_dm';
assert.equal(session.setMap('dust_short'), false, 'Dust Short cannot replace Deathmatch map');
session.close('test');
console.log('Dust Short online 1v1 map option OK: host selection, guest lobby sync and match payload; DM preserved');
