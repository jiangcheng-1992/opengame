const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { PrismaClient } = require("@prisma/client");

const projectRoot = process.cwd();
const outputPath = process.argv[2] || path.join(projectRoot, "reports", "published-games-audit.json");
const chromeBin = process.env.CHROME_BIN || "chromium";
const debugPort = Number(process.env.PLAYABILITY_DEBUG_PORT || 9333);
const perGameTimeoutMs = Number(process.env.AUDIT_PER_GAME_TIMEOUT_MS || 30000);
const publicBaseUrl = (process.env.AUDIT_APP_BASE_URL || "https://opengame-production.up.railway.app").replace(/\/$/, "");
const auditGameIds = (process.env.AUDIT_GAME_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const auditLimit = process.env.AUDIT_LIMIT ? Number(process.env.AUDIT_LIMIT) : null;

function loadEnvFile(file) {
  try {
    const text = readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value.replace(/^\uFEFF/, "");
    }
  } catch {}
}

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(projectRoot, ".env.local"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value) {
  return createHash("sha256").update(value || "").digest("hex").slice(0, 16);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function materializePrivateGame(game) {
  if (game.visibility === "PUBLIC") return `${publicBaseUrl}/api/games/${game.id}/files/index.html`;
  const response = await fetch(game.playUrl, { cache: "no-store" });
  if (!response.ok) return game.playUrl;
  const html = await response.text();
  const dir = path.join(projectRoot, "tmp-audit-fixes", "_private-audit", game.id);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "index.html");
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

async function waitForPageWebSocket() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
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
        for (const listener of this.listeners.get(payload.method)) listener(payload.params || {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
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
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timeout);
        resolve(params);
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), { once: true });
  });
  return new CdpClient(socket);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }
  return result.result ? result.result.value : null;
}

async function screenshotHash(client) {
  const result = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  return hash(result.data || "");
}

const snapshotScript = `(() => {
  function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;}
  const body=document.body;
  const text=(body&&body.innerText?body.innerText:'').replace(/\\s+/g,' ').trim().slice(0,2000);
  const fullText=(body&&body.innerText?body.innerText:'')+' '+document.documentElement.innerHTML.slice(0,80000);
  const controls=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible).map((el)=>(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0,16);
  const criticalEls=Array.from(document.querySelectorAll('canvas,button,[role=button],a,input[type=button],input[type=submit],[data-hud],.hud,.game-hud,.scoreboard,.status-bar,.hud-panel,.overlay,.modal,.dialog,.result,.game-over,.win,.lose,.end-screen,[data-overlay],[data-result]')).filter(visible);
  const offscreenCritical=criticalEls.some((el)=>{const r=el.getBoundingClientRect();return r.right>window.innerWidth+24||r.bottom>window.innerHeight+24||r.left<-24||r.top<-24;});
  const canvases=Array.from(document.querySelectorAll('canvas')).map((canvas)=>{let data='';try{data=canvas.toDataURL('image/png').slice(0,2048);}catch{}const r=canvas.getBoundingClientRect();return {w:canvas.width,h:canvas.height,cssW:Math.round(r.width),cssH:Math.round(r.height),data};});
  const overflowX=Math.max(0,Math.max(document.documentElement.scrollWidth,body?body.scrollWidth:0)-window.innerWidth);
  const overflowY=Math.max(0,Math.max(document.documentElement.scrollHeight,body?body.scrollHeight:0)-window.innerHeight);
  const startGate=/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test(text+' '+controls.join(' '));
  return {title:document.title||'',text,fullText,htmlLength:body?body.innerHTML.length:0,bodyChildCount:body?body.children.length:0,controls,canvasCount:canvases.length,canvases,startGate,viewport:{width:window.innerWidth,height:window.innerHeight,overflowX,overflowY,offscreenCritical}};
})()`;

