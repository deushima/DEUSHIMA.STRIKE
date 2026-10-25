/**
 * Versioned movement presets.
 *
 * GoldSrc reference values are converted with 40 GoldSrc units = 1 world unit.
 * CS16_1V1_AUTOBHOP is the production movement for AIM matches.
 * CS16_VANILLA exists only for diagnostics/comparison.
 */
export const GOLDSRC_UNITS_PER_WORLD = 40;
export const DEFAULT_MATCH_MOVEMENT_PRESET = 'CS16_1V1_AUTOBHOP';
export const DIAGNOSTIC_MOVEMENT_PRESET = 'CS16_VANILLA';

const u = (value) => value / GOLDSRC_UNITS_PER_WORLD;

const BASE = Object.freeze({
  version: '3.1.0',
  fixedPhysicsTick: true,
  fixedStep: 1 / 100,
  maxFrameCatchup: 0.1,
  maxPhysicsStepsPerFrame: 12,
  gravity: u(800),
  accelerate: 5,
  airAccelerate: 10,
  friction: 4,
  edgeFriction: 2,
  stopSpeed: u(75),
  edgeProbeForward: u(16),
  edgeProbeDrop: u(34),
  airWishCap: u(30),
  jumpVelocity: u(268.3281573),
  maxVelocity: u(2000),
  stepHeight: u(18),
  walkSpeedFactor: 0.52,
  crouchSpeedFactor: 0.34,
  jumpBuffer: 0.1,
  airStrafeEnabled: true,
  allowBhopSpeedGain: true,
  preserveHorizontalMomentumOnAutoJump: true,
  noArtificialGroundSpeedClampDuringBhop: true,
});

export const MOVEMENT_PRESETS = Object.freeze({
  CS16_VANILLA: Object.freeze({
    ...BASE,
    id: 'CS16_VANILLA',
    autoBhopEnabled: false,
    jumpWhileHeldOnLanding: false,
    removeClassicBhopSpeedPenalty: false,
  }),
  CS16_1V1_AUTOBHOP: Object.freeze({
    ...BASE,
    id: 'CS16_1V1_AUTOBHOP',
    autoBhopEnabled: true,
    jumpWhileHeldOnLanding: true,
    removeClassicBhopSpeedPenalty: true,
  }),
});

export function movementPreset(id = DEFAULT_MATCH_MOVEMENT_PRESET) {
  return MOVEMENT_PRESETS[id] || MOVEMENT_PRESETS[DEFAULT_MATCH_MOVEMENT_PRESET];
}

export function movementPresetForGame(game) {
  // Explicit diagnostic override is allowed for QA only. Normal AIM/duel/online
  // play always falls back to the production autobhop preset.
  const diagnostic = game?.movementPresetOverride;
  if (diagnostic === DIAGNOSTIC_MOVEMENT_PRESET) return MOVEMENT_PRESETS.CS16_VANILLA;
  return MOVEMENT_PRESETS.CS16_1V1_AUTOBHOP;
}
