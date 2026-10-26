/** Original Dust Short GLB. Uniform scale from measured door height .910m
 * at the former 40x import -> 2.184m at 96x. Source pixels/materials unchanged.
 * Exact triangular collision surfaces feed the existing PhysicsWorld solver. */
import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';
import { TriangleCollider } from '../core/triangle-collider.js';
import { buildTriangleNavigation } from './triangle-navigation.js';
export const DUST_SHORT_MAP_INFO = Object.freeze({
  id: 'dust_short',
  name: 'DUST SHORT',
  displayName: 'DUST SHORT · 1v1',
  mode: 'aim',
  description: 'Dust Short real para duelos 1v1.',
  players: 2,
  targetKills: 10,
  attribution: 'Dust2-short by frostychaos144 · CC-BY-4.0',
});

export const DUST_SHORT_MODEL_URL = '/assets/maps/dust_short.glb';


const loader=new GLTFLoader();
export const DUST_SHORT_SCALE=96;
const MAP_SCALE=DUST_SHORT_SCALE;
// Coordinates in the author's 10x frame, registered against the supplied
// overhead views: CT inside the mosque's cobbled L, T beside the courtyard tire.
export const DUST_SHORT_ANCHORS=Object.freeze({CT:{x:2.0,z:-.15},T:{x:3.2,z:1.875}});
function surfaceForMaterial(materialName = '') {
  const name = materialName.toLowerCase();
  if (/wood|crate/.test(name)) return 'wood';
  if (/metal|mechet/.test(name)) return 'metal';
  if (/ground|sand/.test(name)) return 'sand';
  return 'stone';
}

function triangleAreaAndNormal(a, b, c, normal) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  normal.crossVectors(ab, ac);
  const twiceArea = normal.length();
  if (twiceArea < 1e-8) return 0;
  normal.multiplyScalar(1 / twiceArea);
  return twiceArea * 0.5;
}

function forEachWorldTriangle(root, callback) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const surface = surfaceForMaterial(material?.name || '');
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      const area = triangleAreaAndNormal(a, b, c, normal);
      if (area > 0) callback(a, b, c, normal, area, surface);
    }
  });
}


function prepareImportedMaterials(root) {
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of list) materials.add(material);
  });
  for (const material of materials) {
    if ('metalness' in material) material.metalness = 0.02;
    if ('roughness' in material) material.roughness = Math.max(0.9, Number(material.roughness) || 0);
    if ('envMapIntensity' in material) material.envMapIntensity = 0.2;
    material.needsUpdate = true;
  }
}

function makeLightRig(root) {
  const hemi = new THREE.HemisphereLight(0xd7e7f2, 0x77664d, 1.6);
  hemi.name = 'dust-short:hemi';
  const sun = new THREE.DirectionalLight(0xffe2b7, 2.0);
  sun.name = 'dust-short:sun';
  sun.position.set(-12, 24, 9);
  root.add(hemi, sun);
  return [hemi, sun];
}

function disposeRoot(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const mats = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of mats) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const texture of textures) texture.dispose?.();
  for (const material of materials) material.dispose?.();
  root.removeFromParent();
}


export function buildDustShortMapFromScene(game,root) {
 root.name='map:dust_short';root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.setScalar(MAP_SCALE);root.updateMatrixWorld(true);
 const initial=new THREE.Box3().setFromObject(root,true);root.position.y-=initial.min.y;root.updateMatrixWorld(true);
 prepareImportedMaterials(root);
 const slopes=[];let triangles=0;
 forEachWorldTriangle(root,(a,b,c,n,area,surface)=>{triangles++;if(area>1e-9)slopes.push(new TriangleCollider(a,b,c,n,surface));});
 const hints=Object.fromEntries(Object.entries(DUST_SHORT_ANCHORS).map(([k,p])=>[k,{x:p.x*MAP_SCALE/10,z:p.z*MAP_SCALE/10}]));
 const ground=slopes.filter(s=>s.surface==='sand'&&s.walkable);
 const maxFloorY=Math.max(...ground.map(s=>s.maxY))+.2;
 const navigation=buildTriangleNavigation(slopes,hints,{maxFloorY});
 const visualBounds=new THREE.Box3().setFromObject(root,true),size=visualBounds.getSize(new THREE.Vector3()),center=visualBounds.getCenter(new THREE.Vector3());
 const lights=makeLightRig(root);let drawCalls=0;root.traverse(o=>{if(o.isMesh){drawCalls++;o.castShadow=false;o.receiveShadow=true;}});
 const disabledZone={min:{x:9999,z:9999},max:{x:10000,z:10000}};
 const data={...DUST_SHORT_MAP_INFO,root,colliders:[],slopes,spawns:navigation.spawns,waypoints:navigation.waypoints,
  bounds:{minX:visualBounds.min.x,maxX:visualBounds.max.x,minZ:visualBounds.min.z,maxZ:visualBounds.max.z},
  ambient:{skyTop:0x7796ad,skyBottom:0xd6c29b,fog:0xc7b58f,fogNear:80,fogFar:220},
  buyZones:{CT:disabledZone,T:disabledZone},bombsites:[],hostageSpawns:[],rescueZone:null,callouts:[],
  menuCamera:{pos:{x:center.x-10,y:visualBounds.max.y+10,z:center.z+12},lookAt:{x:center.x,y:1,z:center.z}},
  stats:{triangles,drawCalls,meshes:drawCalls,lights:lights.length,colliders:0,slopes:slopes.length,waypoints:navigation.waypoints.length,
   links:navigation.waypoints.reduce((sum,p)=>sum+p.links.length,0),sourceSize:{x:size.x,y:size.y,z:size.z},scale:MAP_SCALE,scaleIncrease:MAP_SCALE/40,navigation:navigation.stats},
 };
 data.dispose=()=>{disposeRoot(root);data.slopes=[];data.colliders=[];};
 game.scene.add(root);game.log?.('Dust Short: '+JSON.stringify(data.stats));return data;
}
export async function buildDustShortMap(game){const gltf=await loader.loadAsync(DUST_SHORT_MODEL_URL);return buildDustShortMapFromScene(game,gltf.scene);}
