# Weapon models and first-person rendering

The local game and public build now use the same original procedural viewmodels in `src/viewmodel.js`.

- Chamfered bodies, curved AK magazine, cylindrical upper receivers, muzzle crowns, trigger guards, ejection ports, sights, handguard ribs, slide serrations and scope details.
- Contoured gloves, separate fingers, wrist cuffs and tapered sleeves.
- A small deterministic surface-grain texture generated in code; no external weapon models or textures.
- Independent 64-degree viewmodel camera, separate depth pass and controlled lighting. World FOV changes do not stretch the weapon and nearby walls do not clip it.
- Category-specific positioning; compact rear stocks leave hands and target area visible.
- Slide recoil and magazine movement reuse the existing firing/reload state. Weapon damage, spread, timings and network authority are unchanged.
- World-space muzzle effects are transformed through the player's camera, despite rendering the weapon in a separate scene.

`tests/viewmodel.test.mjs` checks all 16 model variants, finite geometry, muzzle transforms, reload reset, scope visibility, independent FOV and cleanup. Browser captures exercise M4A1, AK-47, Desert Eagle, AWP and knife; representative models have roughly 1,000–3,100 triangles.

The online test's release check now waits for 120 actual physics ticks instead of 1.2 seconds of wall-clock time, so software-rendered browsers still verify a full simulated settling period. Jump count, grounded state and released input remain required.

The static build includes the already integrated menu music and writes `version.json` with the Git commit for deployment verification.

Validation: full npm test suite and static build passed; real two-client online E2E passed including 30-jump chains, release, damage, rounds, rematch and disconnect.
`nReal four-client 2v2 E2E on AIM_FORGE also passed: remote equipment, damage, team rounds, match end and all four clients returning to the rematch lobby, with no browser errors.
