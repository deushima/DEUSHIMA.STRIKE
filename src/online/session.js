/**
 * OnlineSession â€” lobby PeerJS host-autoritativo para salas Online de 2 o 4 jugadores.
 *
 * Protocolo (PeerJS DataConnection, serializaciÃ³n JSON):
 *   Control interno (plano):
 *     { t:'hello', name }                       guest -> host
 *     { t:'lobby', lobby }                      host -> guest (lobby autoritativo)
 *     { t:'ready', ready }                      guest -> host
 *     { t:'start', role, code, names, hostTeam, guestTeam, startAt, targetKills }
 *     { t:'full' }                              host -> tercer jugador (y cierra)
 *     { t:'restartLobby' }                      host -> guest
 *     { t:'ping', ts } / { t:'pong', ts }       heartbeat interno (no se usa en partida)
 *   Mensajes de partida:
 *     { t:<tipo>, p:<payload> }                 se enrutan a handlers.onMatchMessage(tipo, payload)
 *
 * No usa `game` para lÃ³gica de partida: solo handlers. `game` se guarda por si el
 * consumidor quiere acceder desde afuera.
 *
 * Nota de testeo: `handlers.peerFactory(id, options)` permite inyectar un stub de
 * PeerJS en Node (global `window.Peer` no existe fuera del navegador).
 */

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const CODE_RE = /^[A-Z2-9]{5}$/;
const PEER_PREFIX = 'cs16aim';
const MODE_1V1 = '1v1';
const MODE_2V2 = '2v2';
const MODE_DEATHMATCH = 'deathmatch';
const DEATHMATCH_MAP = 'de_dust2_dm';
const DEATHMATCH_MAX_PLAYERS = 10;
const DEATHMATCH_MIN_PLAYERS = 2;
import { DEFAULT_ONLINE_MAP, isOnlineMap } from '../world/online_map_pool.js';
const TARGET_KILLS = 13;
const HOST_CODE_RETRIES = 5;
const PEER_OPEN_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 15000;
const LOBBY_TIMEOUT_MS = 15000;
const START_DELAY_MS = 500;
const COUNTDOWN_MS = 1500;
const MAX_NAME_LENGTH = 16;
const RECONNECT_GRACE_MS = 10000;
const RECONNECT_ATTEMPT_MS = 2500;
const VALID_MAX_PLAYERS = new Set([2, 4, DEATHMATCH_MAX_PLAYERS]);
const HOST_AUTH_MATCH_TYPES = new Set([
  'snapshot',
  'shotFx',
  'damage',
  'hitConfirm',
  'playerHit',
  'kill',
  'environmentDeath',
  'roundEnd',
  'roundStart',
  'respawn',
  'matchEnd',
  'weaponDropAdd',
  'weaponDropRemove',
  'weaponDropAccepted',
  'weaponDropsReset',
  'weaponPickupGranted',
  'playerSync',
  'dmBuyResult',
  'playerDisconnected',
  'playerReconnected',
]);

/** STUN pÃºblicos (Google + Twilio). Sin TURN propio: redes muy restrictivas pueden fallar. */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

const ERROR_MESSAGES = {
  'unavailable-id': 'Ese cÃ³digo de sala ya estÃ¡ en uso.',
  'peer-unavailable': 'No se encontrÃ³ la sala. VerificÃ¡ el cÃ³digo e intentÃ¡ de nuevo.',
  network: 'No se pudo conectar al servidor. RevisÃ¡ tu conexiÃ³n a internet.',
  'network-error': 'No se pudo conectar al servidor. RevisÃ¡ tu conexiÃ³n a internet.',
  'server-error': 'El servidor de salas no responde. IntentÃ¡ de nuevo en unos segundos.',
  'socket-error': 'Se cortÃ³ la conexiÃ³n con el servidor de salas.',
  'socket-closed': 'Se cortÃ³ la conexiÃ³n con el servidor de salas.',
  'unexpected-close': 'La sala se cerrÃ³ inesperadamente.',
  webrtc: 'FallÃ³ la conexiÃ³n directa entre los jugadores. ProbÃ¡ de nuevo.',
  'browser-incompatible':
    'Tu navegador no es compatible con WebRTC. ProbÃ¡ con Chrome, Edge o Firefox actualizado.',
  'ssl-unavailable': 'La conexiÃ³n segura no estÃ¡ disponible. AbrÃ­ el juego con https.',
  'invalid-id': 'El cÃ³digo de sala no es vÃ¡lido.',
  'invalid-key': 'La configuraciÃ³n de la sala no es vÃ¡lida.',
  disconnected: 'Se perdiÃ³ la conexiÃ³n con el servidor de salas.',
};

function translatePeerError(err) {
  const type = err && (err.type || err.name);
  if (type && ERROR_MESSAGES[type]) return ERROR_MESSAGES[type];
  if (err && err.message) return `Error de conexiÃ³n: ${err.message}`;
  return 'OcurriÃ³ un error de conexiÃ³n. IntentÃ¡ de nuevo.';
}

function sanitizeName(name) {
  const clean = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean || 'Jugador';
}

function normalizeCode(code) {
  return String(code == null ? '' : code)
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, CODE_LENGTH);
}

function randomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function randomPlayerId() {
  const bytes = new Uint8Array(12);
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `p_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function normalizePlayerId(value) {
  const id = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_-]{6,80}$/.test(id) ? id : '';
}

function normalizeMaxPlayers(value, fallback = 2) {
  const n = Number(value);
  return VALID_MAX_PLAYERS.has(n) ? n : fallback;
}

function normalizeMode(value, maxPlayers = 2) {
  if (value === MODE_DEATHMATCH || Number(maxPlayers) === DEATHMATCH_MAX_PLAYERS) return MODE_DEATHMATCH;
  return normalizeMaxPlayers(maxPlayers) === 4 ? MODE_2V2 : MODE_1V1;
}

function isSupportedMapForMode(mapId, mode) {
  if (mode === MODE_DEATHMATCH) return mapId === DEATHMATCH_MAP;
  return isOnlineMap(mapId);
}

function normalizeMapForMode(mapId, mode) {
  if (mode === MODE_DEATHMATCH) return DEATHMATCH_MAP;
  return isOnlineMap(mapId) ? mapId : DEFAULT_ONLINE_MAP;
}

function teamForSlot(slot) {
  return Number(slot) % 2 === 0 ? 'CT' : 'T';
}

function copyPlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    slot: player.slot,
    ready: !!player.ready,
    connected: player.connected !== false,
    isHost: !!player.isHost,
  };
}

function sortedPlayersFromRoster(roster) {
  return Object.values(roster || {})
    .filter(Boolean)
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map(copyPlayer);
}

function balancedSpawnRolls(players) {
  const rolls = {};
  for (const team of ['CT', 'T']) {
    const teammates = (players || [])
      .filter((player) => player?.team === team)
      .sort((a, b) => Number(a.slot) - Number(b.slot));
    if (!teammates.length) continue;
    const offset = Math.random();
    teammates.forEach((player, index) => {
      rolls[player.id] = (index + offset) / teammates.length;
    });
  }
  return rolls;
}

function freeForAllSpawnRolls(players) {
  const ordered = (players || []).slice().sort((a, b) => Number(a.slot) - Number(b.slot));
  const rolls = {};
  if (!ordered.length) return rolls;
  const offset = Math.random();
  ordered.forEach((player, index) => {
    rolls[player.id] = (index + offset) / ordered.length;
  });
  return rolls;
}

function makeLink(code) {
  const loc = typeof globalThis !== 'undefined' ? globalThis.location : null;
  if (!loc || !loc.origin) return '';
  const path = loc.pathname || '/';
  return `${loc.origin}${path}${path.includes('?') ? '&' : '?'}join=${code}`;
}

function makeLobby(code, hostName, hostId, options = {}) {
  const mode = normalizeMode(options.mode, options.maxPlayers);
  const maxPlayers = mode === MODE_DEATHMATCH
    ? DEATHMATCH_MAX_PLAYERS
    : normalizeMaxPlayers(options.maxPlayers, 2);
  const playerId = normalizePlayerId(hostId) || randomPlayerId();
  const host = {
    id: playerId,
    name: sanitizeName(hostName),
    team: 'CT',
    slot: 0,
    ready: false,
    connected: true,
    isHost: true,
  };
  const roster = { [playerId]: host };
  return {
    code,
    mode,
    maxPlayers,
    map: normalizeMapForMode(options.map, mode),
    targetKills: mode === MODE_DEATHMATCH ? 0 : TARGET_KILLS,
    hostId: playerId,
    roster,
    players: [copyPlayer(host)],
    host: copyPlayer(host),
    guest: null,
  };
}

function syncLobbyCompat(lobby) {
  if (!lobby) return lobby;
  if (!lobby.roster || typeof lobby.roster !== 'object') {
    const roster = {};
    const source = Array.isArray(lobby.players) && lobby.players.length
      ? lobby.players
      : [lobby.host, lobby.guest].filter(Boolean);
    source.forEach((raw, index) => {
      const fallbackId = index === 0 ? (lobby.hostId || 'legacy_host') : `legacy_guest_${index}`;
      const id = normalizePlayerId(raw?.id) || normalizePlayerId(fallbackId) || randomPlayerId();
      const slot = Number.isInteger(raw?.slot) ? raw.slot : index;
      roster[id] = {
        id,
        name: sanitizeName(raw?.name),
        team: raw?.team === 'T' ? 'T' : raw?.team === 'CT' ? 'CT' : teamForSlot(slot),
        slot,
        ready: !!raw?.ready,
        connected: raw?.connected !== false,
        isHost: !!raw?.isHost || slot === 0,
      };
    });
    lobby.roster = roster;
  }
  const players = sortedPlayersFromRoster(lobby.roster);
  lobby.players = players;
  lobby.mode = normalizeMode(lobby.mode, lobby.maxPlayers);
  lobby.maxPlayers = lobby.mode === MODE_DEATHMATCH
    ? DEATHMATCH_MAX_PLAYERS
    : normalizeMaxPlayers(lobby.maxPlayers);
  lobby.map = normalizeMapForMode(lobby.map, lobby.mode);
  lobby.targetKills = lobby.mode === MODE_DEATHMATCH
    ? 0
    : Math.max(1, Math.round(Number(lobby.targetKills) || TARGET_KILLS));
  lobby.host = players.find((player) => player.isHost || player.slot === 0) || null;
  lobby.guest = players.find((player) => player.slot === 1) || null;
  lobby.hostId = lobby.host ? lobby.host.id : lobby.hostId || null;
  return lobby;
}

function copyLobby(lobby) {
  if (!lobby) return null;
  syncLobbyCompat(lobby);
  const roster = {};
  for (const player of lobby.players || []) roster[player.id] = copyPlayer(player);
  return {
    code: lobby.code,
    mode: lobby.mode,
    maxPlayers: normalizeMaxPlayers(lobby.maxPlayers),
    map: lobby.map,
    targetKills: lobby.targetKills,
    hostId: lobby.hostId || null,
    roster,
    players: (lobby.players || []).map(copyPlayer),
    host: lobby.host ? { ...lobby.host } : null,
    guest: lobby.guest ? { ...lobby.guest } : null,
  };
}

export class OnlineSession {
  /**
   * @param {object} game instancia de Game (no se usa para lÃ³gica)
   * @param {object} handlers
   *   onStatus({phase,message}), onLobby(lobby), onStart(payload),
   *   onMatchMessage(type,payload), onClosed(reason), onError(message),
   *   peerFactory(id,options) -> Peer (solo tests)
   */
  constructor(game, handlers = {}) {
    this.game = game || null;
    this.handlers = handlers || {};

    this._peer = null;
    this._conn = null;
    this._connOpen = false;
    this._connections = new Map();
    this._connPlayers = new Map();
    this._pendingConnections = new Set();
    this._reconnectTimers = new Map();
    this._guestReconnectTimer = null;
    this._guestReconnectDeadline = 0;
    this._guestReconnectInFlight = false;
    this._role = null;
    this._code = null;
    this._name = '';
    this._playerId = null;
    this._maxPlayers = 2;
    this._mode = MODE_1V1;
    this._map = DEFAULT_ONLINE_MAP;
    this._guestName = '';
    this._hostName = '';
    this._remoteName = '';
    this._lobby = null;
    this._started = false;
    this._closed = true;
    this._closing = false;
    this._destroyed = false;
    this._closedEmitted = false;
    this._timers = new Set();
    this._startTimer = null;
    this._joinReject = null;
    this._lobbyWaiters = [];
    this._lastError = '';

    this._peerOptions = {
      config: { iceServers: ICE_SERVERS.map((s) => ({ ...s })) },
      debug: 0,
    };
    this._peerFactory =
      typeof this.handlers.peerFactory === 'function' ? this.handlers.peerFactory : null;
  }

  /* ====================================================================== */
  /* Getters                                                                */
  /* ====================================================================== */

  get role() {
    return this._role;
  }

  get code() {
    return this._code;
  }

  get lobby() {
    return this._lobby;
  }

  get localPlayerId() {
    return this._playerId;
  }

  get players() {
    return this._lobby ? (copyLobby(this._lobby).players || []) : [];
  }

  get maxPlayers() {
    return this._lobby ? normalizeMaxPlayers(this._lobby.maxPlayers) : this._maxPlayers;
  }

  get connected() {
    if (this._role === 'host') {
      for (const conn of this._connections.values()) {
        if (conn && conn.open === true) return true;
      }
      return false;
    }
    return !!this._conn && (this._connOpen || this._conn.open === true);
  }

  get remoteName() {
    if (this._role === 'host') return this._guestName || '';
    return this._hostName || this._remoteName || '';
  }

  get started() {
    return this._started;
  }

  get peer() {
    return this._peer;
  }

  get peerId() {
    return this._peer && this._peer.id ? this._peer.id : null;
  }

  /* ====================================================================== */
  /* Host                                                                   */
  /* ====================================================================== */

  /**
   * Crea una sala como host. Reintenta hasta 5 cÃ³digos si PeerJS devuelve
   * `unavailable-id`.
   * @returns {Promise<{code:string, link:string}>}
   */
  async host(name, options = {}) {
    if (this._role) throw new Error('Ya estÃ¡s en una sala');
    this._prepareSession();
    this._role = 'host';
    this._name = sanitizeName(name);
    this._hostName = this._name;
    this._playerId = randomPlayerId();
    this._mode = normalizeMode(options && options.mode, options && options.maxPlayers);
    this._maxPlayers = this._mode === MODE_DEATHMATCH
      ? DEATHMATCH_MAX_PLAYERS
      : normalizeMaxPlayers(options && options.maxPlayers, 2);
    this._map = normalizeMapForMode(options && options.map, this._mode);
    this._status('creating', 'Creando sala...');

    let lastError = null;
    for (let attempt = 0; attempt < HOST_CODE_RETRIES; attempt++) {
      const code = randomCode();
      try {
        await this._openPeer(PEER_PREFIX + code);
        this._code = code;
        break;
      } catch (err) {
        lastError = err;
        this._teardownPeer();
        if (err && err.type === 'unavailable-id') {
          this._status('creating', 'Ese cÃ³digo estÃ¡ ocupado. Probando con otro...');
          continue;
        }
        const message = translatePeerError(err);
        this._status('error', message);
        this._emitError(message);
        this._teardownPeer();
        this._resetFields();
        throw new Error(message);
      }
    }

    if (!this._code) {
      const message =
        'No se pudo crear la sala despuÃ©s de varios intentos. ' +
        (lastError && lastError.type === 'unavailable-id'
          ? 'Todos los cÃ³digos estaban ocupados. ProbÃ¡ de nuevo.'
          : 'RevisÃ¡ tu conexiÃ³n a internet y probÃ¡ de nuevo.');
      this._status('error', message);
      this._emitError(message);
      this._teardownPeer();
      this._resetFields();
      throw new Error(message);
    }

    this._attachPeerEvents();
    this._lobby = makeLobby(this._code, this._name, this._playerId, {
      mode: this._mode,
      maxPlayers: this._maxPlayers,
      map: this._map,
    });
    this._status(
      'waiting',
      `Sala ${this._code} creada. Esperando a tu amigo...`,
    );
    this._emitLobby();
    return { code: this._code, link: makeLink(this._code) };
  }

  /* ====================================================================== */
  /* Guest                                                                  */
  /* ====================================================================== */

  /**
   * Se une a una sala existente y resuelve cuando el host mandÃ³ el lobby.
   * Timeout de conexiÃ³n: 15 s.
   */
  async join(code, name) {
    if (this._role) throw new Error('Ya estÃ¡s en una sala');
    const cleanCode = normalizeCode(code);
    if (!CODE_RE.test(cleanCode)) {
      const message = 'CÃ³digo invÃ¡lido. Debe tener 5 caracteres (A-Z y 2-9).';
      this._status('error', message);
      this._emitError(message);
      throw new Error(message);
    }

    this._prepareSession();
    this._role = 'guest';
    this._code = cleanCode;
    this._name = sanitizeName(name);
    this._playerId = randomPlayerId();
    this._guestName = this._name;

    this._status('creating', 'Conectando...');
    try {
      await this._openPeer(null);
    } catch (err) {
      const message =
        err && err.type === 'timeout'
          ? 'Tiempo de espera agotado al conectar. RevisÃ¡ tu conexiÃ³n a internet.'
          : translatePeerError(err);
      this._status('error', message);
      this._emitError(message);
      this._teardownPeer();
      this._resetFields();
      throw new Error(message);
    }

    this._attachPeerEvents();
    this._status('connecting', 'Conectando con la sala...');

    let conn;
    try {
      conn = await this._connectToHost(PEER_PREFIX + cleanCode);
    } catch (err) {
      const message = (err && err.message) || translatePeerError(err);
      this._status('error', message);
      this._emitError(message);
      this._teardownPeer();
      this._resetFields();
      throw new Error(message);
    }

    this._conn = conn;
    this._connOpen = true;
    this._bindConn(conn);
    this._status('connecting', 'Conectado. Esperando al host...');
    this._sendRaw({ t: 'hello', name: this._name, playerId: this._playerId });

    try {
      await this._waitLobby();
    } catch (err) {
      const message = (err && err.message) || 'El host no respondiÃ³.';
      this._status('error', message);
      this._emitError(message);
      this._teardownPeer();
      this._resetFields();
      throw new Error(message);
    }

    this._status(
      'connected',
      this._hostName ? `Conectado a la sala de ${this._hostName}` : 'Conectado a la sala',
    );
  }

  /* ====================================================================== */
  /* Lobby                                                                  */
  /* ====================================================================== */

  /** Marca/desmarca READY. Host: actualiza y difunde. Guest: avisa al host. */
  setReady(value) {
    if (this._started) return false;
    const ready = !!value;
    if (this._role === 'host') {
      const local = this._localLobbyPlayer();
      if (!local) return false;
      local.ready = ready;
      syncLobbyCompat(this._lobby);
      this._broadcastLobby();
      this._maybeStart();
      return true;
    }
    if (this._role === 'guest') {
      const local = this._localLobbyPlayer();
      if (!local) return false;
      local.ready = ready;
      syncLobbyCompat(this._lobby);
      this._sendRaw({ t: 'ready', ready, playerId: this._playerId });
      this._emitLobby();
      return true;
    }
    return false;
  }

  /** Host chooses whether the room is legacy 1v1 (2) or 2v2 (4). */
  setMaxPlayers(value) {
    if (this._role !== 'host' || !this._lobby || this._started) return false;
    if (this._lobby.mode === MODE_DEATHMATCH) {
      return Number(value) === DEATHMATCH_MAX_PLAYERS;
    }
    const next = normalizeMaxPlayers(value, 0);
    if (next !== 2 && next !== 4) return false;
    const players = sortedPlayersFromRoster(this._lobby.roster);
    if (players.length > next) return false;
    if (this._lobby.maxPlayers === next) return true;
    this._cancelStartTimer();
    this._lobby.maxPlayers = next;
    this._maxPlayers = next;
    for (const player of Object.values(this._lobby.roster || {})) {
      if (player) player.ready = false;
    }
    syncLobbyCompat(this._lobby);
    this._broadcastLobby();
    return true;
  }

  /** Host chooses the arena before both players ready up. Broadcast is authoritative. */
  setMap(mapId) {
    if (
      this._role !== 'host' ||
      !this._lobby ||
      this._started ||
      !isSupportedMapForMode(mapId, this._lobby.mode)
    ) return false;
    if (this._lobby.map === mapId) return true;
    this._cancelStartTimer();
    this._lobby.map = mapId;
    for (const player of Object.values(this._lobby.roster || {})) {
      if (player) player.ready = false;
    }
    syncLobbyCompat(this._lobby);
    this._broadcastLobby();
    return true;
  }

  /** Solo host: vuelve al lobby (ready=false) y avisa a todos. */
  resetToLobby() {
    if (this._role !== 'host' || !this._lobby) return false;
    this._cancelStartTimer();
    this._started = false;
    for (const player of Object.values(this._lobby.roster || {})) {
      if (player) player.ready = false;
    }
    syncLobbyCompat(this._lobby);
    this._broadcastRaw({ t: 'restartLobby' });
    this._broadcastLobby();
    this._status('connected', 'En el lobby. Esperando que todos estÃ©n listos...');
    return true;
  }

  /* ====================================================================== */
  /* Partida                                                                */
  /* ====================================================================== */

  /** Mensaje de partida al otro peer. Devuelve false si no hay conexiÃ³n. */
  send(type, payload, targetId = null) {
    if (!type) return false;
    if (targetId) return this.sendTo(targetId, type, payload);
    const envelope = {
      t: String(type),
      p: payload && typeof payload === 'object' ? payload : {},
    };
    if (this._role === 'host') {
      const legacyGuest = this._legacyGuestPlayer();
      return legacyGuest ? this._sendObjectTo(legacyGuest.id, envelope) : false;
    }
    return this._sendRaw(envelope);
  }

  /** Envía un mensaje de partida a un playerId concreto. */
  sendTo(playerId, type, payload) {
    const targetId = normalizePlayerId(playerId);
    if (!targetId || !type || targetId === this._playerId) return false;
    const envelope = {
      t: String(type),
      p: payload && typeof payload === 'object' ? payload : {},
    };
    if (this._role === 'host') return this._sendObjectTo(targetId, envelope);
    const hostId = this._lobby?.hostId || this._lobby?.host?.id || '';
    if (!hostId || targetId !== hostId) return false;
    return this._sendRaw(envelope);
  }

  /** Guest: atajo explícito al host autoritativo. */
  sendToHost(type, payload) {
    if (this._role !== 'guest') return false;
    return this.send(type, payload);
  }

  /** Host: difunde un mensaje de partida a todos los guests conectados. */
  broadcast(type, payload, exceptId = null) {
    if (this._role !== 'host' || !type) return false;
    const envelope = {
      t: String(type),
      p: payload && typeof payload === 'object' ? payload : {},
    };
    const skipped = normalizePlayerId(exceptId);
    let sent = 0;
    for (const [playerId] of this._connections) {
      if (skipped && playerId === skipped) continue;
      if (this._sendObjectTo(playerId, envelope)) sent++;
    }
    return sent;
  }

  /* ====================================================================== */
  /* Cierre / limpieza                                                      */
  /* ====================================================================== */

  close(reason = 'Saliste de la sala') {
    if (this._closed) return;
    this._closed = true;
    this._closing = true;
    this._clearTimers();
    const conns = this._allConnections();
    this._conn = null;
    this._connOpen = false;
    this._connections.clear();
    this._connPlayers.clear();
    this._pendingConnections.clear();
    for (const conn of conns) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
    this._teardownPeer();
    this._status('closed', reason || 'Saliste de la sala');
    this._resetFields();
    this._closed = true;
    this._closing = false;
  }

  /* ====================================================================== */
  /* Internos: setup                                                        */
  /* ====================================================================== */

  _prepareSession() {
    this._clearTimers();
    this._teardownPeer();
    this._conn = null;
    this._connOpen = false;
    this._connections.clear();
    this._connPlayers.clear();
    this._pendingConnections.clear();
    this._reconnectTimers.clear();
    this._guestReconnectTimer = null;
    this._guestReconnectDeadline = 0;
    this._guestReconnectInFlight = false;
    this._resetFields();
    this._closed = false;
    this._closing = false;
    this._destroyed = false;
  }

  _resetFields() {
    this._clearTimers();
    this._conn = null;
    this._connOpen = false;
    this._connections.clear();
    this._connPlayers.clear();
    this._pendingConnections.clear();
    this._reconnectTimers.clear();
    this._guestReconnectTimer = null;
    this._guestReconnectDeadline = 0;
    this._guestReconnectInFlight = false;
    this._role = null;
    this._code = null;
    this._name = '';
    this._playerId = null;
    this._maxPlayers = 2;
    this._mode = MODE_1V1;
    this._map = DEFAULT_ONLINE_MAP;
    this._guestName = '';
    this._hostName = '';
    this._remoteName = '';
    this._lobby = null;
    this._started = false;
    this._startTimer = null;
    this._joinReject = null;
    this._closedEmitted = false;
    for (const waiter of this._lobbyWaiters.splice(0)) {
      waiter.reject(new Error('La conexiÃ³n se cerrÃ³ antes de recibir el lobby.'));
    }
  }

  _destroyPeerObject(peer) {
    if (!peer) return;
    try {
      peer.removeAllListeners?.();
    } catch {
      /* ignore */
    }
    try {
      peer.destroy?.();
    } catch {
      /* ignore */
    }
  }

  _teardownPeer() {
    const peer = this._peer;
    this._peer = null;
    if (peer) this._destroyPeerObject(peer);
  }

  _setTimer(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      try {
        fn();
      } catch (err) {
        this._emitError(translatePeerError(err));
      }
    }, ms);
    this._timers.add(id);
    return id;
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    this._startTimer = null;
  }

  _cancelStartTimer() {
    if (this._startTimer != null) {
      clearTimeout(this._startTimer);
      this._timers.delete(this._startTimer);
      this._startTimer = null;
    }
  }

  _peerCtor() {
    if (this._peerFactory) return this._peerFactory;
    if (typeof globalThis !== 'undefined' && typeof globalThis.Peer === 'function') {
      return globalThis.Peer;
    }
    if (typeof window !== 'undefined' && typeof window.Peer === 'function') {
      return window.Peer;
    }
    return null;
  }

  _makePeerObject(id) {
    if (this._peerFactory) {
      return this._peerFactory(id, this._peerOptions);
    }
    const Peer = this._peerCtor();
    if (!Peer) {
      const err = new Error(
        'PeerJS no estÃ¡ disponible. RecargÃ¡ la pÃ¡gina o probÃ¡ con otro navegador.',
      );
      err.type = 'peerjs-missing';
      throw err;
    }
    try {
      return id ? new Peer(id, this._peerOptions) : new Peer(this._peerOptions);
    } catch (err) {
      if (err && !err.type) err.type = 'peerjs-init';
      throw err;
    }
  }

  /** Abre el Peer (host con id fijo o guest con id aleatorio) y espera `open`. */
  _openPeer(id) {
    let peer;
    try {
      peer = this._makePeerObject(id);
    } catch (err) {
      return Promise.reject(err);
    }
    this._peer = peer;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new Error(
          this._role === 'host'
            ? 'No se pudo crear la sala. RevisÃ¡ tu conexiÃ³n a internet.'
            : 'No se pudo conectar al servidor. RevisÃ¡ tu conexiÃ³n a internet.',
        );
        err.type = 'timeout';
        reject(err);
      }, PEER_OPEN_TIMEOUT_MS);
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(peer);
      };
      const onError = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err || { type: 'network' });
      };
      const cleanup = () => {
        clearTimeout(timer);
        try {
          peer.off?.('open', onOpen);
        } catch {
          /* ignore */
        }
      };
      try {
        peer.on('open', onOpen);
        peer.on('error', onError);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  _attachPeerEvents() {
    const peer = this._peer;
    if (!peer) return;
    peer.on('error', (err) => this._onPeerError(err));
    peer.on('disconnected', () => this._onPeerDisconnected());
    peer.on('close', () => this._onPeerClose());
    if (this._role === 'host') {
      peer.on('connection', (conn) => this._onIncomingConnection(conn));
    }
  }

  _makeConnection(hostPeerId) {
    if (!this._peer || typeof this._peer.connect !== 'function') {
      const err = new Error('No se pudo iniciar la conexiÃ³n.');
      err.type = 'connect';
      throw err;
    }
    return this._peer.connect(hostPeerId, {
      serialization: 'json',
      reliable: true,
      metadata: { name: this._name, playerId: this._playerId },
    });
  }

  _connectToHost(hostPeerId, timeoutMs = CONNECT_TIMEOUT_MS, trackJoinReject = true) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let conn;
      try {
        conn = this._makeConnection(hostPeerId);
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => {
        finish(
          reject,
          new Error('Tiempo de espera agotado. No se encontrÃ³ la sala. VerificÃ¡ el cÃ³digo.'),
        );
      }, timeoutMs);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (trackJoinReject) this._joinReject = null;
        fn(value);
      };
      if (trackJoinReject) this._joinReject = (message) => finish(reject, new Error(message));
      try {
        conn.on('open', () => finish(resolve, conn));
        conn.on('error', (err) => {
          const type = err && err.type;
          const message =
            type === 'peer-unavailable'
              ? 'No se encontrÃ³ la sala. VerificÃ¡ el cÃ³digo e intentÃ¡ de nuevo.'
              : translatePeerError(err);
          finish(reject, new Error(message));
        });
        conn.on('close', () => {
          if (!settled) finish(reject, new Error('La conexiÃ³n se cerrÃ³ antes de empezar.'));
        });
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  /* ====================================================================== */
  /* Internos: eventos PeerJS                                               */
  /* ====================================================================== */

  _onPeerError(err) {
    if (this._closing || this._closed) return;
    const type = err && err.type;
    const message = translatePeerError(err);
    this._lastError = message;
    if (this._joinReject) {
      const reject = this._joinReject;
      this._joinReject = null;
      reject(message);
      return;
    }
    this._emitError(message);
    const fatalNetwork = ['network', 'server-error', 'socket-error', 'socket-closed'].includes(type);
    if (fatalNetwork && this._started) this._emitClosed(message);
  }

  _onPeerDisconnected() {
    if (this._closing || this._closed) return;
    if (!this._peer) return;
    this._status('connecting', 'Se perdiÃ³ la conexiÃ³n con el servidor. Reconectando...');
    try {
      this._peer.reconnect?.();
    } catch {
      /* ignore */
    }
    this._setTimer(() => {
      if (this._closing || this._closed) return;
      if (this._peer && this._peer.disconnected && !this._peer.destroyed) {
        const message = 'No se pudo reconectar con el servidor de salas.';
        this._status('error', message);
        this._emitError(message);
        if (this._started || !this.connected) this._emitClosed(message);
      }
    }, 8000);
  }

  _onPeerClose() {
    if (this._closing || this._closed) return;
    const message = 'Se cerrÃ³ la conexiÃ³n de la sala.';
    this._status('error', message);
    this._emitClosed(message);
  }

  /* ====================================================================== */
  /* Internos: conexiones                                                   */
  /* ====================================================================== */

  _allConnections() {
    const all = new Set();
    if (this._conn) all.add(this._conn);
    for (const conn of this._connections.values()) if (conn) all.add(conn);
    for (const conn of this._pendingConnections) if (conn) all.add(conn);
    return [...all];
  }

  _localLobbyPlayer() {
    if (!this._lobby || !this._playerId) return null;
    return this._lobby.roster?.[this._playerId] || null;
  }

  _legacyGuestPlayer() {
    if (!this._lobby) return null;
    return sortedPlayersFromRoster(this._lobby.roster).find((player) => player.slot === 1) || null;
  }

  _nextOpenSlot() {
    if (!this._lobby) return -1;
    const occupied = new Set(
      sortedPlayersFromRoster(this._lobby.roster).map((player) => Number(player.slot)),
    );
    const maxPlayers = normalizeMaxPlayers(this._lobby.maxPlayers);
    for (let slot = 1; slot < maxPlayers; slot++) {
      if (!occupied.has(slot)) return slot;
    }
    return -1;
  }

  _syncLegacyConnection() {
    if (this._role !== 'host') return;
    const guest = this._legacyGuestPlayer();
    const conn = guest ? this._connections.get(guest.id) || null : null;
    this._conn = conn;
    this._connOpen = !!conn && conn.open === true;
    this._guestName = guest?.name || '';
    this._remoteName = this._guestName;
  }

  _sendRawToConn(conn, obj) {
    if (!conn || conn.open !== true) return false;
    try {
      conn.send(obj);
      return true;
    } catch {
      return false;
    }
  }

  _sendObjectTo(playerId, obj) {
    const targetId = normalizePlayerId(playerId);
    if (!targetId) return false;
    if (this._role === 'host') {
      return this._sendRawToConn(this._connections.get(targetId), obj);
    }
    const hostId = this._lobby?.hostId || this._lobby?.host?.id || '';
    if (targetId !== hostId) return false;
    return this._sendRawToConn(this._conn, obj);
  }

  _broadcastRaw(obj, exceptId = null) {
    if (this._role !== 'host') return 0;
    const skipped = normalizePlayerId(exceptId);
    let sent = 0;
    for (const [playerId, conn] of this._connections) {
      if (skipped && playerId === skipped) continue;
      if (this._sendRawToConn(conn, obj)) sent++;
    }
    return sent;
  }

  _onIncomingConnection(conn) {
    if (this._closing || this._closed) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (!conn) return;
    const hintedId = normalizePlayerId(conn.metadata?.playerId);
    const known = hintedId && this._lobby?.roster?.[hintedId];
    if (this._started && !known) {
      this._rejectFull(conn);
      return;
    }
    if (!known && this._pendingConnections.size >= Math.max(2, this.maxPlayers)) {
      this._rejectFull(conn);
      return;
    }
    this._pendingConnections.add(conn);
    this._bindConn(conn);
    const onOpen = () => {
      if (this._closing || this._closed || !this._pendingConnections.has(conn)) return;
      if (!this._started) {
        this._status('connected', 'Jugador conectado. Esperando datos...');
      }
    };
    if (conn.open === true) onOpen();
    else conn.on('open', onOpen);
  }

  _rejectFull(conn) {
    const sendFull = () => {
      try {
        conn.send({
          t: 'full',
          maxPlayers: this.maxPlayers,
          message: this._started
            ? 'La partida ya empezÃ³.'
            : `La sala estÃ¡ llena (mÃ¡ximo ${this.maxPlayers} jugadores).`,
        });
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
      }, 150);
    };
    if (conn.open === true) sendFull();
    else {
      try {
        conn.on('open', sendFull);
      } catch {
        /* ignore */
      }
    }
  }

  _bindConn(conn) {
    conn.on('data', (data) => this._onData(data, conn));
    conn.on('close', () => this._onConnClose(conn));
    conn.on('error', (err) => this._onConnError(conn, err));
  }

  _onConnClose(conn) {
    this._pendingConnections.delete(conn);
    if (this._closing || this._closed) return;

    if (this._role === 'guest') {
      if (conn !== this._conn) return;
      this._conn = null;
      this._connOpen = false;
      const local = this._localLobbyPlayer();
      if (local) local.connected = false;
      this._beginGuestReconnect();
      return;
    }

    if (this._role !== 'host') return;
    const playerId = this._connPlayers.get(conn);
    this._connPlayers.delete(conn);
    if (!playerId) return;
    if (this._connections.get(playerId) !== conn) return;
    this._connections.delete(playerId);
    const player = this._lobby?.roster?.[playerId];
    if (!player || player.isHost) return;
    player.connected = false;
    player.ready = false;
    this._cancelStartTimer();
    syncLobbyCompat(this._lobby);
    this._syncLegacyConnection();

    if (!this._started) {
      this._status('waiting', `${player.name} se desconectÃ³. Esperando reconexiÃ³n...`);
      this._broadcastLobby();
    }
    this._schedulePlayerExpiry(playerId);
  }

  _schedulePlayerExpiry(playerId) {
    const prior = this._reconnectTimers.get(playerId);
    if (prior) {
      clearTimeout(prior);
      this._timers.delete(prior);
    }
    const timer = this._setTimer(() => {
      this._reconnectTimers.delete(playerId);
      const player = this._lobby?.roster?.[playerId];
      if (!player || player.connected) return;
      delete this._lobby.roster[playerId];
      syncLobbyCompat(this._lobby);
      this._syncLegacyConnection();
      if (this._started) {
        const payload = { playerId, name: player.name, team: player.team, slot: player.slot };
        this.broadcast('playerDisconnected', payload);
        this._emitMatch('playerDisconnected', payload, playerId);
        if (this.maxPlayers === 2) {
          this._started = false;
          this._emitClosed('El otro jugador se desconectÃ³.');
        }
      } else {
        this._status('waiting', 'Jugador desconectado. Esperando a alguien mÃ¡s...');
        this._broadcastLobby();
      }
    }, RECONNECT_GRACE_MS);
    this._reconnectTimers.set(playerId, timer);
  }

  _beginGuestReconnect() {
    if (this._closing || this._closed || this._role !== 'guest') return;
    if (!this._peer || !this._code) {
      this._emitClosed('Se perdiÃ³ la conexiÃ³n con el host.');
      return;
    }
    if (!this._guestReconnectDeadline) {
      this._guestReconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
    }
    this._status('connecting', 'Se perdiÃ³ la conexiÃ³n con el host. Reconectando...');
    this._attemptGuestReconnect();
  }

  async _attemptGuestReconnect() {
    if (this._guestReconnectInFlight || this._closing || this._closed || this._role !== 'guest') return;
    const remaining = this._guestReconnectDeadline - Date.now();
    if (remaining <= 0) {
      this._guestReconnectDeadline = 0;
      this._emitClosed('Se perdiÃ³ la conexiÃ³n con el host.');
      return;
    }
    this._guestReconnectInFlight = true;
    try {
      const conn = await this._connectToHost(
        PEER_PREFIX + this._code,
        Math.min(RECONNECT_ATTEMPT_MS, remaining),
        false,
      );
      if (this._closing || this._closed || this._role !== 'guest') {
        try { conn.close(); } catch { /* ignore */ }
        return;
      }
      this._conn = conn;
      this._connOpen = true;
      this._bindConn(conn);
      this._guestReconnectDeadline = 0;
      this._guestReconnectTimer = null;
      this._sendRaw({ t: 'hello', name: this._name, playerId: this._playerId, reconnect: true });
      this._status('connected', 'Reconectado con el host.');
    } catch {
      if (this._closing || this._closed || this._role !== 'guest') return;
      const delay = Math.min(700, Math.max(0, this._guestReconnectDeadline - Date.now()));
      if (delay <= 0) {
        this._guestReconnectDeadline = 0;
        this._emitClosed('Se perdiÃ³ la conexiÃ³n con el host.');
        return;
      }
      this._guestReconnectTimer = this._setTimer(() => {
        this._guestReconnectTimer = null;
        this._attemptGuestReconnect();
      }, delay);
    } finally {
      this._guestReconnectInFlight = false;
    }
  }

  _onConnError(conn, err) {
    if (this._closing || this._closed) return;
    const message = translatePeerError(err);
    this._lastError = message;
    this._emitError(message);
  }

  /* ====================================================================== */
  /* Internos: protocolo                                                     */
  /* ====================================================================== */

  _sendRaw(obj) {
    if (this._role === 'host') {
      const guest = this._legacyGuestPlayer();
      return guest ? this._sendObjectTo(guest.id, obj) : false;
    }
    return this._sendRawToConn(this._conn, obj);
  }

  _onData(raw, conn = null) {
    if (this._closing || this._closed) return;
    let msg = raw;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const type = msg.t;

    if (type === 'hello') return this._onHello(msg, conn);
    if (type === 'lobby') return this._onLobbyMessage(msg);
    if (type === 'ready') return this._onReadyMessage(msg, conn);
    if (type === 'start') return this._onStartMessage(msg);
    if (type === 'full') return this._onFullMessage(msg);
    if (type === 'reconnected') return this._onReconnected(msg);
    if (type === 'restartLobby') return this._onRestartLobby();
    if (type === 'ping') return this._onPing(msg, conn);
    const senderId = this._role === 'host'
      ? this._connPlayers.get(conn) || null
      : this._lobby?.hostId || this._lobby?.host?.id || null;
    if (this._role === 'host' && HOST_AUTH_MATCH_TYPES.has(type)) return;
    if (type === 'pong') {
      if (msg.p && typeof msg.p === 'object' && this._started) {
        this._emitMatch('pong', msg.p, senderId);
      }
      return;
    }
    if (this._started) this._emitMatch(type, this._payloadOf(msg), senderId);
  }

  _payloadOf(msg) {
    if (msg.p && typeof msg.p === 'object') return msg.p;
    const payload = {};
    for (const key of Object.keys(msg)) {
      if (key !== 't' && key !== 'p') payload[key] = msg[key];
    }
    return payload;
  }

  _onHello(msg, conn) {
    if (this._role !== 'host' || !this._lobby) return;
    if (!conn) return;
    const name = sanitizeName(msg.name);
    const hintedId = normalizePlayerId(msg.playerId) || normalizePlayerId(conn.metadata?.playerId);
    const playerId = hintedId || normalizePlayerId(conn.peer) || randomPlayerId();
    let player = this._lobby.roster?.[playerId] || null;

    if (!player) {
      if (this._started || sortedPlayersFromRoster(this._lobby.roster).length >= this.maxPlayers) {
        this._pendingConnections.delete(conn);
        this._rejectFull(conn);
        return;
      }
      const slot = this._nextOpenSlot();
      if (slot < 0) {
        this._pendingConnections.delete(conn);
        this._rejectFull(conn);
        return;
      }
      player = {
        id: playerId,
        name,
        team: teamForSlot(slot),
        slot,
        ready: false,
        connected: true,
        isHost: false,
      };
      this._lobby.roster[playerId] = player;
    } else {
      if (player.isHost) {
        this._pendingConnections.delete(conn);
        this._rejectFull(conn);
        return;
      }
      player.name = name;
      player.connected = true;
      if (!this._started) player.ready = false;
    }

    const oldConn = this._connections.get(playerId);
    if (oldConn && oldConn !== conn) {
      this._connPlayers.delete(oldConn);
      try { oldConn.close(); } catch { /* ignore */ }
    }
    this._pendingConnections.delete(conn);
    this._connections.set(playerId, conn);
    this._connPlayers.set(conn, playerId);
    const expiry = this._reconnectTimers.get(playerId);
    if (expiry) {
      clearTimeout(expiry);
      this._timers.delete(expiry);
      this._reconnectTimers.delete(playerId);
    }
    syncLobbyCompat(this._lobby);
    this._syncLegacyConnection();

    if (this._started) {
      this._sendObjectTo(playerId, { t: 'reconnected', playerId });
      const payload = { playerId, name: player.name, team: player.team, slot: player.slot };
      this.broadcast('playerReconnected', payload, playerId);
      this._emitMatch('playerReconnected', payload, playerId);
      return;
    }

    this._status('connected', `Jugador conectado: ${name}`);
    this._broadcastLobby();
    this._maybeStart();
  }

  _onReadyMessage(msg, conn) {
    if (this._role !== 'host' || !this._lobby || this._started) return;
    const playerId = this._connPlayers.get(conn);
    const player = playerId ? this._lobby.roster?.[playerId] : null;
    if (!player || !player.connected) return;
    player.ready = !!msg.ready;
    syncLobbyCompat(this._lobby);
    this._broadcastLobby();
    this._maybeStart();
  }

  _onLobbyMessage(msg) {
    if (this._role !== 'guest') return;
    const lobby = msg.lobby && typeof msg.lobby === 'object' ? msg.lobby : null;
    if (!lobby) return;
    const mode = normalizeMode(lobby.mode, lobby.maxPlayers);
    if (!isSupportedMapForMode(lobby.map, mode)) {
      this._emitError('La sala usa un mapa no disponible en esta versión del juego.');
      return;
    }
    this._lobby = copyLobby(lobby);
    this._maxPlayers = normalizeMaxPlayers(this._lobby.maxPlayers);
    const local = this._localLobbyPlayer();
    if (local) local.connected = true;
    if (this._lobby.host && this._lobby.host.name) this._hostName = this._lobby.host.name;
    this._remoteName = this._hostName;
    this._status(
      'connected',
      this._hostName ? `Conectado a la sala de ${this._hostName}` : 'Conectado a la sala',
    );
    this._resolveLobbyWaiters();
    this._emitLobby();
  }

  _onStartMessage(msg) {
    if (this._role !== 'guest') return;
    const payload = this._payloadOf(msg);
    const mode = normalizeMode(payload.mode, payload.maxPlayers);
    if (!isSupportedMapForMode(payload.map, mode) || payload.map !== this._lobby?.map) {
      this._emitError('El mapa de la partida no coincide con el elegido en la sala.');
      return;
    }
    if (payload.localPlayerId && payload.localPlayerId !== this._playerId) {
      this._emitError('La identidad del jugador no coincide con la sala.');
      return;
    }
    payload.role = payload.role === 'host' ? 'host' : 'guest';
    if (this._lobby) {
      for (const player of Object.values(this._lobby.roster || {})) {
        if (player) player.ready = true;
      }
      syncLobbyCompat(this._lobby);
    }
    this._started = true;
    this._status('connected', 'Â¡Partida en curso!');
    try {
      this.handlers.onStart?.(payload);
    } catch (err) {
      console.error('[CS16 online] onStart', err);
    }
  }

  _onFullMessage(msg = {}) {
    if (this._role !== 'guest') return;
    const maxPlayers = normalizeMaxPlayers(msg.maxPlayers, this.maxPlayers || 2);
    const message = typeof msg.message === 'string' && msg.message.trim()
      ? msg.message.trim()
      : `La sala estÃ¡ llena (mÃ¡ximo ${maxPlayers} jugadores).`;
    this._lastError = message;
    this._emitError(message);
    if (this._joinReject) {
      const reject = this._joinReject;
      this._joinReject = null;
      reject(message);
    }
    for (const waiter of this._lobbyWaiters.splice(0)) waiter.reject(new Error(message));
    if (this._role === 'guest') {
      this._closed = true;
      this._closing = true;
      const conn = this._conn;
      this._conn = null;
      this._connOpen = false;
      try {
        conn?.close();
      } catch {
        /* ignore */
      }
      this._teardownPeer();
      this._resetFields();
      this._closed = true;
      this._closing = false;
    }
  }

  _onReconnected(msg = {}) {
    if (this._role !== 'guest') return;
    if (msg.playerId && msg.playerId !== this._playerId) return;
    const local = this._localLobbyPlayer();
    if (local) local.connected = true;
    this._status('connected', 'Reconectado con el host.');
  }

  _onRestartLobby() {
    if (this._role !== 'guest') return;
    this._started = false;
    if (this._lobby) {
      for (const player of Object.values(this._lobby.roster || {})) {
        if (player) player.ready = false;
      }
      syncLobbyCompat(this._lobby);
    }
    this._status('connected', 'El host volviÃ³ al lobby. Esperando READY...');
    this._emitLobby();
  }

  _onPing(msg, conn = null) {
    // Ping/pong de partida viajan con payload (`{t:'ping', p:{t:...}}`) y se enrutan
    // a onMatchMessage. Esto cubre sÃ³lo el heartbeat interno plano.
    const senderId = this._role === 'host'
      ? this._connPlayers.get(conn) || null
      : this._lobby?.hostId || this._lobby?.host?.id || null;
    if (msg.p && typeof msg.p === 'object') {
      if (this._started) this._emitMatch('ping', msg.p, senderId);
      return;
    }
    if (this._role === 'host' && senderId) this._sendObjectTo(senderId, { t: 'pong', ts: msg.ts });
    else this._sendRaw({ t: 'pong', ts: msg.ts });
  }

  _maybeStart() {
    if (this._role !== 'host' || this._started || this._closing || this._closed) return;
    if (!this._lobby || !this._lobby.host) {
      this._cancelStartTimer();
      return;
    }
    const players = sortedPlayersFromRoster(this._lobby.roster);
    const maxPlayers = normalizeMaxPlayers(this._lobby.maxPlayers);
    const deathmatch = this._lobby.mode === MODE_DEATHMATCH;
    const enoughPlayers = deathmatch
      ? players.length >= DEATHMATCH_MIN_PLAYERS && players.length <= maxPlayers
      : players.length === maxPlayers;
    if (!enoughPlayers) {
      this._cancelStartTimer();
      return;
    }
    if (players.some((player) => !player.connected || !player.ready)) {
      this._cancelStartTimer();
      return;
    }
    if (this._connections.size < players.length - 1) {
      this._cancelStartTimer();
      return;
    }
    if (this._startTimer != null) return;
    this._status('connected', 'Â¡Todos listos! Empezando partida...');
    this._startTimer = this._setTimer(() => {
      this._startTimer = null;
      if (this._started || this._closed || this._closing) return;
      if (!this._lobby) return;
      const current = sortedPlayersFromRoster(this._lobby.roster);
      const currentMax = normalizeMaxPlayers(this._lobby.maxPlayers);
      const currentEnough = this._lobby.mode === MODE_DEATHMATCH
        ? current.length >= DEATHMATCH_MIN_PLAYERS && current.length <= currentMax
        : current.length === currentMax;
      if (!currentEnough) return;
      if (current.some((player) => !player.connected || !player.ready)) return;
      if (this._connections.size < current.length - 1) return;
      this._startMatch();
    }, START_DELAY_MS);
  }

  _startMatch() {
    if (this._role !== 'host' || !this._lobby) return;
    if (this._started) return;
    const players = sortedPlayersFromRoster(this._lobby.roster);
    const maxPlayers = normalizeMaxPlayers(this._lobby.maxPlayers);
    const deathmatch = this._lobby.mode === MODE_DEATHMATCH;
    const enoughPlayers = deathmatch
      ? players.length >= DEATHMATCH_MIN_PLAYERS && players.length <= maxPlayers
      : players.length === maxPlayers;
    if (!enoughPlayers || players.some((player) => !player.connected || !player.ready)) return;
    if (this._connections.size < players.length - 1) return;
    const host = players.find((player) => player.isHost || player.slot === 0);
    const legacyGuest = players.find((player) => player.slot === 1);
    if (!host || !legacyGuest) return;
    this._started = true;
    const now = Date.now();
    const spawnRollsByPlayer = deathmatch
      ? freeForAllSpawnRolls(players)
      : balancedSpawnRolls(players);
    const namesById = {};
    for (const player of players) namesById[player.id] = player.name;
    const spawnRolls = {
      CT: spawnRollsByPlayer[host.id],
      T: spawnRollsByPlayer[legacyGuest.id],
      ...spawnRollsByPlayer,
      byPlayerId: { ...spawnRollsByPlayer },
    };
    const common = {
      code: this._code,
      mode: this._lobby.mode,
      maxPlayers,
      hostId: host.id,
      players: players.map(copyPlayer),
      names: { host: host.name, guest: legacyGuest.name, byId: namesById },
      hostTeam: host.team,
      guestTeam: legacyGuest.team,
      startAt: now + COUNTDOWN_MS,
      targetKills: deathmatch ? 0 : TARGET_KILLS,
      map: this._lobby.map,
      spawnRolls,
    };
    for (const player of players) {
      if (player.isHost) continue;
      const guestPayload = {
        ...common,
        role: 'guest',
        localPlayerId: player.id,
        localTeam: player.team,
      };
      this._sendObjectTo(player.id, { t: 'start', ...guestPayload });
    }
    this._status('connected', 'Partida en curso');
    try {
      this.handlers.onStart?.({
        ...common,
        role: 'host',
        localPlayerId: host.id,
        localTeam: host.team,
      });
    } catch (err) {
      console.error('[CS16 online] onStart', err);
    }
  }

  /* ====================================================================== */
  /* Internos: emisiÃ³n de callbacks                                         */
  /* ====================================================================== */

  _status(phase, message) {
    this._lastStatus = { phase, message };
    try {
      this.handlers.onStatus?.({ phase, message: message || '' });
    } catch (err) {
      console.error('[CS16 online] onStatus', err);
    }
  }

  _broadcastLobby() {
    if (!this._lobby) return;
    syncLobbyCompat(this._lobby);
    if (this._role === 'host') {
      this._broadcastRaw({ t: 'lobby', lobby: copyLobby(this._lobby) });
    }
    this._emitLobby();
  }

  _emitLobby() {
    try {
      this.handlers.onLobby?.(copyLobby(this._lobby));
    } catch (err) {
      console.error('[CS16 online] onLobby', err);
    }
  }

  _emitError(message) {
    try {
      this.handlers.onError?.(message);
    } catch (err) {
      console.error('[CS16 online] onError', err);
    }
  }

  _emitMatch(type, payload, senderId = null) {
    try {
      this.handlers.onMatchMessage?.(type, payload, senderId);
    } catch (err) {
      console.error('[CS16 online] onMatchMessage', type, err);
    }
  }

  _emitClosed(reason) {
    if (this._closedEmitted) return;
    this._closedEmitted = true;
    this._started = false;
    try {
      this.handlers.onClosed?.(reason);
    } catch (err) {
      console.error('[CS16 online] onClosed', err);
    }
  }

  _resolveLobbyWaiters() {
    for (const waiter of this._lobbyWaiters.splice(0)) waiter.resolve();
  }

  _waitLobby(timeoutMs = LOBBY_TIMEOUT_MS) {
    if (this._lobby) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const waiter = {
        resolve: () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const index = this._lobbyWaiters.indexOf(waiter);
        if (index >= 0) this._lobbyWaiters.splice(index, 1);
        reject(
          new Error('El host no respondiÃ³. VerificÃ¡ el cÃ³digo e intentÃ¡ de nuevo.'),
        );
      }, timeoutMs);
      this._lobbyWaiters.push(waiter);
    });
  }
}

