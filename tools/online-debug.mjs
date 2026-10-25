import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:8095/';
const profile = process.env.STRIKE_BROWSER_PROFILE || '.tmp/online-debug';
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-crash-reporter', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  'about:blank',
], { detached: true, stdio: 'ignore' });
chrome.unref();
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) console.log('EVAL_EXC', JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded') logs.push(m.params.entry.text);
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails?.text);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push(`HTTP ${m.params.response.status} ${m.params.response.url}`);
});
await send('Network.enable');
for (let i = 0; i < 80; i++) { if (await ev(`!!window.__CS16__ && window.__CS16__.state === 'menu'`)) break; await new Promise((r) => setTimeout(r, 300)); }
await ev(`window.__CS16__.openOnlineHome(); true`);
await new Promise((r) => setTimeout(r, 1200));
console.log('OPEN', await ev(`JSON.stringify({screen:window.__CS16__.onlineUI._screen,isOpen:window.__CS16__.onlineUI.isOpen,menu:getComputedStyle(document.getElementById('classic-menu')).opacity,home:!!document.querySelector('[data-view="home"]:not(.online-hidden)')})`));
console.log('CREATE', await ev(`(()=>{try{const b=document.querySelector('[data-online-action="create"]');if(!b)return 'NO_BTN';b.click();return 'CLICKED';}catch(e){return 'ERR '+e.stack}})()`));
await new Promise((r) => setTimeout(r, 5000));
console.log('STATE', await ev(`(()=>{try{const g=window.__CS16__;const s=g.onlineSession;return JSON.stringify({peer:typeof window.Peer,screen:g.onlineUI?._screen,isOpen:g.onlineUI?.isOpen,session:!!s,role:s?.role,code:s?.code,connected:s?.connected,closed:s?.closed,status:s?._lastStatus,error:document.querySelector('[data-view="error"]:not(.online-hidden)')?.innerText?.slice(0,300)});}catch(e){return 'ERR '+e.stack}})()`));
console.log('LOGS', logs.slice(-15));
ws.close(); try { process.kill(-chrome.pid); } catch { chrome.kill(); }
process.exit(0);

