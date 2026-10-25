/** Runtime art registry. Gameplay statistics remain in weapons.js. */
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

const SOURCE = 'https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack';
const AUTHOR = '3dmodelscc0';
const LICENSE = 'CC0 1.0 Universal';
const MAIA_SOURCE = 'https://maiastudios.itch.io/firearms-kit-free';
const MAIA_AUTHOR = 'Maia Studios';
const MAIA_LICENSE = 'Firearms Kit Free commercial-use grant';

export const WEAPON_ASSETS = Object.freeze({
  ak47: { label: 'AK-47', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0.034, -0.06, -0.05], support: [-0.022, -0.04, -0.44], muzzle: [0, 0.03, -0.74], offset: [0, -0.015, -0.20] },
  m4a1: { label: 'M4A1', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0.034, -0.06, -0.05], support: [-0.022, -0.04, -0.44], muzzle: [0, 0.03, -0.74], offset: [0, -0.015, -0.20] },
  he: { label: 'Frag grenade', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0, -0.05, -0.02], muzzle: [0, -0.01, -0.18], offset: [0, -0.01, -0.12] },
  flash: { label: 'Flashbang', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0, -0.05, -0.02], muzzle: [0, -0.01, -0.18], offset: [0, -0.01, -0.12] },
  smoke: { label: 'Smoke grenade', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0, -0.05, -0.02], muzzle: [0, -0.01, -0.18], offset: [0, -0.01, -0.12] },
  c4: { label: 'C4', source: SOURCE, author: AUTHOR, license: LICENSE, grip: [0.09, -0.03, -0.04], support: [-0.09, -0.03, -0.06], muzzle: [0, 0, -0.3], offset: [0, 0, -0.18] },
  awp: { label: 'AWP', source: MAIA_SOURCE, author: MAIA_AUTHOR, license: MAIA_LICENSE, grip: [0.035, -0.06, -0.05], support: [-0.025, -0.04, -0.42], muzzle: [0, 0.03, -0.69], offset: [0, 0, -0.18] },
  mp5: { label: 'MP5', source: MAIA_SOURCE, author: MAIA_AUTHOR, license: MAIA_LICENSE, grip: [0.032, -0.055, -0.045], support: [-0.02, -0.03, -0.30], muzzle: [0, 0.03, -0.40], offset: [0, 0, -0.16] },
  usp: { label: 'USP', source: MAIA_SOURCE, author: MAIA_AUTHOR, license: MAIA_LICENSE, grip: [0.03, -0.062, -0.03], support: [-0.028, -0.078, -0.035], muzzle: [0, 0.05, -0.21], offset: [0, 0, -0.11] },
  xm1014: { label: 'Auto Shotgun', source: MAIA_SOURCE, author: MAIA_AUTHOR, license: MAIA_LICENSE, grip: [0.034, -0.06, -0.05], support: [-0.022, -0.04, -0.42], muzzle: [0, 0.04, -0.63], offset: [0, 0, -0.17] },
  m3: { label: 'Pump Shotgun', source: MAIA_SOURCE, author: MAIA_AUTHOR, license: MAIA_LICENSE, grip: [0.034, -0.06, -0.05], support: [-0.022, -0.04, -0.43], muzzle: [0, 0.04, -0.80], offset: [0, 0, -0.17] },
  scout: { label: 'Scout (original stylized model)', source: 'internal:deushima-strike', author: 'DEUSHIMA STRIKE', license: 'Original project art', grip: [0.035, -0.06, -0.05], support: [-0.025, -0.04, -0.41], muzzle: [0, 0.033, -0.96], offset: [0, 0, -0.18] },
  deagle: { label: 'Desert Eagle', source: 'https://opengameart.org/content/desert-eagle-0', author: 'SirDraco65', license: LICENSE, grip: [0.03, -0.062, -0.03], support: [-0.028, -0.078, -0.035], muzzle: [0, 0.05, -0.20], offset: [0, 0, -0.11] },
  glock: { label: 'Glock-18', source: 'https://opengameart.org/content/high-poly-glock-18-no-textures', author: 'locarem', license: LICENSE, grip: [0.03, -0.062, -0.03], support: [-0.028, -0.078, -0.035], muzzle: [0, 0.05, -0.20], offset: [0, 0, -0.11] },
  knife: { label: 'Combat Knife', source: 'https://opengameart.org/content/combat-knife-0', author: 'Aharabada / Simon Lübeß; textures by Yughues', license: LICENSE, grip: [0.028, -0.05, 0.02], muzzle: [0, 0, -0.31], offset: [0.035, 0.025, -0.04], rotation: [0, 0.8, -0.08] },
  m249: { label: 'M249 (original stylized model)', source: 'internal:deushima-strike', author: 'DEUSHIMA STRIKE', license: 'Original project art', grip: [0.036, -0.062, -0.05], support: [-0.025, -0.045, -0.45], muzzle: [0, 0.04, -0.95], offset: [0, 0, -0.16] },
});

const cache = new Map();
const loader = new GLTFLoader();

export function hasNativeWeaponAsset(id) {
  return Object.hasOwn(WEAPON_ASSETS, id);
}

export function loadWeaponModel(id, role = 'view') {
  if (!hasNativeWeaponAsset(id)) return Promise.resolve(null);
  if (role !== 'view' && role !== 'world') throw new Error(`Unknown weapon model role: ${role}`);
  const path = `/assets/weapons/${id}-${role}.glb`;
  if (!cache.has(path)) {
    cache.set(path, loader.loadAsync(path).then((gltf) => {
      const scene = gltf.scene;
      let meshCount = 0;
      scene.traverse((part) => { if (part.isMesh) meshCount++; });
      if (!meshCount) throw new Error(`Empty weapon model: ${path}`);
      return scene;
    }).catch((error) => {
      cache.delete(path);
      throw error;
    }));
  }
  return cache.get(path).then((scene) => scene.clone(true));
}
