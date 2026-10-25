/** Prevent the deploy script from publishing assets outside the requested terms. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPONS } from '../src/weapons.js';
import { WEAPON_ASSETS } from '../src/weapon-assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'docs/v3-asset-manifest.json'), 'utf8'));
const manualQa = JSON.parse(fs.readFileSync(path.join(root, 'docs/weapon-release-qa.json'), 'utf8'));
const blockers = [];
for (const character of characters.targets) {
  if (!character.license || !character.author || !character.source) {
    blockers.push(`${character.team} character is missing attribution or license information`);
  }
}
for (const id of Object.keys(WEAPONS)) {
  if (!WEAPON_ASSETS[id]) blockers.push(`Missing native weapon asset: ${id}`);
}
if (WEAPON_ASSETS.scout?.source !== 'internal:deushima-strike') {
  blockers.push('Scout must use the authorized original model');
}
for (const check of ['firefoxGameplay', 'hardwarePerformance', 'allWeaponsBothTeamsVisualReview', 'deathRespawnAndMultiplayerSwitching']) {
  if (manualQa[check] !== true) blockers.push(`Manual acceptance pending: ${check}`);
}
if (blockers.length) {
  console.error('Deployment is blocked until these release requirements are resolved:');
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log('Release asset and license gate passed');
}
