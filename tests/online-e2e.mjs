/**
 * Online end-to-end test: 2 or 4 headless Chromes, PeerJS public cloud, lobby with
 * room code, READY, selected-map match, replicated drops, damage, rounds and rematch.
 *
 * Must run outside the DSH Windows file/pipe sandbox.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const artifacts = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const PORT = 8098;
const LOCAL_URL = `http://127.0.0.1:${PORT}/`;
const TARGET_URL = process.env.CS16_BASE_URL || LOCAL_URL;
const USE_LOCAL_SERVER = !process.env.CS16_BASE_URL;
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEST_MAP = process.env.CS16_E2E_MAP || 'aim_1v1';
const E2E_PLAYER_COUNT = Number(process.env.CS16_E2E_PLAYERS || 2);
const CDP_COMMAND_TIMEOUT_MS = Number(
  process.env.CS16_E2E_CDP_TIMEOUT_MS || (E2E_PLAYER_COUNT === 4 ? 30000 : 20000),
);
if (!['aim_1v1', 'aim_redline', 'aim_forge', 'cs_assault', 'cs_office'].includes(TEST_MAP))
  throw new Error('Invalid CS16_E2E_MAP: ' + TEST_MAP);
if (![2, 4].includes(E2E_PLAYER_COUNT))
  throw new Error('CS16_E2E_PLAYERS must be 2 or 4');

const errors = [];
const serverProcesses = [];
const chomes = [];
let server;
let browserControl = null;
let browserPort = null;

function log(...args) {
  console.log(...args);
}

function isKnownOptionalGoldSrc404(url) {
  let pathname = '';
  try {
    pathname = new URL(url, TARGET_URL).pathname;
  } catch {
    return false;
  }
  return (
    pathname === '/assets/cs16/ui/hud.json' ||
    pathname.startsWith('/assets/cs16/ui/hud/') ||
    pathname.startsWith('/assets/cs16/models/') ||
    pathname.startsWith('/assets/cs16/sound/') ||
    pathname.startsWith('/assets/cs16/textures/wad/')
  );
}

function isKnownOptionalConsoleError(text) {
  return /^\[classic\] falta assets\/cs16\/ui\/hud\.json\b/.test(String(text || ''));
}

function assertOptionalGoldSrc404Policy() {
  const optional = [
    '/assets/cs16/ui/hud.json',
    '/assets/cs16/ui/hud/640_pain.png',
    '/assets/cs16/models/v_m4a1.json',
    '/assets/cs16/sound/weapons/m4a1-1.wav',
    '/assets/cs16/textures/wad/cs_dust/SandRoad.png',
  ];
  for (const url of optional) {
    if (!isKnownOptionalGoldSrc404(url)) {
      throw new Error('Optional GoldSrc 404 policy missed: ' + url);
    }
  }
  const required = [
    '/assets/cs16/ui/menu.png',
    '/assets/maps/aim_1v1.json',
    '/src/game.js',
  ];
  for (const url of required) {
    if (isKnownOptionalGoldSrc404(url)) {
      throw new Error('Optional GoldSrc 404 policy is too broad: ' + url);
    }
  }
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/__health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('Server did not start');
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      for (const cb of this.handlers.get(msg.method) || []) cb(msg.params);
    });
  }

  send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
  }

  async eval(expression, timeoutMs = E2E_PLAYER_COUNT === 4 ? 60000 : 20000) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (res.exceptionDetails) {
      throw new Error(
        'Evaluation failed: ' +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text),
      );
    }
    return res.result?.value;
  }

  async waitFor(expression, timeoutMs = 25000, interval = 180) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (err) {
        last = err.message;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`waitFor timeout: ${expression} (last=${JSON.stringify(last)})`);
  }

  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' }, 60000);
    const file = path.join(artifacts, name);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    log('  screenshot:', file);
    return file;
  }

  async click(selector) {
    const rect = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height};
    })()`);
    if (!rect) throw new Error('Missing selector: ' + selector);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rect.x,
      y: rect.y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rect.x,
      y: rect.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async fill(selector, value) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }
}

async function findChromePort(profile, timeoutMs = 40000) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(portFile)) {
      try {
        const raw = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
        if (raw[0]) return Number(raw[0]);
      } catch {
        /* Chrome still writing the file */
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Chrome DevToolsActivePort not found: ' + profile);
}

