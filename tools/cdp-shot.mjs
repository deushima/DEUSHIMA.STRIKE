import fs from 'node:fs';

const port = process.argv[2] || '9223';
const out = process.argv[3] || 'shot.png';
const expr = process.argv[4] || 'window.__CS16__?.state';
const waitMs = Number(process.argv[5] || 0);

const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const tab = tabs.find((t) => t.type === 'page');
if (!tab) throw new Error('no page');
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
await send('Page.enable');
await send('Runtime.enable');
if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
const evalRes = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log('EVAL', JSON.stringify(evalRes.result?.value));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('WROTE', out);
ws.close();
