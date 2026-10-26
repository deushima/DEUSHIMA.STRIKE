import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/game.js';
import { OnlineUI } from '../src/ui/online-ui.js';
import {
  DEFAULT_OFFLINE_DUEL_MAP,
  OFFLINE_DUEL_MAPS,
  isOfflineDuelMap,
  offlineDuelMapLabel,
} from '../src/ui/offline-maps.js';

const ids = OFFLINE_DUEL_MAPS.map((map) => map.id);
assert.deepEqual(ids, [
  'aim_1v1',
  'aim_redline',
  'aim_forge',
  'cs_assault',
  'cs_office',
  'de_dust2',
  'dust_short',
], 'offline 1v1 selector exposes every supported local arena in a stable order');
assert.equal(DEFAULT_OFFLINE_DUEL_MAP, 'aim_1v1');
assert.equal(offlineDuelMapLabel('aim_1v1'), 'AIM_MAP');
assert.equal(offlineDuelMapLabel('dust_short'), 'DUST SHORT');
assert.equal(isOfflineDuelMap('de_dust2_dm'), false, 'Deathmatch Dust2 is not an offline duel arena');

// Game.startOffline is the stable map-id entry point used by the menu. It must
// preserve options while sanitizing unsupported ids before delegating to Duel.
const starts = [];
const fakeGame = {
  startDuel(config) {
    starts.push(config);
    return config;
  },
};
for (const id of ids) {
  const result = Game.prototype.startOffline.call(fakeGame, id, { difficulty: 'hard', roundsToWin: 9 });
  assert.equal(result.map, id, `startOffline preserves supported id ${id}`);
  assert.equal(result.difficulty, 'hard');
  assert.equal(result.roundsToWin, 9);
}
const fallback = Game.prototype.startOffline.call(fakeGame, 'de_dust2_dm', { difficulty: 'easy' });
assert.equal(fallback.map, 'aim_1v1', 'unsupported offline ids fall back to AIM_MAP');

// The visible classic main menu owns one unified offline category, not loose
// map buttons. Individual maps live only in the selector generated from the
// shared OFFLINE_DUEL_MAPS contract.
const here = path.dirname(fileURLToPath(import.meta.url));
const classicSource = fs.readFileSync(path.resolve(here, '../src/ui/classic.js'), 'utf8');
const nav = classicSource.match(/<nav class="cm-nav"[\s\S]*?<\/nav>/)?.[0] || '';
assert.match(nav, /data-cm="offline"[^>]*>[\s\S]*?1V1 OFFLINE/);
assert.equal((nav.match(/data-cm="offline"/g) || []).length, 1, 'main menu has one offline category');
for (const legacyAction of ['duel', 'redline', 'forge', 'assault']) {
  assert.doesNotMatch(nav, new RegExp(`data-cm="${legacyAction}"`), `no loose ${legacyAction} button remains`);
}
assert.match(nav, /data-cm="online"/);
assert.match(nav, /data-cm="deathmatch"/);
assert.match(nav, /data-cm="options"/);
assert.match(classicSource, /OFFLINE_DUEL_MAPS\.map/);
assert.match(classicSource, /data-offline-map=/);
assert.match(classicSource, /this\.game\.startOffline\(mapId, config\)/);

// Dust Short uses one CT + one T spawn. It remains selectable for online 1v1,
// but the UI must not offer it to a host after switching the room to 2v2.
const mapOptions = [
  { value: 'aim_1v1', hidden: false, disabled: false },
  { value: 'dust_short', hidden: false, disabled: false },
  { value: 'de_dust2_dm', hidden: false, disabled: false },
];
const onlineUI = Object.create(OnlineUI.prototype);
onlineUI._refs = { mapSelect: { options: mapOptions } };
onlineUI._mode = 'classic';
onlineUI._lobby = { maxPlayers: 2 };
onlineUI._session = () => null;
onlineUI._sessionLobby = () => onlineUI._lobby;
onlineUI._syncMapSelectOptions(2);
assert.equal(mapOptions[1].hidden, false, 'Dust Short is offered in online 1v1');
assert.equal(mapOptions[1].disabled, false);
assert.equal(mapOptions[2].hidden, true, 'Deathmatch map stays out of classic 1v1');
onlineUI._syncMapSelectOptions(4);
assert.equal(mapOptions[1].hidden, true, 'Dust Short is hidden in online 2v2');
assert.equal(mapOptions[1].disabled, true, 'Dust Short is disabled in online 2v2');
assert.equal(mapOptions[0].hidden, false, 'normal maps remain available in 2v2');
onlineUI._mode = 'deathmatch';
onlineUI._syncMapSelectOptions(10);
assert.equal(mapOptions[0].hidden, true);
assert.equal(mapOptions[1].hidden, true);
assert.equal(mapOptions[2].hidden, false, 'Deathmatch keeps its dedicated Dust2 map');

const css = fs.readFileSync(path.resolve(here, '../src/ui/classic.css'), 'utf8');
assert.match(css, /\.cm-offline-grid\s*\{/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.cm-offline-grid\s*\{\s*grid-template-columns:\s*1fr;/,
  'offline selector collapses to one column on narrow screens');

const gameSource = fs.readFileSync(path.resolve(here, '../src/game.js'), 'utf8');
assert.match(gameSource, /mapId === 'dust_short'/);
assert.match(gameSource, /import\('\.\/world\/dust_short_map\.js'\)/);
assert.match(gameSource, /buildDustShortMap\(this\)/);
assert.match(gameSource, /await this\._buildDuelMap\(mapId\)/);

console.log('Offline menu OK: unified selector, 7 local maps, startOffline ids, responsive UI and Dust Short 1v1-only online');
