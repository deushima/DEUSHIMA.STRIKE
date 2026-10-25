import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { ViewModel } from '../src/viewmodel.js';

const camera = new THREE.PerspectiveCamera(90, 16 / 9, .1, 100);
camera.position.set(12, 2, -5); camera.rotation.y = .7; camera.updateMatrixWorld(true);
const game = {camera, state:'playing', player:{alive:true,onGround:true,team:'CT',vel:new THREE.Vector3(),yaw:0}};
const vm = new ViewModel(game); vm.init(); vm.setVisible(true);
assert.equal(vm.root.parent, vm.scene, 'weapon must not intersect world geometry');
for (const id of ['m4a1','ak47','deagle','usp','glock','awp','scout','mp5','m3','xm1014','m249','knife','he','flash','smoke','c4']) {
  vm.setWeapon(id); vm.update(.5,{});
  const model=vm.models.get(id);
  model.group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.geometry.computeBoundingBox();
    assert.ok(mesh.geometry.boundingBox.min.toArray().every(Number.isFinite),id);
    assert.ok(mesh.geometry.boundingBox.max.toArray().every(Number.isFinite),id);
  });
  const muzzle=vm.getMuzzleWorldPosition();
  assert.ok(muzzle.toArray().every(Number.isFinite),id);
  assert.ok(muzzle.distanceTo(camera.position)<3,id+' muzzle remains near player');
}
vm.setWeapon('m4a1');vm.update(.016,{reloading:true,reloadProgress:.5});
const magazine=vm.models.get('m4a1').group.getObjectByName('magazine');
assert.ok(magazine.position.y<magazine.userData.restPosition.y-.09);
vm.update(.016,{reloading:false});assert.equal(magazine.position.y,magazine.userData.restPosition.y);
vm.setScoped(true);assert.equal(vm.root.visible,false);
vm.setScoped(false);assert.equal(vm.root.visible,true);
camera.fov=110;assert.equal(vm.camera.fov,64,'world FOV must not distort the weapon');
vm.dispose();assert.equal(vm.models.size,0);
console.log('viewmodel OK: 16 models, finite geometry, world muzzle, reload reset, scope, independent POV and disposal');
