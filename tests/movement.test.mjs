import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Player } from '../src/core/player.js';
import { PhysicsWorld } from '../src/core/physics.js';
import {
  DEFAULT_MATCH_MOVEMENT_PRESET,
  DIAGNOSTIC_MOVEMENT_PRESET,
} from '../src/core/movement-presets.js';

function inputStub() {
  const keys = new Set();
  const pressed = new Set();
  return {
    keys,
    pressed,
    locked: true,
    isDown(code) { return keys.has(code); },
    wasPressed(code) { return pressed.has(code); },
    consumeLook() { return { x: 0, y: 0 }; },
  };
}

function makeHarness({ floor = true, moveSpeed = 5.525 } = {}) {
  const input = inputStub();
  let canStand = true;
  const game = {
    input,
    // Deliberately false: V3 production movement must not depend on localStorage/settings.
    settings: { sensitivity: 1, invertY: false, autoBhop: false, fov: 90 },
    weapons: { getMoveSpeed: () => moveSpeed },
    canMove: () => true,
    audio: { play() {} },
    physics: {
      canFitBody() { return canStand; },
      moveBody(body, dt) {
        body.pos.x += body.vel.x * dt;
        body.pos.y += body.vel.y * dt;
        body.pos.z += body.vel.z * dt;
        if (floor && body.pos.y <= 0.05) {
          body.pos.y = 0.05;
          if (body.vel.y < 0) body.vel.y = 0;
          body.onGround = true;
        }
      },
    },
    camera: {
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      fov: 90,
      updateProjectionMatrix() {},
    },
    ui: {},
  };
  return {
    game,
    input,
    setCanStand(value) { canStand = !!value; },
  };
}

function makePlayer(opts = {}) {
  const harness = makeHarness(opts);
  const player = new Player(harness.game);
  player.reset('T', { x: 0, y: 0.05, z: 0, yaw: 0 });
  player.onGround = true;
  return { ...harness, player };
}

function runFrames(player, hz, seconds, beforeFrame = null) {
  const frames = Math.ceil(hz * seconds);
  const dt = 1 / hz;
  for (let i = 0; i < frames; i++) {
    beforeFrame?.(i, i * dt, dt);
    player.update(dt);
  }
}

function runUntilJumps(player, hz, target, maxSeconds = 30) {
  const dt = 1 / hz;
  const maxFrames = Math.ceil(maxSeconds * hz);
  for (let i = 0; i < maxFrames && player._jumpCount < target; i++) player.update(dt);
  return player._jumpCount;
}

// Production preset is forced even though the old settings flag is false.
{
  const { player } = makePlayer();
  assert.equal(player.movementPresetId, DEFAULT_MATCH_MOVEMENT_PRESET);
  assert.equal(player.getMovementDebugState().autoBhopEnabled, true);
  assert.equal(player.getMovementDebugState().fixedStep, 0.01);
}

// Weapon speed controls ground wishspeed, not accumulated bhop velocity.
{
  const { player, input } = makePlayer();
  input.keys.add('KeyW');
  runFrames(player, 60, 3);
  assert.ok(
    Math.abs(player.getVelocity2D() - 5.525) < 0.08,
    `AK ground speed drifted: ${player.getVelocity2D()}`,
  );

  input.keys.add('ShiftLeft');
  runFrames(player, 60, 2);
  assert.ok(
    player.getVelocity2D() < 3.05 && player.getVelocity2D() > 2.65,
    `walk speed invalid: ${player.getVelocity2D()}`,
  );
}

// Ground diagonals normalize wishdir and counter-strafe reverses projected velocity.
{
  const straight = makePlayer();
  straight.input.keys.add('KeyW');
  runFrames(straight.player, 60, 2);
  const straightSpeed = straight.player.getVelocity2D();

  const diagonal = makePlayer();
  diagonal.input.keys.add('KeyW');
  diagonal.input.keys.add('KeyD');
  runFrames(diagonal.player, 60, 2);
  assert.ok(
    Math.abs(diagonal.player.getVelocity2D() - straightSpeed) < 0.04,
    'diagonal input changed the intended ground max speed',
  );

  const counter = makePlayer();
  counter.input.keys.add('KeyW');
  runFrames(counter.player, 60, 0.55);
  const beforeReverse = counter.player.vel.z;
  counter.input.keys.delete('KeyW');
  counter.input.keys.add('KeyS');
  runFrames(counter.player, 60, 0.42);
  assert.ok(beforeReverse < -1, `forward acceleration too weak: ${beforeReverse}`);
  assert.ok(counter.player.vel.z > 0.3, `counter-strafe failed to reverse velocity: ${counter.player.vel.z}`);
}

