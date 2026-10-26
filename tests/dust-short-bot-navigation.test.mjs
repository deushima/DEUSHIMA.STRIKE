import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.self = globalThis;
globalThis.document = {
  createElementNS(_ns, name) {
    if (name !== 'img') return {};
    const listeners = new Map();
    return {
      width: 2048,
      height: 2048,
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      set src(_value) { queueMicrotask(() => listeners.get('load')?.call(this)); },
    };
  },
};

const THREE = await import('../vendor/three.module.js');
const { GLTFLoader } = await import('../vendor/loaders/GLTFLoader.js');
const { PhysicsWorld } = await import('../src/core/physics.js');
const { BotManager } = await import('../src/bots.js');
const { buildDustShortMapFromScene } = await import('../src/world/dust_short_map.js');

// Dust Short can author asymmetric routes for one-way physical obstructions.
// BotManager must preserve that direction instead of synthesizing a reverse edge.
{
  const directedGame = {
    map: {
      id: 'dust_short',
      waypoints: [
        { id: 0, x: 0, y: 0, z: 0, links: [1] },
        { id: 1, x: 1, y: 0, z: 0, links: [] },
      ],
    },
    scene: new THREE.Scene(),
    player: { alive: false },
    audio: { play() {} },
  };
  const directedBots = new BotManager(directedGame);
  directedBots._buildNavGraph();
  assert.deepEqual(directedBots._astar(0, 1), [0, 1]);
  assert.equal(directedBots._astar(1, 0), null,
    'Dust Short must not synthesize reverse links for directed authored navigation');
  directedBots.dispose();
}

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = path.resolve(here, '../assets/maps/dust_short.glb');
const source = fs.readFileSync(asset);
const gltf = await new GLTFLoader().parseAsync(
  source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  '',
);

const game = {
  scene: new THREE.Scene(),
  state: 'playing',
  deathmatch: false,
  log() {},
  audio: { play() {} },
  rounds: { phase: 'live', bomb: { planted: false } },
  effects: null,
  raycastShot() { return null; },
  damagePlayer() {},
  notifyKill() {},
};
game.map = buildDustShortMapFromScene(game, gltf.scene);
game.physics = new PhysicsWorld(game.map.colliders, game.map.slopes);

const ctSpawn = game.map.spawns.CT[0];
const tSpawn = game.map.spawns.T[0];
game.player = {
  isPlayer: true,
  alive: true,
  team: 'CT',
  health: 100,
  pos: new THREE.Vector3(ctSpawn.x, ctSpawn.y, ctSpawn.z),
  vel: new THREE.Vector3(),
  radius: 0.3,
  height: 1.8,
  eyeHeight: 1.62,
};
game.hasLineOfSight = (from, to) => {
  const delta = to.clone().sub(from);
  const distance = delta.length();
  if (distance < 1e-6) return true;
  const hit = game.physics.raycast(from, delta.multiplyScalar(1 / distance), distance);
  return !hit || hit.t >= distance - 0.025;
};

const bots = new BotManager(game);
bots.spawnAll({ botsCT: 0, botsT: 1, difficulty: 'normal', teamSize: 2 });
assert.equal(bots.bots.length, 1);
const bot = bots.bots[0];

assert.equal(bot.team, 'T');
assert.equal(bot.radius, 0.3, 'Dust Short bot must use the imported-map narrow collision hull');
assert.equal(bot.height, 1.8, 'Dust Short bot must use the imported-map calibrated height');
assert.ok(
  Math.hypot(bot.pos.x - tSpawn.x, bot.pos.z - tSpawn.z) < 1e-6,
  'Dust Short must preserve its measured single T spawn instead of applying random ring offset',
);

const originalFallbackGoal = bots._fallbackGoal;
bots._fallbackGoal = () => assert.fail('Dust Short aim navigation must never call _fallbackGoal()');
const goal = bots._computeGoal(bot);
bots._fallbackGoal = originalFallbackGoal;
const ctNode = bots.nav.nodes.find((node) => node.tags?.includes('spawn:CT'));
const tNode = bots.nav.nodes.find((node) => node.tags?.includes('spawn:T'));
assert.ok(ctNode && tNode, 'Dust Short bot navigation needs measured spawn waypoints');
for (const authored of game.map.waypoints) {
  const runtime = bots.nav.byId.get(authored.id);
  assert.ok(runtime, `missing runtime nav node ${authored.id}`);
  const expected = [...new Set(authored.links || [])]
    .filter((id) => id !== authored.id && bots.nav.byId.has(id))
    .sort((a, b) => a - b);
  const actual = runtime.neighbors.map((node) => node.id).sort((a, b) => a - b);
  assert.deepEqual(actual, expected,
    `Dust Short runtime nav must preserve authored directed links for node ${authored.id}`);
}
assert.equal(goal.kind, 'hunt', 'Dust Short aim mode must use its dedicated duel goal');
assert.ok(Math.hypot(goal.x - ctNode.x, goal.z - ctNode.z) < 1e-6,
  'Dust Short duel goal must anchor to the enemy spawn waypoint');
