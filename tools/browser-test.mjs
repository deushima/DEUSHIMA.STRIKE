/**
 * Prueba real: abre Chrome headless, hace click en JUGAR 1V1 (gesto de usuario),
 * espera y captura screenshot + estado del juego.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL = process.argv[2] || 'http://127.0.0.1:8095/';
const OUT = process.argv[3] || 'analysis/previews/browser-test.png';
const WAIT = Number(process.argv[4] || 9000);

const profile = process.env.STRIKE_BROWSER_PROFILE || '.tmp/bt-profile';
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-crash-reporter', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();

async function waitPort() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome no abriÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ CDP');
}
await waitPort();
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('PAGE_EXCEPTION', msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text);
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params?.entry;
    if (e?.level === 'error') console.log('PAGE_ERROR', e.url || '', e.text);
  }
});
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
// esperar HUD clÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡sico instalado
for (let i = 0; i < 60; i++) {
  const ready = await evaluate(`!!document.querySelector('[data-cm="duel"]') && !!window.__CS16__`);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
// click real en JUGAR 1V1
const choice = /redline/.test(URL) ? 'redline' : /surf/.test(URL) ? 'surf' : /assault/.test(URL) ? 'assault' : /bomb/.test(URL) ? 'bomb' : /options/.test(URL) ? 'options' : 'duel';
const rect = await evaluate(`(()=>{const b=document.querySelector('[data-cm="${choice}"]');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
}
await new Promise((r) => setTimeout(r, WAIT));
if (/pause/.test(URL)) {
  await evaluate('window.__CS16__.pause()');
  await new Promise((r) => setTimeout(r, 900));
}
if (/kill/.test(URL)) {
  await evaluate(`(()=>{const g=window.__CS16__; g.duel.onBotKilled(); return true;})()`);
  await new Promise((r) => setTimeout(r, 400));
  console.log('KILL_400', await evaluate(`(()=>{const g=window.__CS16__;return JSON.stringify({phase:g.duel.phase,score:g.duel.scoreCT,round:g.duel.roundNumber,state:g.state,deathLeft:g.duel.deathLeft,rounds:g.rounds?.constructor?.name})})()`));
  await new Promise((r) => setTimeout(r, 1000));
  console.log('KILL_1400', await evaluate(`(()=>{const g=window.__CS16__;return JSON.stringify({phase:g.duel.phase,score:g.duel.scoreCT,round:g.duel.roundNumber,state:g.state,deathLeft:g.duel.deathLeft,rounds:g.rounds?.constructor?.name})})()`));
}
if (choice === 'surf') {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await new Promise((r) => setTimeout(r, 2800));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
}
const state = await evaluate(`(()=>{const g=window.__CS16__;const vm=g?.classicVM;let box=null;try{const T=window.__THREE__;const b=new T.Box3().setFromObject(vm.model.group);box={min:b.min.toArray(),max:b.max.toArray()};}catch(e){box=String(e);}return JSON.stringify({state:g?.state,phase:g?.duel?.phase,map:g?.map?.id,weapon:g?.weapons?.currentId,alive:g?.player?.alive,hasVM:!!vm,vmModel:vm?.currentId,vmLoaded:vm?.loaded?.size,vmHasModel:!!vm?.model,vmChildren:vm?.root?.children?.length,modelChildren:vm?.model?.group?.children?.length,mesh0:vm?.model?.group?.children?.[0]?.geometry?.attributes?.position?.count,meshVis:vm?.model?.group?.visible,rootVis:vm?.root?.visible,audioBuffers:g?.audio?._buffers?.size,box,vmPos:vm?.root?.position,vmScale:vm?.root?.scale?.x,oldVisible:g?.weapons?.viewmodel?.root?.visible,locked:g?.input?.locked,pos:g?.player?.pos,yaw:g?.player?.yaw,pitch:g?.player?.pitch,team:g?.player?.team,surf:g?.map?.mode})})()`);
console.log('STATE', state);
if (/redlineplay/.test(URL)) {
  await evaluate(`(()=>{const g=window.__CS16__;g.player.yaw=g.player.team==='CT'?0:Math.PI;g.player.pitch=0;return true})()`);
  console.log('BOT_INIT', await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];return JSON.stringify({team:g.player.team,player:{x:g.player.pos.x,z:g.player.pos.z,yaw:g.player.yaw},bot:b?{x:b.pos.x,z:b.pos.z,alive:b.alive,health:b.health,state:b.state,path:!!b.path}:null,waypoints:g.map?.waypoints?.length,colliders:g.map?.colliders?.length})})()`));
  await new Promise((r) => setTimeout(r, 2800));
  console.log('BOT_LATER', await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];return JSON.stringify({bot:b?{x:b.pos.x,z:b.pos.z,alive:b.alive,health:b.health,state:b.state,moving:b._moving,path:!!b.path}:null,player:{alive:g.player.alive,health:g.player.health,x:g.player.pos.x,z:g.player.pos.z},phase:g.duel?.phase,round:g.duel?.roundNumber})})()`));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await new Promise((r) => setTimeout(r, 1100));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  console.log('MOVED', await evaluate(`(()=>{const g=window.__CS16__;return JSON.stringify({x:g.player.pos.x,z:g.player.pos.z,alive:g.player.alive,health:g.player.health,yaw:g.player.yaw})})()`));
  const before = await evaluate(`(()=>{const g=window.__CS16__;return g.weapons?._currentEntry()?.magazine ?? -1})()`);
  await evaluate(`(()=>{document.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));return true})()`);
  await new Promise((r) => setTimeout(r, 120));
  await evaluate(`(()=>{window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));return true})()`);
  await new Promise((r) => setTimeout(r, 250));
  const after = await evaluate(`(()=>{const g=window.__CS16__;return g.weapons?._currentEntry()?.magazine ?? -1})()`);
  console.log('SHOT', JSON.stringify({ before, after }));
  await evaluate(`(()=>{const g=window.__CS16__;g.player.pos.set(0,0.05,8);g.player.yaw=0;g.player.pitch=0;return true})()`);
  await new Promise((r) => setTimeout(r, 5000));
  console.log('COMBAT', await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];return JSON.stringify({player:{alive:g.player.alive,health:g.player.health,x:g.player.pos.x,z:g.player.pos.z},bot:b?{alive:b.alive,health:b.health,x:b.pos.x,z:b.pos.z,state:b.state,moving:b._moving}:null,phase:g.duel?.phase,round:g.duel?.roundNumber,kills:g.player.kills})})()`));
  await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];if(!b)return false;g.player.pos.set(b.pos.x+1.8,0.05,b.pos.z+2.4);g.player.yaw=Math.atan2(-(b.pos.x-g.player.pos.x),-(b.pos.z-g.player.pos.z));g.player.pitch=0;return true})()`);
  await new Promise((r) => setTimeout(r, 3000));
  console.log('COMBAT2', await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];return JSON.stringify({player:{alive:g.player.alive,health:g.player.health},bot:b?{alive:b.alive,health:b.health,x:b.pos.x,z:b.pos.z,state:b.state,target:b.target?.name||null,targetVisible:b.targetVisible}:null,phase:g.duel?.phase,kills:g.player.kills,deaths:g.player.deaths})})()`));
}
if (/redline_ct|redline_t/.test(URL)) {
  const team = /redline_t/.test(URL) ? 'T' : 'CT';
  await evaluate(`(()=>{const g=window.__CS16__;const s=g.map.spawns['${team}'][0];g.player.team='${team}';g.player.reset('${team}',s);g.player.pos.set(s.x,0.05,s.z);g.player.yaw='${team}'==='CT'?0:Math.PI;g.player.pitch=0;return true})()`);
  await new Promise((r) => setTimeout(r, 300));
  console.log('BASE', await evaluate(`(()=>{const g=window.__CS16__;return JSON.stringify({team:g.player.team,x:g.player.pos.x,z:g.player.pos.z,yaw:g.player.yaw,map:g.map.id,phase:g.duel?.phase})})()`));
}
if (/reload/.test(URL)) {
  console.log('RELOAD_BEFORE', await evaluate(`(()=>{const g=window.__CS16__;const w=g.weapons;const e=w._currentEntry();return JSON.stringify({weapon:w.currentId,mag:e?.magazine,reserve:e?.reserve,reloading:w.reloading,volume:g.audio?.volume})})()`));
  await evaluate(`(()=>{const g=window.__CS16__;const w=g.weapons;const e=w._currentEntry();if(e){e.magazine=1;} w._fire(); return true})()`);
  console.log('RELOAD_DURING', await evaluate(`(()=>{const g=window.__CS16__;const w=g.weapons;const e=w._currentEntry();return JSON.stringify({mag:e?.magazine,reserve:e?.reserve,reloading:w.reloading,timer:w.reloadTimer,total:w.reloadTotal,buffers:g.audio?._buffers?.size,reloadBuf:!!g.audio?._buffers?.get('weapons/reload_pistol.mp3')})})()`));
  await new Promise((r) => setTimeout(r, 2150));
  console.log('RELOAD_AFTER', await evaluate(`(()=>{const g=window.__CS16__;const w=g.weapons;const e=w._currentEntry();return JSON.stringify({mag:e?.magazine,reserve:e?.reserve,reloading:w.reloading,timer:w.reloadTimer})})()`));
}
if (/close/.test(URL)) {
  await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];if(!b)return false;g.player.pos.set(0,0.05,3);b.pos.set(0,0.05,-1.6);b.group?.position.copy(b.pos);b.yaw=Math.PI;b.group.rotation.y=b.yaw + Math.PI;b.alive=true;b.health=100;b._moving=false;b.thinkTimer=99;b.aimYaw=Math.PI;g.player.yaw=0;g.player.pitch=0;g.bots.update=()=>{};b.parts?.character?.mixer?.update(0.8);b.parts?.character?.aimPose?.();return true})()`);
  await new Promise((r) => setTimeout(r, 250));
}
if (/tags/.test(URL)) {
  await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];if(!b)return false;b.team=g.player.team;b.alive=true;b.health=72;b.name='ALIADO KENNEY';const fx=-Math.sin(g.player.yaw),fz=-Math.cos(g.player.yaw);b.pos.set(g.player.pos.x+fx*3.2+0.6,0.05,g.player.pos.z+fz*3.2);b.group?.position.copy(b.pos);b._moving=false;b.thinkTimer=99;g.bots.update=()=>{};return true})()`);
  await new Promise((r) => setTimeout(r, 250));
  console.log('TAGS', await evaluate(`(()=>Array.from(document.querySelectorAll('#name-tags .nt')).map(e=>({text:e.textContent.trim(),display:getComputedStyle(e).display,transform:e.style.transform})))()`));
}
if (/char/.test(URL)) {
  console.log('CHAR', await evaluate(`(()=>{const g=window.__CS16__;const b=g.bots?.getBots?.()[0];const c=b?.parts?.character;return JSON.stringify({bot:!!b,char:!!c,alive:b?.alive,moving:b?._moving,onGround:b?.onGround,pos:b?.pos,actions:c?Object.keys(c.actions):[],idleWeight:c?.actions?.idle?.getEffectiveWeight?.(),idleTime:c?.actions?.idle?.time,runWeight:c?.actions?.run?.getEffectiveWeight?.(),runTime:c?.actions?.run?.time,clipNames:c?Object.fromEntries(Object.entries(c.actions).map(([k,a])=>[k,[a.getClip().name,a.getClip().duration]])):{},arm:c?.model?.getObjectByName('RightArm')?.quaternion?.toArray?.(),mixerTime:c?.mixer?.time,current:c?.state,rootRot:c?.root?.rotation?.toArray?.(),modelRot:c?.model?.rotation?.toArray?.(),weaponPos:c?.weapon?.position})})()`));
}
if (/blue/.test(URL)) {
  console.log('BLUES', await evaluate(`(()=>{const g=window.__CS16__;const out=[];g.scene.traverse(o=>{const m=o.material;if(!m||Array.isArray(m)||!m.color)return;const c=m.color;if(c.b>c.r*1.15&&c.b>c.g*1.05)out.push({n:o.name||o.type,c:'#'+c.getHexString(),p:o.position?.toArray(),g:o.geometry?.boundingSphere?{r:o.geometry.boundingSphere.radius}:null,t:!!m.transparent,op:m.opacity});});return JSON.stringify(out.slice(0,20));})()`));
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('WROTE', OUT);
ws.close();
try { process.kill(-chrome.pid); } catch { try { chrome.kill(); } catch { /* ignore */ } }
process.exit(0);

