async function ensureHarnessBrowser() {
  if (browserControl && browserPort) return { control: browserControl, port: browserPort };
  const profile = path.join(root, '.tmp', `online-browser-${process.pid}`);
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-crash-reporter',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,810',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  chomes.push(chrome);
  browserPort = await findChromePort(profile);
  const version = await (await fetch(`http://127.0.0.1:${browserPort}/json/version`)).json();
  if (!version.webSocketDebuggerUrl) throw new Error('Chrome browser CDP endpoint missing');
  browserControl = new CDP(version.webSocketDebuggerUrl);
  await browserControl.connect();
  return { control: browserControl, port: browserPort };
}

async function launchPage(name) {
  const { control, port } = await ensureHarnessBrowser();
  const context = await control.send('Target.createBrowserContext', {}, 60000);
  const created = await control.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId: context.browserContextId,
    background: true,
  }, 90000);
  let tab;
  for (let i = 0; i < 80; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    tab = list.find((t) => t.type === 'page' && t.id === created.targetId);
    if (tab) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!tab) throw new Error('No page target for ' + name);
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.connect();
  cdp.targetId = created.targetId;
  cdp.browserContextId = context.browserContextId;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  if (E2E_PLAYER_COUNT === 4) {
    // Four WebGL clients are already enough load for the networking test. Use
    // the production public-build flag so optional extracted GoldSrc HUD/WAD/
    // viewmodel assets do not consume CPU and I/O on every headless client.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'globalThis.__DEUSHIMA_PUBLIC__ = true;',
    });
  }
  cdp.on('Runtime.exceptionThrown', (p) => {
    const text = p.exceptionDetails?.exception?.description || p.exceptionDetails?.text;
    errors.push(`[${name}] ${text}`);
    log(`  [${name} exception]`, text);
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') {
      if (isKnownOptionalConsoleError(text)) {
        log(`  [${name} optional GoldSrc]`, text);
        return;
      }
      errors.push(`[${name}] console.error: ${text}`);
      log(`  [${name} console.error]`, text);
    } else if (/error|failed|closed/i.test(text)) {
      log(`  [${name} console.${p.type}]`, text);
    }
  });
  cdp.on('Log.entryAdded', (p) => {
    const t = p.entry;
    // Chromium's Log domain omits the request URL for resource failures. The
    // Network domain below records the same failure with URL + status, so skip
    // only that duplicate generic entry here.
    if (t.source === 'network' && /Failed to load resource/i.test(t.text)) return;
    if (t.level === 'error') {
      errors.push(`[${name}] ${t.source}: ${t.text}`);
      log(`  [${name} log]`, t.level, t.text);
    }
  });
  cdp.on('Network.responseReceived', (p) => {
    const status = Number(p.response?.status);
    if (!Number.isFinite(status) || status < 400) return;
    const url = p.response?.url || '';
    let pathname = url;
    try { pathname = new URL(url).pathname; } catch { /* keep raw URL */ }
    if (status === 404 && isKnownOptionalGoldSrc404(url)) {
      log(`  [${name} optional GoldSrc 404]`, pathname);
      return;
    }
    if (status === 404 && pathname === '/favicon.ico') return;
    errors.push(`[${name}] network ${status}: ${url}`);
    log(`  [${name} network]`, status, url);
  });
  await cdp.send('Page.navigate', { url: TARGET_URL });
  await cdp.waitFor(`!!window.__CS16__`, 60000);
  await cdp.waitFor(`window.__CS16__.state === 'menu'`, 60000);
  // Headless tabs cannot hold pointer lock reliably; the online logic doesn't require it.
  await cdp.eval(`window.__CS16__.input.requestPointerLock = () => {}; true`);
  log(`  ${name} ready`);
  return cdp;
}

async function closePage(cdp) {
  if (!cdp) return;
  try {
    if (browserControl && cdp.targetId) {
      await browserControl.send('Target.closeTarget', { targetId: cdp.targetId });
    }
  } catch {
    /* ignore */
  }
  try {
    if (browserControl && cdp.browserContextId) {
      await browserControl.send('Target.disposeBrowserContext', {
        browserContextId: cdp.browserContextId,
      });
    }
  } catch {
    /* ignore */
  }
  try { cdp.ws?.close(); } catch { /* ignore */ }
}