assert.equal(
  bots._dustShortSegmentSupported(bot, 11.732, -21.3),
  false,
  'scaled historic live fall location must be rejected as an unsupported direct route',
);

// Every edge emitted by the triangle-derived builder is already proven
// traversable for the Dust Short hull. Bot guards must accept those same edges
// in both directions instead of applying a stricter, synthetic support rule.
let directedNavEdges = 0;
for (const from of bots.nav.nodes) {
  for (const to of from.neighbors) {
    directedNavEdges++;
    bot.pos.set(from.x, from.y, from.z);
    assert.equal(
      bots._dustShortSegmentSupported(bot, to.x, to.z),
      true,
      `bot support guard rejected physical nav edge ${from.id}->${to.id}`,
    );
  }
}
assert.ok(directedNavEdges > 100, "navigation must contain physically validated links");
bot.pos.set(tSpawn.x, tSpawn.y, tSpawn.z);

const startNav = bots.nav.byId.get(tNode.id);
const goalNav = bots.nav.byId.get(ctNode.id);
const tToCtRoute = startNav && goalNav ? bots._astar(startNav.index, goalNav.index) : null;
const ctToTRoute = startNav && goalNav ? bots._astar(goalNav.index, startNav.index) : null;
const graphConnected = !!(tToCtRoute?.length && ctToTRoute?.length);
assert.ok(graphConnected,"both spawn directions must be reachable; no skipped trials");

const SIM_SECONDS = 20;
const DT = 0.02;
const ticks = Math.round(SIM_SECONDS / DT);
const startDistance = Math.hypot(bot.pos.x - ctSpawn.x, bot.pos.z - ctSpawn.z);
let minDistance = startDistance;
let minY = bot.pos.y;
let maxUnsupportedStreak = 0;
let unsupportedStreak = 0;
let movedDistance = 0;
let previousX = bot.pos.x;
let previousZ = bot.pos.z;

for (let tick = 0; tick < ticks; tick++) {
  bots.update(DT);

  assert.ok(Number.isFinite(bot.pos.x) && Number.isFinite(bot.pos.y) && Number.isFinite(bot.pos.z),
    `bot position became non-finite at tick ${tick}`);
  assert.ok(bot.pos.y > -0.25,
    `Dust Short bot fell below the playable map at tick ${tick}: y=${bot.pos.y.toFixed(3)}`);

  const stepDistance = Math.hypot(bot.pos.x - previousX, bot.pos.z - previousZ);
  movedDistance += stepDistance;
  previousX = bot.pos.x;
  previousZ = bot.pos.z;
  minY = Math.min(minY, bot.pos.y);
  minDistance = Math.min(minDistance, Math.hypot(bot.pos.x - ctSpawn.x, bot.pos.z - ctSpawn.z));

  const supported = game.physics.hasGroundBelow(bot, 0, 0, 0.7);
  unsupportedStreak = supported ? 0 : unsupportedStreak + 1;
  maxUnsupportedStreak = Math.max(maxUnsupportedStreak, unsupportedStreak);
}

assert.ok(minY > -0.25, `20s live simulation left playable support: minY=${minY.toFixed(3)}`);
assert.ok(maxUnsupportedStreak <= 2,
  `bot spent ${maxUnsupportedStreak} consecutive ticks without physical ground support`);
if (graphConnected) {
  assert.ok(minDistance < startDistance - 1,
    `connected Dust Short nav should advance toward CT: start=${startDistance.toFixed(2)} min=${minDistance.toFixed(2)}`);
}

