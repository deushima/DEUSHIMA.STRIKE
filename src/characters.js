/** User-supplied community models; provenance and licenses in character-credits.html. */
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { clone as skeletonClone } from '../vendor/utils/SkeletonUtils.js';
import { createCommunityAnimator } from './characters/community-rig.js';

export { CHARACTER_IDS } from './characters/identities.js';
const FILES={T:'/assets/characters/community/leet.glb',CT:'/assets/characters/community/sas.glb'};

// Sketchfab's metallic/roughness materials require image-based lighting. A
// shared neutral cubemap supplies it without altering original material factors
// or texture pixels, even when a map provides no environment map.
function neutralEnvironment() {
  const faces=Array.from({length:6},()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=16;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e2e6eb';ctx.fillRect(0,0,16,16);return canvas;
  });
  const cube=new THREE.CubeTexture(faces);cube.colorSpace=THREE.SRGBColorSpace;cube.needsUpdate=true;return cube;
}

export class CharacterLibrary {
  constructor(game){this.game=game;this.ready=false;this.loading=null;this.sources=new Map();}
  async load(){
    if(this.ready)return this;if(this.loading)return this.loading;
    this.loading=(async()=>{
      const loader=new GLTFLoader();
      this.environment ||= neutralEnvironment();
      for(const team of ['T','CT']){
        const gltf=await loader.loadAsync(FILES[team]);
        gltf.scene.updateMatrixWorld(true);
        const bounds=new THREE.Box3().setFromObject(gltf.scene,true);
        const h=bounds.max.y-bounds.min.y;
        if(!Number.isFinite(h)||h<=0)throw new Error(`Invalid character bounds: ${team}`);
        const normalized=new THREE.Group();normalized.add(gltf.scene);
        gltf.scene.position.sub(new THREE.Vector3((bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2));
        normalized.scale.setScalar(1.8/h);
        // Both originals face +Z. Gameplay forward is -Z.
        normalized.rotation.y=Math.PI;normalized.updateMatrixWorld(true);
        const model=normalized;
        model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.castShadow=true;o.receiveShadow=true;
          for(const material of Array.isArray(o.material)?o.material:[o.material]){
            if(material.isMeshStandardMaterial){material.envMap=this.environment;material.envMapIntensity=1.25;}
          }}});
        this.sources.set(team,{scene:model,clips:gltf.animations||[]});
      }
      this.ready=true;return this;
    })();
    try{return await this.loading;}catch(error){this.loading=null;throw error;}
  }
  create(team,seed=0){
    void seed;team=team==='T'?'T':'CT';
    if(!this.ready)return null;
    const model=skeletonClone(this.sources.get(team).scene);
    model.name=`operative:${team}`;
    return createCommunityAnimator(model,team);
  }
}
