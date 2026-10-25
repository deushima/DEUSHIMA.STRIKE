import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const artifacts=path.resolve('tests/artifacts/community');fs.mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__character_qa__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><style>body{margin:0;color:#eee;font:20px Arial}#label{position:absolute;left:24px;top:20px}</style><div id="label"></div><canvas></canvas>'}));
 await page.goto((process.env.CS16_BASE_URL||'http://127.0.0.1:8095')+'/__character_qa__');
 const metrics=await page.evaluate(async()=>{
  const start=performance.now();const T=await import('/vendor/three.module.js');const {CharacterLibrary}=await import('/src/characters.js');
  const scene=new T.Scene();scene.background=new T.Color(0x202731);scene.add(new T.HemisphereLight(0xffffff,0x9090a0,3));
  const light=new T.DirectionalLight(0xffffff,3);light.position.set(3,4,-4);scene.add(light);
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1200,800);renderer.outputColorSpace=T.SRGBColorSpace;
  const camera=new T.PerspectiveCamera(36,1.5,.01,100);camera.position.set(0,1.05,-4.5);camera.lookAt(0,.9,0);
  const library=new CharacterLibrary({scene});await library.load();const chars={T:library.create('T'),CT:library.create('CT')};
  for(const c of Object.values(chars))scene.add(c.root);
  const rows=[];
  for(const team of ['T','CT']){
   const c=chars[team];const meshes=[];c.model.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
   if(!meshes.length||meshes.some(m=>!m.geometry.attributes.uv||!m.geometry.attributes.skinWeight))throw new Error('Missing rig/UV: '+team);
   const before=meshes.map(m=>m.geometry.attributes.position.array.slice());
   for(const pitch of [-80,-45,0,45,80])for(const duck of [false,true])for(const weaponId of ['m4a1','deagle']){
    for(let i=0;i<45;i++)c.update(1/60,{pitch:pitch*Math.PI/180,crouching:duck,onGround:true,speed:0,weaponId});
    const grip=c.getGripErrors();if(Math.max(...Object.values(grip))>.015)throw new Error('Grip drift '+JSON.stringify({team,pitch,duck,weaponId,grip}));
    if(c.root.rotation.x!==0)throw new Error('Root tilted by aim');
    c.model.traverse(o=>{if(o.isBone&&(!o.quaternion.toArray().every(Number.isFinite)||!o.position.toArray().every(Number.isFinite)))throw new Error('Invalid pose');});
    rows.push({team,pitch,duck,weaponId,grip});
   }
   meshes.forEach((m,j)=>{if(m.geometry.attributes.position.array.some((v,i)=>v!==before[j][i]))throw new Error('Animation altered source vertices');});
   const other=library.create(team);scene.add(other.root);const originalPose=meshes[0].skeleton.bones.map(b=>b.quaternion.toArray());
   other.update(.1,{pitch:1,onGround:false,weaponId:'ak47'});
   if(meshes[0].skeleton.bones.some((b,i)=>b.quaternion.toArray().some((v,j)=>v!==originalPose[i][j])))throw new Error('Shared clone skeleton');
   other.dispose();
  }
  function show(team,pitch=0,yaw=0,crouch=false,speed=0){
   for(const [id,c]of Object.entries(chars)){c.root.visible=team==='both'||id===team;c.root.position.x=team==='both'?(id==='T'?-.6:.6):0;c.root.rotation.y=yaw;c.update(1/30,{pitch:pitch*Math.PI/180,yaw,crouching:crouch,onGround:true,speed,velocity:{x:0,y:0,z:-speed},weaponId:'m4a1'});}
   document.querySelector('#label').textContent=team+' / aim '+Math.round(pitch)+'°'+(crouch?' / crouch':'');renderer.render(scene,camera);
  }
  for(let i=0;i<30;i++)show('both');const baseline={...renderer.info.memory};
  const frameStart=performance.now();for(let i=0;i<120;i++)show('both',Math.sin(i*.03)*80,.4,false,5);
  const meanFrameMs=(performance.now()-frameStart)/120;
  for(let i=0;i<20;i++){const c=library.create(i%2?'T':'CT');scene.add(c.root);c.update(.016,{onGround:true,weaponId:'m4a1'});renderer.render(scene,camera);c.dispose();}
  show('both');const finalMemory={...renderer.info.memory};
  if(finalMemory.geometries>baseline.geometries||finalMemory.textures>baseline.textures)throw new Error('GPU resource growth: '+JSON.stringify({baseline,finalMemory}));
  window.qa={show,chars,renderer};
  return {loadMs:frameStart-start,meanFrameMs,renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),baseline,finalMemory,poses:rows};
 });
 for(const team of ['T','CT'])for(const [label,pitch,yaw,duck,speed]of [['front',0,0,false,0],['side',0,Math.PI/2,false,0],['back',0,Math.PI,false,0],['up',80,.6,false,0],['down',-80,.6,false,0],['crouch',0,.6,true,0],['run',0,.6,false,5]]){
  await page.evaluate(a=>{for(let i=0;i<40;i++)window.qa.show(...a)},[team,pitch,yaw,duck,speed]);
  await page.screenshot({path:path.join(artifacts,team+'-'+label+'.png')});
 }
 const video=await page.evaluate(async()=>{
  const stream=document.querySelector('canvas').captureStream(30);const chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:1800000});
  const done=new Promise(resolve=>{recorder.onstop=async()=>{const blob=new Blob(chunks,{type:'video/webm'}),reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);};});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.start();
  const start=performance.now();await new Promise(resolve=>{function frame(){const t=(performance.now()-start)/1000;window.qa.show('both',Math.sin(t)*80,.4,t>4&&t<6,t>6?5:0);if(t<8)requestAnimationFrame(frame);else resolve();}frame();});
  recorder.stop();return done;
 });
 fs.writeFileSync(path.join(artifacts,'poses.webm'),Buffer.from(video,'base64'));fs.writeFileSync(path.join(artifacts,'metrics.json'),JSON.stringify(metrics,null,2));
 assert.deepEqual(errors,[]);assert.equal(metrics.poses.length,40);
 console.log(JSON.stringify({...metrics,poses:metrics.poses.length}));console.log('community-character-render OK');
}finally{await browser.close();}
