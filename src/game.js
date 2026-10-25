import * as THREE from '../vendor/three.module.js';
import { Input } from './core/input.js';
import { Player } from './core/player.js';
import { PhysicsWorld } from './core/physics.js';
import { AudioEngine } from './core/audio.js';
import { Effects } from './core/effects.js';
import { clamp, formatMoney, pointInRect } from './core/utils.js';
import { buildMap, MAPS } from './world/maps.js';
import { buildAimMap, AIM_MAP_INFO } from './world/aim_map.js';
import { preloadWadTextures } from './world/wad.js';
import { buildAssaultMap, ASSAULT_MAP_INFO } from './world/assault_map.js';
import { buildRedlineMap } from './world/redline_map.js';
import { buildForgeMap } from './world/forge_map.js';
import { DEFAULT_ONLINE_MAP, isOnlineMap, onlineMapLabel } from './world/online_map_pool.js';
import { CharacterLibrary } from './characters.js';
import { NameTagLayer } from './ui/name-tags.js';
import { WeaponSystem } from './weapons.js';
import { BotManager } from './bots.js';
import { RoundManager } from './rounds.js';
import { Duel } from './duel.js';
import { UI } from './ui/ui.js';
import { MovementDebugHUD } from './ui/movement-debug.js';
import { OnlineUI } from './ui/online-ui.js';
import { OnlineSession } from './online/session.js';
import { OnlineMatch } from './online/match.js';

const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  volume: 0.65,
  fov: 90,
  resolution: 0.85,
  invertY: false,
  zoomSensitivity: 1.0,
  rawInput: true,
  muted: false,
  hitSound: true,
  fps: false,
  crosshairColor: '#78ff63',
  crosshairSize: 1,
  language: 'es',
  // Kept for backwards-compatible settings serialization. V3 movement no longer
  // depends on this flag: normal AIM matches force CS16_1V1_AUTOBHOP.
  autoBhop: true,
  jumpWheelUp: false,
  jumpWheelDown: false,
  hudTheme: 'olive',
};

const HIT_MULT = { head: 4.0, chest: 1.0, stomach: 1.25, legs: 0.75 };

