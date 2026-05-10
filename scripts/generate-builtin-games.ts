import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_GAMES } from "../lib/builtin-games";

const root = process.cwd();
const publicRoot = path.join(root, "public", "builtin-games");
const sharedRoot = path.join(publicRoot, "shared");

const engineJs = String.raw`
(() => {
  const config = window.BUILTIN_GAME_CONFIG;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const keys = new Set();
  const pointer = { x: W / 2, y: H / 2, down: false, clicked: false };
  const colors = config.theme;
  let state = {};
  let last = 0;
  let started = false;
  let message = "点击或按空格开始";

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function resetBase(duration = 60) {
    state = {
      score: 0,
      lives: 3,
      time: duration,
      over: false,
      win: false,
      tick: 0,
      combo: 0,
      player: { x: W * 0.2, y: H * 0.5, r: 16, vx: 0, vy: 0, grounded: false },
      items: [],
      hazards: [],
      bullets: [],
      enemies: [],
      particles: [],
    };
    message = "开始";
  }

  function init() {
    resetBase();
    const type = config.gameType;
    if (type === "breakout") initBreakout();
    else if (type === "goalie") initGoalie();
    else if (type === "platform") initPlatform();
    else if (type === "beam") initBeam();
    else if (type === "sokoban") initSokoban();
    else if (type === "connect") initConnect();
    else if (type === "lock") initLock();
    else if (type === "memory") initMemory();
    else if (type === "runner") initRunner();
    else if (type === "lane") initLane();
    else if (type === "turret") initTurret();
    else if (type === "defense") initDefense();
    else if (type === "swarm") initSwarm();
    else if (type === "tower") initTower();
    else if (type === "routing") initRouting();
    else if (type === "recipe") initRecipe();
    else if (type === "loading") initLoading();
    else if (type === "rhythm") initRhythm();
    else if (type === "pong") initPong();
    else if (type === "timing") initTiming();
    else initDodge();
  }

  function start() {
    if (state.over) init();
    started = true;
    message = "";
  }

  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.code === "Space") start();
    if (config.gameType === "rhythm") rhythmKey(event.code);
    if (config.gameType === "memory") memoryKey(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));

  function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    pointer.x = ((clientX - rect.left) / rect.width) * W;
    pointer.y = ((clientY - rect.top) / rect.height) * H;
  }

  for (const name of ["pointerdown", "pointermove"]) {
    canvas.addEventListener(name, (event) => {
      pointerPos(event);
      if (name === "pointerdown") {
        pointer.down = true;
        pointer.clicked = true;
        start();
      }
    });
  }
  window.addEventListener("pointerup", () => {
    pointer.down = false;
  });

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, colors.background);
    grad.addColorStop(0.56, "#090d14");
    grad.addColorStop(1, colors.secondary);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = colors.primary;
    for (let x = -80; x < W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x + (state.tick % 80), 0);
      ctx.lineTo(x - 180 + (state.tick % 80), H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    ctx.fillStyle = "rgba(3, 7, 12, 0.58)";
    roundRect(22, 18, W - 44, 50, 12, true);
    ctx.fillStyle = "#eefaf6";
    ctx.font = "800 18px system-ui, sans-serif";
    ctx.fillText(config.title, 42, 50);
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.fillStyle = colors.accent;
    ctx.fillText("分数 " + Math.floor(state.score), W - 220, 49);
    ctx.fillStyle = "#c9d7d7";
    ctx.fillText("生命 " + state.lives, W - 120, 49);
    if (state.time !== undefined) ctx.fillText("时间 " + Math.max(0, Math.ceil(state.time)), W - 330, 49);
  }

  function drawOverlay() {
    if (started && !state.over && !message) return;
    ctx.fillStyle = "rgba(0, 0, 0, 0.56)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#eefaf6";
    ctx.textAlign = "center";
    ctx.font = "900 42px system-ui, sans-serif";
    ctx.fillText(state.over ? (state.win ? "完成挑战" : "再试一次") : config.title, W / 2, H / 2 - 32);
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillStyle = "#c9d7d7";
    ctx.fillText(state.over ? "点击或按空格重新开始" : message, W / 2, H / 2 + 10);
    ctx.fillText(config.summary, W / 2, H / 2 + 42);
    ctx.textAlign = "left";
  }

  function roundRect(x, y, w, h, r, fill = false, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function end(win = false) {
    state.over = true;
    state.win = win;
    started = false;
  }

  function movePlayer(dt, speed = 260) {
    const p = state.player;
    const mx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    const my = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    p.x = clamp(p.x + mx * speed * dt, 28, W - 28);
    p.y = clamp(p.y + my * speed * dt, 92, H - 28);
  }

  function initDodge() {
    resetBase(55);
    state.player.x = W * 0.18;
    state.player.y = H * 0.55;
    for (let i = 0; i < 8; i++) spawnItem();
    for (let i = 0; i < 6; i++) spawnHazard();
  }

  function spawnItem() {
    state.items.push({ x: rand(120, W - 50), y: rand(100, H - 50), r: 10, pulse: rand(0, 10) });
  }

  function spawnHazard() {
    state.hazards.push({ x: rand(W * 0.45, W - 30), y: rand(100, H - 40), r: rand(12, 20), vx: rand(-120, -60), vy: rand(-90, 90) });
  }

  function updateDodge(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    movePlayer(dt, 290);
    const p = state.player;
    for (const item of state.items) {
      if (!item.dead && dist(p, item) < p.r + item.r) {
        item.dead = true;
        state.score += 100;
        spawnItem();
      }
    }
    state.items = state.items.filter((item) => !item.dead).slice(-12);
    for (const h of state.hazards) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.y < 90 || h.y > H - 20) h.vy *= -1;
      if (h.x < -30) Object.assign(h, { x: W + 40, y: rand(90, H - 30), vx: rand(-160, -70) });
      if (dist(p, h) < p.r + h.r) {
        state.lives -= 1;
        Object.assign(h, { x: W + 40, y: rand(90, H - 30) });
        if (state.lives <= 0) end(false);
      }
    }
  }

  function drawDodge() {
    for (const item of state.items) circle(item.x, item.y, item.r + Math.sin(state.tick * 0.08 + item.pulse) * 2, colors.accent);
    for (const h of state.hazards) circle(h.x, h.y, h.r, colors.secondary);
    circle(state.player.x, state.player.y, state.player.r, colors.primary);
  }

  function initBreakout() {
    resetBase(90);
    state.paddle = { x: W / 2 - 70, y: H - 54, w: 140, h: 16 };
    state.ball = { x: W / 2, y: H - 86, r: 10, vx: 210, vy: -230 };
    state.bricks = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 9; x++) state.bricks.push({ x: 58 + x * 94, y: 100 + y * 34, w: 76, h: 22, hp: 1 });
    }
  }

  function updateBreakout(dt) {
    const paddle = state.paddle;
    paddle.x = clamp(pointer.down ? pointer.x - paddle.w / 2 : paddle.x, 18, W - paddle.w - 18);
    if (keys.has("ArrowLeft") || keys.has("KeyA")) paddle.x -= 420 * dt;
    if (keys.has("ArrowRight") || keys.has("KeyD")) paddle.x += 420 * dt;
    paddle.x = clamp(paddle.x, 18, W - paddle.w - 18);
    const b = state.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 15 || b.x > W - 15) b.vx *= -1;
    if (b.y < 84) b.vy *= -1;
    if (b.y > H + 20) {
      state.lives -= 1;
      Object.assign(b, { x: W / 2, y: H - 86, vx: 210, vy: -230 });
      if (state.lives <= 0) end(false);
    }
    if (b.x > paddle.x && b.x < paddle.x + paddle.w && b.y + b.r > paddle.y && b.y < paddle.y + paddle.h) {
      b.vy = -Math.abs(b.vy);
      b.vx += (b.x - (paddle.x + paddle.w / 2)) * 3;
    }
    for (const brick of state.bricks) {
      if (!brick.dead && b.x > brick.x && b.x < brick.x + brick.w && b.y > brick.y && b.y < brick.y + brick.h) {
        brick.dead = true;
        b.vy *= -1;
        state.score += 80;
      }
    }
    if (state.bricks.every((brick) => brick.dead)) end(true);
  }

  function drawBreakout() {
    for (const brick of state.bricks) {
      if (brick.dead) continue;
      ctx.fillStyle = colors.secondary;
      roundRect(brick.x, brick.y, brick.w, brick.h, 6, true);
    }
    ctx.fillStyle = colors.primary;
    roundRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, 8, true);
    circle(state.ball.x, state.ball.y, state.ball.r, colors.accent);
  }

  function initGoalie() {
    resetBase(50);
    state.goalie = { y: H / 2, h: 95 };
    state.balls = [];
    state.spawn = 0;
  }

  function updateGoalie(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    if (keys.has("ArrowUp") || keys.has("KeyW")) state.goalie.y -= 330 * dt;
    if (keys.has("ArrowDown") || keys.has("KeyS")) state.goalie.y += 330 * dt;
    state.goalie.y = clamp(state.goalie.y, 100, H - 60);
    state.spawn -= dt;
    if (state.spawn <= 0) {
      state.balls.push({ x: W - 30, y: rand(110, H - 55), r: 12, vx: -rand(240, 360) });
      state.spawn = rand(0.7, 1.2);
    }
    for (const ball of state.balls) {
      ball.x += ball.vx * dt;
      if (ball.x < 72 && ball.y > state.goalie.y - state.goalie.h / 2 && ball.y < state.goalie.y + state.goalie.h / 2) {
        ball.dead = true;
        state.score += 120;
      } else if (ball.x < 22) {
        ball.dead = true;
        state.lives -= 1;
        if (state.lives <= 0) end(false);
      }
    }
    state.balls = state.balls.filter((ball) => !ball.dead);
  }

  function drawGoalie() {
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 6;
    ctx.strokeRect(28, 96, 54, H - 140);
    ctx.fillStyle = colors.primary;
    roundRect(60, state.goalie.y - state.goalie.h / 2, 18, state.goalie.h, 9, true);
    for (const ball of state.balls) circle(ball.x, ball.y, ball.r, colors.accent);
  }

  function initPlatform() {
    resetBase(55);
    state.player = { x: 120, y: 380, r: 16, vx: 0, vy: 0, grounded: false };
    state.scroll = 0;
    state.platforms = [
      { x: 80, y: 455, w: 180 },
      { x: 330, y: 390, w: 150 },
      { x: 560, y: 330, w: 140 },
      { x: 760, y: 430, w: 160 },
      { x: 1010, y: 360, w: 150 },
    ];
    state.items = [{ x: 380, y: 350 }, { x: 620, y: 288 }, { x: 820, y: 390 }];
  }

  function updatePlatform(dt) {
    const p = state.player;
    if ((keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW")) && p.grounded) {
      p.vy = -480;
      p.grounded = false;
    }
    p.vy += 980 * dt;
    p.x += 150 * dt;
    p.y += p.vy * dt;
    state.scroll = p.x - 150;
    p.grounded = false;
    for (const pl of state.platforms) {
      const sx = pl.x - state.scroll;
      if (p.x - state.scroll > sx - 8 && p.x - state.scroll < sx + pl.w + 8 && p.y + p.r > pl.y && p.y + p.r < pl.y + 28 && p.vy >= 0) {
        p.y = pl.y - p.r;
        p.vy = 0;
        p.grounded = true;
      }
    }
    if (p.y > H + 80) end(false);
    for (const item of state.items) {
      if (!item.dead && Math.hypot(p.x - item.x, p.y - item.y) < 34) {
        item.dead = true;
        state.score += 150;
      }
    }
    const lastPlatform = state.platforms[state.platforms.length - 1];
    if (lastPlatform.x - state.scroll < W) {
      state.platforms.push({ x: lastPlatform.x + rand(210, 280), y: rand(300, 470), w: rand(120, 190) });
      state.items.push({ x: lastPlatform.x + rand(240, 310), y: rand(250, 360) });
    }
    if (state.score >= 900) end(true);
  }

  function drawPlatform() {
    for (const pl of state.platforms) {
      const sx = pl.x - state.scroll;
      ctx.fillStyle = colors.secondary;
      roundRect(sx, pl.y, pl.w, 18, 9, true);
    }
    for (const item of state.items) if (!item.dead) circle(item.x - state.scroll, item.y, 10, colors.accent);
    circle(state.player.x - state.scroll, state.player.y, state.player.r, colors.primary);
  }

  function initBeam() {
    resetBase(120);
    state.grid = [
      ["S", ".", "/", ".", "."],
      [".", "\\", ".", "/", "."],
      [".", ".", "#", ".", "C"],
      [".", "/", ".", "\\", "."],
      [".", ".", ".", ".", "."],
    ];
    state.beam = [];
  }

  function traceBeam() {
    let x = 0, y = 0, dx = 1, dy = 0;
    const path = [];
    for (let step = 0; step < 30; step++) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x > 4 || y > 4) break;
      path.push({ x, y });
      const cell = state.grid[y][x];
      if (cell === "#") break;
      if (cell === "C") {
        state.score = 1000;
        end(true);
        break;
      }
      if (cell === "/") [dx, dy] = [-dy, -dx];
      if (cell === "\\") [dx, dy] = [dy, dx];
    }
    state.beam = path;
  }

  function updateBeam() {
    if (pointer.clicked) {
      const size = 76, ox = W / 2 - size * 2.5, oy = 110;
      const gx = Math.floor((pointer.x - ox) / size);
      const gy = Math.floor((pointer.y - oy) / size);
      if (gx >= 0 && gx < 5 && gy >= 0 && gy < 5) {
        const cell = state.grid[gy][gx];
        if (cell === "/") state.grid[gy][gx] = "\\";
        else if (cell === "\\") state.grid[gy][gx] = "/";
      }
    }
    traceBeam();
  }

  function drawBeam() {
    const size = 76, ox = W / 2 - size * 2.5, oy = 110;
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      ctx.strokeRect(ox + x * size, oy + y * size, size, size);
      const cell = state.grid[y][x];
      if (cell === "/" || cell === "\\") {
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 5;
        ctx.beginPath();
        if (cell === "/") { ctx.moveTo(ox + x * size + 14, oy + (y + 1) * size - 14); ctx.lineTo(ox + (x + 1) * size - 14, oy + y * size + 14); }
        else { ctx.moveTo(ox + x * size + 14, oy + y * size + 14); ctx.lineTo(ox + (x + 1) * size - 14, oy + (y + 1) * size - 14); }
        ctx.stroke();
      }
      if (cell === "C") circle(ox + x * size + size / 2, oy + y * size + size / 2, 18, colors.accent);
      if (cell === "#") { ctx.fillStyle = "#111"; ctx.fillRect(ox + x * size + 8, oy + y * size + 8, size - 16, size - 16); }
    }
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ox + 38, oy + 38);
    for (const p of state.beam) ctx.lineTo(ox + p.x * size + 38, oy + p.y * size + 38);
    ctx.stroke();
  }

  function initSokoban() {
    resetBase(200);
    state.map = ["#######", "#..T..#", "#.B...#", "#..PBT#", "#..T..#", "#######"].map((row) => row.split(""));
    state.moves = 0;
  }

  function updateSokoban() {
    const dirs = [["ArrowUp", 0, -1], ["KeyW", 0, -1], ["ArrowDown", 0, 1], ["KeyS", 0, 1], ["ArrowLeft", -1, 0], ["KeyA", -1, 0], ["ArrowRight", 1, 0], ["KeyD", 1, 0]];
    if (!state.stepCooldown) state.stepCooldown = 0;
    state.stepCooldown -= 1;
    if (state.stepCooldown > 0) return;
    const dir = dirs.find(([code]) => keys.has(code));
    if (!dir) return;
    const dx = dir[1], dy = dir[2];
    let px = 0, py = 0;
    for (let y = 0; y < state.map.length; y++) for (let x = 0; x < state.map[y].length; x++) if (state.map[y][x] === "P") { px = x; py = y; }
    const nx = px + dx, ny = py + dy, bx = nx + dx, by = ny + dy;
    const next = state.map[ny][nx];
    if (next === "#") return;
    if (next === "B" && (state.map[by][bx] === "." || state.map[by][bx] === "T")) {
      state.map[by][bx] = "B";
      state.map[ny][nx] = "P";
      state.map[py][px] = ".";
    } else if (next === "." || next === "T") {
      state.map[ny][nx] = "P";
      state.map[py][px] = ".";
    }
    state.moves += 1;
    state.stepCooldown = 9;
    state.score = Math.max(0, 1000 - state.moves * 10);
    let boxesOnTargets = 0;
    for (const [x, y] of [[3, 1], [5, 3], [3, 4]]) if (state.map[y][x] === "B") boxesOnTargets++;
    if (boxesOnTargets >= 2) end(true);
  }

  function drawSokoban() {
    const size = 62, ox = W / 2 - 217, oy = 116;
    const targets = new Set(["3,1", "5,3", "3,4"]);
    for (let y = 0; y < state.map.length; y++) for (let x = 0; x < state.map[y].length; x++) {
      ctx.fillStyle = targets.has(x + "," + y) ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.04)";
      ctx.fillRect(ox + x * size, oy + y * size, size - 3, size - 3);
      const cell = state.map[y][x];
      if (cell === "#") { ctx.fillStyle = colors.secondary; ctx.fillRect(ox + x * size, oy + y * size, size - 3, size - 3); }
      if (cell === "B") { ctx.fillStyle = colors.accent; roundRect(ox + x * size + 9, oy + y * size + 9, 44, 44, 8, true); }
      if (cell === "P") circle(ox + x * size + 30, oy + y * size + 30, 18, colors.primary);
    }
  }

  function initConnect() {
    resetBase(120);
    state.nodes = [
      { x: 160, y: 160, c: colors.primary }, { x: 780, y: 420, c: colors.primary },
      { x: 780, y: 160, c: colors.accent }, { x: 160, y: 420, c: colors.accent },
      { x: 470, y: 130, c: colors.secondary }, { x: 470, y: 460, c: colors.secondary },
    ];
    state.links = [];
    state.selected = null;
  }

  function updateConnect() {
    if (!pointer.clicked) return;
    const hit = state.nodes.findIndex((n) => Math.hypot(pointer.x - n.x, pointer.y - n.y) < 28);
    if (hit < 0) return;
    if (state.selected === null) state.selected = hit;
    else {
      const a = state.nodes[state.selected], b = state.nodes[hit];
      if (a.c === b.c && state.selected !== hit && !state.links.some((l) => l.c === a.c)) {
        state.links.push({ a: state.selected, b: hit, c: a.c });
        state.score += 250;
      }
      state.selected = null;
    }
    if (state.links.length === 3) end(true);
  }

  function drawConnect() {
    ctx.lineWidth = 10;
    for (const link of state.links) {
      const a = state.nodes[link.a], b = state.nodes[link.b];
      ctx.strokeStyle = link.c;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of state.nodes) circle(n.x, n.y, 26, n.c);
  }

  function initLock() {
    resetBase(100);
    state.code = [Math.floor(rand(1, 9)), Math.floor(rand(1, 9)), Math.floor(rand(1, 9))];
    state.guess = [1, 1, 1];
    state.feedback = "调整数字，点击尝试";
  }

  function updateLock() {
    if (!pointer.clicked) return;
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 160 + i * 120;
      if (pointer.x > x && pointer.x < x + 88 && pointer.y > 190 && pointer.y < 250) state.guess[i] = (state.guess[i] % 9) + 1;
    }
    if (pointer.x > W / 2 - 70 && pointer.x < W / 2 + 70 && pointer.y > 330 && pointer.y < 386) {
      let exact = 0, higher = 0, lower = 0;
      for (let i = 0; i < 3; i++) {
        if (state.guess[i] === state.code[i]) exact++;
        else if (state.guess[i] < state.code[i]) higher++;
        else lower++;
      }
      state.feedback = exact + " 位正确，" + higher + " 位需要更高，" + lower + " 位需要更低";
      state.score += exact * 80;
      if (exact === 3) end(true);
    }
  }

  function drawLock() {
    ctx.textAlign = "center";
    ctx.font = "900 58px system-ui";
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 160 + i * 120;
      ctx.fillStyle = "rgba(255,255,255,.08)";
      roundRect(x, 190, 88, 60, 12, true);
      ctx.fillStyle = colors.accent;
      ctx.fillText(state.guess[i], x + 44, 238);
    }
    ctx.fillStyle = colors.primary;
    roundRect(W / 2 - 70, 330, 140, 56, 12, true);
    ctx.fillStyle = "#031b14";
    ctx.font = "900 18px system-ui";
    ctx.fillText("尝试", W / 2, 365);
    ctx.fillStyle = "#c9d7d7";
    ctx.fillText(state.feedback, W / 2, 440);
    ctx.textAlign = "left";
  }

  function initMemory() {
    resetBase(120);
    state.sequence = [0, 1, 2];
    state.input = [];
    state.show = 3.2;
    state.round = 1;
  }

  function memoryKey(code) {
    if (!started || state.show > 0 || config.gameType !== "memory") return;
    const map = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3 };
    if (map[code] === undefined) return;
    state.input.push(map[code]);
    const idx = state.input.length - 1;
    if (state.input[idx] !== state.sequence[idx]) {
      state.lives -= 1;
      state.input = [];
      if (state.lives <= 0) end(false);
    } else if (state.input.length === state.sequence.length) {
      state.score += state.sequence.length * 120;
      state.round++;
      if (state.round > 5) end(true);
      state.sequence.push(Math.floor(rand(0, 4)));
      state.input = [];
      state.show = 2.4;
    }
  }

  function updateMemory(dt) {
    state.show = Math.max(0, state.show - dt);
  }

  function drawMemory() {
    const pads = [
      { x: 280, y: 170 }, { x: 500, y: 170 }, { x: 280, y: 350 }, { x: 500, y: 350 },
    ];
    const activeIndex = state.show > 0 ? state.sequence[Math.floor(state.tick / 28) % state.sequence.length] : -1;
    pads.forEach((p, index) => {
      ctx.fillStyle = index === activeIndex ? colors.accent : (state.input.includes(index) ? colors.primary : "rgba(255,255,255,.08)");
      roundRect(p.x, p.y, 160, 120, 16, true);
      ctx.fillStyle = "#eefaf6";
      ctx.font = "900 28px system-ui";
      ctx.fillText(["A", "S", "D", "F"][index], p.x + 66, p.y + 72);
    });
  }

  function initRunner() {
    resetBase(50);
    state.player = { x: 120, y: 438, r: 17, vy: 0, grounded: true };
    state.obstacles = [];
    state.spawn = 0;
  }

  function updateRunner(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    const p = state.player;
    if ((keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW")) && p.grounded) { p.vy = -520; p.grounded = false; }
    p.vy += 1150 * dt; p.y += p.vy * dt;
    if (p.y > 438) { p.y = 438; p.vy = 0; p.grounded = true; }
    state.spawn -= dt;
    if (state.spawn <= 0) { state.obstacles.push({ x: W + 40, y: 452, w: rand(28, 48), h: rand(34, 78), vx: rand(260, 360) }); state.spawn = rand(0.9, 1.5); }
    for (const o of state.obstacles) {
      o.x -= o.vx * dt;
      if (Math.abs(p.x - o.x) < p.r + o.w / 2 && p.y + p.r > o.y - o.h) { o.dead = true; state.lives--; if (state.lives <= 0) end(false); }
      if (o.x < -60 && !o.scored) { o.scored = true; state.score += 90; }
    }
    state.obstacles = state.obstacles.filter((o) => o.x > -80 && !o.dead);
  }

  function drawRunner() {
    ctx.fillStyle = colors.secondary; roundRect(0, 468, W, 22, 6, true);
    for (const o of state.obstacles) { ctx.fillStyle = colors.accent; roundRect(o.x - o.w / 2, o.y - o.h, o.w, o.h, 8, true); }
    circle(state.player.x, state.player.y, state.player.r, colors.primary);
  }

  function initLane() {
    resetBase(55);
    state.lane = 1;
    state.obstacles = [];
    state.spawn = 0;
    state.cool = 0;
  }

  function updateLane(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.cool -= dt;
    if (state.cool <= 0) {
      if (keys.has("ArrowUp") || keys.has("KeyW")) { state.lane = clamp(state.lane - 1, 0, 2); state.cool = 0.16; }
      if (keys.has("ArrowDown") || keys.has("KeyS")) { state.lane = clamp(state.lane + 1, 0, 2); state.cool = 0.16; }
    }
    state.spawn -= dt;
    if (state.spawn <= 0) { state.obstacles.push({ x: W + 40, lane: Math.floor(rand(0, 3)), vx: rand(280, 390) }); state.spawn = rand(0.6, 1); }
    for (const o of state.obstacles) {
      o.x -= o.vx * dt;
      if (o.x < 160 && o.x > 100 && o.lane === state.lane) { o.dead = true; state.lives--; if (state.lives <= 0) end(false); }
      if (o.x < -30 && !o.scored) { o.scored = true; state.score += 80; }
    }
    state.obstacles = state.obstacles.filter((o) => !o.dead && o.x > -50);
  }

  function laneY(lane) { return 210 + lane * 110; }
  function drawLane() {
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(60, laneY(i)); ctx.lineTo(W - 60, laneY(i)); ctx.stroke(); }
    circle(130, laneY(state.lane), 22, colors.primary);
    for (const o of state.obstacles) { ctx.fillStyle = colors.accent; roundRect(o.x - 24, laneY(o.lane) - 24, 48, 48, 10, true); }
  }

  function initTurret() {
    resetBase(55);
    state.base = { x: W / 2, y: H / 2, r: 34 };
    state.spawn = 0;
    state.fire = 0;
  }

  function updateTurret(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt; state.fire -= dt;
    if (state.spawn <= 0) {
      const a = rand(0, Math.PI * 2);
      state.enemies.push({ x: W / 2 + Math.cos(a) * 520, y: H / 2 + Math.sin(a) * 360, r: 17, speed: rand(50, 90) });
      state.spawn = rand(0.45, 0.8);
    }
    if ((pointer.down || pointer.clicked) && state.fire <= 0) {
      const a = Math.atan2(pointer.y - state.base.y, pointer.x - state.base.x);
      state.bullets.push({ x: state.base.x, y: state.base.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: 5 });
      state.fire = 0.16;
    }
    for (const e of state.enemies) {
      const a = Math.atan2(state.base.y - e.y, state.base.x - e.x);
      e.x += Math.cos(a) * e.speed * dt; e.y += Math.sin(a) * e.speed * dt;
      if (dist(e, state.base) < e.r + state.base.r) { e.dead = true; state.lives--; if (state.lives <= 0) end(false); }
    }
    for (const b of state.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    collideBullets(120);
  }

  function collideBullets(points) {
    for (const b of state.bullets) for (const e of state.enemies) if (!e.dead && dist(b, e) < b.r + e.r) { e.dead = true; b.dead = true; state.score += points; }
    state.bullets = state.bullets.filter((b) => !b.dead && b.x > -40 && b.x < W + 40 && b.y > -40 && b.y < H + 40);
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function drawTurret() {
    circle(state.base.x, state.base.y, state.base.r, colors.primary);
    for (const e of state.enemies) circle(e.x, e.y, e.r, colors.secondary);
    for (const b of state.bullets) circle(b.x, b.y, b.r, colors.accent);
  }

  function initDefense() {
    resetBase(55);
    state.enemies = [];
    state.spawn = 0;
  }

  function updateDefense(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt;
    if (state.spawn <= 0) { state.enemies.push({ x: W + 30, y: rand(120, H - 60), r: rand(18, 26), vx: rand(55, 105), c: Math.random() > 0.5 ? colors.primary : colors.secondary }); state.spawn = rand(0.45, 0.9); }
    if (pointer.clicked) for (const e of state.enemies) if (!e.dead && Math.hypot(pointer.x - e.x, pointer.y - e.y) < e.r + 12) { e.dead = true; state.score += 90; break; }
    for (const e of state.enemies) { e.x -= e.vx * dt; if (e.x < 75) { e.dead = true; state.lives--; if (state.lives <= 0) end(false); } }
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function drawDefense() {
    ctx.fillStyle = colors.accent; roundRect(44, 104, 18, H - 150, 9, true);
    for (const e of state.enemies) circle(e.x, e.y, e.r, e.c);
  }

  function initSwarm() {
    resetBase(55);
    state.player = { x: W / 2, y: H / 2, r: 16 };
    state.spawn = 0;
    state.fire = 0;
  }

  function updateSwarm(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    movePlayer(dt, 250);
    state.spawn -= dt; state.fire -= dt;
    if (state.spawn <= 0) { state.enemies.push({ x: rand(40, W - 40), y: -30, r: 14, speed: rand(70, 130) }); state.spawn = rand(0.28, 0.55); }
    if (state.fire <= 0) {
      const target = state.enemies[0] ?? { x: pointer.x, y: pointer.y };
      const a = Math.atan2(target.y - state.player.y, target.x - state.player.x);
      state.bullets.push({ x: state.player.x, y: state.player.y, vx: Math.cos(a) * 430, vy: Math.sin(a) * 430, r: 4 });
      state.fire = 0.22;
    }
    for (const e of state.enemies) {
      const a = Math.atan2(state.player.y - e.y, state.player.x - e.x);
      e.x += Math.cos(a) * e.speed * dt; e.y += Math.sin(a) * e.speed * dt;
      if (dist(e, state.player) < e.r + state.player.r) { e.dead = true; state.lives--; if (state.lives <= 0) end(false); }
    }
    for (const b of state.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    collideBullets(100);
  }

  function drawSwarm() {
    circle(state.player.x, state.player.y, state.player.r, colors.primary);
    for (const e of state.enemies) circle(e.x, e.y, e.r, colors.secondary);
    for (const b of state.bullets) circle(b.x, b.y, b.r, colors.accent);
  }

  function initTower() {
    resetBase(90);
    state.coins = 5;
    state.path = [{ x: 40, y: 420 }, { x: 260, y: 420 }, { x: 260, y: 220 }, { x: 600, y: 220 }, { x: 600, y: 420 }, { x: 910, y: 420 }];
    state.slots = [{ x: 190, y: 310 }, { x: 390, y: 300 }, { x: 520, y: 140 }, { x: 720, y: 320 }];
    state.towers = [];
    state.enemies = [];
    state.spawn = 0;
  }

  function updateTower(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    if (pointer.clicked) {
      const slot = state.slots.find((s) => Math.hypot(pointer.x - s.x, pointer.y - s.y) < 32 && !s.used);
      if (slot && state.coins > 0) { slot.used = true; state.coins--; state.towers.push({ x: slot.x, y: slot.y, fire: 0 }); }
    }
    state.spawn -= dt;
    if (state.spawn <= 0) { state.enemies.push({ seg: 0, t: 0, r: 13, hp: 2, speed: rand(0.18, 0.26) }); state.spawn = rand(1.0, 1.45); }
    for (const e of state.enemies) {
      e.t += e.speed * dt;
      if (e.t > 1) { e.t = 0; e.seg++; }
      if (e.seg >= state.path.length - 1) { e.dead = true; state.lives--; if (state.lives <= 0) end(false); }
      const a = state.path[e.seg], b = state.path[e.seg + 1] ?? a;
      e.x = a.x + (b.x - a.x) * e.t; e.y = a.y + (b.y - a.y) * e.t;
    }
    for (const t of state.towers) {
      t.fire -= dt;
      const e = state.enemies.find((enemy) => !enemy.dead && Math.hypot(enemy.x - t.x, enemy.y - t.y) < 165);
      if (e && t.fire <= 0) { e.hp--; t.fire = 0.45; state.score += 25; if (e.hp <= 0) { e.dead = true; state.score += 100; } }
    }
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function drawTower() {
    ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 26; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(state.path[0].x, state.path[0].y); for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
    for (const s of state.slots) circle(s.x, s.y, 24, s.used ? colors.primary : "rgba(255,255,255,.12)");
    for (const e of state.enemies) circle(e.x, e.y, e.r, colors.accent);
    ctx.fillStyle = "#c9d7d7"; ctx.font = "800 15px system-ui"; ctx.fillText("金币 " + state.coins, 42, 92);
  }

  function initRouting() {
    resetBase(100);
    state.nodes = [
      { x: 180, y: 190, on: true, label: "源" },
      { x: 470, y: 150, on: false, label: "A" },
      { x: 740, y: 230, on: false, label: "B" },
      { x: 360, y: 390, on: false, label: "C" },
      { x: 690, y: 420, on: false, label: "D" },
    ];
    state.links = [[0,1],[1,2],[0,3],[3,4],[1,4]];
  }

  function updateRouting() {
    if (pointer.clicked) for (const n of state.nodes.slice(1)) if (Math.hypot(pointer.x - n.x, pointer.y - n.y) < 34) { n.on = !n.on; state.score += n.on ? 80 : -20; }
    if (state.nodes.slice(1).every((n) => n.on)) end(true);
  }

  function drawRouting() {
    ctx.lineWidth = 5;
    for (const [a, b] of state.links) { ctx.strokeStyle = state.nodes[a].on && state.nodes[b].on ? colors.accent : "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.moveTo(state.nodes[a].x, state.nodes[a].y); ctx.lineTo(state.nodes[b].x, state.nodes[b].y); ctx.stroke(); }
    ctx.textAlign = "center"; ctx.font = "900 18px system-ui";
    for (const n of state.nodes) { circle(n.x, n.y, 32, n.on ? colors.primary : colors.secondary); ctx.fillStyle = "#031b14"; ctx.fillText(n.label, n.x, n.y + 6); }
    ctx.textAlign = "left";
  }

  function initRecipe() {
    resetBase(70);
    state.ingredients = ["菜", "谷", "酱"];
    state.order = [0, 1, 2];
    state.pick = [];
  }

  function nextOrder() {
    state.order = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(rand(0, 2)));
    state.pick = [];
  }

  function updateRecipe(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    if (pointer.clicked) {
      for (let i = 0; i < 3; i++) if (Math.hypot(pointer.x - (300 + i * 170), pointer.y - 330) < 58) state.pick.push(i);
      if (state.pick.length === state.order.length) {
        const ok = state.pick.every((v, i) => v === state.order[i]);
        if (ok) { state.score += 180; nextOrder(); } else { state.lives--; state.pick = []; if (state.lives <= 0) end(false); }
      }
    }
  }

  function drawRecipe() {
    ctx.textAlign = "center"; ctx.font = "900 34px system-ui"; ctx.fillStyle = "#eefaf6"; ctx.fillText("订单: " + state.order.map((i) => state.ingredients[i]).join(" + "), W / 2, 180);
    for (let i = 0; i < 3; i++) { circle(300 + i * 170, 330, 58, [colors.primary, colors.secondary, colors.accent][i]); ctx.fillStyle = "#061018"; ctx.font = "900 24px system-ui"; ctx.fillText(state.ingredients[i], 300 + i * 170, 338); }
    ctx.fillStyle = "#c9d7d7"; ctx.font = "800 20px system-ui"; ctx.fillText("已选: " + state.pick.map((i) => state.ingredients[i]).join(" "), W / 2, 450); ctx.textAlign = "left";
  }

  function initLoading() {
    resetBase(80);
    state.left = 0; state.right = 0; state.boxes = [1,2,3,1,2,3,2,1]; state.index = 0;
  }

  function updateLoading() {
    if (!pointer.clicked || state.index >= state.boxes.length) return;
    const weight = state.boxes[state.index];
    if (pointer.x < W / 2) state.left += weight; else state.right += weight;
    state.index++; state.score += 90;
    if (Math.abs(state.left - state.right) > 3) { state.lives--; if (state.lives <= 0) end(false); }
    if (state.index >= state.boxes.length) end(Math.abs(state.left - state.right) <= 3);
  }

  function drawLoading() {
    ctx.fillStyle = colors.secondary; roundRect(230, 380, 500, 50, 12, true);
    ctx.fillStyle = colors.primary; roundRect(250, 310, 190, 70, 10, true);
    ctx.fillStyle = colors.accent; roundRect(520, 310, 190, 70, 10, true);
    ctx.fillStyle = "#031b14"; ctx.font = "900 24px system-ui"; ctx.fillText("左 " + state.left, 310, 354); ctx.fillText("右 " + state.right, 585, 354);
    ctx.fillStyle = "#eefaf6"; ctx.font = "900 38px system-ui"; ctx.fillText("当前货柜重量 " + (state.boxes[state.index] ?? "-"), 300, 200);
  }

  function initRhythm() {
    resetBase(60);
    state.notes = [];
    state.spawn = 0;
  }

  function rhythmKey(code) {
    const lanes = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3 };
    const lane = lanes[code];
    if (lane === undefined || config.gameType !== "rhythm") return;
    let best = null;
    for (const n of state.notes) if (!n.hit && n.lane === lane) {
      const diff = Math.abs(n.y - 470);
      if (diff < 42 && (!best || diff < best.diff)) best = { n, diff };
    }
    if (best) { best.n.hit = true; state.combo++; state.score += Math.max(50, 150 - best.diff * 2); }
    else { state.combo = 0; state.lives--; if (state.lives <= 0) end(false); }
  }

  function updateRhythm(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    state.spawn -= dt;
    if (state.spawn <= 0) { state.notes.push({ lane: Math.floor(rand(0, 4)), y: 90 }); state.spawn = 0.45; }
    for (const n of state.notes) { n.y += 260 * dt; if (n.y > 520 && !n.hit) { n.hit = true; state.combo = 0; state.lives--; if (state.lives <= 0) end(false); } }
    state.notes = state.notes.filter((n) => !n.hit || n.y < 490);
  }

  function drawRhythm() {
    const xs = [270, 410, 550, 690];
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(220, 470); ctx.lineTo(740, 470); ctx.stroke();
    for (let i = 0; i < 4; i++) { ctx.fillStyle = "rgba(255,255,255,.08)"; roundRect(xs[i] - 45, 105, 90, 390, 10, true); ctx.fillStyle = "#c9d7d7"; ctx.font = "900 18px system-ui"; ctx.fillText(["A","S","D","F"][i], xs[i] - 8, 528); }
    for (const n of state.notes) circle(xs[n.lane], n.y, 23, colors.primary);
  }

  function initPong() {
    resetBase(80);
    state.paddle = { y: H / 2, h: 120 };
    state.ball = { x: W / 2, y: H / 2, vx: 260, vy: 190, r: 12 };
  }

  function updatePong(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    if (keys.has("ArrowUp") || keys.has("KeyW")) state.paddle.y -= 360 * dt;
    if (keys.has("ArrowDown") || keys.has("KeyS")) state.paddle.y += 360 * dt;
    state.paddle.y = clamp(state.paddle.y, 100, H - 80);
    const b = state.ball;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 88 || b.y > H - 20) b.vy *= -1;
    if (b.x > W - 25) b.vx *= -1;
    if (b.x < 76 && b.y > state.paddle.y - state.paddle.h / 2 && b.y < state.paddle.y + state.paddle.h / 2) { b.vx = Math.abs(b.vx) + 14; state.score += 100; }
    if (b.x < 0) { state.lives--; Object.assign(b, { x: W / 2, y: H / 2, vx: 260, vy: rand(-210, 210) }); if (state.lives <= 0) end(false); }
  }

  function drawPong() {
    ctx.fillStyle = colors.primary; roundRect(48, state.paddle.y - state.paddle.h / 2, 18, state.paddle.h, 9, true);
    circle(state.ball.x, state.ball.y, state.ball.r, colors.accent);
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.setLineDash([12, 12]); ctx.beginPath(); ctx.moveTo(W / 2, 88); ctx.lineTo(W / 2, H - 18); ctx.stroke(); ctx.setLineDash([]);
  }

  function initTiming() {
    resetBase(55);
    state.phase = 0;
    state.target = { x: W / 2, y: H / 2, r: 72 };
  }

  function updateTiming(dt) {
    state.time -= dt; if (state.time <= 0) end(true);
    state.phase = (state.phase + dt * 1.4) % 1;
    if (pointer.clicked || keys.has("Space")) {
      const sweet = Math.abs(state.phase - 0.5) < 0.09;
      if (sweet) { state.score += 180; state.combo++; state.target.x = rand(180, W - 180); state.target.y = rand(170, H - 120); }
      else { state.combo = 0; state.lives--; if (state.lives <= 0) end(false); }
      keys.delete("Space");
    }
  }

  function drawTiming() {
    const ring = 40 + Math.abs(state.phase - 0.5) * 160;
    circle(state.target.x, state.target.y, state.target.r, "rgba(255,255,255,.07)");
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(state.target.x, state.target.y, ring, 0, Math.PI * 2); ctx.stroke();
    circle(state.target.x, state.target.y, 24, colors.primary);
  }

  function update(dt) {
    if (!started || state.over) return;
    state.tick += dt * 60;
    const type = config.gameType;
    if (type === "breakout") updateBreakout(dt);
    else if (type === "goalie") updateGoalie(dt);
    else if (type === "platform") updatePlatform(dt);
    else if (type === "beam") updateBeam(dt);
    else if (type === "sokoban") updateSokoban(dt);
    else if (type === "connect") updateConnect(dt);
    else if (type === "lock") updateLock(dt);
    else if (type === "memory") updateMemory(dt);
    else if (type === "runner") updateRunner(dt);
    else if (type === "lane") updateLane(dt);
    else if (type === "turret") updateTurret(dt);
    else if (type === "defense") updateDefense(dt);
    else if (type === "swarm") updateSwarm(dt);
    else if (type === "tower") updateTower(dt);
    else if (type === "routing") updateRouting(dt);
    else if (type === "recipe") updateRecipe(dt);
    else if (type === "loading") updateLoading(dt);
    else if (type === "rhythm") updateRhythm(dt);
    else if (type === "pong") updatePong(dt);
    else if (type === "timing") updateTiming(dt);
    else updateDodge(dt);
    pointer.clicked = false;
  }

  function draw() {
    drawBackground();
    const type = config.gameType;
    if (type === "breakout") drawBreakout();
    else if (type === "goalie") drawGoalie();
    else if (type === "platform") drawPlatform();
    else if (type === "beam") drawBeam();
    else if (type === "sokoban") drawSokoban();
    else if (type === "connect") drawConnect();
    else if (type === "lock") drawLock();
    else if (type === "memory") drawMemory();
    else if (type === "runner") drawRunner();
    else if (type === "lane") drawLane();
    else if (type === "turret") drawTurret();
    else if (type === "defense") drawDefense();
    else if (type === "swarm") drawSwarm();
    else if (type === "tower") drawTower();
    else if (type === "routing") drawRouting();
    else if (type === "recipe") drawRecipe();
    else if (type === "loading") drawLoading();
    else if (type === "rhythm") drawRhythm();
    else if (type === "pong") drawPong();
    else if (type === "timing") drawTiming();
    else drawDodge();
    drawHud();
    drawOverlay();
  }

  function loop(time) {
    const dt = Math.min(0.033, (time - last) / 1000 || 0);
    last = time;
    update(dt);
    draw();
    pointer.clicked = false;
    requestAnimationFrame(loop);
  }

  init();
  requestAnimationFrame(loop);
})();
`;

function pageHtml(game: (typeof BUILTIN_GAMES)[number]) {
  const config = {
    title: game.title,
    summary: game.summary,
    gameType: game.gameType,
    theme: game.theme,
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${game.title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #030609; overflow: hidden; }
    body { display: grid; place-items: center; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    canvas { width: 100vw; height: 100vh; display: block; background: ${game.theme.background}; touch-action: none; }
  </style>
</head>
<body>
  <canvas id="game" width="960" height="600" aria-label="${game.title}"></canvas>
  <script>window.BUILTIN_GAME_CONFIG = ${JSON.stringify(config)};</script>
  <script src="../shared/engine.js"></script>
</body>
</html>
`;
}

async function main() {
  await mkdir(sharedRoot, { recursive: true });
  await writeFile(path.join(sharedRoot, "engine.js"), engineJs, "utf8");

  for (const game of BUILTIN_GAMES) {
    const gameRoot = path.join(publicRoot, game.slug);
    await mkdir(gameRoot, { recursive: true });
    await writeFile(path.join(gameRoot, "index.html"), pageHtml(game), "utf8");
  }

  console.log(`Generated ${BUILTIN_GAMES.length} built-in games in ${publicRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