// Exercise each builder edge through BotManager movement itself. This catches
// cases where path/support guards approve a link statically but freeze before
// PhysicsWorld can traverse it.
for (const from of bots.nav.nodes) {
  for (const to of from.neighbors) {
    bot.pos.set(from.x, from.y, from.z);
    bot.vel.set(0, 0, 0);
    bot.onGround = true;
    bot.path = null;
    bot.pathIndex = 0;
    bot.repathTimer = 0;
    bot.detourTimer = 0;
    bot.avoidTimer = 0;
    bot._chkPos.copy(bot.pos);
    let best = Math.hypot(to.x - bot.pos.x, to.z - bot.pos.z);
    for (let tick = 0; tick < 140 && best >= 0.3; tick++) {
      bots._moveToward(bot, to.x, to.z, 2.4, DT);
      best = Math.min(best, Math.hypot(to.x - bot.pos.x, to.z - bot.pos.z));
      assert.ok(bot.pos.y > -0.25, `bot fell traversing nav edge ${from.id}->${to.id}`);
      assert.equal(
        game.physics.overlapsWorld(game.physics.bodyBox(bot), 0.01),
        null,
        `bot penetrated world traversing nav edge ${from.id}->${to.id}`,
      );
    }
    assert.ok(best < 0.35, `bot movement froze ${best.toFixed(3)}m before nav edge ${from.id}->${to.id}`);
  }
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function runDirectedNavigationTrial(team, seed, seconds = 60) {
  const enemyTeam = team === 'T' ? 'CT' : 'T';
  const start = game.map.spawns[team][0];
  const target = game.map.spawns[enemyTeam][0];
  game.player.team = enemyTeam;
  // Empty destination for the path-only trial; a live player occupies a physical hull there.
  game.player.alive = false;
  game.player.pos.set(target.x, target.y, target.z);
  game.player.vel.set(0, 0, 0);

  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  const manager = new BotManager(game);
  try {
    manager.spawnAll({
      botsCT: team === 'CT' ? 1 : 0,
      botsT: team === 'T' ? 1 : 0,
      difficulty: 'normal',
      teamSize: 2,
    });
    const trialBot = manager.bots[0];
    assert.ok(trialBot, `${team} navigation trial failed to spawn bot`);
    assert.ok(Math.hypot(trialBot.pos.x - start.x, trialBot.pos.z - start.z) < 1e-6,
      `${team} navigation trial did not start at measured spawn`);

    // Isolate pathfinding/movement from combat strafing while preserving the
    // exact LOS function used by direct navigation checks.
    manager._canSee = () => false;
    let trialMinDistance = Math.hypot(trialBot.pos.x - target.x, trialBot.pos.z - target.z);
    let trialMinY = trialBot.pos.y;
    let trialUnsupportedStreak = 0;
    let trialMaxUnsupportedStreak = 0;
    let reachedAt = null;
    const trace=[];

    for (let tick = 0; tick < Math.round(seconds / DT); tick++) {
      manager.update(DT);
      trialMinDistance = Math.min(
        trialMinDistance,
        Math.hypot(trialBot.pos.x - target.x, trialBot.pos.z - target.z),
      );
      trialMinY = Math.min(trialMinY, trialBot.pos.y);
      assert.ok(trialBot.pos.y > -0.25,
        `${team} seed ${seed} fell below playable map at tick ${tick}: y=${trialBot.pos.y.toFixed(3)}`);
      assert.equal(
        game.physics.overlapsWorld(game.physics.bodyBox(trialBot), 0.01),
        null,
        `${team} seed ${seed} penetrated world at tick ${tick}`,
      );
      const supported = game.physics.hasGroundBelow(trialBot, 0, 0, 0.7);
      if(tick%50===0)trace.push({time:tick*DT,pos:trialBot.pos.toArray(),vel:trialBot.vel.toArray(),grounded:trialBot.onGround,supported,
        collision:false,waypoint:trialBot.pathIndex,repathTimer:trialBot.repathTimer,
        replanningReason:trialBot.detourTimer>0?'detour':trialBot.avoidTimer>0?'avoidance':trialBot.path?'route':'route-search'});
      trialUnsupportedStreak = supported ? 0 : trialUnsupportedStreak + 1;
      trialMaxUnsupportedStreak = Math.max(trialMaxUnsupportedStreak, trialUnsupportedStreak);
      if (trialMinDistance < 0.55 && reachedAt===null) reachedAt=tick*DT;
    }

    assert.ok(trialMinY > -0.25, `${team} seed ${seed} left playable support`);
    assert.ok(trialMaxUnsupportedStreak <= 2,
      `${team} seed ${seed} spent ${trialMaxUnsupportedStreak} consecutive ticks unsupported`);
    if(trialMinDistance >= .55) console.log("STUCK",{team,pos:trialBot.pos,vel:trialBot.vel,path:trialBot.path?.slice(trialBot.pathIndex,trialBot.pathIndex+3),state:trialBot.state});
    assert.ok(trialMinDistance < 0.55,
      `${team} seed ${seed} froze before enemy spawn: min distance=${trialMinDistance.toFixed(3)}m`);
    return { team, seed, reachedAt, minDistance: trialMinDistance, trace };
  } finally {
    manager.dispose();
    Math.random = originalRandom;
  }
}

const longTrials = [];
{
  for (const seed of [0x13579bdf, 0x2468ace0, 0x5eed1234]) {
    longTrials.push(runDirectedNavigationTrial('T', seed));
    longTrials.push(runDirectedNavigationTrial('CT', seed ^ 0x9e3779b9));
  }
}

console.log(
  `Dust Short bot navigation OK · ${SIM_SECONDS}s live · graph=${graphConnected ? 'connected' : 'DISCONNECTED'} · ` +
  `${directedNavEdges} directed edges · travel=${movedDistance.toFixed(2)}m · ` +
  `CT distance ${startDistance.toFixed(2)} -> ${minDistance.toFixed(2)} · ` +
  `minY=${minY.toFixed(3)} · longTrials=${longTrials.length}`,
);

fs.mkdirSync('tests/artifacts/dust-short',{recursive:true});
fs.writeFileSync('tests/artifacts/dust-short/nav-traces.json',JSON.stringify(longTrials,null,2));
console.log(JSON.stringify(longTrials.map(({trace,...summary})=>summary)));
bots.dispose();
game.map.dispose();