const targetScript = `(() => {
  function visible(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;}
  const els=Array.from(document.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')).filter(visible);
  const start=els.find((el)=>/\\b(start|play|begin|go|restart)\\b|开始|冒险|启动|进入|开局|再来|重玩|播放/i.test((el.innerText||el.value||el.getAttribute('aria-label')||'')));
  const el=start||els[0];
  if(el){const r=el.getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2),text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim()};}
  return {x:Math.floor(window.innerWidth/2),y:Math.floor(window.innerHeight/2),text:null};
})()`;

const debugScript = `(() => {
  try {
    const hook=window.__OPENGAME_DEBUG__;
    if (typeof hook === 'function') return hook();
    if (hook && typeof hook === 'object') return hook;
    return null;
  } catch (error) {
    return { error: String(error && error.message || error) };
  }
})()`;

function changed(a, b, shotA, shotB) {
  if (!a || !b) return false;
  return a.text !== b.text || a.htmlLength !== b.htmlLength || JSON.stringify(a.canvases) !== JSON.stringify(b.canvases) || shotA !== shotB;
}

function numberFrom(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function progressionOk(before, after, mobileAfter, debug) {
  const maxProgression = Math.max(
    numberFrom(debug?.maxLevel),
    numberFrom(debug?.maxWave),
    numberFrom(debug?.maxRound),
    numberFrom(debug?.maxStage),
    numberFrom(debug?.totalLevels),
    numberFrom(debug?.totalWaves),
    numberFrom(debug?.totalRounds),
    numberFrom(debug?.totalStages),
  );
  const source = [before?.fullText, after?.fullText, mobileAfter?.fullText, JSON.stringify(debug || {})].join(" ");
  const signals = source.match(/\\b(level|wave|round|stage|mission|room|chapter|puzzle)\\b|关卡|第\\s*\\d+\\s*关|波次|第\\s*\\d+\\s*波|回合|阶段|目标进度|难度/gi) || [];
  const explicit = /(\b[3-9]\s*(levels?|waves?|rounds?|stages?|missions?|rooms?|puzzles?)\b)|([三四五六七八九十]\s*(关|波|回合|阶段))|(\b\d+\s*\/\s*[3-9]\b)/i.test(source);
  return { ok: maxProgression >= 3 || explicit || signals.length >= 2, maxProgression, signals: signals.slice(0, 8) };
}

function gameplayCoherenceOk(before, after, mobileAfter, debug) {
  const source = [before?.fullText, after?.fullText, mobileAfter?.fullText, JSON.stringify(debug || {})].join(" ");
  const ruleSignals = source.match(/\b(click|tap|drag|swipe|move|shoot|jump|collect|avoid|match|clear|escape|block|blocked|aim|release)\b|点击|轻触|拖拽|滑动|移动|发射|跳跃|收集|躲避|消除|清空|逃离|挡住|阻挡|瞄准|松手/gi) || [];
  const winSignals = source.match(/\b(win|victory|clear|complete|goal|target|finish|pass|score|level up)\b|胜利|通关|过关|目标|完成|清空|得分|命中|逃离/gi) || [];
  const restartSignals = source.match(/\b(restart|retry|again|replay|reset|next level)\b|重玩|重试|再来|重新|复位|下一关|继续/gi) || [];
  const impossibleSignals = source.match(/\b(deadlock|impossible|unreachable|unwinnable|unsolvable|stuck forever)\b|死局|无解|无法通关|不可达|永远卡住/gi) || [];
  const explicitSolvable =
    debug?.solvable === true ||
    debug?.canWin === true ||
    debug?.allLevelsSolvable === true ||
    (Array.isArray(debug?.levels) && debug.levels.length > 0 && debug.levels.every((level) => level && level.solvable !== false)) ||
    (Array.isArray(debug?.levelPlans) && debug.levelPlans.length > 0 && debug.levelPlans.every((level) => level && level.solvable !== false));
  const explicitlyImpossible =
    debug?.solvable === false ||
    debug?.canWin === false ||
    debug?.allLevelsSolvable === false ||
    impossibleSignals.length > 0 ||
    (Array.isArray(debug?.levels) && debug.levels.some((level) => level && level.solvable === false)) ||
    (Array.isArray(debug?.levelPlans) && debug.levelPlans.some((level) => level && level.solvable === false));
  const needsSolvability = /traffic|parking|unblock|puzzle|关卡|闯关|解谜|堵车|挪车|篮球|投篮/i.test(source);

  return {
    ok: ruleSignals.length > 0 && winSignals.length > 0 && restartSignals.length > 0 && !explicitlyImpossible && (!needsSolvability || explicitSolvable),
    ruleSignals: ruleSignals.slice(0, 8),
    winSignals: winSignals.slice(0, 8),
    restartSignals: restartSignals.slice(0, 8),
    explicitSolvable,
    explicitlyImpossible,
  };
}

async function click(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function drag(client, points) {
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
  const [first, ...rest] = points;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first.x, y: first.y, radiusX: 8, radiusY: 8, id: 1 }] });
  for (const point of rest) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, id: 1 }] });
    await sleep(55);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function scoreIssues(issues) {
  return issues.reduce((total, issue) => total + issue.weight, 0);
}

