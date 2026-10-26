import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {
  Player,
  collisionHullForMap,
  DEFAULT_PLAYER_COLLISION_RADIUS,
  DUST2_PLAYER_COLLISION_RADIUS,
  DUST2_PLAYER_STAND_HEIGHT,
  DUST2_PLAYER_CROUCH_HEIGHT,
  DUST2_PLAYER_EYE_STAND,
  DUST2_PLAYER_EYE_CROUCH,
} from '../src/core/player.js';
import { BotManager } from '../src/bots.js';
import { RemoteAvatar } from '../src/online/avatar.js';
import { OnlineMatch } from '../src/online/match.js';

function makePlayerGame(mapId) {
  return {
    map: { id: mapId },
    input: {
      locked: false,
      isDown() { return false; },
      wasPressed() { return false; },
      consumeLook() { return { x: 0, y: 0 }; },
    },
    settings: { sensitivity: 1, invertY: false },
    weapons: { getMoveSpeed() { return 6.25; } },
    canMove() { return true; },
    audio: { play() {} },
    ui: {},
    camera: {
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      updateProjectionMatrix() {},
    },
  };
}

function makeBotGame(mapId) {
  return {
    map: {
      id: mapId,
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      spawns: {
        CT: [{ x: -2, y: 0.05, z: 0, yaw: 90 }],
        T: [{ x: 2, y: 0.05, z: 0, yaw: -90 }],
      },
      waypoints: [],
    },
    scene: new THREE.Scene(),
    player: { alive: false },
    audio: { play() {} },
  };
}

// Imported Dust2 has its own scale calibration; classic maps retain the
// original collision body, standing/crouching heights and eye positions.
{
  const classic = collisionHullForMap('aim_forge');
  const dust2 = collisionHullForMap('de_dust2_dm');
  assert.equal(classic.radius, DEFAULT_PLAYER_COLLISION_RADIUS);
  assert.equal(classic.radius, 0.38);
  assert.equal(dust2.radius, DUST2_PLAYER_COLLISION_RADIUS);
  assert.equal(dust2.radius, 0.25);
  assert.equal(dust2.standHeight, DUST2_PLAYER_STAND_HEIGHT);
  assert.equal(dust2.crouchHeight, DUST2_PLAYER_CROUCH_HEIGHT);
  assert.equal(dust2.standHeight, 1.56);
  assert.equal(dust2.crouchHeight, 1.04);
  assert.equal(dust2.eyeStand, DUST2_PLAYER_EYE_STAND);
  assert.equal(dust2.eyeCrouch, DUST2_PLAYER_EYE_CROUCH);
  assert.equal(dust2.eyeStand, 1.40);
  assert.equal(dust2.eyeCrouch, 0.93);
  assert.equal(classic.standHeight, 1.8);
  assert.equal(classic.crouchHeight, 1.32);
  assert.equal(classic.eyeStand, 1.62);
  assert.equal(classic.eyeCrouch, 1.12);
}

// Player constructor + every reset/online respawn re-resolve the active map,
// so changing maps cannot leak the Dust2 hull into 1v1/2v2.
{
  const game = makePlayerGame('de_dust2_dm');
  const player = new Player(game);
  assert.equal(player.radius, 0.25);
  assert.equal(player.hitboxRadius, 0.38, 'Dust2 collision width does not shrink combat hitboxes');
  player.reset('CT', { x: 0, y: 0.05, z: 0, yaw: 0 });
  assert.equal(player.radius, 0.25);
  assert.equal(player.height, 1.56);
  assert.equal(player.eyeHeight, 1.40);
  player.crouchAmount = 1;
  assert.equal(player.eyeHeight, 0.93, 'Dust2 crouched camera follows lower profile');

  game.map = { id: 'aim_redline' };
  player.respawn('T', { x: 1, y: 0.05, z: 1, yaw: 180 });
  assert.equal(player.radius, 0.38, 'classic respawn restores the original hull');
  assert.equal(player.height, 1.8);
  assert.equal(player.eyeHeight, 1.62, 'classic respawn restores eye height');
  assert.equal(player.crouchHeight, 1.32);

  game.map = { id: 'de_dust2_dm' };
  player.respawn('CT', { x: 2, y: 0.05, z: 2, yaw: 90 });
  assert.equal(player.radius, 0.25, 'Dust2 respawn re-applies the narrow hull');
  assert.equal(player.height, 1.56);
  assert.equal(player.eyeHeight, 1.40);
}

