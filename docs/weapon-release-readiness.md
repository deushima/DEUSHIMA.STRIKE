# Weapon system release check — 2026-10-25

Status: **local candidate; public release blocked**. The release gate (`node scripts/check-release-readiness.mjs`) exits with code 1 because the Scout still uses Maia Studios' Hunting Rifle as a documented visual substitute. It is an authorized model but does not have the Steyr Scout silhouette required for final acceptance. A [free CC BY Steyr Scout](https://sketchfab.com/3d-models/steyr-scout-low-poly-674bbc04a68944bcbfb45cfc44fde651) exists, but its download requires a Sketchfab account.

## Verified locally

- `npm test`: passed, including 16 weapon IDs, 32 GLBs, two POV arm rigs, gameplay/movement regression tests and independent health/armor pulse tests.
- `npm run build:static`: passed; output 96.8 MB. The archived noncommercial Jellypack CT model and its source directory are absent from `dist`. The active CT model is BAMEN's CC BY 4.0 soldier; `character-credits.html` and `docs/v3-asset-manifest.json` identify the author, source, intermediary and adaptation.
- `npm run test:characters` with Chrome headless and SwiftShader: passed 40 pose combinations across both teams, five aim angles, standing/crouching, rifle/pistol; wrist grip targets were within 0.015 world units. Repeated character creation/disposal left WebGL geometry/textures at 30/17.
- `npm run test:weapons:browser` with Chrome headless and SwiftShader: all 32 weapon GLBs had meshes; both POV rigs loaded with 50 bones each; CT and T characters loaded; no uncaught page errors. At 40% reload progress, AK-47, M4A1, AWP, Scout, MP5, USP, Desert Eagle and M249 magazines projected inside the POV camera. This test checks framing, not polygon-to-polygon hand collision.
- Visual inspection in the local game confirmed the CC BY CT tactical soldier and Desert Eagle extraction pose. Raising the weapon during reload fixed the Desert Eagle magazine disappearing below the camera.
- The in-game **Opciones → Acerca del juego → WEAPONS CREATORS** section was opened and displayed the authors, links and full-credits link.
- `git diff --check`: passed. No local personal path or apparent API key was found in the new source/manifest files.

## Still to verify

- **Scout silhouette:** replace the Hunting Rifle substitute with an authorized Steyr Scout model or an original equivalent, then update the asset manifest, credits and browser checks.
- **Firefox:** the installed Firefox headless process failed to capture a page (`RenderCompositorSWGL failed mapping default framebuffer`); Playwright's stock Firefox launch also exited before connection. Firefox gameplay has not been verified.
- **Hardware performance:** software WebGL measured a 115 ms median frame both before and after loading the weapon set. This indicates no measured regression in that environment, but is not evidence of playable hardware FPS.
- **Final visual QA:** inspect reloads and hand/model intersection across all weapons and both teams in a hardware browser, plus death/respawn and multiplayer weapon switching.
- **Public build:** no commit has been pushed and no Vercel deployment of this candidate has been made. Public reload and cross-browser acceptance remain pending.