function loadSettings() {
  try {
    const raw = localStorage.getItem('cs16-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function rayBox(origin, dir, box, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 0;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
    const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
    const min = a === 0 ? box.min.x : a === 1 ? box.min.y : box.min.z;
    const max = a === 0 ? box.max.x : a === 1 ? box.max.y : box.max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxDist) return null;
  const normal = new THREE.Vector3();
  if (axis === 0) normal.x = sign;
  else if (axis === 1) normal.y = sign;
  else if (axis === 2) normal.z = sign;
  else normal.set(0, 1, 0);
  return { t: tmin, normal };
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.state = 'boot';
    this.time = 0;
    this.clock = new THREE.Clock();
    this.map = null;
    this.bots = null;
    this.rounds = null;
    this.weapons = null;
    this.matchConfig = null;
    this.online = null;
    this.onlineSession = null;
    this.onlineUI = null;
    this.onlineStartPayload = null;
    this._onlineLeaving = false;
    this._onlineLobbyOpen = false;
    this._previewAngle = 0;
    this._previewCenter = new THREE.Vector3();
    this._hudAccum = 0;
    this._scoreboardAccum = 0;
    this._suppressPause = false;
    this._lastTab = false;

    this.characters = new CharacterLibrary(this);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d0c);
    this.scene.fog = new THREE.Fog(0x8a7f66, 45, 150);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.05,
      300,
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = true;

    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.audio = new AudioEngine();
    this.audio.setVolume(this.settings.muted ? 0 : this.settings.volume);
    this.effects = new Effects(this);
    this.physics = new PhysicsWorld([]);
    this.player = new Player(this);
    this.ui = new UI(this);
    this.movementDebug = new MovementDebugHUD(this);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this.input.onPointerLockChange((locked) => this.onPointerLockChange(locked));
    this.canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !this.input.locked && !this.ui.isOverlayOpen) this.input.requestPointerLock();
    });

    this._loop = this._loop.bind(this);
  }

  pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return Math.max(0.55, dpr * this.settings.resolution);
  }

  async init() {
    this.ui.init();
    this.nameTags = new NameTagLayer(this);
    this.onlineUI = new OnlineUI(this);
    this.onlineUI.init();
    this.ui.showLoading('Cargando texturas originales...');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await preloadWadTextures();
    this.characters.load().catch((err) => console.warn('[characters] preload', err));
    const preferred = localStorage.getItem('cs16-lastmap');
    const mapId = preferred === 'cs_office' ? 'cs_office' : 'de_dust2';
    try {
      this.loadPreview(mapId);
    } catch (err) {
      console.error(err);
      this.ui.showFatalError?.('No se pudo construir el mapa: ' + err.message);
      return;
    }
    this.ui.hideLoading?.();
    this.ui.showMainMenu();
    document.getElementById('boot-screen')?.remove();
    this.state = 'menu';
    this.clock.start();
    requestAnimationFrame(this._loop);

    // Si el amigo abre un link ?join=CODE, llevarlo directo a la pantalla de unirse.
    try {
      const invite = new URLSearchParams(window.location.search).get('join') || '';
      if (/^[A-Za-z0-9]{5}$/.test(invite)) {
        setTimeout(() => this.openOnlineHome(), 350);
      }
    } catch {
      /* ignore */
    }
  }

  ensureOnlineSession() {
    if (this.onlineSession) return this.onlineSession;
    this.onlineSession = new OnlineSession(this, {
      onStatus: (status) => {
        const phase = typeof status === 'string' ? status : status?.phase;
        const message = typeof status === 'string' ? '' : status?.message;
        this.onlineUI?.showStatus?.(phase, message);
      },
      onLobby: (lobby) => this.handleOnlineLobby(lobby),
      onStart: (payload) => this.startOnlineMatch(payload),
      onMatchMessage: (type, payload, senderId) => this.online?.handleMessage?.(type, payload, senderId),
      onClosed: (reason) => this.handleOnlineClosed(reason),
      onError: (message) => this.onlineUI?.showError?.(message),
    });
    return this.onlineSession;
  }

  openOnlineHome() {
    this._onlineLobbyOpen = true;
    this.ensureOnlineSession();
    this.onlineUI?.openHome?.();
  }

  handleOnlineLobby(lobby) {
    this._onlineLobbyOpen = true;
    if (this.online) {
      if (lobby?.started === true || lobby?.phase === 'match') {
        this.online.syncRoster?.(lobby.players || lobby.roster || []);
        return;
      }
      this.returnToOnlineLobby(lobby);
      return;
    }
    this.onlineUI?.showLobby?.(lobby);
  }

  handleOnlineClosed(reason) {
    if (this._onlineLeaving) return;
    this.leaveOnline(reason || 'Se perdiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ la conexiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³n con la sala', false);
  }

  async startOnlineMatch(payload = {}) {
    if (!payload || !payload.role) return;
    if (!isOnlineMap(payload.map) || payload.map !== this.onlineSession?.lobby?.map) {
      this.onlineUI?.showError?.('El mapa elegido no coincide con la sala. RecargÃƒÆ’Ã‚Â¡ ambos juegos.');
      return;
    }
    const mapId = payload.map;
    this.audio.init();
    this.onlineStartPayload = payload;
    this._onlineLobbyOpen = false;
    this.onlineUI?.hide?.();
    this.state = 'loading';
    this.ui.hideAll();
    this.ui.showLoading(`Cargando ${onlineMapLabel(mapId)}...`);
    await new Promise((r) => requestAnimationFrame(r));

    try {
      this.disposeMatch();
      if (!this.map || this.map.id !== mapId) {
        if (this.map) {
          this.map.dispose?.();
          this.map = null;
        }
        this.map = mapId === 'aim_redline' ? buildRedlineMap(this)
          : mapId === 'aim_forge' ? buildForgeMap(this)
          : mapId === 'cs_assault' ? buildAssaultMap(this)
          : mapId === 'cs_office' ? buildMap(this, mapId) : buildAimMap(this);
      }
      this.physics.setColliders(this.map.colliders, this.map.slopes || []);
      this.applyMapEnvironment(this.map);
      this.effects.dispose();
      this.effects = new Effects(this);

      const localPlayerId =
        payload.playerId ||
        payload.localPlayerId ||
        this.onlineSession?.localPlayerId ||
        this.onlineSession?.playerId;
      const roster = Array.isArray(payload.players) ? payload.players : [];
      const localRosterPlayer = roster.find(
        (p) => String(p?.id || p?.playerId) === String(localPlayerId),
      );
      const team =
        localRosterPlayer?.team === 'T' || localRosterPlayer?.team === 'CT'
          ? localRosterPlayer.team
          : payload.role === 'host'
            ? payload.hostTeam || 'CT'
            : payload.guestTeam || 'T';
      const spawns = this.map.spawns?.[team];
      if (!spawns?.length) throw new Error(`El mapa no tiene spawn ${team}`);
      this.player.money = 0;
      this.player.kills = 0;
      this.player.deaths = 0;
      this.player.assists = 0;
      const keyedRoll = localPlayerId != null ? payload.spawnRolls?.[String(localPlayerId)] : undefined;
      const legacyRoll = payload.spawnRolls?.[team];
      const slot = Math.max(0, Math.floor(Number(localRosterPlayer?.slot) || 0));
      const rawRoll = Number.isFinite(Number(keyedRoll)) ? Number(keyedRoll) : Number(legacyRoll);
      const roll = Number.isFinite(rawRoll) && rawRoll >= 0 && rawRoll < 1
        ? rawRoll
        : Math.min(0.999999, (slot + 0.5) / Math.max(1, spawns.length));
      if (!(Number.isFinite(roll) && roll >= 0 && roll < 1))
        throw new Error('La sala no enviÃƒÆ’Ã‚Â³ un spawn inicial vÃƒÆ’Ã‚Â¡lido.');
      this.player.reset(team, spawns[Math.floor(roll * spawns.length)]);
      this.player.health = 100;
      this.player.armor = 100;
      this.player.helmet = false;
      this.player.alive = true;

      this.weapons = new WeaponSystem(this);
      this.weapons.init();
      this.setupOnlineLoadout();
      this._setupClassicViewmodel();

      this.bots = null;
      this.rounds = null;
      this.state = 'playing';
      this.online = new OnlineMatch(this, this.ensureOnlineSession(), payload);
      this.online.start();

      this.matchConfig = {
        map: mapId,
        mode: 'aim',
        online: true,
        team,
        onlineMode: payload.mode === '2v2' || Number(payload.maxPlayers) === 4 ? '2v2' : '1v1',
      };
      this.ui.hideAll();
      this.ui.showHUD();
      this.ui.hideLoading?.();
      document.documentElement.classList.add('online-match');
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
      this.audio.startAmbient(mapId);
      this.input.requestPointerLock();
      this._lockHintShown = false;
      this.ui.showCenterMessage?.(
        (payload.role === 'host' ? 'SOS EL HOST · ' : '') + 'PRIMERO A ' + Math.max(1, Number(payload.targetRounds || payload.targetKills) || 13) + ' RONDAS',
        2600,
      );
    } catch (err) {
      console.error('[online] startOnlineMatch', err);
      this.state = 'menu';
      this.ui.showFatalError?.(`No se pudo iniciar la partida online: ${err.message}`);
    }
  }

  setupOnlineLoadout() {
    if (!this.weapons || !this.player) return;
    this.player.health = 100;
    this.player.armor = 100;
    this.player.helmet = false;
    this.player.hasBomb = false;
    this.player.hasDefuseKit = false;
    this.player.alive = true;
    this.weapons.resetForMatch(this.player.team);
    this.weapons.giveWeapon(this.player.team === 'CT' ? 'm4a1' : 'ak47', { silent: true });
    this.weapons.giveWeapon('deagle', { silent: true });
    const inv = this.weapons.inventory;
    if (inv?.primary) {
      inv.primary.reserve = 999;
      const w = this.weapons.getHudState?.();
      if (w) inv.primary.magazine = Math.max(inv.primary.magazine || 0, 30);
    }
    if (inv?.secondary) inv.secondary.reserve = 999;
    this.weapons.selectSlot?.(1);
    this.weapons.setVisible?.(true);
  }

  spawnOnlinePlayer(team, spawn = null) {
    const sp = spawn || this.map?.spawns?.[team]?.[0];
    if (!sp) return;
    this.player.reset(team, sp);
    this.player.health = 100;
    this.player.armor = 100;
    this.player.helmet = false;
    this.player.alive = true;
    this.setupOnlineLoadout();
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  returnToOnlineLobby(lobby = null) {
    const session = this.onlineSession;
    this.audio.stopAmbient();
    this.online?.dispose?.();
    this.online = null;
    this.state = 'menu';
    this._onlineLobbyOpen = true;
    document.documentElement.classList.remove('online-match');
    this.disposeMatch();
    this.ui.hideHUD?.();
    this.ui.hideAll?.();
    if (isOnlineMap(this.map?.id)) {
      this.map.dispose?.();
      this.map = null;
      try {
        this.loadPreview('de_dust2');
      } catch (err) {
        console.warn(err);
      }
    }
    this.ui.showMainMenu?.();
    this.ui.hideLoading?.();
    this.onlineUI?.showLobby?.(lobby || session?.lobby);
    this.ui.toast?.('De vuelta a la sala de espera');
  }

  leaveOnline(reason = '', silent = false) {
    if (this._onlineLeaving) return;
    this._onlineLeaving = true;
    try {
      this.online?.dispose?.();
    } catch (err) {
      console.warn(err);
    }
    this.online = null;
    try {
      this.onlineSession?.close?.(reason || 'Saliste de la sala');
    } catch (err) {
      console.warn(err);
    }
    this.onlineSession = null;
    this.onlineStartPayload = null;
    this._onlineLobbyOpen = false;
    this.onlineUI?.hide?.();
    document.documentElement.classList.remove('online-match');
    this._suppressPause = true;
    this.input.exitPointerLock();
    this.disposeMatch();
    if (isOnlineMap(this.map?.id)) {
      this.map.dispose?.();
      this.map = null;
      try {
        this.loadPreview('de_dust2');
      } catch (err) {
        console.warn(err);
      }
    }
    this.ui.hideHUD?.();
    this.ui.hideAll?.();
    this.ui.showMainMenu?.();
    this.ui.hideLoading?.();
    if (!silent && reason) this.ui.toast?.(reason);
    this.state = 'menu';
    setTimeout(() => {
      this._onlineLeaving = false;
      this._suppressPause = false;
    }, 120);
  }

  loadPreview(mapId = 'de_dust2') {
    if (this.map) {
      this.map.dispose?.();
      this.map = null;
    }
    this.ui.showLoading?.(`Cargando ${MAPS[mapId]?.displayName || mapId}...`);
    this.map = buildMap(this, mapId);
    this.physics.setColliders(this.map.colliders, this.map.slopes || []);
    this.applyMapEnvironment(this.map);
    const center = new THREE.Vector3(
      (this.map.bounds.minX + this.map.bounds.maxX) / 2,
      0,
      (this.map.bounds.minZ + this.map.bounds.maxZ) / 2,
    );
    this._previewCenter.copy(center);
    this._previewAngle = 0;
    this.positionMenuCamera(0);
    this.state = 'menu';
    try {
      localStorage.setItem('cs16-lastmap', mapId);
    } catch {
      /* ignore */
    }
  }

  applyMapEnvironment(map) {
    const amb = map.ambient || {};
    this.scene.background = new THREE.Color(amb.skyBottom || 0x8aa0a8);
    this.scene.fog = new THREE.Fog(
      amb.fog ?? 0x9a8d6e,
      amb.fogNear ?? 40,
      amb.fogFar ?? 170,
    );
  }

  positionMenuCamera(dt) {
    if (!this.map) return;
    const cam = this.map.menuCamera;
    const center = this._previewCenter;
    if (cam?.pos) {
      this.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
      const look = cam.lookAt || { x: center.x, y: 1.2, z: center.z };
      this.camera.lookAt(look.x, look.y, look.z);
      this.camera.rotation.z = 0;
      return;
    }
    const radius = cam?.orbitRadius ?? Math.max(26, (this.map.bounds.maxX - this.map.bounds.minX) * 0.58);
    const speed = cam?.orbitSpeed ?? 0.035;
    this._previewAngle += dt * speed;
    this.camera.position.set(
      center.x + Math.sin(this._previewAngle) * radius,
      cam?.height ?? 17,
      center.z + Math.cos(this._previewAngle) * radius,
    );
    this.camera.lookAt(center.x, 0.8, center.z);
    this.camera.rotation.z = 0;
  }

  _setupClassicViewmodel() {
    // Use the same original weapon models in local and public builds.
    this.classicVM?.dispose?.();
    this.classicVM = null;
  }

  /**
   * Duelo 1v1 por rondas (modo principal): cuatro arenas compartidas con online.
   * Usa un BotManager con un ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºnico bot enemigo y el manager Duel.
   */
  async startDuel(config = {}) {
    this.audio.init();
    this._ignoreUnlockUntil = performance.now() + 2500;
    this.input.requestPointerLock();
    const mapId = isOnlineMap(config.map) ? config.map : DEFAULT_ONLINE_MAP;
    const team = config.team === 'CT' || config.team === 'T'
      ? config.team
      : Math.random() < 0.5 ? 'CT' : 'T';
    this.matchConfig = {
      mode: 'duel',
      map: mapId,
      team,
      teamSize: 1,
      difficulty: config.difficulty || 'normal',
      roundsToWin: Number(config.roundsToWin) || 13,
      roundTime: 60,
      freezeTime: 3,
      buyTime: 0,
    };
    this._lockHintShown = false;
    this.state = 'loading';
    this.ui.hideAll();
    this.ui.showLoading(`Cargando ${mapId} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· duel...`);
    await new Promise((r) => requestAnimationFrame(r));

    try {
      this.disposeMatch();
      if (!this.map || this.map.id !== mapId) {
        if (this.map) {
          this.map.dispose?.();
          this.map = null;
        }
        this.map = mapId === 'aim_redline' ? buildRedlineMap(this)
          : mapId === 'aim_forge' ? buildForgeMap(this)
          : mapId === 'cs_assault' ? buildAssaultMap(this)
          : mapId === 'cs_office' ? buildMap(this, mapId) : buildAimMap(this);
      }
      this.physics.setColliders(this.map.colliders, this.map.slopes || []);
      this.applyMapEnvironment(this.map);
      this.effects.dispose();
      this.effects = new Effects(this);
      this.physics.setColliders(this.map.colliders, this.map.slopes || []);

      this.player.reset(team, this.map.spawns[team][0]);
      this.player.money = 0;
      this.player.kills = 0;
      this.player.deaths = 0;
      this.player.assists = 0;
      this.player.hasDefuseKit = false;
      this.player.hasBomb = false;
      this.player.armor = 100;
      this.player.helmet = true;

      this.weapons = new WeaponSystem(this);
      this.weapons.init();
      this.weapons.resetForMatch(team);
      this._setupClassicViewmodel();

      await this.characters.load();
      this.bots = new BotManager(this);
      this.bots.spawnAll({
        botsCT: team === 'CT' ? 0 : 1,
        botsT: team === 'T' ? 0 : 1,
        difficulty: config.difficulty || 'normal',
        teamSize: 2,
      });

      this.duel = new Duel(this);
      this.rounds = this.duel;
      this.state = 'playing';
      this.ui.hideAll();
      this.ui.showHUD();
      this.ui.hideLoading?.();
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();

      this.duel.startMatch(this.matchConfig);
      this.audio.startAmbient(mapId);
      try { localStorage.setItem('cs16-lastmap', mapId); } catch { /* ignore */ }
    } catch (err) {
      console.error(err);
      this.state = 'menu';
      this.ui.showFatalError?.('Error al iniciar el duelo: ' + err.message);
    }
  }

  async startMatch(config = {}) {
    this.audio.init();
    // Must be requested while the Start click is still a user gesture.
    this.input.requestPointerLock();
    const mapId = MAPS[config.map] ? config.map : 'de_dust2';
    const mapInfo = MAPS[mapId];
    let team = config.team || 'auto';
    if (team !== 'CT' && team !== 'T') team = Math.random() < 0.5 ? 'CT' : 'T';
    const teamSize = clamp(Number(config.teamSize) || 5, 2, 8);
    const botsCT = teamSize - (team === 'CT' ? 1 : 0);
    const botsT = teamSize - (team === 'T' ? 1 : 0);
    const normalized = {
      ...config,
      map: mapId,
      mode: mapInfo?.mode || 'bomb',
      team,
      teamSize,
      botsCT,
      botsT,
      difficulty: config.difficulty || 'normal',
      roundsToWin: Number(config.roundsToWin) || 8,
      roundTime: Number(config.roundTime) || 115,
      freezeTime: Number(config.freezeTime) || 6,
      buyTime: Number(config.buyTime) || 15,
      botDifficulty: config.difficulty || 'normal',
    };
    this.matchConfig = normalized;
    this._lockHintShown = false;

    this.state = 'loading';
    this.ui.hideAll();
    this.ui.showLoading(`Cargando ${mapInfo?.displayName || mapId}...`);
    await new Promise((r) => requestAnimationFrame(r));

    try {
      this.disposeMatch();
      if (!this.map || this.map.id !== mapId) {
        if (this.map) {
          this.map.dispose?.();
          this.map = null;
        }
        this.map = buildMap(this, mapId);
      }
      this.physics.setColliders(this.map.colliders, this.map.slopes || []);
      this.applyMapEnvironment(this.map);
      this.effects.dispose();
      this.effects = new Effects(this);

      this.player.reset(team, this.map.spawns[team][0]);
      this.player.money = 800;
      this.player.kills = 0;
      this.player.deaths = 0;
      this.player.assists = 0;
      this.player.hasDefuseKit = false;
      this.player.hasBomb = false;
      this.player.armor = 0;
      this.player.helmet = false;

      this.weapons = new WeaponSystem(this);
      this.weapons.init();
      this.weapons.resetForMatch(team);
      this._setupClassicViewmodel();

      await this.characters.load();
      this.bots = new BotManager(this);
      this.bots.spawnAll({
        botsCT: normalized.botsCT,
        botsT: normalized.botsT,
        difficulty: normalized.difficulty,
        teamSize,
      });

      this.state = 'playing';
      this.ui.hideAll();
      this.ui.showHUD();
      this.ui.hideLoading?.();
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();

      this.rounds = new RoundManager(this);
      this.rounds.startMatch(normalized);

      this.audio.startAmbient(mapId);
      try {
        localStorage.setItem('cs16-lastmap', mapId);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error(err);
      this.state = 'menu';
      this.ui.showFatalError?.('Error al iniciar la partida: ' + err.message);
    }
  }

  disposeMatch() {
    this.ui.hideActionProgress?.();
    this.ui.hideRoundBanner?.();
    try {
      this.online?.dispose?.();
    } catch (e) {
      console.warn(e);
    }
    this.online = null;
    try {
      this.rounds?.dispose?.();
    } catch (e) {
      console.warn(e);
    }
    try {
      this.bots?.dispose?.();
    } catch (e) {
      console.warn(e);
    }
    try {
      this.weapons?.dispose?.();
    } catch (e) {
      console.warn(e);
    }
    try {
      this.classicVM?.dispose?.();
    } catch (e) {
      console.warn(e);
    }
    this.classicVM = null;
    this.rounds = null;
    this.bots = null;
    this.weapons = null;
    this.player.alive = false;
    this.player.vel.set(0, 0, 0);
  }

  quitToMenu() {
    if (this.online || this.onlineSession) {
      this.leaveOnline();
      return;
    }
    this.state = 'menu';
    this._suppressPause = true;
    this.input.exitPointerLock();
    this.ui.closeBuyMenu?.();
    this.ui.closeScoreboard?.();
    this.audio.stopAmbient();
    this.disposeMatch();
    this.ui.hideHUD();
    this.ui.showLoading('Cargando menÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âº...');
    const last = this.matchConfig?.map || localStorage.getItem('cs16-lastmap') || 'de_dust2';
    if (this.map) {
      this.map.dispose?.();
      this.map = null;
    }
    this.effects.dispose();
    this.effects = new Effects(this);
    this.applyMapEnvironment(this.map || { ambient: {} });
    try {
      this.loadPreview(last);
    } catch (err) {
      console.error(err);
    }
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.ui.hideLoading?.();
    this.ui.showMainMenu();
    this.matchConfig = null;
    setTimeout(() => {
      this._suppressPause = false;
    }, 80);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._suppressPause = true;
    this.input.exitPointerLock();
    this.ui.showPauseMenu();
    setTimeout(() => {
      this._suppressPause = false;
    }, 80);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hidePauseMenu();
    this.input.requestPointerLock();
  }

  onPointerLockChange(locked) {
    if (locked) return;
    if (this._suppressPause) return;
    if (this._ignoreUnlockUntil && performance.now() < this._ignoreUnlockUntil) return;
    if (this.online) return; // online no se pausa: la partida sigue en red
    if (this.state === 'playing' && !this.ui.isBuyMenuOpen && !this.ui.isOverlayOpen) {
      this.pause();
    }
  }

  canMove() {
    return (
      this.state === 'playing' &&
      this.player.alive &&
      this.input.locked &&
      !this.ui.isOverlayOpen &&
      !this.onlineUI?.isOpen &&
      (this.online ? this.online.canControl() : (this.rounds?.canControlPlayer?.() ?? true))
    );
  }

  canUseWeapons() {
    return (
      this.state === 'playing' &&
      this.player.alive &&
      this.input.locked &&
      !this.ui.isOverlayOpen &&
      !this.onlineUI?.isOpen &&
      (this.online ? this.online.canControl() : (this.rounds?.canControlPlayer?.() ?? true))
    );
  }

  isPointerLocked() {
    return this.input.locked;
  }

  requestPointerLock() {
    this.input.requestPointerLock();
  }

  releasePointerLock() {
    this._suppressPause = true;
    this.input.exitPointerLock();
    setTimeout(() => {
      this._suppressPause = false;
    }, 80);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
  }

  applySettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.input.sensitivity = this.settings.sensitivity;
    this.audio.setVolume(this.settings.muted ? 0 : this.settings.volume);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.ui.applySettings?.(this.settings);
    try {
      localStorage.setItem('cs16-settings', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  raycastWorld(origin, dir, maxDist = 200) {
    return this.physics.raycast(origin, dir, maxDist);
  }

  hasLineOfSight(from, to) {
    return this.physics.hasLineOfSight(from, to);
  }

  getPlayerHitboxes(entity = this.player) {
    const p = entity.pos;
    const h = entity.height || 1.8;
    const r = entity.radius || 0.38;
    const make = (part, y0, y1, width, mult) => {
      const box = new THREE.Box3(
        new THREE.Vector3(p.x - width / 2, p.y + y0, p.z - width / 2),
        new THREE.Vector3(p.x + width / 2, p.y + y1, p.z + width / 2),
      );
      return { part, box, damageMult: mult };
    };
    return [
      make('head', h - 0.3, h, 0.28, HIT_MULT.head),
      make('chest', h * 0.56, h - 0.3, Math.max(0.4, r * 1.15), HIT_MULT.chest),
      make('stomach', h * 0.42, h * 0.56, Math.max(0.38, r * 1.1), HIT_MULT.stomach),
      make('legs', 0.02, h * 0.42, Math.max(0.34, r), HIT_MULT.legs),
    ];
  }

  raycastShot(origin, dir, maxDist = 200, shooterTeam = null) {
    const direction = dir.clone().normalize();
    const worldHit = this.physics.raycast(origin, direction, maxDist);
    let best = worldHit
      ? { ...worldHit, type: 'world' }
      : null;
    let bestT = worldHit ? worldHit.t : maxDist;

    const consider = (boxes, entity, type) => {
      for (const hb of boxes) {
        const hit = rayBox(origin, direction, hb.box, bestT);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          best = {
            t: hit.t,
            point: origin.clone().addScaledVector(direction, hit.t),
            normal: hit.normal,
            type,
            entity,
            part: hb.part,
            damageMult: hb.damageMult ?? 1,
          };
        }
      }
    };

    if (this.player.alive && shooterTeam !== this.player.team) {
      consider(this.getPlayerHitboxes(this.player), this.player, 'player');
    }
    if (this.bots) {
      for (const bot of this.bots.getBots()) {
        if (!bot.alive || bot.team === shooterTeam) continue;
        const boxes = this.bots.getBotHitboxes(bot);
        if (boxes && boxes.length) consider(boxes, bot, 'bot');
      }
    }
    if (this.online) {
      const remotes = this.online.getRemoteEntities?.() || [];
      for (const remote of remotes) {
        if (!remote?.alive || remote.team === shooterTeam) continue;
        const boxes = this.online.getRemoteHitboxes?.(remote);
        if (boxes && boxes.length) consider(boxes, remote, 'remote');
      }
    }
    return best;
  }

  damagePlayer(amount, source, part = 'chest', weaponId = 'unknown') {
    const mult = HIT_MULT[part] ?? 1;
    return this.player.takeDamage(amount * mult, source, part, weaponId);
  }

  damageBot(bot, amount, source, part = 'chest', weaponId = 'unknown') {
    if (!this.bots || !bot) return 0;
    const mult = HIT_MULT[part] ?? 1;
    return this.bots.damageBot(bot, amount * mult, source, part, weaponId);
  }

  addKillFeed(entry) {
    this.ui.addKillFeed(entry);
  }

  notifyKill(killer, victim, weaponId = 'unknown', headshot = false) {
    if (!victim) return;
    if (this.online) {
      this.online.onKill(killer, victim, weaponId, headshot);
      return;
    }
    if (victim._deathNotifiedRound === this.rounds?.roundNumber) return;
    victim._deathNotifiedRound = this.rounds?.roundNumber;
    victim.deaths = (victim.deaths || 0) + 1;

    const sameTeam = killer && victim.team && killer.team === victim.team;
    const validKill = killer && killer !== victim && !sameTeam;
    if (validKill) {
      killer.kills = (killer.kills || 0) + 1;
      killer.roundKills = (killer.roundKills || 0) + 1;
      killer.score = (killer.score || 0) + 1;
      if (killer.isPlayer) {
        const reward = this.weapons?.getKillReward?.(weaponId) ?? 300;
        this.player.addMoney(reward);
        if (headshot) this.audio.play('headshot');
        this.ui.showKillConfirm?.(headshot);
      }
    }

    const weaponName = this.weapons?.getName?.(weaponId) || weaponId || 'mundo';
    this.ui.addKillFeed({
      killer: killer?.name || 'Mundo',
      victim: victim.name || '???',
      weapon: weaponName,
      headshot: !!headshot,
      teamKill: !!sameTeam,
      killerTeam: killer?.team || null,
      victimTeam: victim.team || null,
      isPlayerKiller: !!killer?.isPlayer,
      isPlayerVictim: !!victim?.isPlayer,
    });

    if (victim.isPlayer) {
      this.ui.showCenterMessage('HAS MUERTO', 2400);
      this.ui.toast?.('Espera al final de la ronda para reaparecer');
    }

    if (this.rounds) {
      if (victim.isBot) this.rounds.onBotKilled?.(victim);
      else if (victim.isPlayer) this.rounds.onPlayerKilled?.();
    }
  }

  getAliveBots(team) {
    return this.bots ? this.bots.getBots().filter((b) => b.alive && (!team || b.team === team)) : [];
  }

  getAliveCounts() {
    const counts = { CT: 0, T: 0 };
    if (this.player.alive) counts[this.player.team]++;
    if (this.bots) {
      for (const b of this.bots.getBots()) {
        if (b.alive) counts[b.team]++;
      }
    }
    const remotes = this.online?.getRemoteEntities?.() || [];
    for (const remote of remotes) {
      if (remote?.alive && (remote.team === 'CT' || remote.team === 'T')) counts[remote.team]++;
    }
    return counts;
  }

  getPlayersForRadar() {
    const list = [];
    if (this.player.alive) {
      list.push({
        x: this.player.pos.x,
        z: this.player.pos.z,
        yaw: this.player.yaw,
        team: this.player.team,
        isPlayer: true,
        alive: true,
      });
    }
    if (this.bots) {
      for (const b of this.bots.getBots()) {
        if (!b.alive) continue;
        list.push({
          x: b.pos.x,
          z: b.pos.z,
          yaw: b.yaw,
          team: b.team,
          isPlayer: false,
          alive: true,
          name: b.name,
          hasBomb: !!b.hasBomb,
        });
      }
    }
    const remotes = this.online?.getRemoteEntities?.() || [];
    for (const remote of remotes) {
      if (!remote?.alive) continue;
      list.push({
          x: remote.pos.x,
          z: remote.pos.z,
          yaw: remote.yaw || 0,
          team: remote.team,
          isPlayer: false,
          alive: true,
          name: remote.name || 'Rival',
          online: true,
        });
    }
    return list;
  }

  getRadarData() {
    const map = this.map;
    const round = this.rounds;
    return {
      mapName: map?.displayName || map?.id || '',
      bounds: map?.bounds || { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
      players: this.getPlayersForRadar(),
      bombsites: map?.bombsites || [],
      bomb: round?.bomb?.planted
        ? { x: round.bomb.x, z: round.bomb.z, site: round.bomb.site, timeLeft: round.bomb.timeLeft }
        : null,
      hostages:
        round?.hostages?.map((h) => ({
          x: h.x,
          z: h.z,
          rescued: h.rescued,
          following: h.following,
        })) || [],
      rescueZone: map?.rescueZone || null,
    };
  }

  getHudState() {
    const onlineHud = this.online?.getHudState?.() || null;
    let roundHud = this.rounds?.getHudState?.() || {
      phase: 'live',
      round: 1,
      timeLeft: 0,
      freezeLeft: 0,
      buyTimeLeft: 0,
      scoreCT: 0,
      scoreT: 0,
      objective: '',
      teamAlive: this.getAliveCounts(),
    };
    if (onlineHud) {
      roundHud = {
        phase: onlineHud.phase || 'live',
        round: onlineHud.roundNumber || onlineHud.round || 1,
        roundNumber: onlineHud.roundNumber || onlineHud.round || 1,
        timeLeft: 0,
        freezeLeft: 0,
        buyTimeLeft: 0,
        scoreCT: Number(onlineHud.scoreCT ?? onlineHud.scoreHost) || 0,
        scoreT: Number(onlineHud.scoreT ?? onlineHud.scoreGuest) || 0,
        objective:
          'PRIMERO A ' +
          (onlineHud.targetRounds || onlineHud.targetKills || 13) +
          ' RONDAS Â· ' +
          String(onlineHud.mode || '1v1').toUpperCase(),
        teamAlive: this.getAliveCounts(),
        bomb: { planted: false },
        hostages: { total: 0, rescued: 0, carrying: 0 },
        message: onlineHud.phase === 'over' ? 'PARTIDA TERMINADA' : '',
      };
    }
    const weaponHud = this.weapons?.getHudState?.() || {
      name: 'DESARMADO',
      weaponId: 'none',
      ammo: 0,
      reserve: 0,
      slots: [],
      grenades: [],
      hasC4: false,
      hasKit: false,
      spread: 0,
      scoped: false,
    };
    return {
      health: Math.ceil(this.player.health),
      armor: Math.ceil(this.player.armor),
      helmet: !!this.player.helmet,
      money: Math.round(this.player.money),
      team: this.player.team,
      alive: this.player.alive,
      kills: this.player.kills,
      deaths: this.player.deaths,
      weapon: weaponHud,
      round: roundHud,
      radar: this.getRadarData(),
      crosshair: {
        spread: weaponHud.spread ?? 0,
        hidden: this.ui.isBuyMenuOpen || !!weaponHud.scoped,
        sniper: !!weaponHud.scoped,
        color: this.settings.crosshairColor,
        size: this.settings.crosshairSize,
      },
      buy: {
        canBuy: onlineHud ? false : this.canBuy(),
        inZone: onlineHud ? false : this.buyZoneFor(this.player.team),
      },
      teamAlive: this.getAliveCounts(),
      mapName: this.map?.displayName || '',
      scores: { CT: roundHud.scoreCT, T: roundHud.scoreT },
      online: onlineHud,
    };
  }

  canBuy() {
    if (this.online) return false;
    if (this.state !== 'playing' || !this.player.alive || !this.rounds) return false;
    const rh = this.rounds.getHudState?.();
    if (!rh || rh.buyTimeLeft <= 0) return false;
    if (rh.phase !== 'freeze' && rh.phase !== 'live') return false;
    return this.buyZoneFor(this.player.team);
  }

  buyZoneFor(team) {
    if (!this.map || !this.map.buyZones?.[team]) return false;
    const z = this.map.buyZones[team];
    return pointInRect(this.player.pos.x, this.player.pos.z, z.min, z.max);
  }

  openBuyMenu() {
    if (this.online) return false;
    if (!this.canBuy()) {
      this.ui.toast?.('No puedes comprar ahora');
      return false;
    }
    this.ui.showBuyMenu?.(this.getBuyMenuData());
    this.input.exitPointerLock();
    return true;
  }

  closeBuyMenu() {
    this.ui.closeBuyMenu?.();
    if (this.state === 'playing') {
      setTimeout(() => this.input.requestPointerLock(), 30);
    }
  }

  getBuyMenuData() {
    const base = this.weapons?.getBuyMenuData?.() || { categories: [] };
    return {
      ...base,
      money: Math.round(this.player.money),
      team: this.player.team,
      canBuy: this.canBuy(),
    };
  }

  buyItem(id) {
    if (!this.canBuy()) return { ok: false, message: 'Fuera de zona de compra' };
    const result = this.weapons?.buyItem?.(id) || { ok: false, message: 'No disponible' };
    if (result.ok) {
      this.audio.play('buy');
      this.ui.updateBuyMenu?.(this.getBuyMenuData());
      this.ui.toast?.(result.message || 'Comprado');
    } else {
      this.audio.play('empty');
      this.ui.toast?.(result.message || 'No puedes comprar eso');
    }
    return result;
  }

  getScoreboardData() {
    if (this.online) {
      const onlineBoard = this.online.getScoreboardData?.();
      if (onlineBoard) return onlineBoard;
    }
    const teams = { CT: [], T: [] };
    const player = this.player;
    teams[player.team].push({
      name: player.name,
      team: player.team,
      isPlayer: true,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      money: Math.round(player.money),
      ping: 12,
      hasBomb: !!player.hasBomb,
      hasKit: !!player.hasDefuseKit,
    });
    if (this.bots) {
      for (const b of this.bots.getBots()) {
        teams[b.team]?.push({
          name: b.name,
          team: b.team,
          isPlayer: false,
          alive: b.alive,
          kills: b.kills || 0,
          deaths: b.deaths || 0,
          money: Math.round(b.money || 0),
          ping: b.ping ?? 35,
          hasBomb: !!b.hasBomb,
          hasKit: !!b.hasKit,
        });
      }
    }
    for (const key of ['CT', 'T']) teams[key].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const rh = this.rounds?.getHudState?.() || {};
    return {
      round: rh.round || 1,
      scoreCT: rh.scoreCT || 0,
      scoreT: rh.scoreT || 0,
      phase: rh.phase || 'live',
      mapName: this.map?.displayName || '',
      mode: this.matchConfig?.mode || 'bomb',
      teams,
    };
  }

  showActionProgress(label, progress) {
    this.ui.showActionProgress?.(label, progress);
  }

  hideActionProgress() {
    this.ui.hideActionProgress?.();
  }

  setRoundBanner(title, subtitle, winner) {
    this.ui.showRoundBanner?.(title, subtitle, winner);
  }

  hideRoundBanner() {
    this.ui.hideRoundBanner?.();
  }

  showRoundResult(data) {
    this.ui.showRoundResult?.(data);
  }

  onRoundStarted(data = {}) {
    this.state = 'playing';
    this.ui.hideRoundResult?.();
    this.ui.hideActionProgress?.();
    this.ui.showHUD();
    this.ui.closeBuyMenu?.();
    this.audio.play('round_start');
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    if (data.round) {
      this.ui.showRoundBanner?.(`RONDA ${data.round}`, this.matchConfig?.mode === 'hostage' ? 'RESCATE DE REHENES' : 'DESACTIVACIÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN DE BOMBA', 'neutral');
      this.ui.toast?.(`Ronda ${data.round} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${formatMoney(this.player.money)}`);
    }
    if (!this.input.locked && this.state === 'playing') {
      setTimeout(() => {
        if (this.state === 'playing' && !this.ui.isOverlayOpen) this.input.requestPointerLock();
      }, 60);
    }
  }

  onRoundEnded(winner, reason, data = {}) {
    this.state = 'roundover';
    this.ui.hideActionProgress?.();
    this.ui.closeBuyMenu?.();
    this.audio.play(winner === this.player.team ? 'round_win' : 'round_lose');
    this.ui.showRoundResult?.({
      ...data,
      winner,
      reason,
      scoreCT: data.scoreCT ?? this.rounds?.getHudState?.().scoreCT ?? 0,
      scoreT: data.scoreT ?? this.rounds?.getHudState?.().scoreT ?? 0,
      playerTeam: this.player.team,
    });
  }

  onOnlineMatchEnd(data = {}) {
    if (!this.online) return;
    this._suppressPause = true;
    this.input.exitPointerLock();
    this.onlineUI?.showMatchEnd?.(data);
    setTimeout(() => {
      this._suppressPause = false;
    }, 120);
  }

  showMatchEnd(data = {}) {
    this.state = 'matchover';
    this._suppressPause = true;
    this.ui.hideActionProgress?.();
    this.ui.hideRoundResult?.();
    this.ui.closeBuyMenu?.();
    this.input.exitPointerLock();
    setTimeout(() => {
      this._suppressPause = false;
    }, 120);
    this.ui.showMatchEnd?.(data);
  }

  setCameraShake(amount) {
    this.player.addShake(amount);
  }

  flashPlayer(alpha) {
    this.ui.flash?.(alpha);
  }

  toast(text) {
    this.ui.toast?.(text);
  }

  log(text) {
    console.log('[CS16]', text);
    this.ui.consoleLog?.(text);
  }

  spawnPlayer(team, spawn) {
    this.player.reset(team, spawn);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const input = this.input;
    const ui = this.ui;

    this.audio.syncMenuMusic(this.state === 'menu');

    if (this.state === 'menu') {
      this.positionMenuCamera(dt);
      this._maybeGlobalKeys();
      return;
    }
    if (this.state === 'paused') {
      this._maybeGlobalKeys();
      return;
    }

    this._maybeGlobalKeys();

    if (this.state === 'playing' && !this.input.locked && !this.ui.isOverlayOpen && !this.onlineUI?.isOpen) {
      if (!this._lockHintShown) {
        this._lockHintShown = true;
        this.ui.showCenterMessage?.('HAZ CLIC PARA JUGAR', 3200);
      }
    } else if (this.input.locked) {
      this._lockHintShown = false;
    }

    if (this.state === 'playing' || this.state === 'roundover') {
      this.player.update(dt);
      // Seguro contra huecos/roturas del piso o caÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­das fuera del mapa.
      if (
        this.player.alive &&
        (this.player.pos.y < -6 ||
          this.player.pos.x < (this.map?.bounds?.minX ?? -999) - 8 ||
          this.player.pos.x > (this.map?.bounds?.maxX ?? 999) + 8 ||
          this.player.pos.z < (this.map?.bounds?.minZ ?? -999) - 8 ||
          this.player.pos.z > (this.map?.bounds?.maxZ ?? 999) + 8)
      ) {
        this.player.die(null, 'fall');
      }
    }

    if (this.weapons && (this.state === 'playing' || this.state === 'roundover')) {
      this.weapons.update(dt);
    }

    if (this.online && (this.state === 'playing' || this.state === 'roundover')) {
      this.online.update(dt);
    }

    if (this.bots && this.state === 'playing') {
      this.bots.update(dt);
    }

    if (this.rounds && (this.state === 'playing' || this.state === 'roundover')) {
      this.rounds.update(dt);
    }

    this.effects.update(dt);

    if (this.state === 'playing' || this.state === 'roundover') {
      this.time += dt;
      this._hudAccum += dt;
      if (this._hudAccum > 0.05) {
        this._hudAccum = 0;
        const hud = this.getHudState();
        ui.updateHUD?.(hud);
        if (hud.online) this.onlineUI?.updateHud?.(hud.online);
      }
      const tabDown = input.isDown('Tab');
      if (tabDown && !this._lastTab && !ui.isBuyMenuOpen) {
        ui.openScoreboard?.(this.getScoreboardData());
      } else if (tabDown && ui.isScoreboardVisible) {
        this._scoreboardAccum += dt;
        if (this._scoreboardAccum > 0.35) {
          this._scoreboardAccum = 0;
          ui.updateScoreboard?.(this.getScoreboardData());
        }
      } else if (!tabDown && this._lastTab) {
        ui.closeScoreboard?.();
      }
      this._lastTab = tabDown;
    }
  }

  _maybeGlobalKeys() {
    const input = this.input;
    if (input.consumePressed('KeyB') && !this.online && (this.state === 'playing' || this.state === 'roundover')) {
      if (this.ui.isBuyMenuOpen) this.closeBuyMenu();
      else this.openBuyMenu();
    }
    if (input.consumePressed('Backquote') && this.ui.toggleConsole) {
      this.ui.toggleConsole();
    }
    if (input.consumePressed('Escape')) {
      if (this.state === 'playing' && !this.online && !this.ui.isOverlayOpen && !this.onlineUI?.isOpen) {
        this.pause();
      } else if (this.state === 'paused' && this.pauseGuardReady) {
        this.resume();
      }
    }
    if (this.state === 'paused') this.pauseGuardReady = true;
    else this.pauseGuardReady = false;
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    this._fpsElapsed = (this._fpsElapsed || 0) + dt;
    if (this._fpsElapsed >= 0.5) {
      this._uiFps = this._fpsFrames / this._fpsElapsed;
      this._fpsFrames = 0;
      this._fpsElapsed = 0;
    }
    try {
      this.update(dt);
      this.movementDebug?.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.weapons?.viewmodel?.render?.(this.renderer);
      this.nameTags?.update();
    } catch (err) {
      console.error(err);
    }
    this.input.endFrame();
  }
}










