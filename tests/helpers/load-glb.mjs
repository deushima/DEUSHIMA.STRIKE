import fs from 'node:fs';
globalThis.self=globalThis;
globalThis.document ||= {createElementNS(_ns,name){if(name!=='img')return {};const events=new Map();return {width:2048,height:2048,addEventListener(t,f){events.set(t,f);},removeEventListener(t){events.delete(t);},set src(v){queueMicrotask(()=>events.get('load')?.call(this));}};}};
const {GLTFLoader}=await import('../../vendor/loaders/GLTFLoader.js');
export async function loadGLB(path) {const b=fs.readFileSync(path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
