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
  "const body=document.body;" +
  "const text=(body&&body.innerText?body.innerText:'').replace(/\\s+/g,' ').trim().slice(0,1200);" +
  "const controls=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible).map((el)=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,12);" +
  "const canvases=Array.from(document.querySelectorAll('canvas')).map((canvas)=>{let data='';try{data=canvas.toDataURL('image/png').slice(0,2048);}catch{}return {w:canvas.width,h:canvas.height,data};});" +
  "const joined=(text+' '+controls.join(' '));" +
  "return {title:document.title||'',text,htmlLength:body?body.innerHTML.length:0,bodyChildCount:body?body.children.length:0,controlCount:controls.length,controls,canvasCount:canvases.length,canvases,startGate:/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test(joined)};" +
"})()";

const targetScript = "(() => {" +
  "function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;}" +
  "const els=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible);" +
  "const start=els.find((el)=>/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test((el.innerText||el.value||el.getAttribute('aria-label')||'')));" +
  "const el=start||els[0];" +
  "if(el){const r=el.getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2),text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()};}" +
  "return {x:Math.floor(window.innerWidth/2),y:Math.floor(window.innerHeight/2),text:null};" +
"})()";

async function click(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function press(client, key, code) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}

function summarizeErrors(errors) {
  return errors.map((error) => String(error).slice(0, 240)).slice(0, 8);
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
  chrome.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) chromeErrors.push(text.slice(0, 400));
  });

  let client;
  try {
    const wsUrl = await waitForPageWebSocket();
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
    await sleep(1000);

    const after = await evaluate(client, snapshotScript);
    const afterShot = await screenshotHash(client);

    const textChanged = before.text !== after.text || before.htmlLength !== after.htmlLength;
    const canvasChanged = JSON.stringify(before.canvases) !== JSON.stringify(after.canvases);
    const screenshotChanged = beforeShot !== afterShot;
    const changed = textChanged || canvasChanged || screenshotChanged;
    const hasVisualSurface = before.canvasCount > 0 || after.canvasCount > 0 || before.text.length > 0 || after.text.length > 0 || before.bodyChildCount > 0 || after.bodyChildCount > 0;
    const hasGameSignals = /score|level|life|health|time|hp|得分|等级|生命|时间|血量|分数/i.test(before.text + " " + after.text) || before.canvasCount > 0 || after.canvasCount > 0;
    const fatalErrors = runtimeErrors.concat(networkErrors.filter((error) => error.includes("/index.html")));
    const startGate = Boolean(before.startGate || (target.text && /start|play|begin|go|restart|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test(target.text)));

    const checks = {
      loaded: true,
      hasVisualSurface,
      startGate,
      changed,
      hasGameSignals,
      runtimeErrorCount: runtimeErrors.length,
      networkErrorCount: networkErrors.length,
      consoleErrorCount: consoleErrors.length,
    };

    let ok = fatalErrors.length === 0 && hasVisualSurface;
    if (ok && startGate && !changed) ok = false;
    if (ok && !startGate && !changed && !hasGameSignals) ok = false;

    const report = {
      ok,
      url,
      checks,
      clicked: target,
      before: { text: before.text.slice(0, 240), controls: before.controls, canvasCount: before.canvasCount, screenshotHash: beforeShot },
      after: { text: after.text.slice(0, 240), controls: after.controls, canvasCount: after.canvasCount, screenshotHash: afterShot },
      runtimeErrors: summarizeErrors(runtimeErrors),
      consoleErrors: summarizeErrors(consoleErrors),
      networkErrors: summarizeErrors(networkErrors),
      chromeErrors: summarizeErrors(chromeErrors),
      reason: ok ? "Playable smoke passed." : "Playable smoke failed: " + JSON.stringify(checks),
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
