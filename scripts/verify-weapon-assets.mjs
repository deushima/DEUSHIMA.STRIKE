/** Validate every locally hosted weapon asset and its source manifest. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WEAPONS } from '../src/weapons.js';
import { WEAPON_ASSETS } from '../src/weapon-assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = {
  title: 'Free CC0 Guns & Explosives Pack',
  author: '3dmodelscc0',
  authorUrl: 'https://3dmodelscc0.itch.io/',
  sourceUrl: 'https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack',
  licenseName: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceArchiveName: 'Guns&Explosives.rar',
  sourceArchiveSha256: '275679f1f8c7d22aa413c04012571a92e6c7b266ed7174125b64b9d8533f7a1a',
};
const maiaSource = {
  title: 'Firearms Kit Free',
  author: 'Maia Studios',
  authorUrl: 'https://maiastudios.itch.io/',
  sourceUrl: 'https://maiastudios.itch.io/firearms-kit-free',
  licenseName: 'Firearms Kit Free commercial-use grant',
  licenseUrl: 'https://maiastudios.itch.io/firearms-kit-free',
  sourceArchives: {
    awp: { name: 'AWP.zip', sha256: '183914733fc125970f03a0b2b2efec02b3aacf6024f5554f7f2b8ce02c935d31' },
    mp5: { name: 'MP5.zip', sha256: '6d24bfb5144704c2f7f49ec4783f4c30ba7998f4bda34d82a6f2241906808eff' },
    usp: { name: 'USP.zip', sha256: 'cebf6f40203d4fc2a44a588ac37e35bcd62ebe2397c823367848b28d28958c57' },
    xm1014: { name: 'Auto Shotgun.zip', sha256: '84e8f8093b31587c36d67e6244cc32bc69d7dbe2d596c05dc085b9a36a7ef0fc' },
    m3: { name: 'Pump Shotgun.zip', sha256: '52a4276c69757207acd2fa91fbc051b9e2aff6c2dd729f697878d395377b4e21' },
  },
};
const ogaSources = {
  deagle: {
    title: 'Desert Eagle', author: 'SirDraco65', authorUrl: 'https://opengameart.org/users/sirdraco65',
    sourceUrl: 'https://opengameart.org/content/desert-eagle-0', licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceArchiveName: 'desert_eagle_0.zip', sourceArchiveSha256: '599e979d9b01ebdb8b6ca4694b2bd4a93dfce981d83ecf023f01284bf9ee8b6e',
  },
  glock: {
    title: 'High Poly Glock-18 (No-Textures)', author: 'locarem', authorUrl: 'https://opengameart.org/users/locarem',
    sourceUrl: 'https://opengameart.org/content/high-poly-glock-18-no-textures', licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceArchiveName: 'Glock_HighPoly.obj', sourceArchiveSha256: '5437aa4cbacfb9838c2ff06cabb13ccf68779ce8af4652a1672923772f35d089',
  },
  knife: {
    title: 'Combat Knife', author: 'Aharabada / Simon Lübeß; textures by Yughues', authorUrl: 'https://opengameart.org/users/aharabada',
    sourceUrl: 'https://opengameart.org/content/combat-knife-0', licenseName: 'CC0 1.0 Universal',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceArchiveName: 'Knife_1.zip', sourceArchiveSha256: 'b06dc392acd04aa3f8143a0a6bc77631ed018898aa63cb4913f4636986fc6464',
  },
};
const originalSource = {
  title: 'Original DEUSHIMA STRIKE M249 art', author: 'DEUSHIMA STRIKE', authorUrl: 'internal:deushima-strike',
  sourceUrl: 'internal:deushima-strike', licenseName: 'Original project art', licenseUrl: 'internal:deushima-strike',
  sourceScript: 'scripts/create-m249.py',
};
const originalScoutSource = {
  title: 'Original DEUSHIMA STRIKE Scout art', author: 'DEUSHIMA STRIKE', authorUrl: 'internal:deushima-strike',
  sourceUrl: 'internal:deushima-strike', licenseName: 'Original project art', licenseUrl: 'internal:deushima-strike',
  sourceScript: 'scripts/create-scout.py',
};
const sourceFiles = {
  ak47: 'AK-47/AK47.fbx',
  m4a1: 'M4A1/M4A1.fbx',
  he: 'FragGrenade/FragGrenadeModel.fbx',
  flash: 'Flashbang/Flashbang.fbx',
  smoke: 'Smoke_Grenade/Smoke_Grenade.fbx',
  c4: 'C4/C4.fbx',
  awp: 'AWP/BLEND/AWP.blend',
  mp5: 'MP5/BLEND/MP5.blend',
  usp: 'USP/BLEND/USP.blend',
  xm1014: 'Auto Shotgun/BLEND/Auto Shotgun.blend',
  m3: 'Pump Shotgun/BLEND/Pump Shotgun.blend',
  scout: 'scripts/create-scout.py',
  deagle: 'Export/Desert Eagle Export.blend',
  glock: 'Glock_HighPoly.obj',
  knife: 'Knife.obj',
  m249: 'scripts/create-m249.py',
};
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const models = [];
for (const [id, entry] of Object.entries(WEAPON_ASSETS)) {
  if (!WEAPONS[id] || !sourceFiles[id]) throw new Error(`Invalid weapon asset ID: ${id}`);
  const modelSource = id === 'm249' ? originalSource : (id === 'scout' ? originalScoutSource : (ogaSources[id] ?? (maiaSource.sourceArchives[id] ? maiaSource : source)));
  if (entry.source !== modelSource.sourceUrl || entry.author !== modelSource.author || entry.license !== modelSource.licenseName) {
    throw new Error(`Runtime credit mismatch: ${id}`);
  }
  if (modelSource.sourceScript && !fs.existsSync(path.join(root, modelSource.sourceScript))) {
    throw new Error(`Missing original source script: ${modelSource.sourceScript}`);
  }
  const files = {};
  for (const role of ['view', 'world']) {
    const relativePath = `assets/weapons/${id}-${role}.glb`;
    const bytes = fs.readFileSync(path.join(root, relativePath));
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
      throw new Error(`Invalid GLB header: ${relativePath}`);
    }
    const jsonLength = bytes.readUInt32LE(12);
    if (bytes.toString('ascii', 16, 20) !== 'JSON' || jsonLength + 20 > bytes.length) throw new Error(`Invalid GLB JSON: ${relativePath}`);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
    if (gltf.asset?.version !== '2.0' || !gltf.meshes?.length || !gltf.materials?.length || !gltf.images?.length) {
      throw new Error(`Missing mesh or PBR texture: ${relativePath}`);
    }
    if (role === 'view' && ['ak47', 'm4a1', 'awp', 'mp5', 'usp', 'scout', 'deagle'].includes(id) && !gltf.nodes.some((node) => node.name === 'magazine')) {
      throw new Error(`Missing movable magazine: ${relativePath}`);
    }
    if (id === 'scout' && role === 'view') {
      const magazine = gltf.nodes.find((node) => node.name === 'magazine');
      if (!magazine.children?.some((index) => gltf.nodes[index]?.name === 'magazine-floor-plate')) {
        throw new Error(`Scout magazine floor plate must move with magazine: ${relativePath}`);
      }
      if (!gltf.nodes.some((node) => node.name === 'bolt')) throw new Error(`Missing movable Scout bolt: ${relativePath}`);
    }
    files[role] = {
      path: relativePath,
      bytes: bytes.length,
      sha256: digest(bytes),
      meshes: gltf.meshes.length,
      images: gltf.images.length,
    };
  }
  models.push({ id, weapon: WEAPONS[id].name, source: modelSource.title, sourceFile: sourceFiles[id], sourceArchive: modelSource.sourceArchives?.[id] ?? (modelSource.sourceArchiveName ? { name: modelSource.sourceArchiveName, sha256: modelSource.sourceArchiveSha256 } : null), files });
}

const armSource = {
  title: 'WRAD ARMS',
  author: 'WRiKS',
  authorUrl: 'https://wriks.itch.io/',
  sourceUrl: 'https://github.com/wwwriks/wrad-arms',
  licenseName: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceCommit: 'f3987244176c33d2c20d4f9e139980af12684d87',
  sourceGlbSha256: '580efbb0852bf0b41f82dd3e17eafec86b3d2a48f4a7acaa7e64d60e850f565d',
};
const povArms = [];
for (const variant of ['sas', 'leet']) {
  const relativePath = `assets/weapons/arms-${variant}.glb`;
  const bytes = fs.readFileSync(path.join(root, relativePath));
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid arm GLB: ${relativePath}`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  if (gltf.skins?.length !== 1 || !gltf.nodes.some((node) => node.name === 'wrist.r') || !gltf.nodes.some((node) => node.name === 'wrist.l') || gltf.materials?.length !== 3) {
    throw new Error(`Incomplete POV arm rig: ${relativePath}`);
  }
  povArms.push({ variant, path: relativePath, bytes: bytes.length, sha256: digest(bytes), joints: gltf.skins[0].joints.length });
}

const manifest = { schemaVersion: 4, sources: [source, maiaSource, ...Object.values(ogaSources), originalSource, originalScoutSource], models, armSource, povArms };
const manifestPath = path.join(root, 'weapon-asset-manifest.json');
if (process.argv.includes('--write')) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
} else {
  const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) throw new Error('Weapon asset manifest is out of date; run node scripts/verify-weapon-assets.mjs --write');
}
console.log(`Native weapon assets OK: ${models.length} weapon IDs, ${models.length * 2} weapon GLBs, ${povArms.length} arm rigs`);
