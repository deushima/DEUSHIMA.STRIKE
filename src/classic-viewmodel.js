/**
 * Viewmodel clásico: malla original del arma GoldSrc convertida a JSON por
 * tools/convert-smds.py. Se renderiza en una segunda escena encima del mundo.
 *
 * El modelo se posiciona con una base GoldSrc (Y adelante, Z arriba) y se
 * ajusta por categoría. Las animaciones por hueso no se usan; el retroceso,
 * el bob y el reload se animan proceduralmente sobre el grupo.
 */
import * as THREE from '../../vendor/three.module.js';

window.__THREE__ = THREE;

const MODEL_BASE = '/assets/cs16/models';
const GOLD = new THREE.Vector3(-1, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

const RIFLES = new Set(['ak47', 'm4a1', 'awp', 'aug', 'famas', 'galil', 'sg552', 'sg550', 'scout', 'g3sg1', 'm249']);
const PISTOLS = new Set(['deagle', 'usp', 'glock', 'fiveseven', 'p228', 'elite']);
const SMGS = new Set(['mp5', 'mac10', 'p90', 'tmp', 'ump45']);
const SHOTGUNS = new Set(['xm1014', 'm3']);
const MODEL_ID = { glock: 'v_glock18' };

function modelFile(id) {
  return MODEL_ID[id] || `v_${id}`;
}

function fallbackPartColor(name) {
  if (/view_finger|view_skin/i.test(name)) return 0xb28b69;
  if (/view_glove/i.test(name)) return 0x263238;
  if (/wood|forearm|buttstock|handle/i.test(name)) return 0x74513a;
  if (/reticle|glass|scope/i.test(name)) return 0x3d5057;
  if (/slide|receiver|barrel|magazine|body|silencer|knife/i.test(name)) return 0x283036;
  return 0x41494b;
}

function poseFor(id, bounds) {
  const lenIn = Math.max(1, bounds?.size?.[1] || 30);
  let target = 0.66;
  let centerX = 0.24;
  let centerY = -0.17;
  let yaw = 0.12;
  if (PISTOLS.has(id)) { target = 0.38; yaw = 0.1; centerX = 0.25; centerY = -0.2; }
  else if (SMGS.has(id)) { target = 0.5; yaw = 0.12; centerX = 0.24; centerY = -0.17; }
  else if (SHOTGUNS.has(id)) { target = 0.6; yaw = 0.12; centerX = 0.24; centerY = -0.16; }
  else if (id === 'knife') { target = 0.3; yaw = 0.25; centerX = 0.27; centerY = -0.18; }
  const scale = target / lenIn;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const half = (lenIn * scale) / 2;
  return {
    scale,
    x: centerX + cx * scale,
    y: centerY - cz * scale,
    z: -0.24 - half - cy * scale,
    yaw,
  };
}

export class ClassicViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / Math.max(1, window.innerHeight), 0.01, 4);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const key = new THREE.DirectionalLight(0xfff1d8, 2.2);
    key.position.set(-1, 2, 2);
    this.scene.add(key);
    this.basis = new THREE.Group();
    this.basis.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0),
      ),
    );
    this.scene.add(this.basis);
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.basis.add(this.root);
    this.loaded = new Map();
    this.currentId = null;
    this.model = null;
    this.kick = 0;
    this.kickVel = 0;
    this.time = 0;
    this._texLoader = new THREE.TextureLoader();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this._bindFire();
  }

  _bindFire() {
    const vm = this.game.weapons?.viewmodel;
    if (vm && !vm._classicPatched) {
      const original = vm.onFire?.bind(vm);
      vm.onFire = (...args) => {
        this.kickVel += 1.5;
        original?.(...args);
      };
      vm._classicPatched = true;
    }
  }

  resize() {
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
  }

  async load(id) {
    if (!id || this.loaded.has(id)) return this.loaded.get(id);
    const res = await fetch(`${MODEL_BASE}/${modelFile(id)}.json`).catch(() => null);
    if (!res || !res.ok) {
      this.loaded.set(id, null);
      return null;
    }
    const data = await res.json();
    const group = new THREE.Group();
    const parts = (data.materials || []).filter((part) => part.positions?.length && part.name !== 'view_skin');
    const firstTextured = parts.find((part) => part.texture);
    const firstMap = firstTextured
      ? await this._texLoader.loadAsync(`${MODEL_BASE}/${firstTextured.texture}`).catch(() => null)
      : null;
    const texturesAvailable = !!firstMap;
    for (const part of parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
      let map = null;
      if (texturesAvailable && part.texture) {
        map = part === firstTextured
          ? firstMap
          : await this._texLoader.loadAsync(`${MODEL_BASE}/${part.texture}`).catch(() => null);
        if (map) {
          map.colorSpace = THREE.SRGBColorSpace;
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.LinearMipmapLinearFilter;
        }
      }
      const mat = new THREE.MeshLambertMaterial({
        map, color: map ? 0xffffff : fallbackPartColor(part.name), side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(geo, mat));
    }
    const item = { group, bounds: data.bounds };
    this.loaded.set(id, item);
    return item;
  }

  async setWeapon(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    this.model = id ? await this.load(id) : null;
    this._bindFire();
    this.root.clear();
    if (this.model) this.root.add(this.model.group);
  }

  render(renderer) {
    const game = this.game;
    if (!game || !['playing', 'roundover'].includes(game.state)) return;
    if (!game.player?.alive) return;
    const w = game.weapons;
    if (!w) return;
    const scoped = !!w.scoped || w.currentId === 'awp' && w.zoomLevel > 0;
    if (scoped) return;
    const id = w.currentId;
    if (id && id !== this.currentId) {
      this.setWeapon(id);
    }
    if (!this.model) return;
    const pose = poseFor(id, this.model.bounds);
    const dt = 0.016;
    this.time += dt;

    // bob + retroceso
    this.kickVel -= this.kick * 38 * dt;
    this.kickVel *= Math.max(0, 1 - 8 * dt);
    this.kick += this.kickVel * dt;
    const speed = Math.hypot(game.player.vel.x, game.player.vel.z);
    const bob = Math.min(1, speed / 5.2);
    const bx = Math.sin(this.time * 9.5) * 0.007 * bob;
    const by = Math.abs(Math.cos(this.time * 9.5)) * 0.006 * bob;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, pose.yaw, 0);
    this.root.scale.setScalar(pose.scale);
    this.basis.position.set(pose.x + bx, pose.y + by - this.kick * 0.012, pose.z + this.kick * 0.02);
    this.root.position.y -= Math.abs(Math.sin(this.time * 5)) * 0.0015 * bob;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose() {
    window.removeEventListener('resize', this._resize);
    this.root.clear();
    this.scene.clear();
  }
}