// Hold-Space autobhop: 10/20/30 landings at 30/60/144 render FPS.
// Start with real horizontal momentum and verify landing never clamps it to weapon speed.
const chainResults = [];
for (const hz of [30, 60, 144]) {
  for (const target of [10, 20, 30]) {
    const { player, input } = makePlayer();
    player.vel.x = 7.25; // already above AK ground wishspeed
    input.keys.add('Space');
    const count = runUntilJumps(player, hz, target, 28);
    assert.equal(count, target, `held Space missed jumps at ${hz} FPS (${count}/${target})`);
    assert.ok(
      player.getVelocity2D() > 7.15,
      `bhop momentum was clamped at ${hz} FPS / ${target} jumps: ${player.getVelocity2D()}`,
    );
    chainResults.push({ hz, target, x: player.pos.x, speed: player.getVelocity2D() });
  }
}

// Fixed 100 Hz physics should make straight-line results nearly render-rate independent.
{
  const finalByHz = [];
  for (const hz of [30, 60, 144]) {
    const { player, input } = makePlayer();
    player.vel.x = 6.8;
    input.keys.add('Space');
    runFrames(player, hz, 8);
    finalByHz.push({ hz, x: player.pos.x, speed: player.getVelocity2D(), jumps: player._jumpCount });
  }
  const xs = finalByHz.map((x) => x.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.12, `fixed tick position drift: ${JSON.stringify(finalByHz)}`);
  const speeds = finalByHz.map((x) => x.speed);
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < 0.03, `fixed tick speed drift: ${JSON.stringify(finalByHz)}`);
}

// Holding Space in air cannot double-jump; releasing it stops the next automatic jump.
{
  const { player, input } = makePlayer();
  player.vel.x = 5;
  input.keys.add('Space');
  runFrames(player, 60, 0.15);
  assert.equal(player._jumpCount, 1, 'holding Space generated an in-air double jump');
  runUntilJumps(player, 60, 3, 5);
  assert.equal(player._jumpCount, 3);
  input.keys.delete('Space');
  runFrames(player, 60, 1.2);
  assert.equal(player._jumpCount, 3, 'releasing Space did not stop autobhop');
  assert.equal(player.onGround, true, 'player should settle on the floor after releasing Space');
}

// Jittery render pacing must not lose held-Space landings.
{
  const { player, input } = makePlayer();
  player.vel.x = 6.5;
  input.keys.add('Space');
  const pattern = [1 / 30, 1 / 144, 1 / 60, 0.041, 1 / 120, 0.019];
  for (let i = 0; i < 2400 && player._jumpCount < 20; i++) player.update(pattern[i % pattern.length]);
  assert.equal(player._jumpCount, 20, 'irregular render cadence lost an autobhop landing');
  assert.ok(player.getVelocity2D() > 6.4, 'irregular render cadence destroyed horizontal momentum');
}

// Air-strafe uses projected acceleration. Skilled changing wish direction can build
// more total speed than simply holding forward with a static yaw.
{
  const baseline = makePlayer({ floor: false });
  baseline.player.pos.y = 2;
  baseline.player.onGround = false;
  baseline.player.vel.set(5.5, 0, 0);
  baseline.input.keys.add('KeyW');
  runFrames(baseline.player, 100, 1);
  const baselineSpeed = baseline.player.getVelocity2D();

  const skilled = makePlayer({ floor: false });
  skilled.player.pos.y = 2;
  skilled.player.onGround = false;
  skilled.player.vel.set(5.5, 0, 0);
  skilled.input.keys.add('KeyD');
  runFrames(skilled.player, 100, 1, (_i, t) => {
    skilled.player.yaw = t * 1.75;
  });
  const skilledSpeed = skilled.player.getVelocity2D();
  assert.ok(
    skilledSpeed > baselineSpeed + 0.1,
    `coordinated air-strafe did not gain skill speed: baseline=${baselineSpeed}, skilled=${skilledSpeed}`,
  );
}

// The same scripted air-strafe remains close across render rates because movement
// integrates at 100 Hz; yaw is sampled once per render, so a small tolerance is declared.
{
  const results = [];
  for (const hz of [30, 60, 144]) {
    const h = makePlayer({ floor: false });
    h.player.pos.y = 2;
    h.player.onGround = false;
    h.player.vel.set(5.5, 0, 0);
    h.input.keys.add('KeyD');
    runFrames(h.player, hz, 2, (_i, t) => {
      h.player.yaw = t * 1.45;
    });
    results.push({
      hz,
      x: h.player.pos.x,
      z: h.player.pos.z,
      speed: h.player.getVelocity2D(),
    });
  }
  const speeds = results.map((x) => x.speed);
  assert.ok(
    Math.max(...speeds) - Math.min(...speeds) < 0.18,
    `air-strafe render-rate speed drift exceeded tolerance: ${JSON.stringify(results)}`,
  );
  const base = results[1];
  for (const row of results) {
    const drift = Math.hypot(row.x - base.x, row.z - base.z);
    assert.ok(drift < 0.5, `air-strafe render-rate position drift exceeded 0.5: ${JSON.stringify(results)}`);
  }
}