async function main() {
  assertOptionalGoldSrc404Policy();
  log('Starting server...');
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, ['server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore',
    });
    serverProcesses.push(server);
    await waitForHealth();
    // A stale harness server on the same port can make /__health succeed even
    // if this child immediately died with EADDRINUSE. Give the child one turn
    // to report that exit and fail instead of testing against the wrong run.
    await new Promise((r) => setTimeout(r, 150));
    if (server.exitCode !== null) {
      throw new Error(`E2E server exited early with code ${server.exitCode}; port ${PORT} may already be in use`);
    }
  } else {
    log('Using deployed URL:', TARGET_URL);
  }

  log(`Launching ${E2E_PLAYER_COUNT} browsers...`);
  const host = await launchPage('host');
  const guests = [];
  for (let i = 1; i < E2E_PLAYER_COUNT; i++) guests.push(await launchPage(`guest${i}`));
  const guest = guests[0];
  const clients = [host, ...guests];

  // Clean old localStorage names is fine. Open the online home in every client.
  for (const client of clients) await client.eval(`window.__CS16__.openOnlineHome(); true`);
  for (const client of clients) {
    await client.waitFor(`!!document.querySelector('[data-view="home"]:not(.online-hidden)')`, 12000);
    await client.waitFor(`getComputedStyle(document.getElementById('classic-menu')).opacity === '0'`, 8000);
  }

  await host.fill('[data-online-ref="nameInput"]', 'HostE2E');
  await host.click('[data-online-action="create"]');
  await host.waitFor(
    `!!window.__CS16__.onlineSession && window.__CS16__.onlineSession.role === 'host' && !!window.__CS16__.onlineSession.code`,
    40000,
  );
  const code = await host.eval(`window.__CS16__.onlineSession.code`);
  log('Room code:', code);

  if (E2E_PLAYER_COUNT === 4) {
    await host.waitFor(`!!document.querySelector('[data-view="host"]:not(.online-hidden)')`, 12000);
    await host.eval(`(() => {
      const select = document.querySelector('[data-online-ref="hostMaxPlayersSelect"]');
      if (!select) throw new Error('host maxPlayers selector missing');
      select.value = '4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await host.waitFor(`window.__CS16__.onlineSession.lobby?.maxPlayers === 4`, 10000);
  }

  for (let i = 0; i < guests.length; i++) {
    const client = guests[i];
    await client.fill('[data-online-ref="nameInputJoin"]', `Guest${i + 1}E2E`);
    await client.fill('[data-online-ref="codeInput"]', code);
    await client.click('[data-online-action="join"]');
    try {
      await client.waitFor(
        `!!window.__CS16__.onlineSession && window.__CS16__.onlineSession.role === 'guest' && !!window.__CS16__.onlineSession.connected`,
        40000,
      );
    } catch (err) {
      const dbg = await client.eval(`(() => {
        const g = window.__CS16__;
        const s = g.onlineSession;
        return {
          screen: g.onlineUI && g.onlineUI._screen,
          error: document.querySelector('[data-view="error"]:not(.online-hidden)')?.innerText?.slice(0,500),
          status: document.querySelector('[data-view="home"]:not(.online-hidden) .online-status')?.innerText,
          session: s ? {role:s.role, code:s.code, connected:s.connected, closed:s.closed, started:s.started, status:s._lastStatus} : null,
          codeInput: document.querySelector('[data-online-ref="codeInput"]')?.value,
          nameInput: document.querySelector('[data-online-ref="nameInputJoin"]')?.value,
        };
      })()`);
      const hostDbg = await host.eval(`(() => {
        const g = window.__CS16__; const s = g.onlineSession;
        return s ? {role:s.role, code:s.code, connected:s.connected, closed:s.closed, started:s.started, status:s._lastStatus, lobby:s.lobby} : null;
      })()`);
      log(`GUEST${i + 1} DEBUG:`, JSON.stringify(dbg, null, 2));
      log('HOST DEBUG:', JSON.stringify(hostDbg, null, 2));
      await client.screenshot(`25-online-join-failure-${i + 1}.png`);
      throw err;
    }
  }
  await host.waitFor(
    `window.__CS16__.onlineSession.lobby?.players?.length === ${E2E_PLAYER_COUNT}`,
    25000,
  );
  log(`Lobby connected (${E2E_PLAYER_COUNT} players)`);
  for (const client of clients)
    await client.waitFor(`!!document.querySelector('[data-view="lobby"]:not(.online-hidden)')`, 12000);
  for (const client of guests) {
    const guestSelectDisabled = await client.eval(`document.querySelector('[data-online-ref="mapSelect"]')?.disabled`);
    if (!guestSelectDisabled) throw new Error('Guest must not control the map selector');
  }
  await host.eval(`(() => {
    const select = document.querySelector('[data-online-ref="mapSelect"]');
    select.value = ${JSON.stringify(TEST_MAP)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  for (const client of guests)
    await client.waitFor(`window.__CS16__.onlineSession.lobby.map === ${JSON.stringify(TEST_MAP)}`, 10000);
  // A late host map change must revoke READY on both peers before starting.
  await host.click('[data-online-action="ready"]');
  await host.waitFor(`window.__CS16__.onlineSession.lobby.host.ready === true`, 10000);
  const alternateMap = TEST_MAP === 'aim_1v1' ? 'aim_redline' : 'aim_1v1';
  await host.eval(`(() => {
    const select = document.querySelector('[data-online-ref="mapSelect"]');
    select.value = ${JSON.stringify(alternateMap)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await host.waitFor(`window.__CS16__.onlineSession.lobby.host.ready === false`, 10000);
  for (const client of guests)
    await client.waitFor(`window.__CS16__.onlineSession.lobby.map === ${JSON.stringify(alternateMap)}`, 10000);
  await host.eval(`(() => {
    const select = document.querySelector('[data-online-ref="mapSelect"]');
    select.value = ${JSON.stringify(TEST_MAP)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await host.waitFor(`window.__CS16__.onlineSession.lobby.map === ${JSON.stringify(TEST_MAP)}`, 10000);
  for (const client of guests)
    await client.waitFor(`window.__CS16__.onlineSession.lobby.map === ${JSON.stringify(TEST_MAP)}`, 10000);
  await host.screenshot('20-online-host-lobby.png');
  await guest.screenshot('21-online-guest-lobby.png');

  // READY on every connected player.
  await host.click('[data-online-action="ready"]');
  await host.waitFor(`window.__CS16__.onlineSession.lobby.host.ready === true`, 10000);
  for (const client of guests) await client.click('[data-online-action="ready"]');
  for (const client of clients) await client.waitFor(`window.__CS16__.state === 'playing'`, 50000);
  for (const client of clients)
    await client.waitFor(`window.__CS16__.map && window.__CS16__.map.id === ${JSON.stringify(TEST_MAP)}`, 30000);
  for (const client of clients) await client.waitFor(`!!window.__CS16__.online`, 15000);
  for (const peer of clients) {
    const spawnCheck = await peer.eval(`(() => {
      const g = window.__CS16__;
      const localId = g.onlineSession.localPlayerId;
      const me = g.online.startPayload.players.find((p) => p.id === localId);
      const team = me?.team || g.player.team;
      const rolls = g.online.startPayload.spawnRolls || {};
      const roll = rolls[localId] ?? rolls.byPlayerId?.[localId] ?? rolls[team];
      const expected = g.map.spawns[team][Math.floor(roll * g.map.spawns[team].length)];
      return {
        localId,
        team:g.player.team,
        expected,
        actual:{x:g.player.pos.x,z:g.player.pos.z},
        roster:g.online.getRoster().length,
        remotes:g.online.getRemoteEntities().length,
        alive:g.getAliveCounts(),
      };
    })()`);
    if (!spawnCheck.expected || Math.abs(spawnCheck.actual.x - spawnCheck.expected.x) > .01 ||
      Math.abs(spawnCheck.actual.z - spawnCheck.expected.z) > .01)
      throw new Error('Wrong initial spawn: ' + JSON.stringify(spawnCheck));
    if (spawnCheck.roster !== E2E_PLAYER_COUNT || spawnCheck.remotes !== E2E_PLAYER_COUNT - 1)
      throw new Error('Wrong online roster replication: ' + JSON.stringify(spawnCheck));
    const perTeam = E2E_PLAYER_COUNT / 2;
    if (spawnCheck.alive.CT !== perTeam || spawnCheck.alive.T !== perTeam)
      throw new Error('Wrong alive team counts: ' + JSON.stringify(spawnCheck));
  }
  log(`All ${E2E_PLAYER_COUNT} clients in`, TEST_MAP);

  // Regression: remote pose/equipment must replicate, not just position/yaw.
  // Send one real protocol state explicitly; headless Chrome cannot retain
  // pointer-lock reliably enough to exercise held Ctrl through Player.update().
  await host.waitFor("window.__CS16__.online.phase === 'live'", 15000);
  await host.eval("(() => { const g=window.__CS16__; const prev={c:g.player.crouching,o:g.player.onGround,s:g.player.speed,w:g.weapons.currentId}; g.online._stateAccum=-999; g.player.crouching=true; g.player.onGround=false; g.player.speed=4.2; g.weapons.currentId='deagle'; g.online._sendState(); g.player.crouching=prev.c; g.player.onGround=prev.o; g.player.speed=prev.s; g.weapons.currentId=prev.w; return true; })()");
  await guest.waitFor("(() => { const o=window.__CS16__.online; const a=o?.avatars?.get?.(o.startPayload.hostId); return !!a && a.crouchAmount > 0.45 && a.weaponId === 'deagle' && a.onGround === false; })()", 10000);
  await guest.waitFor("(() => { const o=window.__CS16__.online; const c=o?.avatars?.get?.(o.startPayload.hostId)?._kenney; return !!c && c.state === 'duck' && c.gunMeshes?.Pistol?.visible === true; })()", 10000);
  const replicatedPose = await guest.eval("(() => { const o=window.__CS16__.online; const a=o.avatars.get(o.startPayload.hostId); const c=a._kenney; return { crouch:a.crouchAmount, weaponId:a.weaponId, onGround:a.onGround, anim:c?.state || null, pistolVisible:!!c?.gunMeshes?.Pistol?.visible }; })()");
  if (!(replicatedPose.crouch > 0.45) || replicatedPose.weaponId !== 'deagle' || replicatedPose.onGround !== false ||
      replicatedPose.anim !== 'duck' || replicatedPose.pistolVisible !== true) {
    throw new Error('Remote pose/equipment replication failed: ' + JSON.stringify(replicatedPose));
  }
  log('Remote pose/equipment:', replicatedPose);
  await host.eval("(() => { window.__CS16__.online._stateAccum=1; return true; })()");
  await new Promise((r) => setTimeout(r, 2200));

  // Require the user-selected identities on every actual remote avatar.
  for (const client of clients) {
    await client.waitFor("[...window.__CS16__.online.avatars.values()].every(a=>a._kenney?.characterId === (a.team === 'T' ? 'community-leet-fe6216ca' : 'community-sas-d2807183'))", 15000);
  }
  // Office has indoor ceilings and short corridors; the 30-jump open-arena
  // endurance check is specific to the AIM arenas, not the online protocol.
  if (E2E_PLAYER_COUNT === 2 && TEST_MAP !== 'cs_office') {
    // Two real PeerJS clients, unchanged production preset and game-loop physics.
    // Input.locked emulates pointer-lock only because headless Chrome drops it.
    // Delay only outgoing state packets by 120/135 ms, preserving packet order.
    for (const client of clients) {
      const start = await client.eval(`(() => {
        const g=window.__CS16__,o=g.online;
        const method=o.isHost?'_broadcast':'_sendToHost';
        const original=o[method].bind(o);let packet=0;
        o.__restoreStateTransport=()=>{o[method]=original;};
        o[method]=function(type,...args){if(type==='state')setTimeout(()=>original(type,...args),120+15*(packet++%2));else return original(type,...args);};
        g.input.locked=true;for(const k of ['KeyW','KeyA','KeyS','KeyD'])g.input.keys.delete(k);
        g.player.vel.x=0;g.player.vel.z=0;g.player._jumpCount=0;
        g.input.keys.add('Space');return g.player.getMovementDebugState();
      })()`);
      if(start.preset!=='CS16_1V1_AUTOBHOP'||!start.autoBhopEnabled||start.fixedStep!==.01)
        throw new Error('Default movement changed: '+JSON.stringify(start));
    }
    for(const client of clients){
      await client.waitFor("window.__CS16__.player._jumpCount >= 30",60000);
      await client.waitFor("[...window.__CS16__.online.players.values()].some(r=>r.id!==window.__CS16__.online.localId && r.lastState?.jumpCount >= 29 && r.lastState?.movementPreset === 'CS16_1V1_AUTOBHOP')",10000);
    }
    const jumps=[];
    for(const client of clients)jumps.push(await client.eval(`(() => {const g=window.__CS16__;g.input.keys.delete('Space');g.online.__restoreStateTransport();return g.player.getMovementDebugState();})()`));
    for(let i=0;i<clients.length;i++){
      // Headless software rendering can run slower than real time. Require
      // 1.2 seconds of actual fixed simulation, not 1.2 seconds on the host.
      await clients[i].waitFor(`window.__CS16__.player.getMovementDebugState().tick >= ${jumps[i].tick + 120}`, 20000);
      const after=await clients[i].eval('window.__CS16__.player.getMovementDebugState()');
      if(after.jumpCount!==jumps[i].jumpCount||!after.grounded||after.jumpHeld)
        throw new Error('Release did not stop chain: '+JSON.stringify({release:jumps[i],after}));
    }
    log('Online autobhop: both clients >=30 jumps, 120/135 ms state delay, release and replicated character IDs',jumps);
  }
  // Capture the real network avatar from a temporary inspection camera. The
  // player's physics, avatar, materials and map remain the live match objects.
  for(let i=0;i<clients.length;i++){
    await clients[i].eval(`(() => {
      const g=window.__CS16__,a=[...g.online.avatars.values()].find(a=>a.alive);
      if(!a)return false;
      g.player.__savedCamera=g.player.updateCamera;
      g.player.updateCamera=()=>{const p=a.pos;g.camera.position.set(p.x+1.8,p.y+1.15,p.z-2.3);g.camera.lookAt(p.x,p.y+.95,p.z);};
      return true;
    })()`);
    await new Promise(r=>setTimeout(r,200));
    await clients[i].screenshot('community-online-client-'+i+'.png');
    await clients[i].eval('(() => {const p=window.__CS16__.player;if(p.__savedCamera){p.updateCamera=p.__savedCamera;delete p.__savedCamera;}return true;})()');
  }

  // Real G-drop path: host authority removes the gun, every client sees one
  // network drop, then pickup removes it everywhere and preserves exact ammo.
  const dropInfo = await host.eval(`(() => {
    const g = window.__CS16__;
    g.weapons.setDroppedWeaponPickupEnabled(false);
    const entry = g.weapons.inventory.primary;
    if (!entry || entry.id !== 'm4a1') throw new Error('host primary missing before drop test');
    entry.magazine = 17;
    entry.reserve = 53;
    g.online._syncAuthorityFromLocal(Date.now());
    if (!g.weapons._dropCurrent()) throw new Error('G drop request rejected');
    const drop = [...g.online.drops.values()][0];
    return drop ? { id:drop.id, magazine:drop.entry.magazine, reserve:drop.entry.reserve } : null;
  })()`);
  if (!dropInfo?.id || dropInfo.magazine !== 17 || dropInfo.reserve !== 53)
    throw new Error('Host drop ammo mismatch: ' + JSON.stringify(dropInfo));
  for (const client of clients)
    await client.waitFor(`window.__CS16__.online.drops.size === 1 && window.__CS16__.weapons.dropped.length === 1`, 10000);
  for (const client of guests) {
    const remoteDrop = await client.eval(`(() => { const d=[...window.__CS16__.online.drops.values()][0]; return d ? {id:d.id,magazine:d.entry.magazine,reserve:d.entry.reserve} : null; })()`);
    if (remoteDrop?.id !== dropInfo.id || remoteDrop.magazine !== 17 || remoteDrop.reserve !== 53)
      throw new Error('Replicated drop mismatch: ' + JSON.stringify(remoteDrop));
  }
  await new Promise((r) => setTimeout(r, 700));
  await host.eval(`(() => {
    const g = window.__CS16__;
    g.weapons.setDroppedWeaponPickupEnabled(true);
    if (!g.online.requestWeaponPickup(${JSON.stringify(dropInfo.id)})) return false;
    return true;
  })()`);
  for (const client of clients)
    await client.waitFor(`window.__CS16__.online.drops.size === 0 && window.__CS16__.weapons.dropped.length === 0`, 10000);
  const pickedAmmo = await host.eval(`(() => { const e=window.__CS16__.weapons.inventory.primary; return e ? {id:e.id,magazine:e.magazine,reserve:e.reserve} : null; })()`);
  if (pickedAmmo?.id !== 'm4a1' || pickedAmmo.magazine !== 17 || pickedAmmo.reserve !== 53)
    throw new Error('Pickup ammo mismatch: ' + JSON.stringify(pickedAmmo));

  await host.screenshot('22-online-host-match.png');
  await guest.screenshot('23-online-guest-match.png');

  const matchInfo = await host.eval(`(() => {
    const g = window.__CS16__;
    return {
      map: g.map.id, phase: g.online.phase, role: g.online.role,
      team: g.player.team, health: g.player.health, weapon: g.weapons.getHudState().name,
      remote: g.online.getRemoteEntity()?.name, players: g.getAliveCounts(),
      score: g.online.getHudState(),
    };
  })()`);
  log('Host match:', JSON.stringify(matchInfo, null, 2));

  // Wait for live and force a headshot from the host to the guest through the real protocol.
  await host.waitFor(`window.__CS16__.online.phase === 'live'`, 15000);
  const beforeGuest = await guest.eval(`({health:window.__CS16__.player.health, alive:window.__CS16__.player.alive})`);
  await host.eval(`(() => {
    const g = window.__CS16__;
    const remote = g.online.getRemoteEntities().find((entity) => entity.team !== g.player.team);
    if (!remote) throw new Error('enemy remote missing');
    const p = g.player.pos;
    g.online.notifyLocalShot({
      origin: {x:p.x, y:p.y + 1.62, z:p.z},
      dir: {x:0, y:-0.02, z:1},
      weaponId: 'm4a1',
      hit: { entity: remote, part: 'head', point: {x:remote.pos.x, y:remote.pos.y+1.7, z:remote.pos.z} }
    });
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1400));
  const afterGuest = await guest.eval(`({health:window.__CS16__.player.health, alive:window.__CS16__.player.alive})`);
  const hostScore = await host.eval(`({scores:window.__CS16__.online.scores, phase:window.__CS16__.online.phase})`);
  log('Damage test:', { beforeGuest, afterGuest, hostScore });

  if (E2E_PLAYER_COUNT === 4) {
    // One kill must not end a 2v2 round. Eliminate the remaining T to exercise
    // the team-round transition before checking the next-round respawn.
    const phaseAfterFirstKill = await host.eval(`window.__CS16__.online.phase`);
    if (phaseAfterFirstKill !== 'live')
      throw new Error('2v2 round ended after only one opponent died: ' + phaseAfterFirstKill);
    await host.eval(`(() => {
      const o = window.__CS16__.online;
      const victim = [...o.players.values()].find((p) => p.team === 'T' && p.alive);
      if (!victim) throw new Error('remaining T missing');
      o._hostKill(o.localId, victim.id, 'm4a1', false);
      return true;
    })()`);
  }

  await new Promise((r) => setTimeout(r, 5200));
  const respawnedGuest = await guest.eval(`({health:window.__CS16__.player.health, alive:window.__CS16__.player.alive, pos:{x:window.__CS16__.player.pos.x,z:window.__CS16__.player.pos.z}})`);
  log('Guest respawn:', respawnedGuest);

  // Put CT on match point, then finish through the real team-round path.
  await host.eval(`(() => {
    const o = window.__CS16__.online;
    o.teamScores.CT = o.targetRounds - 1;
    o.phase = 'live';
    const victims = [...o.players.values()].filter((p) => p.team !== o.myTeam && p.connected !== false);
    if (!victims.length) throw new Error('opponents missing at match point');
    for (const victim of victims) {
      victim.alive = true;
      victim.health = 100;
      o.avatars.get(victim.id)?.respawn?.();
    }
    for (const victim of victims) o._hostKill(o.localId, victim.id, 'm4a1', false);
    return true;
  })()`);
  await host.waitFor(`!!document.querySelector('[data-view="matchEnd"]:not(.online-hidden)')`, 15000);
  for (const client of guests)
    await client.waitFor(`!!document.querySelector('[data-view="matchEnd"]:not(.online-hidden)')`, 15000);
  const endInfo = await host.eval(`({phase:window.__CS16__.online.phase, scoreCT:window.__CS16__.online.teamScores.CT, scoreT:window.__CS16__.online.teamScores.T, endText:document.querySelector('[data-view="matchEnd"]:not(.online-hidden)')?.innerText?.slice(0,300)})`);
  log('Match end:', JSON.stringify(endInfo));
  await host.screenshot('25-online-match-end.png');

  // Rematch: host resets lobby, every client should leave the match and keep the room.
  await host.eval(`window.__CS16__.online.requestRematch(); true`);
  for (const client of clients)
    await client.waitFor(`!!document.querySelector('[data-view="lobby"]:not(.online-hidden)')`, 30000);
  for (let i = 0; i < clients.length; i++) {
    const rematchInfo = await clients[i].eval(`({state:window.__CS16__.state, online:!!window.__CS16__.online, screen:window.__CS16__.onlineUI._screen, role:window.__CS16__.onlineSession?.role, code:window.__CS16__.onlineSession?.code})`);
    const expectedRole = i === 0 ? 'host' : 'guest';
    if (rematchInfo.state !== 'menu' || rematchInfo.online || rematchInfo.screen !== 'lobby' ||
        rematchInfo.role !== expectedRole || rematchInfo.code !== code) {
      throw new Error(`Bad rematch state for client ${i}: ` + JSON.stringify(rematchInfo));
    }
    log(`Rematch/lobby client ${i}:`, JSON.stringify(rematchInfo));
  }
  await host.screenshot('26-online-rematch-lobby.png');

  if (E2E_PLAYER_COUNT === 2) {
    log('Closing guest to test disconnect...');
    const guestId = await guest.eval(`window.__CS16__.onlineSession.localPlayerId`);
    await guest.eval(`window.__CS16__.onlineSession.close('E2E guest disconnect'); true`);
    await closePage(guest);
    await host.waitFor(`(() => {
      const roster = window.__CS16__.onlineSession?.lobby?.roster;
      if (!roster) return false;
      const peer = roster[${JSON.stringify(guestId)}];
      return !peer || peer.connected === false;
    })()`, 16000);
    const afterClose = await host.eval(`(() => {
      const g = window.__CS16__;
      const s = g.onlineSession;
      const peer = s?.lobby?.roster?.[${JSON.stringify(guestId)}];
      return {
        state:g.state,
        online:!!g.online,
        session:!!s,
        screen:g.onlineUI?._screen,
        code:s?.code,
        peerExists:!!peer,
        peerConnected:peer?.connected,
        peerReady:peer?.ready,
        mainVisible:!document.querySelector('[data-screen="main"]')?.classList.contains('u-hidden'),
      };
    })()`);
    const peerGoneOrDisconnected =
      afterClose.peerExists === false ||
      (afterClose.peerConnected === false && afterClose.peerReady === false);
    if (afterClose.state !== 'menu' || afterClose.online || !afterClose.session ||
        afterClose.screen !== 'lobby' || afterClose.code !== code ||
        !peerGoneOrDisconnected) {
      throw new Error('Bad host state after guest disconnect: ' + JSON.stringify(afterClose));
    }
    log('Host after guest close:', afterClose);
  }

  if (errors.length) {
    log('\nERRORS (' + errors.length + '):');
    for (const e of errors) log(' -', e);
    process.exitCode = 1;
  } else {
    log('\nNo browser errors.');
  }
}

async function cleanup() {
  try { browserControl?.ws?.close(); } catch { /* ignore */ }
  browserControl = null;
  browserPort = null;
  for (const c of chomes) {
    try {
      if (process.platform === 'win32' && c.pid) {
        spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        c.kill();
      }
    } catch {
      /* ignore */
    }
  }
  for (const s of serverProcesses) {
    try {
      if (process.platform === 'win32' && s.pid) {
        spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        s.kill();
      }
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
}

main()
  .catch((err) => {
    console.error('ONLINE E2E FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 800);
  });