// Bots use the map-specific hull and scale their entire rendered rig together;
// their combat hitbox width remains independent of navigation clearance.
{
  const dustGame = makeBotGame('de_dust2_dm');
  const dustBots = new BotManager(dustGame);
  dustBots.spawnAll({ botsCT: 1, botsT: 0, difficulty: 'normal', teamSize: 2 });
  assert.equal(dustBots.bots.length, 1);
  assert.equal(dustBots.bots[0].radius, 0.25);
  assert.equal(dustBots.bots[0].hitboxRadius, 0.38);
  assert.equal(dustBots.bots[0].height, 1.56);
  assert.ok(Math.abs(dustBots.bots[0].group.scale.y - (1.56 / 1.8)) < 1e-8);
  const limbs=dustBots.getBotHitboxes(dustBots.bots[0]).filter(box=>box.part.endsWith('leg'));
  assert.deepEqual(limbs.map(l=>l.part),['leftleg','rightleg']);
  for(const limb of limbs)assert.ok(Math.abs((limb.box.max.x-limb.box.min.x)-.16*1.56/1.8)<1e-9,'anatomical legs scale with the model height independently of movement radius');
  const originalLimbs=limbs.map(l=>l.box.clone());
  dustBots.bots[0].radius = 0.99;
  const changed=dustBots.getBotHitboxes(dustBots.bots[0]).filter(box=>box.part.endsWith('leg'));
  changed.forEach((limb,i)=>assert.ok(limb.box.equals(originalLimbs[i]),'navigation radius never widens damage geometry'));
  dustBots.resetRound(2);
  assert.equal(dustBots.bots[0].radius, 0.25, 'Dust2 bot respawn restores collision radius');
  assert.equal(dustBots.bots[0].height, 1.56, 'Dust2 bot respawn restores model height');
  dustBots.dispose();

  const classicGame = makeBotGame('aim_forge');
  const classicBots = new BotManager(classicGame);
  classicBots.spawnAll({ botsCT: 1, botsT: 0, difficulty: 'normal', teamSize: 2 });
  assert.equal(classicBots.bots[0].radius, 0.38, 'classic bot hull remains unchanged');
  assert.equal(classicBots.bots[0].group.scale.y, 1, 'classic bot visual scale unchanged');
  classicBots.dispose();
}

// Remote players are scaled at the same point in the hierarchy as bots, from
// the feet; dynamic crouch and eye heights stay aligned with local players.
{
  const dustGame = { map: { id: 'de_dust2_dm' }, scene: new THREE.Scene() };
  const dustRemote = new RemoteAvatar(dustGame, { name: 'Dust2 remote', team: 'CT' });
  assert.ok(Math.abs(dustRemote.group.scale.y - (1.56 / 1.8)) < 1e-8);
  assert.equal(dustRemote.height, 1.56);
  assert.equal(dustRemote.eyeHeight, 1.40);
  assert.ok(Math.abs(dustRemote._communityCrouchDrop - 0.60) < 1e-8);
  assert.equal(dustRemote.radius, 0.38, 'remote hit-registration width stays unchanged');
  dustRemote.crouchAmount = 1;
  assert.equal(dustRemote.height, 1.04);
  assert.equal(dustRemote.eyeHeight, 0.93);
  dustRemote.update(0);
  assert.ok(Math.abs(dustRemote._body.scale.y * 1.56 - 1.04) < 1e-8,
    'Dust2 procedural crouch visual must match its actual collision height');
  dustRemote.dispose();

  const classicRemote = new RemoteAvatar({ map: { id: 'aim_redline' }, scene: new THREE.Scene() });
  assert.equal(classicRemote.group.scale.y, 1);
  assert.equal(classicRemote.height, 1.8);
  assert.equal(classicRemote.eyeHeight, 1.62);
  assert.ok(Math.abs(classicRemote._communityCrouchDrop - 0.48) < 1e-8);
  classicRemote.dispose();
}

// The async skinned-character path receives the map-specific crouch depth;
// it must not fall back to the old 0.48m hip drop on Dust2.
{
  const received = [];
  const character = {
    root: new THREE.Group(),
    setWeapon() {},
    update(_dt, actor) { received.push(actor); },
    dispose() {},
  };
  const game = {
    map: { id: 'de_dust2_dm' },
    scene: new THREE.Scene(),
    characters: {
      ready: true,
      async load() {},
      create() { return character; },
    },
  };
  const remote = new RemoteAvatar(game, { team: 'T' });
  await Promise.resolve();
  assert.equal(remote._kenney, character);
  remote.crouchAmount = 1;
  remote.update(0);
  assert.equal(received.at(-1)?.crouching, true);
  assert.ok(Math.abs(received.at(-1).crouchDrop - 0.60) < 1e-8);
  remote.dispose();
}

// Host origin validation must use each map's real camera height, otherwise
// legitimate near-tolerance Dust2 shots can be rejected after scale changes.
{
  const now = Date.now();
  const state = { pos: { x: 0, y: 0, z: 0 }, crouch: false };
  const shooter = { lastState: state, lastStateAt: now };
  const dustValidator = { game: { map: { id: 'de_dust2_dm' } } };
  const classicValidator = { game: { map: { id: 'aim_redline' } } };
  const validate = OnlineMatch.prototype._validShotOrigin;
  assert.ok(validate.call(dustValidator, shooter, new THREE.Vector3(0, 1.40, 0)));
  assert.ok(validate.call(classicValidator, shooter, new THREE.Vector3(0, 1.62, 0)));
  assert.ok(validate.call(dustValidator, shooter, new THREE.Vector3(2.594, 1.40, 0)));
  assert.equal(validate.call(classicValidator, shooter, new THREE.Vector3(2.594, 1.40, 0)), false);
  state.crouch = true;
  assert.ok(validate.call(dustValidator, shooter, new THREE.Vector3(0, 0.93, 0)));
  assert.ok(validate.call(classicValidator, shooter, new THREE.Vector3(0, 1.12, 0)));
  assert.equal(validate.call(dustValidator, shooter, new THREE.Vector3(0, 3.60, 0)), false);
}

console.log('Dust2 collision hull OK: player/bots/remotes scale 0.25m radius, 1.56m tall; classic hull preserved');