async function auditGame(client, game) {
  const runtimeErrors = [];
  const networkErrors = [];
  const auditUrl = game.auditUrl || game.playUrl;
  client.on("Runtime.exceptionThrown", (params) => {
    const detail = params.exceptionDetails || {};
    runtimeErrors.push(detail.text || (detail.exception && detail.exception.description) || "Runtime exception");
  });
  client.on("Network.responseReceived", (params) => {
    const response = params.response || {};
    if (response.status >= 400 && response.url && !response.url.endsWith("/favicon.ico")) {
      networkErrors.push(`${response.status} ${response.url}`);
    }
  });

  await client.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  const loaded = client.waitFor("Page.loadEventFired", 12000).catch(() => null);
  await client.send("Page.navigate", { url: auditUrl });
  await loaded;
  await sleep(600);

  const before = await evaluate(client, snapshotScript);
  const beforeShot = await screenshotHash(client);
  const target = await evaluate(client, targetScript);
  await click(client, target.x, target.y);
  await sleep(300);
  const started = await evaluate(client, snapshotScript);
  const startedShot = await screenshotHash(client);

  for (const stroke of [
    [{ x: 180, y: 520 }, { x: 420, y: 340 }, { x: 720, y: 180 }],
    [{ x: 780, y: 520 }, { x: 500, y: 330 }, { x: 240, y: 180 }],
    [{ x: 480, y: 560 }, { x: 480, y: 360 }, { x: 480, y: 140 }],
  ]) {
    await drag(client, stroke);
    await sleep(80);
  }
  const pointerAfter = await evaluate(client, snapshotScript);
  const pointerAfterShot = await screenshotHash(client);

  for (const item of [[" ", "Space"], ["ArrowLeft", "ArrowLeft"], ["ArrowRight", "ArrowRight"], ["ArrowUp", "ArrowUp"], ["w", "KeyW"], ["a", "KeyA"], ["d", "KeyD"]]) {
    await press(client, item[0], item[1]);
    await sleep(45);
  }
  await sleep(450);
  const keyboardAfter = await evaluate(client, snapshotScript);
  const keyboardAfterShot = await screenshotHash(client);

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(250);
  const mobileBefore = await evaluate(client, snapshotScript);
  const mobileBeforeShot = await screenshotHash(client);
  await touchSwipe(client, [{ x: 80, y: 690 }, { x: 185, y: 500 }, { x: 310, y: 270 }]);
  await sleep(90);
  await touchSwipe(client, [{ x: 330, y: 690 }, { x: 210, y: 500 }, { x: 80, y: 270 }]);
  await sleep(90);
  await touchSwipe(client, [{ x: 195, y: 720 }, { x: 195, y: 520 }, { x: 195, y: 260 }]);
  await sleep(700);
  const mobileAfter = await evaluate(client, snapshotScript);
  const mobileAfterShot = await screenshotHash(client);
  const debug = await evaluate(client, debugScript);

  const pointerChanged = changed(started, pointerAfter, startedShot, pointerAfterShot);
  const keyboardChanged = changed(pointerAfter, keyboardAfter, pointerAfterShot, keyboardAfterShot);
  const touchChanged = changed(mobileBefore, mobileAfter, mobileBeforeShot, mobileAfterShot);
  const debugInputCoverage = debug?.inputCoverage || {};
  const pointerOk = Boolean(pointerChanged || debugInputCoverage.pointer || debugInputCoverage.mouse);
  const keyboardOk = Boolean(keyboardChanged || debugInputCoverage.keyboard);
  const touchOk = Boolean(touchChanged || debugInputCoverage.touch || debugInputCoverage.gesture);
  const overallChanged = changed(before, mobileAfter, beforeShot, mobileAfterShot) || pointerOk || keyboardOk || touchOk;
  const progression = progressionOk(before, keyboardAfter, mobileAfter, debug);
  const gameplayCoherence = gameplayCoherenceOk(before, keyboardAfter, mobileAfter, debug);
  const activeTargets = Array.isArray(debug?.activeTargets) ? debug.activeTargets : [];
  const targetHistory = Array.isArray(debug?.targetHistory) ? debug.targetHistory : [];
  const targetReachabilityOk =
    activeTargets.length === 0 && targetHistory.length === 0
      ? true
      : activeTargets.some((target) => target && (target.reachable === true || Number(target.y) < Number(debug?.playfield?.bottom || 640) * 0.68)) ||
        targetHistory.some((target) => target && (target.reachedUpperMiddle === true || target.reachable === true));

  const issues = [];
  if (runtimeErrors.length > 0) issues.push({ code: "runtime_error", weight: 100, message: runtimeErrors[0].slice(0, 240) });
  if (networkErrors.some((error) => error.includes("/index.html"))) issues.push({ code: "index_network_error", weight: 100, message: networkErrors[0] });
  if (!before.bodyChildCount && !before.canvasCount) issues.push({ code: "blank_page", weight: 100, message: "页面没有可见内容。" });
  if (before.viewport.overflowX > 24 || mobileAfter.viewport.overflowX > 24) issues.push({ code: "horizontal_overflow", weight: 45, message: "画面存在横向溢出。" });
  if (before.viewport.offscreenCritical || mobileAfter.viewport.offscreenCritical) issues.push({ code: "offscreen_critical", weight: 45, message: "关键 UI 或游戏画面出屏/被裁切。" });
  if (before.viewport.overflowY > Math.max(120, before.viewport.height * 0.12) || mobileAfter.viewport.overflowY > Math.max(160, mobileAfter.viewport.height * 0.16)) issues.push({ code: "vertical_overflow", weight: 35, message: "需要明显滚动才能看全游戏。" });
  if (before.startGate && !overallChanged) issues.push({ code: "start_no_response", weight: 80, message: "点击开始后画面/状态没有变化。" });
  if (!pointerOk) issues.push({ code: "pointer_no_response", weight: 30, message: "鼠标拖拽/点击未观察到明显响应。" });
  if (!keyboardOk) issues.push({ code: "keyboard_no_response", weight: 25, message: "键盘输入未观察到明显响应。" });
  if (!touchOk) issues.push({ code: "touch_no_response", weight: 35, message: "手机触摸/滑动未观察到明显响应。" });
  if (!targetReachabilityOk) issues.push({ code: "target_unreachable", weight: 50, message: "目标存在但未进入上/中部可触达区域。" });
  if (!progression.ok) issues.push({ code: "shallow_progression", weight: 20, message: "未识别到 3 个以上关卡/波次/阶段。" });
  if (!gameplayCoherence.ok) issues.push({ code: "gameplay_incoherent_or_unsolvable", weight: 70, message: "规则说明、胜负目标、重试反馈或关卡可通关信号不完整。" });

  return {
    id: game.id,
    title: game.title,
    version: game.version,
    visibility: game.visibility,
    auditUrl,
    playUrl: game.playUrl,
    severity: scoreIssues(issues),
    issues,
    checks: {
      loaded: true,
      startGate: before.startGate,
      overallChanged,
      pointerChanged: pointerOk,
      keyboardChanged: keyboardOk,
      touchChanged: touchOk,
      targetReachabilityOk,
      progressionOk: progression.ok,
      gameplayCoherenceOk: gameplayCoherence.ok,
      desktopViewport: before.viewport,
      mobileViewport: mobileAfter.viewport,
      runtimeErrorCount: runtimeErrors.length,
      networkErrorCount: networkErrors.length,
    },
    clicked: target,
    progression,
    gameplayCoherence,
    debug,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const prisma = new PrismaClient();
  let games = await prisma.game.findMany({
    where: { status: "READY", playUrl: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, version: true, visibility: true, playUrl: true },
  });
  if (auditGameIds.length > 0) {
    const allowed = new Set(auditGameIds);
    games = games.filter((game) => allowed.has(game.id));
  }
  if (Number.isFinite(auditLimit) && auditLimit !== null && auditLimit > 0) {
    games = games.slice(0, auditLimit);
  }
  await prisma.$disconnect();

  const chrome = spawn(chromeBin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
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
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable");
    await client.send("Network.enable");

    const results = [];
    const byPlayUrl = new Map();
    const writePartial = () => {
      const sorted = [...results].sort((a, b) => b.severity - a.severity);
      const report = {
        generatedAt: new Date().toISOString(),
        partial: sorted.length < games.length,
        gameCount: games.length,
        scannedCount: sorted.length,
        issueCount: sorted.filter((result) => result.severity > 0).length,
        chromeErrors: chromeErrors.slice(-8),
        results: sorted,
      };
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(report, null, 2));
    };

    for (let index = 0; index < games.length; index++) {
      const game = {
        ...games[index],
        auditUrl: await materializePrivateGame(games[index]),
      };
      process.stdout.write(`[audit] ${index + 1}/${games.length} ${game.id} ${game.title}\n`);
      try {
        if (byPlayUrl.has(game.playUrl)) {
          const cached = byPlayUrl.get(game.playUrl);
          results.push({ ...cached, id: game.id, title: game.title, version: game.version, visibility: game.visibility, auditUrl: game.auditUrl, duplicateOf: cached.id });
        } else {
          const result = await Promise.race([
            auditGame(client, game),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Audit timed out after ${perGameTimeoutMs}ms.`)), perGameTimeoutMs)),
          ]);
          byPlayUrl.set(game.playUrl, result);
          results.push(result);
        }
      } catch (error) {
        results.push({
          id: game.id,
          title: game.title,
          version: game.version,
          visibility: game.visibility,
          severity: 120,
          issues: [{ code: "audit_crashed", weight: 120, message: error instanceof Error ? error.message : String(error) }],
        });
      }
      writePartial();
    }

    results.sort((a, b) => b.severity - a.severity);
    const report = {
      generatedAt: new Date().toISOString(),
      gameCount: games.length,
      issueCount: results.filter((result) => result.severity > 0).length,
      chromeErrors: chromeErrors.slice(-8),
      results,
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`[audit] wrote ${outputPath}`);
    console.log(JSON.stringify(report.results.slice(0, 12).map((result) => ({
      id: result.id,
      title: result.title,
      severity: result.severity,
      issues: result.issues.map((issue) => issue.code),
    })), null, 2));
  } finally {
    if (client) client.close();
    chrome.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
