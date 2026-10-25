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
  scene.position.set(0, -0.32, -0.10);
  scene.scale.setScalar(0.12);
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
  scene.traverse((part) => { if (part.isBone) rest.push([part, part.position.clone(), part.quaternion.clone(), part.scale.clone()]); });
  scene.updateWorldMatrix(true, true);
  // Derive a palm frame from the actual skeleton. IK alone positions a wrist;
  // it does not orient the palm or close the fingers around an object.
  const palms = {};
  for (const side of ['r', 'l']) {
    const wrist = joints[side].wrist;
    const origin = wrist.getWorldPosition(V());
    const middle = scene.getObjectByName(`finger_middle1${side}`).getWorldPosition(V());
    const next = scene.getObjectByName(`finger_middle2${side}`).getWorldPosition(V());
    const index = scene.getObjectByName(`finger_index1${side}`).getWorldPosition(V());
    const pinky = scene.getObjectByName(`finger_pinky1${side}`).getWorldPosition(V());
    const forward = middle.clone().sub(origin).normalize();
    const normal = index.sub(pinky).cross(forward).normalize();
    if (normal.dot(next.sub(middle)) < 0) normal.negate();
    const inverse = wrist.getWorldQuaternion(new THREE.Quaternion()).invert();
    const localForward = forward.clone().applyQuaternion(inverse);
    const localNormal = normal.clone().applyQuaternion(inverse);
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      localForward.clone().cross(localNormal).normalize(), localForward, localNormal));
    palms[side] = { basis, normal, offset: wrist.worldToLocal(middle.clone()).multiplyScalar(0.48) };
  }
  const fingers = [];
  for (const side of ['r', 'l']) {
    for (const name of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      for (let segment = 1; segment <= 3; segment++) {
        const bone = scene.getObjectByName(`finger_${name}${segment}${side}`);
        if (bone) {
          const direction = V(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
          const axis = direction.cross(palms[side].normal).normalize()
            .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
          fingers.push({ bone, segment, name, side, axis });
        }
      }
    }
  }

  function orientPalm(side, target, forward, normal, pole) {
    const { wrist } = joints[side];
    const palm = palms[side];
    const along = forward.clone().normalize();
    const inward = normal.clone().addScaledVector(along, -normal.dot(along)).normalize();
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      along.clone().cross(inward).normalize(), along, inward)).multiply(palm.basis.clone().invert());
    wrist.scale.multiplyScalar(0.70);
    scene.updateWorldMatrix(true, true);
    const offset = palm.offset.clone().multiply(wrist.getWorldScale(V())).applyQuaternion(desired);
    aim(side, target.clone().sub(offset), pole);
    // Spread forearm roll through the source's twist bones instead of twisting
    // the entire sleeve at the wrist seam.
    const current = wrist.getWorldQuaternion(new THREE.Quaternion());
    const delta = desired.clone().multiply(current.clone().invert());
    const axis = wrist.getWorldPosition(V()).sub(joints[side].forearm.getWorldPosition(V())).normalize();
    const projection = axis.clone().multiplyScalar(V(delta.x, delta.y, delta.z).dot(axis));
    const twist = new THREE.Quaternion(projection.x, projection.y, projection.z, delta.w).normalize();
    for (const name of [`forearmTwist0${side}`, `forearmTwist1${side}`]) {
      const bone = scene.getObjectByName(name);
      const fraction = new THREE.Quaternion().slerp(twist, 0.35);
      const world = fraction.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      bone.updateWorldMatrix(false, true);
    }
    wrist.quaternion.copy(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
    wrist.updateWorldMatrix(false, true);
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
    pose(trigger, support, triggerPole, supportPole, orientation) {
      for (const [bone, position, quaternion, scale] of rest) {
        bone.position.copy(position);
        bone.quaternion.copy(quaternion);
        bone.scale.copy(scale);
      }
      scene.updateWorldMatrix(true, true);
      // Keep the open shoulder ends outside the POV frustum while the weapon
      // rises for reload. Anchoring these to the weapon made entire upper arms
      // float into view during reload and deploy.
      for (const [side, target, sign] of [['r', trigger, 1], ['l', support, -1]]) {
        const edge = 0.84;
        const z = Math.min(-0.18, (target.z + edge * target.y) / (1 + edge * edge));
        const position = V(target.x + sign * 0.16, Math.min(target.y - 0.16, z * edge), z);
        const upper = joints[side].upper;
        const shoulder = upper.parent;
        const delta = position.sub(upper.getWorldPosition(V()));
        shoulder.position.copy(shoulder.parent.worldToLocal(shoulder.getWorldPosition(V()).add(delta)));
      }
      scene.updateWorldMatrix(true, true);
      orientPalm('r', trigger, orientation.rightForward, orientation.rightNormal, triggerPole);
      orientPalm('l', support, orientation.leftForward, orientation.leftNormal, supportPole);
      for (const { bone, segment, name, side, axis } of fingers) {
        const curl = name === 'thumb' ? [0.18, 0.38, 0.4][segment - 1]
          : name === 'index' && side === 'r' && orientation.triggerFinger ? [0.30, 0.85, 0.65][segment - 1]
          : [0.90, 1.20, 0.75][segment - 1];
        bone.rotateOnAxis(axis, curl);
      }
      scene.updateWorldMatrix(true, true);
      for (const side of ['r', 'l']) {
        const thumb1 = scene.getObjectByName(`finger_thumb1${side}`);
        const thumb2 = scene.getObjectByName(`finger_thumb2${side}`);
        const thumb3 = scene.getObjectByName(`finger_thumb3${side}`);
        const index1 = scene.getObjectByName(`finger_index1${side}`).getWorldPosition(V());
        const index2 = scene.getObjectByName(`finger_index2${side}`).getWorldPosition(V());
        turnToward(thumb1, thumb2, index1);
        turnToward(thumb2, thumb3, index2);
      }
      scene.updateWorldMatrix(true, true);
    },
    getGripErrors(trigger, support) {
      scene.updateWorldMatrix(true, true);
      return {
        trigger: joints.r.wrist.localToWorld(palms.r.offset.clone()).distanceTo(trigger),
        support: joints.l.wrist.localToWorld(palms.l.offset.clone()).distanceTo(support),
      };
    },
  };
}
