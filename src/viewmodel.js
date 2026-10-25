/**
 * First-person weapon presentation, native models, and articulated POV arms.
 *
 * Procedural geometry remains a loading and asset-failure fallback. A dedicated scene and
 * camera keep the weapon perspective stable. WeaponSystem drives the rig through
 * setWeapon / onFire / onKnife / onThrow / setVisible / setScoped.
 */
import * as THREE from '../vendor/three.module.js';
import { clamp, expDamp, rand } from './core/utils.js';
import { hasNativeWeaponAsset, loadWeaponModel, WEAPON_ASSETS } from './weapon-assets.js';
import { loadPovArms } from './pov-arms.js';

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function reloadMagazineTravel(progress) {
  const out = smoothstep(0.17, 0.37, progress);
  const back = 1 - smoothstep(0.54, 0.76, progress);
  return out * back;
}

function stdMat(color, opts = {}) {
  const c = new THREE.Color(color);
  const material = new THREE.MeshStandardMaterial({
    color: c,
    metalness: opts.metalness ?? 0.2,
    roughness: opts.roughness ?? 0.6,
    emissive: c.clone().multiplyScalar(opts.emissive ?? 0.22),
    flatShading: false,
  });
  return material;
}

function buildMaterials() {
  const materials = {
    metal: stdMat(0x78818b, { metalness: 0.28, roughness: 0.4, emissive: 0.06 }),
    metalDark: stdMat(0x505a65, { metalness: 0.18, roughness: 0.55, emissive: 0.06 }),
    polymer: stdMat(0x353c42, { metalness: 0.08, roughness: 0.85, emissive: 0.05 }),
    wood: stdMat(0x9a6636, { metalness: 0.04, roughness: 0.9, emissive: 0.06 }),
    woodDark: stdMat(0x6b4322, { metalness: 0.04, roughness: 0.92, emissive: 0.05 }),
    olive: stdMat(0x656b4a, { metalness: 0.12, roughness: 0.8, emissive: 0.05 }),
    tan: stdMat(0xaa9b7b, { metalness: 0.06, roughness: 0.9, emissive: 0.06 }),
    blade: stdMat(0xe0e5ea, { metalness: 0.9, roughness: 0.18, emissive: 0.28 }),
    grip: stdMat(0x303234, { metalness: 0.08, roughness: 0.95, emissive: 0.18 }),
    glove: stdMat(0x575046, { metalness: 0.04, roughness: 0.95, emissive: 0.06 }),
    sleeve: stdMat(0x5a6c7c, { metalness: 0.02, roughness: 0.95, emissive: 0.05 }),
    brass: stdMat(0xd2a94f, { metalness: 0.88, roughness: 0.28, emissive: 0.2 }),
    accent: stdMat(0xab4034, { metalness: 0.3, roughness: 0.6, emissive: 0.2 }),
    green: stdMat(0x5c714c, { metalness: 0.18, roughness: 0.7, emissive: 0.2 }),
    gray: stdMat(0x888e94, { metalness: 0.3, roughness: 0.65, emissive: 0.05 }),
    scopeGlass: new THREE.MeshStandardMaterial({
      color: 0x1a3a48,
      metalness: 0.3,
      roughness: 0.12,
      emissive: new THREE.Color(0x143039),
    }),
  };
  const pixels = new Uint8Array(64 * 64 * 4);
  let seed = 1701;
  for (let i = 0; i < 64 * 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 205 + (seed % 45);
    pixels.set([value, value, value, 255], i * 4);
  }
  const grain = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(12, 12);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.magFilter = THREE.LinearFilter; grain.needsUpdate = true;
  for (const key of ['metal', 'metalDark', 'polymer', 'grip', 'glove', 'sleeve', 'wood', 'woodDark']) materials[key].map = grain;
  return materials;
}

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.weaponRoot = null;
    this.muzzleAnchor = null;
    this.flashMesh = null;
    this.models = new Map();
    this.materials = null;
    this.currentId = 'knife';

    this.time = 0;
    this.visible = true;
    this.userHidden = false;
    this.scoped = false;

    this.kick = 0;
    this.flashT = 0;
    this.deploy = 1;
    this.deployDuration = 0.34;
    this.knifeT = 0;
    this.throwT = 0;
    this.cycleT = 0;

    this.idleX = 0;
    this.idleY = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastYaw = 0;
    this.lookSwayX = 0;

    this.basePos = new THREE.Vector3(0.18, -0.18, -0.36);
    this.baseRot = new THREE.Euler(0.015, 0.13, -0.025);
    this._team = null;
    this.armsByTeam = new Map();
    this.armLoads = new Set();
  }

  init() {
    if (this.root) return;
    const camera = this.game.camera;
    if (!camera) return;
    this.materials = buildMaterials();

    this.root = new THREE.Group();
    this.root.name = 'cs16-viewmodel';
    this.root.position.copy(this.basePos);
    this.root.rotation.copy(this.baseRot);
    this.root.scale.setScalar(0.88);
    this.root.renderOrder = 20;
    this.root.frustumCulled = false;
    // Separate camera: stable weapon perspective, independent of world FOV,
    // and no intersection with nearby level geometry.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(camera.aspect < 1.2 ? 72 : 64, camera.aspect || 16 / 9, 0.01, 5);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xe2e9f0, 0x68635b, 2.5));
    const keyLight = new THREE.DirectionalLight(0xfff2df, 2.4);
    keyLight.position.set(-2, 3, 2); this.scene.add(keyLight);

    // Small warm light rig attached to the camera so the viewmodel reads clearly even in
    // dark tunnels (CS 1.6 models were lit separately from the world).
    this.viewLight = new THREE.PointLight(0xffefdc, 1.1, 3, 1);
    this.viewLight.position.set(0.35, 0.42, 0.18);
    this.scene.add(this.viewLight);
    this.fillLight = new THREE.PointLight(0xb5cee5, 0.65, 3, 1);
    this.fillLight.position.set(-0.35, -0.15, 0.08);
    this.scene.add(this.fillLight);

    this.weaponRoot = new THREE.Group();
    this.weaponRoot.name = 'viewmodel-weapon';
    this.root.add(this.weaponRoot);

    this.muzzleAnchor = new THREE.Object3D();
    this.root.add(this.muzzleAnchor);

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd280,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Mesh(new THREE.CircleGeometry(0.085, 8), flashMat);
    this.flashMesh.visible = false;
    this.flashMesh.renderOrder = 25;
    this.flashMesh.frustumCulled = false;
    this.root.add(this.flashMesh);

    this.setWeapon('knife');
    this.setVisible(false);
  }

  // --- model helpers -------------------------------------------------------

  _group() {
    return new THREE.Group();
  }

  _box(w, h, d, mat) {
    const bevel = Math.min(0.005, w * 0.12, h * 0.12, d * 0.12);
    const shape = new THREE.Shape();
    const x = w / 2 - bevel, y = h / 2 - bevel;
    shape.moveTo(-x, -y); shape.lineTo(x, -y); shape.lineTo(x, y);
    shape.lineTo(-x, y); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: d - bevel * 2, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    geometry.translate(0, 0, -d / 2 + bevel);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.userData.dimensions = [w, h, d];
    return mesh;
  }

  _cyl(r, h, mat, seg = 10) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  _cone(r, h, mat, seg = 8) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
    return mesh;
  }

  _place(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    return mesh;
  }

  _addHand(g, x, y, z, rotX = 0, mirror = false, withArm = true) {
    const M = this.materials, sign = mirror ? -1 : 1;
    const rig = new THREE.Group();
    rig.name = 'hand-rig';
    g.add(rig);
    const hand = new THREE.Group();
    hand.name = mirror ? 'support-hand' : 'trigger-hand';
    hand.position.set(x, y, z); hand.rotation.x = rotX;
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.glove);
    palm.scale.set(0.029, 0.031, 0.038); hand.add(palm);
    // Individually articulated silhouettes, leather knuckles and wrist cuff.
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.022, 2, 6), M.glove);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(-0.019 + i * 0.012, 0.007, -0.037);
      hand.add(finger);
      const pad = this._box(0.009, 0.006, 0.014, M.grip);
      pad.position.set(-0.019 + i * 0.012, 0.027, -0.023);
      hand.add(pad);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.025, 2, 6), M.glove);
    thumb.position.set(-sign * 0.027, -0.005, -0.008);
    thumb.rotation.z = sign * 0.55; hand.add(thumb);
    rig.add(hand);
    if (withArm) {
      const cuff = this._box(0.059, 0.056, 0.028, M.grip);
      cuff.position.set(x, y - 0.014, z + 0.047); cuff.rotation.x = 0.35; rig.add(cuff);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.047, 0.22, 10), M.sleeve);
      arm.position.set(x + sign * 0.025, y - 0.068, z + 0.13);
      arm.rotation.set(1.05, 0, -sign * 0.18); rig.add(arm);
    }
    return hand;
  }

  _details(g, id, muzzle) {
    const M = this.materials;
    const pistol = ['deagle', 'usp', 'glock'].includes(id);
    const rifle = ['ak47', 'm4a1', 'mp5', 'awp', 'scout', 'm3', 'xm1014', 'm249'].includes(id);
    if (pistol || rifle) {
      const bore = new THREE.Mesh(new THREE.CircleGeometry(pistol ? 0.008 : 0.007, 12), M.grip);
      bore.rotation.y = Math.PI; bore.position.copy(muzzle); bore.position.z -= 0.002; g.add(bore);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(pistol ? 0.011 : 0.01, 0.003, 6, 12), M.metal);
      crown.position.copy(muzzle); g.add(crown);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.004, 5, 12), M.metalDark);
      guard.rotation.y = Math.PI / 2; guard.scale.set(1.2, 0.8, 1);
      guard.position.set(0, -0.048, pistol ? -0.13 : -0.115); g.add(guard);
      const port = this._box(0.003, 0.019, pistol ? 0.035 : 0.068, M.grip);
      port.position.set(pistol ? 0.025 : 0.032, 0.04, pistol ? -0.2 : -0.16); g.add(port);
      const bolt = this._box(0.004, 0.009, pistol ? 0.027 : 0.052, M.metal);
      bolt.position.copy(port.position); bolt.position.x += 0.002; g.add(bolt);
      for (const z of [-0.08, -0.26]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 8), M.metal);
        pin.rotation.z = Math.PI / 2; pin.position.set(pistol ? 0.025 : 0.033, 0.012, z); g.add(pin);
      }
    }
    if (pistol) {
      for (let i = 0; i < 6; i++) {
        const serration = this._box(0.002, 0.028, 0.0025, M.grip);
        serration.position.set(0.025, 0.045, -0.108 - i * 0.007); g.add(serration);
      }
      const rear = this._box(0.035, 0.011, 0.012, M.metalDark);
      rear.position.set(0, 0.083, -0.11); g.add(rear);
    }
    if (id === 'm4a1' || id === 'mp5') {
      for (let i = 0; i < 9; i++) {
        const rib = this._cyl(0.029, 0.004, M.grip, 12);
        rib.position.set(0, 0.018, -0.345 - i * 0.018); g.add(rib);
      }
      if (id === 'm4a1') {
        const carry = this._box(0.024, 0.012, 0.13, M.metalDark);
        carry.position.set(0, 0.114, -0.19); g.add(carry);
        for (const z of [-0.13, -0.25]) {
          const post = this._box(0.024, 0.03, 0.012, M.metalDark);
          post.position.set(0, 0.1, z); g.add(post);
        }
        const sight = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 5, 10), M.metalDark);
        sight.position.set(0, 0.063, -0.57); g.add(sight);
      }
    }
    if (id === 'ak47') {
      const dustCover = this._cyl(0.032, 0.265, M.metal);
      dustCover.scale.y = 1; dustCover.scale.z = 0.6;
      dustCover.position.set(0, 0.064, -0.20); g.add(dustCover);
      const selector = this._box(0.004, 0.008, 0.075, M.metal);
      selector.position.set(0.034, 0.017, -0.115); selector.rotation.x = -0.12; g.add(selector);
      const gas = this._cyl(0.009, 0.22, M.metalDark);
      gas.position.set(0, 0.067, -0.46); g.add(gas);
      for (let i = 0; i < 4; i++) {
        const vent = this._box(0.003, 0.008, 0.02, M.woodDark);
        vent.position.set(0.027, 0.031, -0.36 - i * 0.031); g.add(vent);
      }
    }
    if (id === 'awp' || id === 'scout') {
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.023, 12), M.metalDark);
      turret.position.set(0, 0.132, -0.24); g.add(turret);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 6), M.metalDark);
      knob.position.set(0.061, 0.015, -0.1); g.add(knob);
      for (const z of [-0.19, -0.29]) {
        const band = this._cyl(0.028, 0.014, M.metal);
        band.position.set(0, 0.095, z); g.add(band);
      }
    }
    g.traverse(part => {
      if (part.name === 'magazine' || part.name === 'slide') part.userData.restPosition = part.position.clone();
    });
  }

  // --- weapon builders -----------------------------------------------------

  _buildWeapon(id) {
    const g = this._group();
    const M = this.materials;
    let muzzle = new THREE.Vector3(0, 0.03, -0.4);
    switch (id) {
      case 'knife': {
        g.add(this._place(this._box(0.028, 0.036, 0.105, M.grip), 0, -0.018, -0.02));
        g.add(this._place(this._box(0.052, 0.013, 0.02, M.metalDark), 0, 0.0, -0.088));
        const bladeProfile = new THREE.Shape();
        bladeProfile.moveTo(-0.095, -0.02); bladeProfile.lineTo(-0.27, -0.018);
        bladeProfile.lineTo(-0.345, 0.014); bladeProfile.lineTo(-0.245, 0.026);
        bladeProfile.lineTo(-0.095, 0.026); bladeProfile.closePath();
        const bladeGeo = new THREE.ExtrudeGeometry(bladeProfile, {depth:0.004, bevelEnabled:true, bevelSize:0.003, bevelThickness:0.002, bevelSegments:1, steps:1});
        bladeGeo.rotateY(-Math.PI / 2);
        const blade = new THREE.Mesh(bladeGeo, M.blade); g.add(blade);
        this._addHand(g, 0.028, -0.05, 0.02, 0.22);
        muzzle.set(0, 0.004, -0.33);
        break;
      }
      case 'glock':
      case 'usp':
      case 'deagle': {
        const deagle = id === 'deagle';
        const slideLen = deagle ? 0.225 : 0.175;
        const slideH = deagle ? 0.062 : 0.052;
        const slide = this._place(
          this._box(0.048, slideH, slideLen, deagle ? M.metal : M.metalDark),
          0,
          0.048,
          -0.1 - slideLen / 2,
        );
        slide.name = 'slide';
        g.add(slide);
        g.add(this._place(this._box(0.043, 0.036, slideLen * 0.92, M.polymer), 0, 0.008, -0.1 - slideLen * 0.46));
        const grip = this._place(this._box(0.041, 0.118, 0.062, deagle ? M.polymer : M.grip), 0, -0.046, -0.062);
        grip.rotation.x = 0.26;
        g.add(grip);
        g.add(this._place(this._box(0.016, 0.012, 0.05, M.metalDark), 0, -0.022, -0.15));
        if (deagle) {
          g.add(this._place(this._box(0.03, 0.012, 0.03, M.metal), 0, 0.086, -0.09));
          g.add(this._place(this._cyl(0.014, 0.045, M.metal), 0, 0.048, -0.1 - slideLen - 0.012));
        }
        const sight = this._place(this._box(0.012, 0.014, 0.02, M.brass), 0, 0.078 + (deagle ? 0.004 : 0), -0.1 - slideLen + 0.02);
        g.add(sight);
        this._addHand(g, 0.03, -0.062, -0.03, 0.3);
        this._addHand(g, -0.028, -0.078, -0.035, 0.42, true, false);
        muzzle.set(0, 0.048, -0.1 - slideLen - 0.03);
        break;
      }
      case 'mp5': {
        g.add(this._place(this._box(0.056, 0.078, 0.24, M.metalDark), 0, 0.02, -0.2));
        g.add(this._place(this._cyl(0.013, 0.16, M.metal), 0, 0.032, -0.39));
        g.add(this._place(this._box(0.045, 0.05, 0.16, M.polymer), 0, 0.012, -0.34));
        const mag = this._place(this._box(0.034, 0.16, 0.055, M.metalDark), 0, -0.088, -0.19);
        mag.rotation.x = -0.18;
        mag.name = 'magazine';
        g.add(mag);
        const grip = this._place(this._box(0.036, 0.09, 0.05, M.grip), 0, -0.062, -0.055);
        grip.rotation.x = 0.3;
        g.add(grip);
        g.add(this._place(this._box(0.026, 0.055, 0.03, M.metalDark), 0, 0.005, 0.02));
        g.add(this._place(this._box(0.036, 0.05, 0.1, M.polymer), 0, 0.0, 0.06));
        g.add(this._place(this._box(0.014, 0.02, 0.03, M.metal), 0, 0.075, -0.25));
        g.add(this._place(this._box(0.01, 0.03, 0.01, M.metal), 0, 0.09, -0.12));
        g.add(this._place(this._box(0.01, 0.03, 0.01, M.metal), 0, 0.09, -0.29));
        this._addHand(g, 0.032, -0.055, -0.045, 0.28);
        this._addHand(g, -0.02, -0.03, -0.31, -0.15, true, false);
        muzzle.set(0, 0.032, -0.47);
        break;
      }
      case 'ak47':
      case 'm4a1': {
        const wood = id === 'ak47';
        const recvMat = wood ? M.metalDark : M.metalDark;
        g.add(this._place(this._box(0.052, 0.047, 0.24, recvMat), 0, -0.003, -0.16));
        const upper = this._cyl(0.029, 0.29, M.metalDark, 12);
        upper.scale.y = 0.78; upper.position.set(0, 0.038, -0.19); g.add(upper);
        const forearm = wood ? this._box(0.052, 0.052, 0.19, M.wood) : this._cyl(0.028, 0.19, M.polymer, 12);
        g.add(this._place(forearm, 0, 0.018, -0.42));
        g.add(this._place(this._cyl(0.011, 0.26, M.metal), 0, 0.03, -0.61));
        const mag = this._place(this._box(0.043, 0.15, 0.075, M.metalDark), 0, -0.1, -0.2);
        if (wood) {
          const outline = new THREE.Shape();
          outline.moveTo(-0.035, 0.07); outline.lineTo(0.035, 0.07);
          outline.quadraticCurveTo(0.038, -0.04, 0.085, -0.12);
          outline.lineTo(0.025, -0.145); outline.quadraticCurveTo(-0.035, -0.055, -0.035, 0.07);
          mag.geometry.dispose();
          mag.geometry = new THREE.ExtrudeGeometry(outline, {depth:0.04, bevelEnabled:true, bevelSize:0.002, bevelThickness:0.002, bevelSegments:1, curveSegments:5, steps:1});
          mag.geometry.translate(0, 0, -0.02); mag.geometry.rotateY(Math.PI / 2);
        }
        mag.rotation.x = -0.28;
        mag.name = 'magazine';
        g.add(mag);
        const grip = this._place(this._box(0.038, 0.1, 0.052, M.grip), 0, -0.07, -0.06);
        grip.rotation.x = 0.3;
        g.add(grip);
        g.add(this._place(this._box(0.045, 0.055, 0.08, wood ? M.wood : M.polymer), 0, 0.008, 0.0));
        if (wood) {
          g.add(this._place(this._box(0.02, 0.03, 0.05, M.metalDark), 0, 0.075, -0.12));
          g.add(this._place(this._box(0.012, 0.028, 0.02, M.metal), 0, 0.085, -0.18));
        } else {
          g.add(this._place(this._box(0.03, 0.024, 0.16, M.metalDark), 0, 0.077, -0.22));
          g.add(this._place(this._box(0.012, 0.032, 0.012, M.metal), 0, 0.1, -0.15));
        }
        this._addHand(g, 0.034, -0.06, -0.05, 0.28);
        this._addHand(g, -0.022, -0.04, -0.44, -0.12, true, false);
        muzzle.set(0, 0.03, -0.74);
        break;
      }
      case 'awp':
      case 'scout': {
        const awp = id === 'awp';
        g.add(this._place(this._box(0.06, 0.085, 0.36, awp ? M.olive : M.gray), 0, 0.018, -0.2));
        g.add(this._place(this._box(0.048, 0.048, 0.18, awp ? M.olive : M.polymer), 0, 0.014, -0.44));
        g.add(this._place(this._cyl(0.012, 0.34, M.metal), 0, 0.028, -0.68));
        if (awp) g.add(this._place(this._cyl(0.016, 0.05, M.metalDark), 0, 0.028, -0.86));
        const scope = this._place(this._cyl(0.026, 0.19, M.metalDark), 0, 0.095, -0.24);
        g.add(scope);
        g.add(this._place(this._cyl(0.031, 0.025, M.metal), 0, 0.095, -0.33));
        g.add(this._place(this._cyl(0.031, 0.02, M.metal), 0, 0.095, -0.15));
        const lens = this._place(this._cyl(0.027, 0.006, M.scopeGlass), 0, 0.095, -0.145);
        g.add(lens);
        g.add(this._place(this._box(0.012, 0.03, 0.012, M.metalDark), 0, 0.062, -0.12));
        g.add(this._place(this._box(0.012, 0.03, 0.012, M.metalDark), 0, 0.062, -0.34));
        const bolt = this._place(this._box(0.012, 0.012, 0.06, M.metal), 0.045, 0.03, -0.13);
        bolt.rotation.z = 0.5;
        g.add(bolt);
        const mag = this._place(this._box(0.04, 0.1, 0.07, M.metalDark), 0, -0.075, -0.18);
        mag.rotation.x = -0.18;
        mag.name = 'magazine';
        g.add(mag);
        const grip = this._place(this._box(0.038, 0.1, 0.052, M.polymer), 0, -0.068, -0.055);
        grip.rotation.x = 0.32;
        g.add(grip);
        g.add(this._place(this._box(0.048, 0.075, 0.08, awp ? M.olive : M.polymer), 0, 0.0, 0.0));

        this._addHand(g, 0.034, -0.058, -0.05, 0.3);
        this._addHand(g, -0.022, -0.04, -0.45, -0.12, true, false);
        muzzle.set(0, 0.028, awp ? -0.9 : -0.84);
        break;
      }
      case 'xm1014':
      case 'm3': {
        const wood = id === 'm3';
        g.add(this._place(this._box(0.058, 0.082, 0.32, wood ? M.woodDark : M.polymer), 0, 0.018, -0.2));
        g.add(this._place(this._cyl(0.019, 0.4, M.metal), 0, 0.04, -0.55));
        g.add(this._place(this._cyl(0.013, 0.34, M.metalDark), 0, -0.005, -0.52));
        const pump = this._place(this._box(0.056, 0.058, 0.16, wood ? M.wood : M.polymer), 0, 0.0, -0.46);
        g.add(pump);
        g.add(this._place(this._box(0.012, 0.012, 0.05, M.metalDark), 0, 0.062, -0.35));
        const grip = this._place(this._box(0.038, 0.095, 0.052, wood ? M.wood : M.polymer), 0, -0.065, -0.06);
        grip.rotation.x = 0.3;
        g.add(grip);
        g.add(this._place(this._box(0.045, 0.065, 0.08, wood ? M.wood : M.polymer), 0, 0.0, 0.0));
        this._addHand(g, 0.034, -0.058, -0.05, 0.3);
        this._addHand(g, -0.02, -0.03, -0.44, -0.1, true, false);
        muzzle.set(0, 0.04, -0.76);
        break;
      }
      case 'm249': {
        g.add(this._place(this._box(0.085, 0.1, 0.36, M.olive), 0, 0.025, -0.2));
        g.add(this._place(this._box(0.06, 0.06, 0.2, M.olive), 0, 0.02, -0.44));
        g.add(this._place(this._cyl(0.014, 0.34, M.metal), 0, 0.035, -0.68));
        g.add(this._place(this._box(0.11, 0.13, 0.13, M.olive), 0.075, -0.05, -0.2));
        g.add(this._place(this._box(0.03, 0.04, 0.02, M.brass), 0.075, -0.02, -0.14));
        const grip = this._place(this._box(0.04, 0.1, 0.055, M.grip), 0, -0.075, -0.05);
        grip.rotation.x = 0.3;
        g.add(grip);
        g.add(this._place(this._box(0.05, 0.065, 0.08, M.polymer), 0, 0.0, 0.0));
        g.add(this._place(this._box(0.012, 0.16, 0.012, M.metalDark), 0, -0.07, -0.5));
        g.add(this._place(this._box(0.012, 0.16, 0.012, M.metalDark), 0.02, -0.07, -0.5));
        g.add(this._place(this._box(0.02, 0.05, 0.02, M.metalDark), 0, 0.09, -0.1));
        this._addHand(g, 0.036, -0.062, -0.05, 0.3);
        this._addHand(g, -0.025, -0.045, -0.45, -0.12, true, false);
        muzzle.set(0, 0.035, -0.86);
        break;
      }
      case 'he':
      case 'flash':
      case 'smoke': {
        const mat = id === 'he' ? M.green : id === 'flash' ? M.gray : M.tan;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), mat);
        body.position.set(0, -0.01, -0.12);
        g.add(body);
        g.add(this._place(this._cyl(0.022, 0.03, M.metalDark), 0, 0.05, -0.12));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 10), M.metal);
        ring.position.set(0, 0.07, -0.12);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        g.add(this._place(this._box(0.05, 0.012, 0.012, M.brass), 0, 0.04, -0.12));
        this._addHand(g, 0.0, -0.05, -0.02, 0.4);
        muzzle.set(0, -0.01, -0.18);
        break;
      }
      case 'c4': {
        g.add(this._place(this._box(0.18, 0.1, 0.26, M.tan), 0, 0.0, -0.18));
        g.add(this._place(this._box(0.1, 0.02, 0.12, M.metalDark), 0, 0.06, -0.18));
        g.add(this._place(this._box(0.06, 0.006, 0.06, M.accent), 0.032, 0.072, -0.18));
        g.add(this._place(this._box(0.045, 0.008, 0.03, M.gray), -0.03, 0.072, -0.18));
        for (let i = 0; i < 3; i++) {
          const wire = this._place(this._cyl(0.004, 0.05, i === 0 ? M.accent : M.metalDark), -0.04 + i * 0.03, 0.065, -0.29);
          wire.rotation.x = 0;
          wire.rotation.z = Math.PI / 2;
          g.add(wire);
        }
        this._addHand(g, 0.09, -0.03, -0.04, 0.3);
        this._addHand(g, -0.09, -0.03, -0.06, 0.3, true, false);
        muzzle.set(0, 0.0, -0.3);
        break;
      }
      default: {
        g.add(this._place(this._box(0.05, 0.07, 0.22, M.metalDark), 0, 0.02, -0.2));
        this._addHand(g, 0.03, -0.05, -0.02, 0.25);
        muzzle.set(0, 0.02, -0.32);
        break;
      }
    }
    this._details(g, id, muzzle);
    g.userData.muzzle = muzzle;
    return g;
  }

  _ensureModel(id) {
    let entry = this.models.get(id);
    if (entry) return entry;
    const group = this._buildWeapon(id);
    group.visible = false;
    group.traverse((child) => {
      child.frustumCulled = false;
      if (child.isMesh) child.renderOrder = 21;
      if (child.name === 'hand-rig' && this.armsByTeam.get(this._team)) child.visible = false;
    });
    this.weaponRoot.add(group);
    entry = { group, muzzle: group.userData.muzzle || new THREE.Vector3(0, 0.02, -0.4) };
    this.models.set(id, entry);
    if (hasNativeWeaponAsset(id) && typeof window !== 'undefined') {
      loadWeaponModel(id, 'view').then((native) => {
        if (this.models.get(id) !== entry) return;
        native.name = 'native-weapon';
        native.position.set(...WEAPON_ASSETS[id].offset);
        if (WEAPON_ASSETS[id].rotation) native.rotation.set(...WEAPON_ASSETS[id].rotation);
        native.traverse((part) => {
          part.frustumCulled = false;
          if (part.isMesh) part.renderOrder = 21;
          if (['magazine', 'slide', 'bolt', 'pump', 'feed_cover'].includes(part.name)) {
            part.userData.restPosition = part.position.clone();
            part.userData.restRotation = part.rotation.clone();
            part.userData.motionScale = 1 / (native.getObjectByName(id)?.scale.x || 1);
          }
        });
        for (const child of group.children) child.visible = child.name === 'hand-rig' && !this.armsByTeam.get(this._team);
        group.add(native);
        entry.native = native;
        entry.muzzle.set(...WEAPON_ASSETS[id].muzzle).add(native.position);
        if (this.currentId === id) this.muzzleAnchor?.position.copy(entry.muzzle);
      }).catch((error) => console.warn(`[viewmodel] ${id} asset unavailable; procedural fallback retained`, error));
    }
    return entry;
  }

  // --- public API ----------------------------------------------------------

  _ensureArms(team) {
    const active = this.armsByTeam.get(team);
    if (active) {
      for (const [key, rig] of this.armsByTeam) rig.scene.visible = key === team;
      for (const { group } of this.models.values()) group.traverse((part) => { if (part.name === 'hand-rig') part.visible = false; });
      return;
    }
    for (const rig of this.armsByTeam.values()) rig.scene.visible = false;
    for (const { group } of this.models.values()) group.traverse((part) => { if (part.name === 'hand-rig') part.visible = true; });
    if (this.armLoads.has(team) || typeof window === 'undefined') return;
    this.armLoads.add(team);
    loadPovArms(team).then((rig) => {
      if (!this.root) return;
      this.root.add(rig.scene);
      this.armsByTeam.set(team, rig);
      for (const [key, other] of this.armsByTeam) other.scene.visible = key === this._team;
      for (const { group } of this.models.values()) {
        group.traverse((part) => { if (part.name === 'hand-rig') part.visible = false; });
      }
    }).catch((error) => console.warn(`[viewmodel] ${team} POV arms unavailable; procedural fallback retained`, error))
      .finally(() => this.armLoads.delete(team));
  }

  _poseArms(ctx) {
    const rig = this.armsByTeam.get(this._team);
    if (!rig) return;
    const group = this.models.get(this.currentId)?.group;
    if (!group) return;
    this.root.updateWorldMatrix(true, true);
    const triggerHand = group.getObjectByName('trigger-hand');
    const supportHand = group.getObjectByName('support-hand');
    const trigger = triggerHand?.getWorldPosition(new THREE.Vector3())
      || this.root.localToWorld(new THREE.Vector3(0.04, -0.06, -0.05));
    const support = supportHand?.getWorldPosition(new THREE.Vector3())
      || this.root.localToWorld(new THREE.Vector3(-0.30, -0.24, 0.08));
    const magazine = this.models.get(this.currentId)?.native?.getObjectByName('magazine')
      || group.getObjectByName('magazine');
    if (magazine && ctx.reloading && supportHand) {
      const rp = clamp(ctx.reloadProgress ?? 0, 0, 1);
      const approach = smoothstep(0.04, 0.24, rp);
      const returnToGrip = 1 - smoothstep(0.76, 0.95, rp);
      support.lerp(magazine.getWorldPosition(new THREE.Vector3()), approach * returnToGrip);
    }
    const rightPole = this.root.localToWorld(new THREE.Vector3(0.42, -0.42, 0.22));
    const leftPole = this.root.localToWorld(new THREE.Vector3(-0.42, -0.42, 0.12));
    rig.pose(trigger, support, rightPole, leftPole);
  }

  setWeapon(id) {
    if (!this.root) return;
    const entry = this._ensureModel(id);
    for (const [, model] of this.models) model.group.visible = false;
    entry.group.visible = true;
    this.currentId = id;
    const pistol = ['deagle', 'usp', 'glock'].includes(id);
    this.basePos.set(pistol ? 0.16 : 0.20, pistol ? -0.17 : -0.17, pistol ? -0.38 : -0.45);
    this.baseRot.set(0.015, pistol ? 0.12 : 0.24, -0.025);
    if (this.muzzleAnchor) this.muzzleAnchor.position.copy(entry.muzzle);
    this.deploy = 0;
    this.kick = 0;
    this.flashT = 0;
    this.knifeT = 0;
    this.throwT = 0;
    this.cycleT = 0;
    if (this.flashMesh) this.flashMesh.visible = false;
  }

  onFire() {
    this.kick = Math.min(1.6, this.kick + 1);
    this.cycleT = 1;
    this.flashT = 0.055;
    if (this.flashMesh) {
      this.flashMesh.rotation.z = Math.random() * Math.PI * 2;
      this.flashMesh.scale.setScalar(rand(0.7, 1.15));
      this.flashMesh.visible = true;
    }
  }

  onKnife() {
    this.knifeT = 1;
  }

  onThrow() {
    this.throwT = 1;
  }

  setVisible(v) {
    this.visible = !!v;
    if (this.root) this.root.visible = this.visible && !this.scoped;
  }

  setScoped(v) {
    this.scoped = !!v;
    if (this.root) this.root.visible = this.visible && !this.scoped;
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()) {
    if (!this.muzzleAnchor) return target.copy(this.basePos);
    this.muzzleAnchor.updateWorldMatrix(true, false);
    this.muzzleAnchor.getWorldPosition(target);
    this.game.camera.updateWorldMatrix(true, false);
    return target.applyMatrix4(this.game.camera.matrixWorld);
  }

  update(dt, ctx = {}) {
    if (!this.root) return;
    this.time += dt;
    const game = this.game;
    const p = game.player;

    const team = ctx.team || p?.team;
    if (team && team !== this._team) {
      this._team = team;
      this._ensureArms(team);
      if (this.materials) {
        this.materials.sleeve.color.set(team === 'T' ? 0x4a3b23 : 0x2b3947);
        this.materials.sleeve.emissive.set(team === 'T' ? 0x17120a : 0x0d1318);
      }
    }

    // Timers / spring-ish decay.
    this.kick = expDamp(this.kick, 0, 16, dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0 && this.flashMesh) this.flashMesh.visible = false;
    }
    const deployTarget = 1;
    this.deploy = expDamp(this.deploy, deployTarget, 14, dt);
    if (this.deploy > 0.999) this.deploy = 1;

    if (this.knifeT > 0) this.knifeT = Math.max(0, this.knifeT - dt / 0.3);
    if (this.throwT > 0) this.throwT = Math.max(0, this.throwT - dt / 0.42);
    if (this.cycleT > 0) this.cycleT = Math.max(0, this.cycleT - dt / 0.38);

    const bobAmount = p?.bobAmount ?? 0;
    const bobTime = p?.bobTime ?? 0;
    const speed = ctx.speed ?? p?.getVelocity2D?.() ?? 0;
    const run = clamp(speed / 5.6, 0, 1);

    // Idle breathing + walk bob.
    this.idleX = Math.sin(this.time * 1.7) * 0.0024;
    this.idleY = Math.cos(this.time * 1.15) * 0.0018;
    const bobX = Math.sin(bobTime * 0.5) * 0.011 * bobAmount * (0.4 + run);
    const bobY = -Math.abs(Math.cos(bobTime)) * 0.011 * bobAmount * (0.4 + run);

    // Strafe sway from horizontal velocity relative to the view.
    let side = 0;
    if (p?.vel) {
      const yaw = p.yaw || 0;
      side = p.vel.x * Math.cos(yaw) - p.vel.z * Math.sin(yaw);
    }
    this.swayX = expDamp(this.swayX, -clamp(side, -6, 6) * 0.004, 10, dt);
    this.swayY = expDamp(this.swayY, Math.abs(clamp(side, -6, 6)) * 0.0012, 10, dt);

    // Mouse look sway (fake lag using accumulated yaw delta).
    const yaw = p?.yaw ?? 0;
    let yawDelta = yaw - this.lastYaw;
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    this.lastYaw = yaw;
    this.lookSwayX = expDamp(this.lookSwayX, clamp(yawDelta * -2.4, -0.05, 0.05), 12, dt);

    let px = this.basePos.x * Math.min(1, (this.game.camera.aspect || 1.78) / 1.45) + this.idleX + bobX + this.swayX + this.lookSwayX;
    let py = this.basePos.y + this.idleY + bobY + this.swayY;
    let pz = this.basePos.z;
    let rx = this.baseRot.x;
    let ry = this.baseRot.y;
    let rz = this.baseRot.z;

    // Deploy (from lowered position).
    const lower = 1 - clamp(this.deploy, 0, 1);
    px -= lower * 0.05;
    py -= lower * 0.19;
    rx += lower * 0.62;
    rz -= lower * 0.18;

    // Recoil kick.
    pz += this.kick * 0.045;
    py += this.kick * 0.018;
    rx += this.kick * 0.11;
    rz += this.kick * 0.03;

    // Keep the ejection port and manipulated part in frame while the weapon
    // rotates toward the support hand.
    const reloading = !!ctx.reloading;
    if (reloading) {
      const rp = clamp(ctx.reloadProgress ?? 0, 0, 1);
      const s = Math.sin(rp * Math.PI);
      const pistol = ['deagle', 'usp', 'glock'].includes(this.currentId);
      // Raise the weapon while the magazine is detached so the manipulated
      // part and the support hand stay inside the first-person camera.
      py += s * (pistol ? 0.08 : 0.12);
      pz += s * 0.025;
      rx += s * (pistol ? 0.12 : 0.27);
      rz += s * (pistol ? 0.13 : 0.20);
      py += Math.sin(rp * 34) * 0.0015 * s;
    }

    // Knife swing.
    if (this.knifeT > 0) {
      const ph = 1 - this.knifeT;
      const s = Math.sin(clamp(ph, 0, 1) * Math.PI);
      px -= s * 0.16;
      py += s * 0.02;
      ry += s * 0.75;
      rz -= s * 0.55;
      rx -= s * 0.35;
    }

    // Grenade throw.
    if (this.throwT > 0) {
      const ph = 1 - this.throwT;
      const s = Math.sin(clamp(ph, 0, 1) * Math.PI);
      py += s * 0.075;
      pz -= s * 0.06;
      rx -= s * 0.4;
      py += this.kick * 0.01;
    }

    const current = this.models.get(this.currentId)?.group;
    const rp = reloading ? clamp(ctx.reloadProgress ?? 0, 0, 1) : 0;
    const magazineTravel = reloading ? reloadMagazineTravel(rp) : 0;
    const cycle = this.cycleT > 0 ? Math.sin((1 - this.cycleT) * Math.PI) : 0;
    current?.traverse(part => {
      const rest = part.userData.restPosition;
      if (!rest) return;
      part.position.copy(rest);
      if (part.userData.restRotation) part.rotation.copy(part.userData.restRotation);
      const scale = part.userData.motionScale || 1;
      if (part.name === 'magazine') {
        const pistol = ['usp', 'glock', 'deagle'].includes(this.currentId);
        if (this.currentId === 'm249') {
          part.position.x -= magazineTravel * 0.11 * scale;
          part.position.y -= magazineTravel * 0.035 * scale;
        } else {
          if (pistol) part.position.x -= magazineTravel * 0.055 * scale;
          part.position.y -= magazineTravel * (pistol ? 0.09 : 0.16) * scale;
          part.position.z += magazineTravel * (pistol ? 0.015 : 0.035) * scale;
        }
      }
      if (part.name === 'feed_cover' && reloading) {
        part.rotation.x -= smoothstep(0.10, 0.31, rp) * (1 - smoothstep(0.75, 0.92, rp)) * 0.8;
      }
      if (part.name === 'slide') {
        const rack = reloading ? smoothstep(0.81, 0.90, rp) * (1 - smoothstep(0.93, 1, rp)) : 0;
        part.position.z += (this.kick * 0.026 + rack * 0.045) * scale;
      }
      if (part.name === 'bolt') {
        const rack = reloading ? smoothstep(0.79, 0.87, rp) * (1 - smoothstep(0.92, 0.99, rp)) : 0;
        part.position.z += (cycle * 0.075 + rack * 0.09) * scale;
      }
      if (part.name === 'pump') {
        part.position.z += cycle * 0.14 * scale;
      }
    });
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);
    this._poseArms(ctx);

    // Muzzle flash quad.
    if (this.flashMesh && this.flashT > 0) {
      const m = this.models.get(this.currentId);
      if (m) {
        this.flashMesh.position.copy(m.muzzle);
        this.flashMesh.position.z -= 0.03;
        this.flashMesh.visible = true;
      }
    }

    if (p?.crouching) this.root.position.y -= 0.012;
    if (p && !p.onGround && p.alive) this.root.position.y += 0.012;
  }

  render(renderer) {
    if (!this.root?.visible || !this.scene || !['playing', 'roundover'].includes(this.game.state)) return;
    const aspect = this.game.camera.aspect;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 1.2 ? 72 : 64;
      this.camera.updateProjectionMatrix();
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  dispose() {
    if (this.root) {
      // Cached GLB geometry is shared by all scene clones. Disposing a previous
      // viewmodel must not invalidate a later round or a second game instance.
      const sharedGeometry = new Set();
      for (const { native } of this.models.values()) {
        native?.traverse((part) => { if (part.isMesh) sharedGeometry.add(part.geometry); });
      }
      for (const { scene } of this.armsByTeam.values()) {
        scene.traverse((part) => { if (part.isMesh) sharedGeometry.add(part.geometry); });
      }
      this.root.traverse((child) => {
        if (child.isMesh && !sharedGeometry.has(child.geometry)) {
          child.geometry?.dispose?.();
        }
      });
      this.root.removeFromParent();
    }
    if (this.materials) {
      const maps = new Set(Object.values(this.materials).map(mat => mat.map).filter(Boolean));
      for (const map of maps) map.dispose();
      for (const mat of Object.values(this.materials)) mat.dispose?.();
      this.materials = null;
    }
    if (this.flashMesh) {
      this.flashMesh.geometry?.dispose?.();
      this.flashMesh.material?.dispose?.();
      this.flashMesh = null;
    }
    this.viewLight?.removeFromParent?.();
    this.fillLight?.removeFromParent?.();
    this.viewLight = null;
    this.fillLight = null;
    this.models.clear();
    this.armsByTeam.clear();
    this.armLoads.clear();
    this.root = null;
    this.weaponRoot = null;
    this.muzzleAnchor = null;
  }
}

