/** Real-browser rendering regressions. Start server.mjs first, then run:
 * node tests/render-regression.mjs
 * Uses playwright-core from the workspace tools, or PLAYWRIGHT_MODULE (file URL).
 * Optional: CS16_BASE_URL, CHROME_PATH.
 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || new URL('../../tools/node_modules/playwright-core/index.mjs', import.meta.url).href);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  const origin = process.env.CS16_BASE_URL || 'http://127.0.0.1:8095';
  // A separate page loads the real modules without starting a match or touching
  // the user's browser, server process, character files, or saved preferences.
  await page.route('**/__render_regression__', route => route.fulfill({contentType:'text/html', body:'<!doctype html><canvas id="test"></canvas>'}));
  await page.goto(new URL('/__render_regression__', origin).href);
  const result = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js');
    const { Effects } = await import('/src/core/effects.js');
    const { buildAimMap } = await import('/src/world/aim_map.js');
    const { buildAssaultMap } = await import('/src/world/assault_map.js');
    const { preloadWadTextures } = await import('/src/world/wad.js');
    await preloadWadTextures();
    const checks=[];
    function check(ok, message) {if(!ok)throw new Error(message);checks.push(message);}
    const scene=new T.Scene();
    const effects=new Effects({scene});
    const pool=effects.tracers;
    const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas')});
    renderer.setSize(320,180);
    const camera=new T.PerspectiveCamera(75,320/180,.05,300);
    camera.position.set(0,1.62,10);camera.lookAt(0,2,-10);
    function submitted() { renderer.render(scene,camera); return renderer.info.render.lines; }
    function validatePool() {
      const expected=[];
      for(let i=0;i<pool.max;i++)if(pool.tracers[i].life>0)expected.push(i*2,i*2+1);
      const index=pool.geometry.index;
      if(!index || pool.geometry.drawRange.count!==expected.length)throw new Error('Expired/uninitialized tracers submitted');
      if(expected.some((v,i)=>index.array[i]!==v))throw new Error('Live tracer endpoint pairing changed');
      if(!Array.from(pool.positions).every(v=>Number.isFinite(v)&&Math.abs(v)<100))throw new Error('Off-world tracer endpoint');
    }
    check(submitted()===0,'No lines before the first shot');
    const from=new T.Vector3(-1,1.6,8),to=new T.Vector3(2,9,-8);
    pool.spawn(from,to);
    check(submitted()===1,'Active shot renders exactly one segment');
    pool.update(.04); pool.spawn(from,to); pool.update(.04);
    validatePool();
    check(submitted()===1,'Expiring an older shot preserves the newer shot');
    pool.update(.1);
    check(submitted()===0,'Expired shots submit no lines');
    for(let i=0;i<pool.max*4;i++) {pool.spawn(from,to);validatePool();}
    check(submitted()===pool.max,'Ring-buffer reuse does not grow the draw count');
    pool.update(.1);validatePool();
    check(submitted()===0,'All reused shots expire cleanly');
    effects.dispose();
    const maps=[];
    for(const build of [buildAimMap,buildAssaultMap,buildAimMap]) {
      const map=build({scene});
      scene.updateMatrixWorld(true);
      let invalid=0,badIndices=0,degenerate=0,badNormals=0;
      map.root.traverse(o=>{
        const geo=o.geometry;if(!geo)return;
        for(const attr of Object.values(geo.attributes))for(const v of attr.array)if(!Number.isFinite(v))invalid++;
        const p=geo.attributes.position,n=geo.attributes.normal,idx=geo.index?.array;
        if(idx)for(const i of idx)if(i>=p.count)badIndices++;
        if(n)for(let i=0;i<n.count;i++){const length=new T.Vector3().fromBufferAttribute(n,i).length();if(Math.abs(length-1)>.001)badNormals++;}
        if(o.isMesh)for(let i=0;i<(idx?.length||p.count);i+=3){const a=new T.Vector3().fromBufferAttribute(p,idx?idx[i]:i),b=new T.Vector3().fromBufferAttribute(p,idx?idx[i+1]:i+1),c=new T.Vector3().fromBufferAttribute(p,idx?idx[i+2]:i+2);if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-16)degenerate++;}
      });
      check(!invalid&&!badIndices&&!degenerate&&!badNormals,`${map.id}: finite geometry, valid indices, unit normals, nonzero triangles`);
      if(map.id==='aim_1v1') {
        for(const [name,w,h] of [['aim-center',6,6],['spawn-CT',3.4,3.4],['spawn-T',3.4,3.4],['line-CT',7.2,.9],['line-T',7.2,.9]]) {
          const mesh=map.root.getObjectByName(name),size=new T.Box3().setFromObject(mesh).getSize(new T.Vector3());
          check(Math.abs(size.x-w)<1e-5&&Math.abs(size.z-h)<1e-5,`${name}: world size ${w} x ${h} metres`);
          check(mesh.material.map.image.width===256,`${name}: texture resolution remains 256 px`);
        }
      } else {
        const a=map.root.getObjectByName('sign:ASSAULT'),b=map.root.getObjectByName('sign:CARGO');
        check(a.position.distanceTo(b.position)>10,'ASSAULT signs occupy separate wall locations');
        check(Math.abs(b.rotation.y-Math.PI/2)<1e-6,'CARGO faces outward from the east wall');
      }
      const floor=map.root.getObjectByName(map.id==='aim_1v1'?'batch:sandFloor':'batch:concreteFloor');
      check(Math.max(...floor.geometry.attributes.uv.array)>4,`${map.id}: tiled floor UVs`);
      check(floor.material.map.image.naturalWidth>0 && floor.material.map.wrapS===T.RepeatWrapping,`${map.id}: original WAD texture loaded and repeating`);
      check(floor.material.depthTest&&floor.material.depthWrite,`${map.id}: solid floor depth remains enabled`);
      renderer.render(scene,camera);
      check(renderer.getContext().getError()===0,`${map.id}: no WebGL error after render`);
      maps.push({id:map.id,triangles:map.stats.triangles,drawCalls:map.stats.drawCalls});
      map.dispose();
      check(scene.children.length===0,`${map.id}: map switch leaves no duplicate root`);
    }
    renderer.dispose();
    return {checks,maps};
  });
  assert.ok(result.checks.length>30);
  console.log(JSON.stringify(result,null,2));
  console.log(`render-regression OK: ${result.checks.length} checks`);
} finally { await browser.close(); }