// Diagnostic vanilla preset is separate: holding Space alone does not autojump after landing.
{
  const { game, player, input } = makePlayer();
  game.movementPresetOverride = DIAGNOSTIC_MOVEMENT_PRESET;
  player.refreshMovementPreset();
  assert.equal(player.movementPresetId, DIAGNOSTIC_MOVEMENT_PRESET);
  input.keys.add('Space');
  input.pressed.add('Space');
  runFrames(player, 60, 0.08);
  input.pressed.delete('Space');
  assert.equal(player._jumpCount, 1);
  runFrames(player, 60, 1.2);
  assert.equal(player._jumpCount, 1, 'vanilla diagnostic preset unexpectedly autojumped');
}

// Duck/stand clearance: releasing crouch under a ceiling must not expand the collider.
{
  const { player, input, setCanStand } = makePlayer();
  input.keys.add('ControlLeft');
  runFrames(player, 60, 0.35);
  assert.equal(player.crouching, true);
  assert.ok(player.height < player.standHeight - 0.1);

  input.keys.delete('ControlLeft');
  setCanStand(false);
  runFrames(player, 60, 0.3);
  assert.equal(player.crouching, true, 'stood up through blocked ceiling');

  setCanStand(true);
  runFrames(player, 60, 0.5);
  assert.equal(player.crouching, false);
  assert.ok(Math.abs(player.height - player.standHeight) < 0.02);
}

// Real PhysicsWorld regression: step-up works from a grounded zero-Y velocity
// body, and high horizontal velocity cannot tunnel through a wall.
{
  const floor = new THREE.Box3(
    new THREE.Vector3(-20, -1, -20),
    new THREE.Vector3(20, 0, 20),
  );
  const lowStep = new THREE.Box3(
    new THREE.Vector3(0.7, 0, -1),
    new THREE.Vector3(1.15, 0.3, 1),
  );
  const world = new PhysicsWorld([floor, lowStep]);
  const body = {
    pos: new THREE.Vector3(0, 0.001, 0),
    vel: new THREE.Vector3(4, 0, 0),
    radius: 0.38,
    height: 1.8,
    stepHeight: 0.45,
    onGround: true,
  };
  world.moveBody(body, 0.3);
  assert.ok(body.pos.x > 0.75, `step-up blocked horizontal travel: ${body.pos.x}`);
  assert.ok(body.pos.y >= 0.299, `step-up failed to raise body: ${body.pos.y}`);

  const wall = new THREE.Box3(
    new THREE.Vector3(2, 0, -2),
    new THREE.Vector3(2.25, 4, 2),
  );
  const fastWorld = new PhysicsWorld([floor, wall]);
  const fast = {
    pos: new THREE.Vector3(0, 0.001, 0),
    vel: new THREE.Vector3(50, 0, 0),
    radius: 0.38,
    height: 1.8,
    stepHeight: 0.45,
    onGround: true,
  };
  fastWorld.moveBody(fast, 0.1);
  assert.ok(fast.pos.x < 1.63, `high-speed body tunneled through wall: ${fast.pos.x}`);
  assert.equal(fast.vel.x, 0, 'wall collision did not cancel normal velocity');

  const edgeFloor = new THREE.Box3(
    new THREE.Vector3(-2, -1, -2),
    new THREE.Vector3(0.8, 0, 2),
  );
  const edgeWorld = new PhysicsWorld([edgeFloor]);
  const edgeBody = {
    pos: new THREE.Vector3(0.5, 0.001, 0),
    vel: new THREE.Vector3(3, 0, 0),
    radius: 0.38,
    height: 1.8,
  };
  assert.equal(edgeWorld.hasGroundBelow(edgeBody, 0.1, 0, 0.85), true);
  assert.equal(edgeWorld.hasGroundBelow(edgeBody, 0.4, 0, 0.85), false);
}

// GoldSrc-style edgefriction applies only when staying on ground; an autojump
// skips this friction path entirely.
{
  const supported = makePlayer();
  supported.game.physics.hasGroundBelow = () => true;
  supported.player.vel.x = 3;
  runFrames(supported.player, 100, 0.08);

  const edge = makePlayer();
  edge.game.physics.hasGroundBelow = () => false;
  edge.player.vel.x = 3;
  runFrames(edge.player, 100, 0.08);
  assert.ok(
    edge.player.getVelocity2D() < supported.player.getVelocity2D() - 0.2,
    `edgefriction did not increase ground deceleration: supported=${supported.player.getVelocity2D()} edge=${edge.player.getVelocity2D()}`,
  );
}

console.log(
  'movement OK: CS16_1V1_AUTOBHOP fixed tick, weapon wishspeed, 10/20/30 chains @30/60/144, release/no-double-jump, skill air-strafe and duck clearance',
);
