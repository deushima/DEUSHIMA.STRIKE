/** Rigged first-person arms derived from WRiKS's CC0 WRAD ARMS. */
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from '../vendor/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function loadPovArms(team) {
  const variant = team === 'T' ? 'leet' : 'sas';
  if (!cache.has(variant)) {
    cache.set(variant, loader.loadAsync(`/assets/weapons/arms-${variant}.glb`).then(({ scene }) => {
      // GLTFLoader sanitizes punctuation in bone names for animation binding.
      if (!scene.getObjectByName('wristr') || !scene.getObjectByName('wristl')) {
        throw new Error(`Invalid arm skeleton: ${variant}`);
      }
      return scene;
    }).catch((error) => {
      cache.delete(variant);
      throw error;
    }));
  }
  return cache.get(variant).then((scene) => createArmRig(cloneSkeleton(scene)));
}

function createArmRig(scene) {
  scene.name = 'pov-arms';
  scene.position.set(0, -0.28, -0.04);
  scene.scale.setScalar(0.11);
  scene.traverse((part) => {
    part.frustumCulled = false;
    if (part.isMesh) part.renderOrder = 22;
  });
  const joints = {};
  for (const side of ['r', 'l']) {
    joints[side] = {
      upper: scene.getObjectByName(`bicep${side}`),
      forearm: scene.getObjectByName(`forearm${side}`),
      wrist: scene.getObjectByName(`wrist${side}`),
    };
    if (Object.values(joints[side]).some((bone) => !bone)) throw new Error(`Missing arm joint: ${side}`);
  }
  const rest = [];
  scene.traverse((part) => { if (part.isBone) rest.push([part, part.position.clone(), part.quaternion.clone()]); });
  const fingers = [];
  for (const side of ['r', 'l']) {
    for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      for (let segment = 1; segment <= 3; segment++) {
        const bone = scene.getObjectByName(`finger_${name}${segment}${side}`);
        if (bone) fingers.push({ bone, segment, name });
      }
    }
  }

  function turnToward(bone, child, target) {
    scene.updateWorldMatrix(true, true);
    const origin = bone.getWorldPosition(V());
    const from = child.getWorldPosition(V()).sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
    const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
    const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parentRotation.multiply(rotation).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
    bone.updateWorldMatrix(false, true);
  }

  function aim(side, target, pole) {
    const { upper, forearm, wrist } = joints[side];
    scene.updateWorldMatrix(true, true);
    const start = upper.getWorldPosition(V());
    const middle = forearm.getWorldPosition(V());
    const end = wrist.getWorldPosition(V());
    const first = start.distanceTo(middle), second = middle.distanceTo(end);
    const offset = target.clone().sub(start);
    const distance = THREE.MathUtils.clamp(offset.length(), Math.abs(first - second) + 0.001, first + second - 0.001);
    const direction = offset.normalize();
    const bend = pole.clone().sub(start);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    const along = (first * first - second * second + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, first * first - along * along));
    turnToward(upper, forearm, start.clone().addScaledVector(direction, along).addScaledVector(bend, height));
    turnToward(forearm, wrist, start.clone().addScaledVector(direction, distance));
  }

  return {
    scene,
    pose(trigger, support, triggerPole, supportPole) {
      for (const [bone, position, quaternion] of rest) {
        bone.position.copy(position);
        bone.quaternion.copy(quaternion);
      }
      scene.updateWorldMatrix(true, true);
      aim('r', trigger, triggerPole);
      aim('l', support, supportPole);
      for (const { bone, segment, name } of fingers) {
        bone.rotateX(name === 'thumb' ? (segment === 1 ? -0.25 : -0.38) : segment === 1 ? -0.55 : -0.72);
      }
      scene.updateWorldMatrix(true, true);
    },
    getGripErrors(trigger, support) {
      scene.updateWorldMatrix(true, true);
      return {
        trigger: joints.r.wrist.getWorldPosition(V()).distanceTo(trigger),
        support: joints.l.wrist.getWorldPosition(V()).distanceTo(support),
      };
    },
  };
}
