/** Prevent the deploy script from publishing assets outside the requested terms. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPONS } from '../src/weapons.js';
import { WEAPON_ASSETS } from '../src/weapon-assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'docs/v3-asset-manifest.json'), 'utf8'));
const blockers = [];
for (const character of characters.targets) {
  if (/\bNC\b|NONCOMMERCIAL/i.test(character.license.replaceAll('-', ' '))) {
    blockers.push(`${character.team} character uses a noncommercial license: ${character.title}`);
  }
}
for (const id of Object.keys(WEAPONS)) {
  if (!WEAPON_ASSETS[id]) blockers.push(`Missing native weapon asset: ${id}`);
}
if (WEAPON_ASSETS.scout?.label.includes('stand-in')) {
  blockers.push('Scout currently uses a Hunting Rifle visual substitute');
}
if (blockers.length) {
  console.error('Deployment is blocked until these release requirements are resolved:');
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  console.log('Release asset and license gate passed');
}
