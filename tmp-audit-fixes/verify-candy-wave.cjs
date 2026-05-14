const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const debugPort = 9357;
const chromeBin = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'https://opengame-production.up.railway.app/api/games/cmp3j6vuc0001l504g4p3hykp/files/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
class Cdp { constructor(ws) { this.ws = ws; this.id = 1; this.pending = new Map(); ws.addEventListener('message', e => { const p = JSON.parse(String(e.data)); if (p.id && this.pending.has(p.id)) { const it = this.pending.get(p.id); this.pending.delete(p.id); p.error ? it.reject(new Error(p.error.message)) : it.resolve(p.result || {}); } }); } send(method, params = {}) { const id = this.id++; return new Promise((resolve, reject) => { const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout '+method)); }, 15000); this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); } }
async function waitWs() { const end = Date.now() + 12000; while (Date.now() < end) { try { const list = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`); const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (page) return page.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('no ws'); }
async function evalJs(c, expression) { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed'); return r.result && r.result.value; }
async function drag(c, x, y) { await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x - 70, y: y + 40, button: 'left', clickCount: 1 }); for (let i = 0; i <= 5; i++) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 70 + i * 28, y: y + 40 - i * 16, button: 'left', buttons: 1 }); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 70, y: y - 40, button: 'left', clickCount: 1 }); }
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'candy-wave-'));
  const chrome = spawn(chromeBin, [`--remote-debugging-port=${debugPort}`, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${userData}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const wsUrl = await waitWs();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const c = new Cdp(ws);
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Input.setIgnoreInputEvents', { ignore: false });
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send('Page.navigate', { url });
    await sleep(2500);
    const start = await evalJs(c, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/开始|start/i.test(x.textContent)); const r=b.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    const samples = [];
    let reachedWave2Spawn = false;
    for (let tick = 0; tick < 420; tick++) {
      const debug = await evalJs(c, `window.__OPENGAME_DEBUG__ ? window.__OPENGAME_DEBUG__() : null`);
      if (tick % 10 === 0) samples.push({ t: tick, wave: debug && debug.wave, live: debug && debug.liveFruitCount, halves: debug && debug.fruitHalfCount, spawned: debug && debug.spawnedFruitCount, history: debug && debug.targetHistory && debug.targetHistory.length, delay: debug && debug.waveSpawnDelay, complete: debug && debug.waveComplete, state: debug && debug.gameState });
      const target = debug && debug.activeTargets && debug.activeTargets.find(t => t.reachable !== false && t.y > 120 && t.y < 760);
      if (target) await drag(c, Math.max(50, Math.min(340, target.x)), Math.max(120, Math.min(760, target.y)));
      if (debug && debug.wave >= 2 && debug.targetHistory && debug.targetHistory.length > 3) { reachedWave2Spawn = true; samples.push({ t: tick, wave: debug.wave, live: debug.liveFruitCount, spawned: debug.spawnedFruitCount, history: debug.targetHistory.length, state: debug.gameState, reachedWave2Spawn: true }); break; }
      await sleep(90);
    }
    const finalDebug = await evalJs(c, `window.__OPENGAME_DEBUG__ ? window.__OPENGAME_DEBUG__() : null`);
    console.log(JSON.stringify({ ok: reachedWave2Spawn, finalDebug, samples }, null, 2));
    ws.close();
  } finally { chrome.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
