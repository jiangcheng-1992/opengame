export function buildPlayabilityValidatorScript() {
  return String.raw`#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const reportPath = process.argv[3] || join(root, "playability-report.json");
const debugPort = Number(process.env.PLAYABILITY_DEBUG_PORT || 9222);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function hash(value) {
  return createHash("sha256").update(value || "").digest("hex").slice(0, 16);
}

function isInsideRoot(filePath) {
  const rel = relative(root, filePath);
  return rel && !rel.startsWith("..") && !rel.startsWith("/");
}

function createStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      const pathName = decodeURIComponent(requestUrl.pathname);
      const targetPath = resolve(join(root, pathName === "/" ? "index.html" : pathName));

      if (!isInsideRoot(targetPath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const fileStat = await stat(targetPath);
      if (!fileStat.isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const body = await readFile(targetPath);
      res.writeHead(200, {
        "content-type": contentTypes[extname(targetPath).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectServer(new Error("Failed to bind validation server."));
        return;
      }
      resolveServer({ server, port: address.port });
    });
  });
}

function findChromeCommand() {
  return process.env.CHROME_BIN || "chromium";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
  return response.json();
}

async function waitForPageWebSocket() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson("http://127.0.0.1:" + debugPort + "/json/list");
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
    await sleep(250);
  }
  throw new Error("Chromium did not expose a debuggable page.");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.id && this.pending.has(payload.id)) {
        const item = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) item.reject(new Error(payload.error.message || "CDP command failed."));
        else item.resolve(payload.result || {});
        return;
      }
      if (payload.method && this.listeners.has(payload.method)) {
        for (const listener of this.listeners.get(payload.method)) {
          listener(payload.params || {});
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error("CDP timeout: " + method));
      }, 15000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolveSend(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectSend(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => rejectWait(new Error("Timed out waiting for " + method)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timeout);
        resolveWait(params);
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("WebSocket connection failed.")), { once: true });
  });
  return new CdpClient(socket);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }
  return result.result ? result.result.value : null;
}

async function screenshotHash(client) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  return hash(result.data || "");
}

const snapshotScript = "(() => {" +
  "function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;}" +
  "function hasGradient(s){return /gradient\\(/i.test(s.backgroundImage||'')||/gradient\\(/i.test(s.background||'');}" +
  "function hasShadow(s){return (s.boxShadow&&s.boxShadow!=='none')||(s.textShadow&&s.textShadow!=='none');}" +
  "function hasRadius(s){return parseFloat(s.borderTopLeftRadius||'0')>=6||parseFloat(s.borderTopRightRadius||'0')>=6||parseFloat(s.borderBottomLeftRadius||'0')>=6||parseFloat(s.borderBottomRightRadius||'0')>=6;}" +
  "const body=document.body;" +
  "const text=(body&&body.innerText?body.innerText:'').replace(/\\s+/g,' ').trim().slice(0,1200);" +
  "const fullText=(body&&body.innerText?body.innerText:'')+' '+document.documentElement.innerHTML.slice(0,60000);" +
  "const controls=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible).map((el)=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,12);" +
  "const heroCandidates=Array.from(document.querySelectorAll('header,section,main > div,main > section,.hero,.start-screen,.title-screen,.intro,.overlay')).filter(visible).map((el)=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);const t=(el.innerText||'').replace(/\\s+/g,' ').trim();return {tag:el.tagName.toLowerCase(),text:t.slice(0,220),area:r.width*r.height,gradient:hasGradient(s),shadow:hasShadow(s),radius:hasRadius(s)};});" +
  "const hudCandidates=Array.from(document.querySelectorAll('[data-hud],.hud,.game-hud,header,aside,.topbar,.scoreboard,.status-bar,.hud-panel')).filter(visible).map((el)=>({text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,220),count:el.querySelectorAll('span,div,li,strong,p').length}));" +
  "const overlayCandidates=Array.from(document.querySelectorAll('.overlay,.modal,.dialog,.result,.game-over,.win,.lose,.end-screen,[data-overlay],[data-result]')).filter(visible).map((el)=>(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,240));" +
  "const visibleEls=Array.from(document.querySelectorAll('body,*')).filter(visible).slice(0,220);" +
  "const styled=visibleEls.map((el)=>{const s=getComputedStyle(el);return {tag:el.tagName.toLowerCase(),bg:s.backgroundColor,bgImage:s.backgroundImage,shadow:hasShadow(s),radius:hasRadius(s),gradient:hasGradient(s),imageRendering:s.imageRendering,font:s.fontFamily,color:s.color,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height};});" +
  "const gradients=styled.filter(x=>x.gradient).length;" +
  "const shadows=styled.filter(x=>x.shadow).length;" +
  "const radii=styled.filter(x=>x.radius).length;" +
  "const colors=new Set(styled.map(x=>x.bg).concat(styled.map(x=>x.color)).filter(v=>v&&v!=='rgba(0, 0, 0, 0)'&&v!=='transparent')).size;" +
  "const pixelatedElements=styled.filter(x=>/pixelated|crisp-edges/i.test(x.imageRendering||'')).length;" +
  "const pixelTerms=(fullText.match(/\\b(pixel art|pixelated|8-bit|8 bit|16-bit|16 bit|low-res|low res|blocky sprite|blocky sprites|retro pixel)\\b/ig)||[]).slice(0,8);" +
  "const buttons=Array.from(document.querySelectorAll('button,[role=button],input[type=button],input[type=submit],a')).filter(visible);" +
  "const defaultControls=buttons.filter((el)=>{const s=getComputedStyle(el);return !hasGradient(s)&&!hasShadow(s)&&!hasRadius(s)&&parseFloat(s.borderTopWidth||'0')<=2&&/^(button|input)$/i.test(el.tagName);}).length;" +
  "const canvases=Array.from(document.querySelectorAll('canvas')).map((canvas)=>{let data='';try{data=canvas.toDataURL('image/png').slice(0,2048);}catch{}const r=canvas.getBoundingClientRect();return {w:canvas.width,h:canvas.height,cssW:Math.round(r.width),cssH:Math.round(r.height),lowResScaled:(canvas.width<480||canvas.height<320)&&(r.width>canvas.width*1.4||r.height>canvas.height*1.4),data};});" +
  "const criticalEls=Array.from(document.querySelectorAll('canvas,button,[role=button],a,input[type=button],input[type=submit],[data-hud],.hud,.game-hud,.scoreboard,.status-bar,.hud-panel,.overlay,.modal,.dialog,.result,.game-over,.win,.lose,.end-screen,[data-overlay],[data-result]')).filter(visible);" +
  "const overflowX=Math.max(0,Math.max(document.documentElement.scrollWidth,body?body.scrollWidth:0)-window.innerWidth);" +
  "const overflowY=Math.max(0,Math.max(document.documentElement.scrollHeight,body?body.scrollHeight:0)-window.innerHeight);" +
  "const offscreenCritical=criticalEls.some((el)=>{const r=el.getBoundingClientRect();return r.right>window.innerWidth+24||r.bottom>window.innerHeight+24||r.left<-24||r.top<-24;});" +
  "const joined=(text+' '+controls.join(' '));" +
  "const hero=heroCandidates.sort((a,b)=>b.area-a.area)[0]||null;" +
  "const hudText=(hudCandidates.map(x=>x.text).join(' ')+' '+text);" +
  "return {title:document.title||'',text,fullText:fullText.slice(0,4000),htmlLength:body?body.innerHTML.length:0,bodyChildCount:body?body.children.length:0,controlCount:controls.length,controls,canvasCount:canvases.length,canvases,startGate:/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test(joined),hero,heroCount:heroCandidates.length,hud:{count:hudCandidates.length,text:hudText.slice(0,400),modules:hudCandidates.slice(0,4)},overlay:{count:overlayCandidates.length,text:overlayCandidates.join(' ').slice(0,400)},viewport:{width:window.innerWidth,height:window.innerHeight,overflowX,overflowY,offscreenCritical},visual:{gradients,shadows,radii,colors,pixelatedElements,pixelTerms,defaultControls,lowResScaledCanvas:canvases.some(c=>c.lowResScaled),visibleElementCount:visibleEls.length}};" +
"})()";

const targetScript = "(() => {" +
  "function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;}" +
  "const els=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible);" +
  "const start=els.find((el)=>/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test((el.innerText||el.value||el.getAttribute('aria-label')||'')));" +
  "const el=start||els[0];" +
  "if(el){const r=el.getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2),text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()};}" +
  "return {x:Math.floor(window.innerWidth/2),y:Math.floor(window.innerHeight/2),text:null};" +
"})()";

const gameplayDebugScript = "(() => {" +
  "try{" +
    "const hook=window.__OPENGAME_DEBUG__;" +
    "if(typeof hook==='function')return hook();" +
    "if(hook&&typeof hook==='object')return hook;" +
    "return null;" +
  "}catch(error){return {error:String(error&&error.message||error)};}" +
"})()";

async function click(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function drag(client, points) {
  if (!points.length) return;
  const [first, ...rest] = points;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: first.x, y: first.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: first.x, y: first.y, button: "left", clickCount: 1 });
  for (const point of rest) {
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "left", buttons: 1 });
    await sleep(45);
  }
  const last = rest[rest.length - 1] || first;
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", clickCount: 1 });
}

async function press(client, key, code) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}

async function touchSwipe(client, points) {
  if (!points.length) return;
  const [first, ...rest] = points;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: first.x, y: first.y, radiusX: 8, radiusY: 8, id: 1 }],
  });
  for (const point of rest) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, id: 1 }],
    });
    await sleep(55);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function summarizeErrors(errors) {
  return errors.map((error) => String(error).slice(0, 240)).slice(0, 8);
}

function snapshotChanged(a, b, shotA, shotB) {
  if (!a || !b) return false;
  return a.text !== b.text || a.htmlLength !== b.htmlLength || JSON.stringify(a.canvases) !== JSON.stringify(b.canvases) || shotA !== shotB;
}

function numberFrom(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function assessProgression(before, after, mobileAfter, gameplayDebug) {
  const debug = gameplayDebug || {};
  const maxProgression = Math.max(
    numberFrom(debug.maxLevel),
    numberFrom(debug.maxWave),
    numberFrom(debug.maxRound),
    numberFrom(debug.maxStage),
    numberFrom(debug.totalLevels),
    numberFrom(debug.totalWaves),
    numberFrom(debug.totalRounds),
    numberFrom(debug.totalStages),
  );
  const source = [
    before?.fullText,
    after?.fullText,
    mobileAfter?.fullText,
    JSON.stringify(debug),
  ].filter(Boolean).join(" ");
  const progressionSignals =
    source.match(/\b(level|wave|round|stage|mission|room|chapter|puzzle)\b|关卡|第\s*\d+\s*关|波次|第\s*\d+\s*波|回合|阶段|目标进度|难度/gi) || [];
  const explicitMultiStep =
    /(\b[3-9]\s*(levels?|waves?|rounds?|stages?|missions?|rooms?|puzzles?)\b)|([三四五六七八九十]\s*(关|波|回合|阶段))|(\b\d+\s*\/\s*[3-9]\b)/i.test(source);

  return {
    ok: maxProgression >= 3 || explicitMultiStep || progressionSignals.length >= 2,
    maxProgression,
    signals: progressionSignals.slice(0, 8),
  };
}

function assessVisualQuality(before, after) {
  const visual = after.visual || before.visual || {};
  const hero = before.hero || after.hero || null;
  const hud = after.hud || before.hud || { count: 0, text: "", modules: [] };
  const overlay = after.overlay || before.overlay || { count: 0, text: "" };
  const viewport = after.viewport || before.viewport || { overflowX: 0, overflowY: 0, offscreenCritical: false, height: 0 };
  const reasons = [];
  const polishSignals = Number(visual.gradients || 0) + Number(visual.shadows || 0) + Number(visual.radii || 0);
  const hasEnoughPolish = polishSignals >= 4 || (Number(visual.radii || 0) >= 2 && Number(visual.colors || 0) >= 5);
  const hasDesignedControls = Number(visual.defaultControls || 0) === 0 || Number(visual.radii || 0) > 0 || Number(visual.gradients || 0) > 0;
  const hudSignals = (hud.text || "").match(/\b(score|combo|wave|time|level|life|lives|health|hp|ammo|coins|goal|progress)\b|得分|连击|波次|时间|等级|生命|血量|金币|目标|进度/gi) || [];
  const endSignals = (overlay.text || after.text || before.fullText || after.fullText || "").match(/\b(restart|retry|play again|continue|victory|defeat|game over|mission over|you win|result|final score)\b|再来|重试|继续|胜利|失败|游戏结束|结果|最终得分/gi) || [];
  const hasHud = (hud.count || 0) >= 1 ? hudSignals.length >= 2 : hudSignals.length >= 3;
  const hasEndState = endSignals.length >= 1 || (/play again|restart|retry|再来|重试/i.test(after.text || "") && /score|time|wave|result|得分|时间|波次|结果/i.test(after.text || ""));
  const hasHero = Boolean(hero && hero.text && hero.text.length >= 12) || (Boolean(before.startGate) && Number(visual.visibleElementCount || 0) >= 20 && hasEnoughPolish);

  if (Number(visual.pixelatedElements || 0) > 0) reasons.push("Uses pixelated/crisp-edges image rendering.");
  if (Array.isArray(visual.pixelTerms) && visual.pixelTerms.length > 0) reasons.push("Contains pixel-art/8-bit/blocky visual language: " + visual.pixelTerms.join(", "));
  if (visual.lowResScaledCanvas) reasons.push("Uses a low-resolution scaled canvas that looks pixelated.");
  if (Number(viewport.overflowX || 0) > 24) reasons.push("Layout overflows horizontally; some game content extends beyond the visible viewport.");
  if (Number(viewport.overflowY || 0) > Math.max(120, Number(viewport.height || 0) * 0.12)) reasons.push("Layout requires excessive vertical scrolling; keep the whole playable scene inside the viewport.");
  if (viewport.offscreenCritical) reasons.push("Important gameplay UI appears partially off-screen or clipped.");
  if (!hasEnoughPolish) reasons.push("UI lacks enough polish signals such as gradients, rounded panels, shadows/glow, or color depth.");
  if (!hasDesignedControls) reasons.push("Visible controls look like default browser UI.");
  if (!hasHero) reasons.push("Missing a designed first screen or hero section with title/hook/CTA framing.");
  if (!hasHud) reasons.push("HUD is too weak; expected multiple readable state modules such as score, lives, timer, wave, or progress.");
  if (!hasEndState) reasons.push("Missing a designed end-state or replay-ready result overlay.");

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: { ...visual, hero, hud, overlay, hudSignals: hudSignals.slice(0, 8), endSignals: endSignals.slice(0, 8) },
  };
}

async function runValidation() {
  const serverInfo = await createStaticServer();
  const url = "http://127.0.0.1:" + serverInfo.port + "/index.html";
  const chrome = spawn(findChromeCommand(), [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=" + debugPort,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const chromeErrors = [];
  const chromeLaunchError = new Promise((_, rejectLaunch) => {
    chrome.once("error", (error) => {
      rejectLaunch(new Error("Chromium failed to start: " + (error && error.message ? error.message : String(error))));
    });
  });
  chrome.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) chromeErrors.push(text.slice(0, 400));
  });

  let client;
  try {
    const wsUrl = await Promise.race([waitForPageWebSocket(), chromeLaunchError]);
    client = await connect(wsUrl);
    const runtimeErrors = [];
    const consoleErrors = [];
    const networkErrors = [];

    client.on("Runtime.exceptionThrown", (params) => {
      const detail = params.exceptionDetails || {};
      runtimeErrors.push(detail.text || (detail.exception && detail.exception.description) || "Runtime exception");
    });
    client.on("Log.entryAdded", (params) => {
      if (params.entry && params.entry.level === "error") {
        consoleErrors.push(params.entry.text || "Console error");
      }
    });
    client.on("Network.responseReceived", (params) => {
      const response = params.response || {};
      if (response.status >= 400 && response.url && !response.url.endsWith("/favicon.ico")) {
        networkErrors.push(response.status + " " + response.url);
      }
    });

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable");
    await client.send("Network.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 960,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = client.waitFor("Page.loadEventFired", 12000).catch(() => null);
    await client.send("Page.navigate", { url });
    await loaded;
    await sleep(1000);

    const before = await evaluate(client, snapshotScript);
    const beforeShot = await screenshotHash(client);
    const target = await evaluate(client, targetScript);

    await click(client, target.x, target.y);
    await sleep(500);
    const started = await evaluate(client, snapshotScript);
    const startedShot = await screenshotHash(client);

    for (const stroke of [
      [{ x: 180, y: 520 }, { x: 420, y: 340 }, { x: 720, y: 180 }],
      [{ x: 780, y: 520 }, { x: 500, y: 330 }, { x: 240, y: 180 }],
      [{ x: 160, y: 390 }, { x: 480, y: 280 }, { x: 800, y: 390 }],
      [{ x: 480, y: 560 }, { x: 480, y: 360 }, { x: 480, y: 140 }],
    ]) {
      await drag(client, stroke);
      await sleep(140);
    }
    const pointerAfter = await evaluate(client, snapshotScript);
    const pointerAfterShot = await screenshotHash(client);

    for (const item of [
      [" ", "Space"],
      ["ArrowLeft", "ArrowLeft"],
      ["ArrowRight", "ArrowRight"],
      ["ArrowUp", "ArrowUp"],
      ["w", "KeyW"],
      ["a", "KeyA"],
      ["d", "KeyD"],
    ]) {
      await press(client, item[0], item[1]);
      await sleep(80);
    }
    await sleep(900);
    const keyboardAfter = await evaluate(client, snapshotScript);
    const keyboardAfterShot = await screenshotHash(client);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(500);
    const mobileBefore = await evaluate(client, snapshotScript);
    const mobileBeforeShot = await screenshotHash(client);
    await touchSwipe(client, [{ x: 80, y: 690 }, { x: 185, y: 500 }, { x: 310, y: 270 }]);
    await sleep(160);
    await touchSwipe(client, [{ x: 330, y: 690 }, { x: 210, y: 500 }, { x: 80, y: 270 }]);
    await sleep(160);
    await touchSwipe(client, [{ x: 195, y: 720 }, { x: 195, y: 520 }, { x: 195, y: 260 }]);
    await sleep(1800);
    const mobileAfter = await evaluate(client, snapshotScript);
    const mobileAfterShot = await screenshotHash(client);

    const after = await evaluate(client, snapshotScript);
    const gameplayDebug = await evaluate(client, gameplayDebugScript);
    const afterShot = await screenshotHash(client);

    const pointerChanged = snapshotChanged(started, pointerAfter, startedShot, pointerAfterShot);
    const keyboardChanged = snapshotChanged(pointerAfter, keyboardAfter, pointerAfterShot, keyboardAfterShot);
    const touchChanged = snapshotChanged(mobileBefore, mobileAfter, mobileBeforeShot, mobileAfterShot);
    const debugInputCoverage = gameplayDebug?.inputCoverage || {};
    const inputCoverage = {
      pointer: Boolean(pointerChanged || debugInputCoverage.pointer || debugInputCoverage.mouse),
      keyboard: Boolean(keyboardChanged || debugInputCoverage.keyboard),
      touch: Boolean(touchChanged || debugInputCoverage.touch || debugInputCoverage.gesture),
    };
    const inputCoverageOk = inputCoverage.pointer && inputCoverage.keyboard && inputCoverage.touch;
    const changed = snapshotChanged(before, after, beforeShot, afterShot) || pointerChanged || keyboardChanged || touchChanged;
    const hasVisualSurface = before.canvasCount > 0 || after.canvasCount > 0 || before.text.length > 0 || after.text.length > 0 || before.bodyChildCount > 0 || after.bodyChildCount > 0;
    const hasGameSignals = /score|level|life|health|time|hp|得分|等级|生命|时间|血量|分数/i.test(before.text + " " + after.text) || before.canvasCount > 0 || after.canvasCount > 0;
    const fatalErrors = runtimeErrors.concat(networkErrors.filter((error) => error.includes("/index.html")));
    const startGate = Boolean(before.startGate || (target.text && /start|play|begin|go|restart|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test(target.text)));
    const visualQuality = assessVisualQuality(before, after);
    const progression = assessProgression(before, after, mobileAfter, gameplayDebug);
    const blockingVisualReasons = visualQuality.reasons.filter((reason) =>
      /pixelated|pixel-art|8-bit|low-resolution scaled canvas|default browser UI|off-screen|clipped|overflows horizontally|vertical scrolling/i.test(reason),
    );
    const activeTargets = Array.isArray(gameplayDebug?.activeTargets) ? gameplayDebug.activeTargets : [];
    const targetHistory = Array.isArray(gameplayDebug?.targetHistory) ? gameplayDebug.targetHistory : [];
    const historicalReachabilityOk =
      targetHistory.length === 0 ||
      targetHistory.some((target) => target && (target.reachedUpperMiddle === true || target.reachable === true));
    const targetReachabilityOk =
      (activeTargets.length === 0 && targetHistory.length === 0) ||
      activeTargets.some((target) => target && (target.reachable === true || Number(target.y) < Number(gameplayDebug?.playfield?.bottom || 640) * 0.68)) ||
      historicalReachabilityOk;
    const targetReachabilityReasons = targetReachabilityOk
      ? []
      : ["Active gameplay targets are present but none reached the upper/middle playfield during automated play; targets may be too low or unreachable."];
    const inputCoverageReasons = inputCoverageOk
      ? []
      : ["Input coverage is incomplete; every game must visibly support mouse/pointer, keyboard, and mobile touch gestures."];
    const progressionReasons = progression.ok
      ? []
      : ["Game progression is too shallow; expected at least 3 levels, waves, rounds, stages, puzzles, or difficulty tiers."];

    const checks = {
      loaded: true,
      hasVisualSurface,
      startGate,
      changed,
      hasGameSignals,
      visualQualityOk: visualQuality.ok,
      blockingVisualIssueCount: blockingVisualReasons.length,
      targetReachabilityOk,
      inputCoverageOk,
      progressionOk: progression.ok,
      runtimeErrorCount: runtimeErrors.length,
      networkErrorCount: networkErrors.length,
      consoleErrorCount: consoleErrors.length,
    };

    let ok = fatalErrors.length === 0 && hasVisualSurface;
    if (ok && startGate && !changed) ok = false;
    if (ok && !startGate && !changed && !hasGameSignals) ok = false;
    if (ok && blockingVisualReasons.length > 0) ok = false;
    if (ok && targetReachabilityReasons.length > 0) ok = false;
    if (ok && inputCoverageReasons.length > 0) ok = false;
    if (ok && progressionReasons.length > 0) ok = false;

    const report = {
      ok,
      url,
      checks,
      clicked: target,
      before: { text: before.text.slice(0, 240), controls: before.controls, canvasCount: before.canvasCount, screenshotHash: beforeShot, visual: before.visual },
      after: { text: after.text.slice(0, 240), controls: after.controls, canvasCount: after.canvasCount, screenshotHash: afterShot, visual: after.visual },
      inputCoverage,
      progression,
      gameplayDebug,
      visualQuality: {
        ...visualQuality,
        blockingReasons: blockingVisualReasons.concat(targetReachabilityReasons, inputCoverageReasons, progressionReasons),
      },
      runtimeErrors: summarizeErrors(runtimeErrors),
      consoleErrors: summarizeErrors(consoleErrors),
      networkErrors: summarizeErrors(networkErrors),
      chromeErrors: summarizeErrors(chromeErrors),
      reason: ok ? "Playable smoke passed; non-blocking visual warnings may remain." : "Playable/visual smoke failed: " + JSON.stringify({ checks, visualQuality }),
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log("[validation] " + (ok ? "passed" : "failed") + ": " + report.reason);
    return ok;
  } finally {
    if (client) client.close();
    chrome.kill("SIGTERM");
    serverInfo.server.close();
  }
}

try {
  const ok = await runValidation();
  process.exit(ok ? 0 : 1);
} catch (error) {
  const report = {
    ok: false,
    reason: error instanceof Error ? error.message : "Validation crashed.",
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.error("[validation] crashed: " + report.reason);
  process.exit(1);
}
`;
}
