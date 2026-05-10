(() => {
  const config = window.BUILTIN_GAME_CONFIG;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const VW = 320;
  const VH = 200;
  const SCALE = canvas.width / VW;
  const keys = new Set();
  const keyQueue = [];
  const pointer = { x: VW / 2, y: VH / 2, down: false, clicked: false };
  const colors = config.theme;
  const title = config.title || "";
  let state = {};
  let last = 0;
  let started = false;
  let message = "PRESS SPACE / TAP";
  let audioCtx = null;

  ctx.imageSmoothingEnabled = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(rand(0, items.length))];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rectHit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const has = (text) => title.includes(text);

  const NES = {
    ink: "#f8f8f8",
    dim: "#8a8a8a",
    black: "#070707",
    navy: "#101828",
    brick: "#7c3f2c",
    red: "#d94b3d",
    orange: "#f0a03a",
    yellow: "#ffd866",
    green: "#58b368",
    mint: "#88d8b0",
    blue: "#3b82f6",
    cyan: "#5eead4",
    purple: "#8b5cf6",
    pink: "#f472b6",
    stone: "#5e6673",
    wood: "#b7793c",
  };

  const sprites = {
    ship: [
      "00011000",
      "00111100",
      "11111111",
      "10111101",
      "00100100",
      "01000010",
    ],
    runner: [
      "001100",
      "011110",
      "001100",
      "111111",
      "011010",
      "110011",
    ],
    keeper: [
      "011110",
      "111111",
      "011110",
      "111111",
      "101101",
      "101101",
      "110011",
    ],
    turret: [
      "001100",
      "011110",
      "111111",
      "111111",
      "011110",
    ],
    crate: [
      "11111111",
      "12222221",
      "12122121",
      "12211221",
      "12211221",
      "12122121",
      "12222221",
      "11111111",
    ],
    enemy: [
      "01100110",
      "11111111",
      "10111101",
      "11111111",
      "01011010",
      "10000001",
    ],
  };

  function cssVar(color, fallback) {
    return color || fallback;
  }

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function stroke(x, y, w, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  function dot(x, y, r, color) {
    px(x - r, y - r, r * 2, r * 2, color);
  }

  function text(value, x, y, color = NES.ink, size = 8, align = "left") {
    ctx.font = `700 ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(String(value), Math.round(x), Math.round(y));
    ctx.textAlign = "left";
  }

  function sprite(pattern, x, y, scale, palette) {
    for (let yy = 0; yy < pattern.length; yy++) {
      for (let xx = 0; xx < pattern[yy].length; xx++) {
        const key = pattern[yy][xx];
        if (key !== "0" && palette[key]) px(x + xx * scale, y + yy * scale, scale, scale, palette[key]);
      }
    }
  }

  function bar(x, y, w, h, value, max, color) {
    px(x, y, w, h, NES.black);
    stroke(x, y, w, h, NES.dim);
    px(x + 1, y + 1, Math.max(0, (w - 2) * value / max), h - 2, color);
  }

  function ensureAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = null;
    }
  }

  function beep(type = "tap") {
    if (!audioCtx) return;
    const map = {
      start: [440, 0.08, "square"],
      jump: [660, 0.08, "square"],
      shoot: [520, 0.05, "square"],
      hit: [240, 0.07, "sawtooth"],
      pickup: [880, 0.06, "square"],
      hurt: [120, 0.16, "sawtooth"],
      win: [980, 0.18, "triangle"],
      tap: [360, 0.04, "square"],
    };
    const [freq, duration, wave] = map[type] || map.tap;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  function resetBase(duration = 60) {
    state = {
      score: 0,
      lives: 3,
      time: duration,
      over: false,
      win: false,
      tick: 0,
      combo: 0,
      shake: 0,
      flash: 0,
      hurt: 0,
      particles: [],
      bullets: [],
      enemies: [],
      items: [],
      hazards: [],
    };
    message = "PRESS SPACE / TAP";
  }

  function start() {
    ensureAudio();
    if (state.over) init();
    const newlyStarted = !started;
    if (newlyStarted) beep("start");
    started = true;
    message = "";
    return newlyStarted;
  }

  function end(win = false) {
    if (state.over) return;
    state.over = true;
    state.win = win;
    started = false;
    beep(win ? "win" : "hurt");
  }

  function damage(amount = 1) {
    if (state.hurt > 0 || state.over) return false;
    state.lives -= amount;
    state.hurt = 1.1;
    state.shake = 8;
    state.combo = 0;
    beep("hurt");
    if (state.lives <= 0) end(false);
    return true;
  }

  function pop(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x,
        y,
        vx: rand(-42, 42),
        vy: rand(-48, 28),
        life: rand(0.28, 0.58),
        max: 0.58,
        color,
      });
    }
  }

  function updateParticles(dt) {
    state.hurt = Math.max(0, state.hurt - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.shake = Math.max(0, state.shake - dt * 28);
    for (const p of state.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 80 * dt;
      p.life -= dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0).slice(-160);
  }

  function drawParticles() {
    for (const p of state.particles) {
      const s = p.life > 0.22 ? 2 : 1;
      px(p.x, p.y, s, s, p.color);
    }
  }

  function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;
    pointer.x = clamp(((clientX - rect.left) / rect.width) * VW, 0, VW);
    pointer.y = clamp(((clientY - rect.top) / rect.height) * VH, 0, VH);
  }

  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (!keys.has(event.code)) keyQueue.push(event.code);
    keys.add(event.code);
    if (event.code === "Space") start();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));

  for (const name of ["pointerdown", "pointermove"]) {
    canvas.addEventListener(name, (event) => {
      pointerPos(event);
      if (name === "pointerdown") {
        pointer.down = true;
        pointer.clicked = true;
        state.lastCell = "";
        if (start()) pointer.clicked = false;
      }
    });
  }
  window.addEventListener("pointerup", () => {
    pointer.down = false;
    state.lastCell = "";
  });

  function dirInput() {
    return {
      x: (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0),
      y: (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0),
    };
  }

  function movePlayer(dt, speed = 90) {
    const d = dirInput();
    const len = Math.hypot(d.x, d.y) || 1;
    state.player.x = clamp(state.player.x + d.x / len * speed * dt, 8, VW - 8);
    state.player.y = clamp(state.player.y + d.y / len * speed * dt, 32, VH - 8);
  }

  function drawBackground() {
    px(0, 0, VW, VH, NES.black);
    const type = config.gameType;
    if (["dodge", "turret", "swarm"].includes(type) && !has("弹幕")) {
      for (let i = 0; i < 70; i++) {
        const x = (i * 47 + Math.floor(state.tick * (i % 3 + 1))) % VW;
        const y = 28 + ((i * 29) % 166);
        px(x, y, 1, 1, i % 4 === 0 ? colors.accent : NES.dim);
      }
    } else if (["runner", "platform", "lane"].includes(type)) {
      px(0, 150, VW, 50, has("熔岩") ? "#3b120e" : has("月面") ? "#172033" : "#141414");
      for (let x = -16; x < VW + 16; x += 16) {
        const sx = (x - Math.floor((state.tick * 0.8) % 16));
        px(sx, 158, 12, 3, has("熔岩") ? NES.orange : NES.stone);
      }
    } else if (["beam", "connect", "lock", "memory"].includes(type)) {
      for (let y = 30; y < VH; y += 12) px(0, y, VW, 1, "#111827");
      for (let x = 0; x < VW; x += 12) px(x, 28, 1, VH - 28, "#111827");
    } else {
      for (let y = 30; y < VH; y += 16) for (let x = 0; x < VW; x += 16) px(x, y, 14, 14, (x + y) % 32 ? "#141414" : "#1f1f1f");
    }
    for (let y = 0; y < VH; y += 4) px(0, y, VW, 1, "rgba(255,255,255,0.025)");
  }

  function drawHud() {
    px(0, 0, VW, 25, NES.black);
    px(0, 24, VW, 1, cssVar(colors.primary, NES.cyan));
    text("SCORE " + String(Math.floor(state.score)).padStart(5, "0"), 6, 7, NES.ink, 8);
    text("LIFE " + state.lives, 118, 7, state.lives <= 1 ? NES.red : NES.ink, 8);
    if (state.time !== undefined) text("TIME " + Math.max(0, Math.ceil(state.time)).toString().padStart(2, "0"), 184, 7, NES.ink, 8);
    if (state.combo > 1) text("x" + state.combo, 270, 7, colors.accent, 8);
  }

  function drawOverlay() {
    if (started && !state.over && !message) return;
    px(28, 48, 264, 104, "rgba(0,0,0,0.82)");
    stroke(28, 48, 264, 104, cssVar(colors.primary, NES.cyan));
    text(state.over ? (state.win ? "CLEAR!" : "GAME OVER") : title, VW / 2, 65, NES.ink, 12, "center");
    text(state.over ? "SPACE / TAP TO RETRY" : message, VW / 2, 90, colors.accent, 8, "center");
    ctx.font = "700 7px sans-serif";
    ctx.fillStyle = NES.dim;
    ctx.textAlign = "center";
    ctx.fillText(config.summary, VW / 2, 116, 230);
    ctx.textAlign = "left";
  }

  function init() {
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
    else initDodge();
  }

  function initDodge() {
    resetBase(55);
    state.cleaner = has("清道夫");
    state.player = { x: 42, y: 108, w: 10, h: 8, cargo: null };
    state.drop = { x: 265, y: 146, w: 38, h: 28 };
    state.spawn = 0;
    for (let i = 0; i < 7; i++) spawnDodgeItem();
    for (let i = 0; i < 6; i++) spawnDodgeHazard(rand(110, VW));
  }

  function spawnDodgeItem() {
    state.items.push({ x: rand(72, 286), y: rand(44, 176), r: 3, pulse: rand(0, 6), vx: rand(-7, 7), vy: rand(-5, 5) });
  }

  function spawnDodgeHazard(x = VW + 12) {
    state.hazards.push({ x, y: rand(38, 180), w: rand(7, 13), h: rand(7, 11), vx: -rand(38, 72), vy: rand(-20, 20), warned: false, near: false });
  }

  function updateDodge(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    movePlayer(dt, state.cleaner ? 78 : 94);
    const p = state.player;
    if (state.cleaner && p.cargo && rectHit({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }, state.drop)) {
      state.score += 180 + state.combo * 15;
      state.combo++;
      pop(state.drop.x + 18, state.drop.y + 12, colors.accent, 14);
      p.cargo = null;
      spawnDodgeItem();
      beep("pickup");
    }
    for (const item of state.items) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      if (item.x < 54 || item.x > 298) item.vx *= -1;
      if (item.y < 35 || item.y > 184) item.vy *= -1;
      if (!item.dead && Math.hypot(p.x - item.x, p.y - item.y) < 9) {
        item.dead = true;
        if (state.cleaner) {
          if (!p.cargo) p.cargo = item;
          else item.dead = false;
        } else {
          state.score += 100 + state.combo * 12;
          state.combo++;
          spawnDodgeItem();
          pop(item.x, item.y, colors.accent, 10);
          beep("pickup");
        }
      }
    }
    state.items = state.items.filter((item) => !item.dead).slice(-12);
    for (const h of state.hazards) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.y < 31 || h.y > 188) h.vy *= -1;
      if (h.x < -20) Object.assign(h, { x: VW + rand(10, 80), y: rand(38, 180), vx: -rand(45, 82), near: false });
      const hb = { x: h.x - h.w / 2, y: h.y - h.h / 2, w: h.w, h: h.h };
      if (rectHit({ x: p.x - 5, y: p.y - 4, w: 10, h: 8 }, hb)) {
        Object.assign(h, { x: VW + 20, y: rand(40, 178), near: false });
        damage();
      } else if (!h.near && Math.abs(p.x - h.x) < 16 && Math.abs(p.y - h.y) < 14) {
        h.near = true;
        state.score += 35;
        state.combo++;
      }
    }
    state.spawn -= dt;
    if (state.spawn <= 0) {
      spawnDodgeHazard();
      state.spawn = rand(1.2, 2);
    }
  }

  function drawDodge() {
    if (state.cleaner) {
      stroke(state.drop.x, state.drop.y, state.drop.w, state.drop.h, colors.accent);
      text("REC", state.drop.x + 9, state.drop.y + 10, colors.accent, 7);
    }
    for (const item of state.items) {
      dot(item.x, item.y, 3 + (Math.sin(state.tick * 0.15 + item.pulse) > 0 ? 1 : 0), state.cleaner ? NES.stone : colors.accent);
      px(item.x - 1, item.y - 1, 2, 2, NES.ink);
    }
    for (const h of state.hazards) {
      px(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, has("星港") ? colors.secondary : NES.red);
      px(h.x + 4, h.y - 1, 12, 2, "rgba(255,255,255,0.16)");
    }
    const blink = state.hurt > 0 && Math.floor(state.tick / 5) % 2 === 0;
    if (!blink) sprite(sprites.ship, state.player.x - 8, state.player.y - 6, 2, { 1: colors.primary, 2: colors.accent });
    if (state.player.cargo) dot(state.player.x + 12, state.player.y - 6, 3, NES.stone);
  }

  function initBreakout() {
    resetBase(90);
    state.time = undefined;
    state.paddle = { x: 130, y: 184, w: 58, h: 5 };
    state.ball = { x: 160, y: 174, w: 4, h: 4, vx: 72, vy: -74 };
    state.bricks = [];
    const cols = [NES.red, NES.orange, NES.yellow, NES.green, colors.secondary];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) {
      state.bricks.push({ x: 12 + x * 30, y: 38 + y * 10, w: 24, h: 7, hp: y < 2 ? 2 : 1, max: y < 2 ? 2 : 1, color: cols[y] });
    }
  }

  function updateBreakout(dt) {
    const p = state.paddle;
    if (pointer.down) p.x = pointer.x - p.w / 2;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) p.x -= 128 * dt;
    if (keys.has("ArrowRight") || keys.has("KeyD")) p.x += 128 * dt;
    p.x = clamp(p.x, 5, VW - p.w - 5);
    const b = state.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 4 || b.x > VW - 8) b.vx *= -1;
    if (b.y < 29) b.vy = Math.abs(b.vy);
    if (b.y > VH + 5) {
      damage();
      Object.assign(b, { x: 160, y: 174, vx: 72 * (Math.random() > 0.5 ? 1 : -1), vy: -74 });
      state.combo = 0;
    }
    if (rectHit(b, p) && b.vy > 0) {
      const t = (b.x + b.w / 2 - (p.x + p.w / 2)) / (p.w / 2);
      b.vx = clamp(t * 112, -118, 118);
      b.vy = -Math.min(118, Math.abs(b.vy) + 4);
      beep("hit");
    }
    for (const brick of state.bricks) {
      if (brick.dead || !rectHit(b, brick)) continue;
      brick.hp--;
      b.vy *= -1;
      state.combo++;
      state.score += 60 + state.combo * 8;
      pop(b.x, b.y, brick.color, 8);
      beep("hit");
      if (brick.hp <= 0) brick.dead = true;
      break;
    }
    if (state.bricks.every((brick) => brick.dead)) end(true);
  }

  function drawBreakout() {
    for (const brick of state.bricks) {
      if (brick.dead) continue;
      px(brick.x, brick.y, brick.w, brick.h, brick.hp < brick.max ? NES.stone : brick.color);
      px(brick.x + 2, brick.y + 2, brick.w - 4, 1, NES.black);
    }
    px(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, colors.primary);
    px(state.paddle.x + 4, state.paddle.y - 2, state.paddle.w - 8, 2, NES.ink);
    px(state.ball.x, state.ball.y, state.ball.w, state.ball.h, colors.accent);
  }

  function initGoalie() {
    resetBase(60);
    state.goalie = { y: 110, h: 32, dive: 0 };
    state.shot = null;
    state.balls = [];
    state.spawn = 0.4;
  }

  function updateGoalie(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    const g = state.goalie;
    if (keys.has("ArrowUp") || keys.has("KeyW")) g.y -= 88 * dt;
    if (keys.has("ArrowDown") || keys.has("KeyS")) g.y += 88 * dt;
    g.y = clamp(g.y, 54, 168);
    g.dive = Math.max(0, g.dive - dt);
    state.spawn -= dt;
    if (!state.shot && state.spawn <= 0) {
      state.shot = { y: rand(48, 172), wait: 0.55, curve: rand(-20, 20) };
    }
    if (state.shot) {
      state.shot.wait -= dt;
      if (state.shot.wait <= 0) {
        state.balls.push({ x: 282, y: state.shot.y + rand(-18, 18), w: 5, h: 5, vx: -rand(92, 126), vy: state.shot.curve * 0.18 });
        state.shot = null;
        state.spawn = rand(0.7, 1.05);
        beep("shoot");
      }
    }
    for (const b of state.balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += Math.sin(state.tick * 0.06) * dt * 4;
      if (b.x < 38 && b.y > g.y - g.h / 2 && b.y < g.y + g.h / 2) {
        b.dead = true;
        g.dive = 0.18;
        state.combo++;
        state.score += 120 + state.combo * 20;
        pop(b.x, b.y, colors.accent, 12);
        beep("hit");
      } else if (b.x < 14) {
        b.dead = true;
        damage();
      }
    }
    state.balls = state.balls.filter((b) => !b.dead);
  }

  function drawGoalie() {
    px(14, 45, 5, 126, NES.ink);
    for (let y = 48; y < 170; y += 12) px(19, y, 38, 1, "#283241");
    px(54, 45, 2, 126, NES.ink);
    if (state.shot) {
      for (let x = 92; x < 276; x += 10) px(x, state.shot.y, 5, 1, colors.accent);
      sprite(sprites.runner, 275, state.shot.y - 14, 2, { 1: colors.secondary });
    } else sprite(sprites.runner, 275, 130, 2, { 1: colors.secondary });
    const gy = state.goalie.y - state.goalie.h / 2;
    sprite(sprites.keeper, state.goalie.dive > 0 ? 36 : 32, gy, 2, { 1: colors.primary });
    for (const b of state.balls) px(b.x, b.y, b.w, b.h, colors.accent);
  }

  function initPlatform() {
    resetBase(65);
    state.cloud = has("云端");
    state.player = { x: 48, y: 128, w: 8, h: 12, vy: 0, grounded: false, coyote: 0, buffer: 0 };
    state.worldX = 0;
    state.speed = state.cloud ? 36 : 42;
    state.platforms = [
      { x: 20, y: 154, w: 62, sink: 0 },
      { x: 104, y: 132, w: 48, sink: 0 },
      { x: 184, y: 112, w: 42, sink: 0 },
      { x: 260, y: 146, w: 50, sink: 0 },
    ];
    state.items = [{ x: 124, y: 120 }, { x: 204, y: 100 }, { x: 282, y: 132 }];
  }

  function updatePlatform(dt) {
    const p = state.player;
    state.time -= dt;
    if (state.time <= 0) end(true);
    if (keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW")) p.buffer = 0.12;
    p.buffer = Math.max(0, p.buffer - dt);
    p.coyote = Math.max(0, p.coyote - dt);
    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
      p.vy = state.cloud ? -130 : -116;
      p.grounded = false;
      p.buffer = 0;
      beep("jump");
      pop(p.x, p.y + p.h, colors.primary, 5);
    }
    p.vy += (state.cloud ? 210 : 260) * dt;
    p.y += p.vy * dt;
    state.worldX += state.speed * dt;
    p.grounded = false;
    for (const pl of state.platforms) {
      if (!state.cloud && pl.sink > 0) pl.y += dt * 4;
      const sx = pl.x - state.worldX;
      if (p.x + p.w > sx && p.x < sx + pl.w && p.y + p.h >= pl.y && p.y + p.h <= pl.y + 8 && p.vy >= 0) {
        p.y = pl.y - p.h;
        p.vy = 0;
        p.grounded = true;
        p.coyote = 0.09;
        if (!state.cloud) pl.sink = 1;
      }
    }
    if (p.y > VH + 20) end(false);
    for (const item of state.items) {
      if (!item.dead && Math.hypot(p.x - (item.x - state.worldX), p.y - item.y) < 12) {
        item.dead = true;
        state.score += 140;
        state.combo++;
        pop(item.x - state.worldX, item.y, colors.accent, 10);
        beep("pickup");
      }
    }
    const last = state.platforms[state.platforms.length - 1];
    if (last.x - state.worldX < VW) {
      const nextX = last.x + rand(58, 84);
      state.platforms.push({ x: nextX, y: rand(92, 160), w: rand(34, 58), sink: 0 });
      state.items.push({ x: nextX + rand(12, 36), y: rand(76, 138) });
    }
    state.platforms = state.platforms.filter((pl) => pl.x - state.worldX > -90);
    state.items = state.items.filter((it) => it.x - state.worldX > -60 && !it.dead);
    if (state.score >= 1200) end(true);
  }

  function drawPlatform() {
    px(0, state.cloud ? 176 : 182, VW, 18, state.cloud ? "#243b55" : "#5c1e12");
    for (const pl of state.platforms) {
      const sx = pl.x - state.worldX;
      px(sx, pl.y, pl.w, 6, state.cloud ? NES.ink : NES.orange);
      px(sx + 2, pl.y + 6, pl.w - 4, 3, state.cloud ? "#a7c7e7" : NES.red);
    }
    for (const item of state.items) dot(item.x - state.worldX, item.y, 3, colors.accent);
    sprite(sprites.runner, state.player.x, state.player.y, 2, { 1: colors.primary });
  }

  function initRunner() {
    resetBase(55);
    state.moon = has("月面");
    state.subway = has("地铁");
    state.player = { x: 42, y: 154, w: 8, h: 12, vy: 0, grounded: true, slide: 0 };
    state.speed = state.moon ? 70 : 86;
    state.obstacles = [];
    state.spawn = 0.8;
  }

  function spawnRunnerObstacle() {
    const high = state.subway && Math.random() > 0.55;
    const pit = state.moon && Math.random() > 0.65;
    state.obstacles.push({
      x: VW + 10,
      y: pit ? 166 : high ? 146 : 154,
      w: pit ? 30 : rand(10, 18),
      h: pit ? 10 : high ? 18 : rand(12, 24),
      type: pit ? "pit" : high ? "high" : "low",
      scored: false,
    });
    state.spawn = rand(0.75, 1.25);
  }

  function updateRunner(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    const p = state.player;
    state.speed = Math.min(132, state.speed + dt * 2.3);
    const jump = keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");
    if (jump && p.grounded) {
      p.vy = state.moon ? -124 : -150;
      p.grounded = false;
      beep("jump");
    }
    p.slide = (keys.has("ArrowDown") || keys.has("KeyS")) && p.grounded ? 0.2 : Math.max(0, p.slide - dt);
    p.vy += (state.moon ? 235 : 330) * dt;
    p.y += p.vy * dt;
    if (p.y > 154) {
      p.y = 154;
      p.vy = 0;
      p.grounded = true;
    }
    state.spawn -= dt;
    if (state.spawn <= 0) spawnRunnerObstacle();
    for (const o of state.obstacles) {
      o.x -= state.speed * dt;
      const playerBox = { x: p.x, y: p.y + (p.slide > 0 ? 6 : 0), w: p.w, h: p.slide > 0 ? 6 : p.h };
      const obstacleBox = o.type === "pit" ? { x: o.x, y: 166, w: o.w, h: 12 } : { x: o.x, y: o.y, w: o.w, h: o.h };
      const hitPit = o.type === "pit" && p.grounded && p.x + p.w > o.x && p.x < o.x + o.w;
      if (rectHit(playerBox, obstacleBox) || hitPit) {
        o.dead = true;
        damage();
      }
      if (!o.scored && o.x + o.w < p.x) {
        o.scored = true;
        state.combo++;
        state.score += 90 + state.combo * 8;
      }
    }
    state.obstacles = state.obstacles.filter((o) => o.x > -45 && !o.dead);
  }

  function drawRunner() {
    px(0, 166, VW, 5, colors.secondary);
    for (let x = -16; x < VW; x += 20) px((x - state.tick) % VW, 172, 12, 2, NES.dim);
    for (const o of state.obstacles) {
      if (o.type === "pit") {
        px(o.x, 166, o.w, 12, NES.black);
        stroke(o.x, 166, o.w, 12, NES.red);
      } else px(o.x, o.y, o.w, o.h, o.type === "high" ? colors.secondary : colors.accent);
    }
    const p = state.player;
    if (p.slide > 0) px(p.x, p.y + 8, 14, 5, colors.primary);
    else sprite(sprites.runner, p.x, p.y, 2, { 1: colors.primary });
  }

  function initLane() {
    resetBase(55);
    state.lane = 1;
    state.playerY = laneY(1);
    state.obstacles = [];
    state.pickups = [];
    state.spawn = 0.5;
    state.cool = 0;
    state.speed = 95;
  }

  function laneY(lane) {
    return 72 + lane * 42;
  }

  function updateLane(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.speed = Math.min(145, state.speed + dt * 2);
    state.cool -= dt;
    if (state.cool <= 0) {
      if (keys.has("ArrowUp") || keys.has("KeyW")) {
        state.lane = clamp(state.lane - 1, 0, 2);
        state.cool = 0.16;
        beep("tap");
      }
      if (keys.has("ArrowDown") || keys.has("KeyS")) {
        state.lane = clamp(state.lane + 1, 0, 2);
        state.cool = 0.16;
        beep("tap");
      }
    }
    state.playerY += (laneY(state.lane) - state.playerY) * Math.min(1, dt * 14);
    state.spawn -= dt;
    if (state.spawn <= 0) {
      const lane = Math.floor(rand(0, 3));
      state.obstacles.push({ x: VW + 10, lane, w: 14, h: 14, scored: false });
      if (Math.random() > 0.55) state.pickups.push({ x: VW + 40, lane: (lane + 1 + Math.floor(rand(0, 2))) % 3 });
      state.spawn = rand(0.55, 0.95);
    }
    for (const o of state.obstacles) {
      o.x -= state.speed * dt;
      if (o.x < 54 && o.x > 34 && o.lane === state.lane) {
        o.dead = true;
        damage();
      }
      if (!o.scored && o.x < 20) {
        o.scored = true;
        state.combo++;
        state.score += 70 + state.combo * 6;
      }
    }
    for (const p of state.pickups) {
      p.x -= state.speed * dt;
      if (p.x < 56 && p.x > 34 && p.lane === state.lane) {
        p.dead = true;
        state.score += 110;
        state.combo++;
        beep("pickup");
        pop(44, state.playerY, colors.accent, 8);
      }
    }
    state.obstacles = state.obstacles.filter((o) => o.x > -25 && !o.dead);
    state.pickups = state.pickups.filter((p) => p.x > -20 && !p.dead);
  }

  function drawLane() {
    for (let i = 0; i < 3; i++) {
      px(0, laneY(i) + 9, VW, 2, "#293241");
      for (let x = 0; x < VW; x += 28) px((x - state.tick * 2) % VW, laneY(i) + 9, 12, 2, NES.dim);
    }
    sprite(sprites.runner, 36, state.playerY - 8, 2, { 1: colors.primary });
    for (const o of state.obstacles) px(o.x, laneY(o.lane) - 8, o.w, o.h, colors.accent);
    for (const p of state.pickups) dot(p.x, laneY(p.lane), 3, colors.secondary);
  }

  function initTurret() {
    resetBase(65);
    state.base = { x: 160, y: 110, r: 11 };
    state.spawn = 0.2;
    state.fire = 0;
  }

  function updateTurret(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const edge = Math.floor(rand(0, 4));
      const e = edge === 0 ? { x: rand(0, VW), y: 26 } : edge === 1 ? { x: VW + 8, y: rand(35, VH) } : edge === 2 ? { x: rand(0, VW), y: VH + 8 } : { x: -8, y: rand(35, VH) };
      const size = rand(6, 12);
      state.enemies.push({ ...e, w: size, h: size, hp: size > 9 ? 2 : 1, speed: rand(24, 42) });
      state.spawn = rand(0.45, 0.85);
    }
    if ((pointer.down || pointer.clicked) && state.fire <= 0) {
      const a = Math.atan2(pointer.y - state.base.y, pointer.x - state.base.x);
      state.bullets.push({ x: state.base.x, y: state.base.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, w: 2, h: 2 });
      state.fire = 0.14;
      state.flash = 0.06;
      beep("shoot");
    }
    for (const e of state.enemies) {
      const a = Math.atan2(state.base.y - e.y, state.base.x - e.x);
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;
      if (dist(e, state.base) < state.base.r + e.w / 2) {
        e.dead = true;
        damage();
      }
    }
    for (const b of state.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    bulletEnemyCollisions(90);
  }

  function bulletEnemyCollisions(points) {
    for (const b of state.bullets) for (const e of state.enemies) {
      if (!e.dead && rectHit({ x: b.x, y: b.y, w: b.w, h: b.h }, { x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h })) {
        b.dead = true;
        e.hp--;
        pop(b.x, b.y, colors.accent, 6);
        if (e.hp <= 0) {
          e.dead = true;
          state.score += points;
          state.combo++;
          pop(e.x, e.y, colors.secondary, 14);
        }
      }
    }
    state.bullets = state.bullets.filter((b) => !b.dead && b.x > -10 && b.x < VW + 10 && b.y > 20 && b.y < VH + 10).slice(-48);
    state.enemies = state.enemies.filter((e) => !e.dead).slice(-42);
  }

  function drawTurret() {
    const angle = Math.atan2(pointer.y - state.base.y, pointer.x - state.base.x);
    for (let r = 32; r < 120; r += 24) stroke(state.base.x - r, state.base.y - r, r * 2, r * 2, "rgba(255,255,255,0.07)");
    px(state.base.x + Math.cos(angle) * 8, state.base.y + Math.sin(angle) * 8, 18, 3, colors.accent);
    sprite(sprites.turret, state.base.x - 8, state.base.y - 8, 3, { 1: colors.primary });
    if (state.flash > 0) dot(state.base.x + Math.cos(angle) * 22, state.base.y + Math.sin(angle) * 22, 3, colors.accent);
    stroke(pointer.x - 4, pointer.y - 4, 8, 8, colors.accent);
    for (const e of state.enemies) px(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, colors.secondary);
    for (const b of state.bullets) px(b.x, b.y, 2, 2, colors.accent);
  }

  function initDefense() {
    resetBase(65);
    state.bubble = has("泡泡");
    state.wallHp = 8;
    state.spawn = 0.4;
    state.fire = 0;
    state.bubbleColor = 0;
  }

  function updateDefense(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const palette = [colors.primary, colors.secondary, colors.accent];
      const colorIndex = Math.floor(rand(0, 3));
      state.enemies.push({ x: VW + 8, y: rand(50, 178), w: 10, h: 10, hp: state.bubble ? 1 : Math.floor(rand(1, 3)), colorIndex, color: palette[colorIndex], speed: rand(22, 42) });
      state.spawn = rand(0.45, 0.85);
    }
    if (pointer.clicked && state.fire <= 0) {
      const target = state.enemies.find((e) => Math.abs(pointer.x - e.x) < 15 && Math.abs(pointer.y - e.y) < 15);
      if (target) {
        const strong = !state.bubble || target.colorIndex === state.bubbleColor;
        target.hp -= strong ? 2 : 1;
        pop(target.x, target.y, strong ? colors.accent : colors.primary, 10);
        if (target.hp <= 0) {
          target.dead = true;
          state.score += strong ? 120 : 80;
          state.combo++;
        }
        state.bubbleColor = (state.bubbleColor + 1) % 3;
        state.fire = state.bubble ? 0.1 : 0.18;
        beep("shoot");
      }
    }
    for (const e of state.enemies) {
      e.x -= e.speed * dt;
      if (e.x < 26) {
        e.dead = true;
        state.wallHp--;
        damage(0);
        state.lives = Math.ceil(state.wallHp / 3);
        if (state.wallHp <= 0) end(false);
      }
    }
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function drawDefense() {
    px(12, 42, 10, 142, state.bubble ? NES.cyan : NES.wood);
    bar(28, 31, 70, 5, state.wallHp, 8, colors.accent);
    if (state.bubble) dot(30, 180, 5, [colors.primary, colors.secondary, colors.accent][state.bubbleColor]);
    for (const e of state.enemies) {
      if (state.bubble) dot(e.x, e.y, 6, e.color);
      else sprite(sprites.enemy, e.x - 8, e.y - 6, 2, { 1: e.hp > 1 ? NES.red : colors.secondary });
    }
  }

  function initSwarm() {
    resetBase(60);
    state.ring = has("弹幕");
    if (state.ring) {
      state.angle = -Math.PI / 2;
      state.ringR = 58;
      state.player = { x: 160, y: 100, w: 7, h: 7 };
      state.bullets = [];
      state.spawn = 0.3;
    } else {
      state.player = { x: 160, y: 108, w: 8, h: 8 };
      state.spawn = 0.2;
      state.fire = 0;
    }
  }

  function updateSwarm(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    if (state.ring) return updateBulletRing(dt);
    movePlayer(dt, 82);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const edge = Math.floor(rand(0, 4));
      const e = edge === 0 ? { x: rand(0, VW), y: 26 } : edge === 1 ? { x: VW + 6, y: rand(35, VH) } : edge === 2 ? { x: rand(0, VW), y: VH + 6 } : { x: -6, y: rand(35, VH) };
      state.enemies.push({ ...e, w: 8, h: 8, hp: 1, speed: rand(28, 52) });
      state.spawn = rand(0.22, 0.45);
    }
    if (state.fire <= 0) {
      const target = state.enemies.reduce((best, e) => !best || dist(e, state.player) < dist(best, state.player) ? e : best, null);
      if (target) {
        const a = Math.atan2(target.y - state.player.y, target.x - state.player.x);
        state.bullets.push({ x: state.player.x, y: state.player.y, vx: Math.cos(a) * 145, vy: Math.sin(a) * 145, w: 2, h: 2 });
        state.fire = 0.18;
        beep("shoot");
      }
    }
    for (const e of state.enemies) {
      const a = Math.atan2(state.player.y - e.y, state.player.x - e.x);
      e.x += Math.cos(a) * e.speed * dt;
      e.y += Math.sin(a) * e.speed * dt;
      if (dist(e, state.player) < 9) {
        e.dead = true;
        damage();
      }
    }
    for (const b of state.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    bulletEnemyCollisions(80);
  }

  function updateBulletRing(dt) {
    if (keys.has("ArrowLeft") || keys.has("KeyA")) state.angle -= dt * 2.7;
    if (keys.has("ArrowRight") || keys.has("KeyD")) state.angle += dt * 2.7;
    state.player.x = 160 + Math.cos(state.angle) * state.ringR;
    state.player.y = 108 + Math.sin(state.angle) * state.ringR;
    state.spawn -= dt;
    if (state.spawn <= 0) {
      const gap = rand(0, Math.PI * 2);
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + state.tick * 0.01;
        if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < 0.32) continue;
        state.bullets.push({ x: 160, y: 108, vx: Math.cos(a) * rand(30, 48), vy: Math.sin(a) * rand(30, 48), w: 3, h: 3, hostile: true });
      }
      state.spawn = rand(1.1, 1.7);
    }
    for (const b of state.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (Math.hypot(b.x - state.player.x, b.y - state.player.y) < 6) {
        b.dead = true;
        damage();
      }
    }
    state.score += dt * 18;
    state.bullets = state.bullets.filter((b) => !b.dead && b.x > -20 && b.x < VW + 20 && b.y > 10 && b.y < VH + 20);
  }

  function drawSwarm() {
    if (state.ring) {
      stroke(160 - state.ringR, 108 - state.ringR, state.ringR * 2, state.ringR * 2, colors.secondary);
      dot(160, 108, 5, colors.accent);
      sprite(sprites.ship, state.player.x - 7, state.player.y - 5, 2, { 1: colors.primary });
      for (const b of state.bullets) px(b.x, b.y, b.w, b.h, colors.accent);
      return;
    }
    sprite(sprites.ship, state.player.x - 7, state.player.y - 5, 2, { 1: colors.primary });
    for (const e of state.enemies) sprite(sprites.enemy, e.x - 8, e.y - 6, 2, { 1: colors.secondary });
    for (const b of state.bullets) px(b.x, b.y, 2, 2, colors.accent);
  }

  function initTower() {
    resetBase(90);
    state.time = undefined;
    state.coins = 8;
    state.wave = 1;
    state.path = [{ x: 0, y: 154 }, { x: 72, y: 154 }, { x: 72, y: 78 }, { x: 178, y: 78 }, { x: 178, y: 150 }, { x: 320, y: 150 }];
    state.slots = [{ x: 48, y: 112, type: "fast" }, { x: 122, y: 118, type: "slow" }, { x: 154, y: 42, type: "splash" }, { x: 222, y: 110, type: "fast" }, { x: 260, y: 172, type: "slow" }];
    state.towers = [];
    state.enemies = [];
    state.projectiles = [];
    state.spawn = 0;
    state.toSpawn = 5;
  }

  function updateTower(dt) {
    if (state.wave > 7 && state.enemies.length === 0 && state.toSpawn <= 0) {
      end(true);
      return;
    }
    if (pointer.clicked) {
      const slot = state.slots.find((s) => !s.used && Math.hypot(pointer.x - s.x, pointer.y - s.y) < 12);
      if (slot && state.coins >= 2) {
        slot.used = true;
        state.coins -= 2;
        state.towers.push({ x: slot.x, y: slot.y, type: slot.type, fire: 0, range: slot.type === "slow" ? 58 : 48 });
        beep("pickup");
      }
    }
    state.spawn -= dt;
    if (state.toSpawn > 0 && state.spawn <= 0) {
      state.enemies.push({ seg: 0, t: 0, x: 0, y: 154, w: 7, h: 7, hp: 1 + Math.floor(state.wave / 3), speed: 0.18 + state.wave * 0.012 });
      state.toSpawn--;
      state.spawn = rand(0.55, 0.9);
    }
    if (state.toSpawn <= 0 && state.enemies.length === 0) {
      state.wave++;
      state.toSpawn = 4 + state.wave;
      state.coins += 2;
    }
    for (const e of state.enemies) {
      e.t += e.speed * dt;
      while (e.t > 1) {
        e.t -= 1;
        e.seg++;
      }
      if (e.seg >= state.path.length - 1) {
        e.dead = true;
        damage();
        continue;
      }
      const a = state.path[e.seg], b = state.path[e.seg + 1];
      e.x = a.x + (b.x - a.x) * e.t;
      e.y = a.y + (b.y - a.y) * e.t;
    }
    for (const t of state.towers) {
      t.fire -= dt;
      const target = state.enemies.find((e) => !e.dead && Math.hypot(e.x - t.x, e.y - t.y) < t.range);
      if (target && t.fire <= 0) {
        const rate = t.type === "fast" ? 0.28 : t.type === "slow" ? 0.65 : 0.48;
        t.fire = rate;
        state.projectiles.push({ x: t.x, y: t.y, tx: target.x, ty: target.y, target, type: t.type, life: 0.18 });
        beep("shoot");
      }
    }
    for (const p of state.projectiles) {
      p.life -= dt;
      if (p.life <= 0 && !p.done && !p.target.dead) {
        p.done = true;
        const damageAmount = p.type === "fast" ? 1 : p.type === "slow" ? 1 : 2;
        p.target.hp -= damageAmount;
        if (p.type === "slow") p.target.speed *= 0.94;
        pop(p.target.x, p.target.y, colors.accent, p.type === "splash" ? 12 : 5);
        if (p.target.hp <= 0) {
          p.target.dead = true;
          state.score += 90;
          state.coins += 1;
        }
      }
    }
    state.projectiles = state.projectiles.filter((p) => p.life > -0.04);
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  function drawTower() {
    ctx.strokeStyle = NES.wood;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (const p of state.path.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const s of state.slots) {
      stroke(s.x - 9, s.y - 9, 18, 18, s.used ? colors.primary : NES.dim);
      if (!s.used) text(s.type[0].toUpperCase(), s.x - 3, s.y - 4, NES.dim, 7);
    }
    for (const t of state.towers) {
      dot(t.x, t.y, 7, t.type === "fast" ? colors.primary : t.type === "slow" ? colors.secondary : colors.accent);
      if (pointer.down) stroke(t.x - t.range, t.y - t.range, t.range * 2, t.range * 2, "rgba(255,255,255,0.09)");
    }
    for (const p of state.projectiles) {
      ctx.strokeStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.tx, p.ty);
      ctx.stroke();
    }
    for (const e of state.enemies) sprite(sprites.enemy, e.x - 6, e.y - 5, 1.5, { 1: colors.accent });
    text("COIN " + state.coins + " WAVE " + state.wave, 6, 28, colors.accent, 7);
  }

  const beamLevels = [
    ["S./..", ".....", "../.C", "..#..", "....."],
    ["S/...", "...\\C", "..#..", ".\\.\\.", "....."],
    ["S.../", ".#...", ".....", "...#.", "....C"],
  ];

  function initBeam() {
    resetBase(180);
    state.time = undefined;
    state.level = 0;
    loadBeamLevel();
  }

  function loadBeamLevel() {
    state.grid = beamLevels[state.level].map((row) => row.split(""));
    state.beam = [];
    state.cool = 0;
  }

  function traceBeam() {
    let x = 0, y = 0, dx = 1, dy = 0;
    const path = [{ x, y }];
    for (let step = 0; step < 40; step++) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || y >= state.grid.length || x >= state.grid[0].length) break;
      path.push({ x, y });
      const cell = state.grid[y][x];
      if (cell === "#") break;
      if (cell === "C") {
        state.level++;
        state.score += 350;
        pop(70 + x * 30, 42 + y * 25, colors.accent, 18);
        if (state.level >= beamLevels.length) end(true);
        else loadBeamLevel();
        break;
      }
      if (cell === "/") [dx, dy] = [-dy, -dx];
      if (cell === "\\") [dx, dy] = [dy, dx];
    }
    state.beam = path;
  }

  function updateBeam(dt) {
    state.cool -= dt;
    if (pointer.clicked && state.cool <= 0) {
      const gx = Math.floor((pointer.x - 70) / 30);
      const gy = Math.floor((pointer.y - 42) / 25);
      if (state.grid[gy] && ["/", "\\"].includes(state.grid[gy][gx])) {
        state.grid[gy][gx] = state.grid[gy][gx] === "/" ? "\\" : "/";
        state.cool = 0.12;
        state.score = Math.max(0, state.score - 5);
        beep("tap");
      }
    }
    traceBeam();
  }

  function drawBeam() {
    const ox = 70, oy = 42, s = 24;
    for (let y = 0; y < state.grid.length; y++) for (let x = 0; x < state.grid[y].length; x++) {
      px(ox + x * 30, oy + y * 25, s, s, "#111827");
      stroke(ox + x * 30, oy + y * 25, s, s, NES.stone);
      const cell = state.grid[y][x];
      if (cell === "#") px(ox + x * 30 + 3, oy + y * 25 + 3, s - 6, s - 6, NES.black);
      if (cell === "C") dot(ox + x * 30 + 12, oy + y * 25 + 12, 7, colors.accent);
      if (cell === "S") px(ox + x * 30 + 3, oy + y * 25 + 8, 12, 8, colors.primary);
      if (cell === "/" || cell === "\\") {
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (cell === "/") {
          ctx.moveTo(ox + x * 30 + 4, oy + y * 25 + 20);
          ctx.lineTo(ox + x * 30 + 20, oy + y * 25 + 4);
        } else {
          ctx.moveTo(ox + x * 30 + 4, oy + y * 25 + 4);
          ctx.lineTo(ox + x * 30 + 20, oy + y * 25 + 20);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < state.beam.length; i++) {
      const p = state.beam[i];
      const bx = ox + p.x * 30 + 12, by = oy + p.y * 25 + 12;
      if (i === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    text("ROOM " + (state.level + 1), 126, 174, colors.accent, 8);
  }

  function initSokoban() {
    resetBase(300);
    state.time = undefined;
    state.level = ["########", "#......#", "#.B.T..#", "#.P....#", "#.B.T..#", "########"];
    state.targets = new Set();
    state.walls = new Set();
    state.boxes = new Set();
    state.undo = [];
    for (let y = 0; y < state.level.length; y++) for (let x = 0; x < state.level[y].length; x++) {
      const c = state.level[y][x];
      if (c === "#") state.walls.add(x + "," + y);
      if (c === "T") state.targets.add(x + "," + y);
      if (c === "B") state.boxes.add(x + "," + y);
      if (c === "P") state.player = { x, y };
    }
    state.moves = 0;
    state.cool = 0;
  }

  function updateSokoban(dt) {
    state.cool -= dt;
    if (keyQueue.includes("KeyZ") && state.undo.length) {
      const prev = state.undo.pop();
      state.player = { ...prev.player };
      state.boxes = new Set(prev.boxes);
      state.moves = Math.max(0, state.moves - 1);
      keyQueue.length = 0;
      return;
    }
    if (state.cool > 0) return;
    const dirs = [["ArrowUp", 0, -1], ["KeyW", 0, -1], ["ArrowDown", 0, 1], ["KeyS", 0, 1], ["ArrowLeft", -1, 0], ["KeyA", -1, 0], ["ArrowRight", 1, 0], ["KeyD", 1, 0]];
    const dir = dirs.find(([code]) => keys.has(code));
    if (!dir) return;
    const dx = dir[1], dy = dir[2];
    const nx = state.player.x + dx, ny = state.player.y + dy;
    const nk = nx + "," + ny;
    if (state.walls.has(nk)) return;
    const nbx = nx + dx, nby = ny + dy, nbk = nbx + "," + nby;
    if (state.boxes.has(nk)) {
      if (state.walls.has(nbk) || state.boxes.has(nbk)) return;
      state.undo.push({ player: { ...state.player }, boxes: [...state.boxes] });
      state.boxes.delete(nk);
      state.boxes.add(nbk);
    } else state.undo.push({ player: { ...state.player }, boxes: [...state.boxes] });
    state.player = { x: nx, y: ny };
    state.moves++;
    state.cool = 0.13;
    state.score = Math.max(0, 1200 - state.moves * 8);
    beep("tap");
    if ([...state.boxes].every((b) => state.targets.has(b))) end(true);
  }

  function drawSokoban() {
    const ox = 54, oy = 38, s = 22;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      const k = x + "," + y;
      px(ox + x * s, oy + y * s, s - 1, s - 1, state.walls.has(k) ? NES.brick : "#151515");
      if (state.targets.has(k)) {
        stroke(ox + x * s + 5, oy + y * s + 5, 11, 11, colors.accent);
      }
      if (state.boxes.has(k)) sprite(sprites.crate, ox + x * s + 3, oy + y * s + 3, 2, { 1: NES.wood, 2: state.targets.has(k) ? colors.accent : NES.orange });
    }
    sprite(sprites.runner, ox + state.player.x * s + 5, oy + state.player.y * s + 4, 2, { 1: colors.primary });
    text("MOVES " + state.moves + "  Z UNDO", 80, 176, colors.accent, 7);
  }

  function initConnect() {
    resetBase(180);
    state.time = undefined;
    state.size = 5;
    state.nodes = {
      a: [{ x: 0, y: 0 }, { x: 4, y: 0 }, colors.primary],
      b: [{ x: 0, y: 1 }, { x: 4, y: 1 }, colors.accent],
      c: [{ x: 0, y: 2 }, { x: 4, y: 4 }, colors.secondary],
    };
    state.paths = { a: [], b: [], c: [] };
    state.selected = null;
    state.lastCell = "";
  }

  function cellFromPointer() {
    const ox = 100, oy = 44, s = 24;
    const x = Math.floor((pointer.x - ox) / s);
    const y = Math.floor((pointer.y - oy) / s);
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
    return { x, y };
  }

  function occupiedCell(x, y) {
    for (const [id, path] of Object.entries(state.paths)) {
      if (path.some((p) => p.x === x && p.y === y)) return id;
    }
    return null;
  }

  function endpointId(x, y) {
    for (const [id, [a, b]] of Object.entries(state.nodes)) if ((a.x === x && a.y === y) || (b.x === x && b.y === y)) return id;
    return null;
  }

  function updateConnect() {
    if (!pointer.clicked && !pointer.down) return;
    const cell = cellFromPointer();
    if (!cell) return;
    const cellKey = cell.x + "," + cell.y;
    if (cellKey === state.lastCell) return;
    state.lastCell = cellKey;
    const endId = endpointId(cell.x, cell.y);
    if (endId && (!state.selected || state.selected !== endId)) {
      state.selected = endId;
      state.paths[endId] = [{ ...cell }];
      beep("tap");
      return;
    }
    if (!state.selected) return;
    const path = state.paths[state.selected];
    const last = path[path.length - 1];
    if (!last || Math.abs(last.x - cell.x) + Math.abs(last.y - cell.y) !== 1) return;
    const [a, b] = state.nodes[state.selected];
    const startedAtA = path[0].x === a.x && path[0].y === a.y;
    const target = startedAtA ? b : a;
    if (cell.x === target.x && cell.y === target.y) {
      path.push({ ...target });
      state.selected = null;
      state.score += 240;
      beep("pickup");
      if (Object.keys(state.nodes).every((id) => state.paths[id].length >= 2 && endpointId(state.paths[id][state.paths[id].length - 1].x, state.paths[id][state.paths[id].length - 1].y) === id)) end(true);
      return;
    }
    if (endId) return;
    const occupied = occupiedCell(cell.x, cell.y);
    if (occupied && occupied !== state.selected) return;
    if (occupied === state.selected) {
      const index = path.findIndex((p) => p.x === cell.x && p.y === cell.y);
      if (index >= 0) path.splice(index + 1);
      return;
    }
    path.push({ ...cell });
  }

  function drawConnect() {
    const ox = 100, oy = 44, s = 24;
    for (let y = 0; y < state.size; y++) for (let x = 0; x < state.size; x++) {
      stroke(ox + x * s, oy + y * s, s - 2, s - 2, "#263244");
      dot(ox + x * s + 11, oy + y * s + 11, 1, NES.dim);
    }
    for (const [id, path] of Object.entries(state.paths)) {
      if (path.length < 2) continue;
      ctx.strokeStyle = state.nodes[id][2];
      ctx.lineWidth = 4;
      ctx.beginPath();
      path.forEach((p, i) => {
        const x = ox + p.x * s + 11, y = oy + p.y * s + 11;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    for (const [id, [a, b, color]] of Object.entries(state.nodes)) {
      dot(ox + a.x * s + 11, oy + a.y * s + 11, 6, color);
      dot(ox + b.x * s + 11, oy + b.y * s + 11, 6, color);
      if (state.selected === id) stroke(ox + a.x * s + 4, oy + a.y * s + 4, 14, 14, NES.ink);
    }
  }

  function initLock() {
    resetBase(120);
    state.time = undefined;
    state.code = [Math.floor(rand(1, 7)), Math.floor(rand(1, 7)), Math.floor(rand(1, 7))];
    state.guess = [1, 1, 1];
    state.history = [];
    state.attempts = 7;
    state.feedback = "TRY THE SAFE";
  }

  function updateLock() {
    if (!pointer.clicked) return;
    for (let i = 0; i < 3; i++) {
      const x = 94 + i * 44;
      if (pointer.x > x && pointer.x < x + 34 && pointer.y > 74 && pointer.y < 110) {
        state.guess[i] = state.guess[i] % 6 + 1;
        beep("tap");
      }
    }
    if (pointer.x > 118 && pointer.x < 202 && pointer.y > 124 && pointer.y < 146) {
      let exact = 0, present = 0;
      const usedCode = [false, false, false], usedGuess = [false, false, false];
      for (let i = 0; i < 3; i++) if (state.guess[i] === state.code[i]) {
        exact++;
        usedCode[i] = true;
        usedGuess[i] = true;
      }
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!usedGuess[i] && !usedCode[j] && state.guess[i] === state.code[j]) {
        present++;
        usedGuess[i] = true;
        usedCode[j] = true;
      }
      state.history.unshift({ guess: [...state.guess], exact, present });
      state.attempts--;
      state.feedback = exact + " EXACT / " + present + " NEAR";
      state.score += exact * 90 + present * 35;
      beep("hit");
      if (exact === 3) end(true);
      else if (state.attempts <= 0) end(false);
    }
  }

  function drawLock() {
    px(72, 54, 176, 108, "#131313");
    stroke(72, 54, 176, 108, colors.primary);
    for (let i = 0; i < 3; i++) {
      const x = 94 + i * 44;
      px(x, 74, 34, 36, NES.black);
      stroke(x, 74, 34, 36, NES.stone);
      text(state.guess[i], x + 17, 82, colors.accent, 18, "center");
    }
    px(118, 124, 84, 22, colors.primary);
    text("OPEN", 160, 130, NES.black, 8, "center");
    text(state.feedback, 160, 166, colors.accent, 7, "center");
    text("LEFT " + state.attempts, 222, 166, NES.dim, 7);
    for (let i = 0; i < Math.min(4, state.history.length); i++) {
      const h = state.history[i];
      text(h.guess.join("") + " " + h.exact + "/" + h.present, 14, 54 + i * 12, NES.dim, 7);
    }
  }

  function initMemory() {
    resetBase(120);
    state.time = undefined;
    state.round = 0;
    state.paths = [
      [[0, 4], [1, 4], [1, 3], [2, 3], [2, 2], [3, 2], [4, 2]],
      [[0, 4], [0, 3], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [3, 0], [4, 0]],
      [[0, 4], [1, 4], [2, 4], [2, 3], [3, 3], [3, 2], [3, 1], [4, 1], [4, 0]],
    ];
    loadMemoryRound();
  }

  function loadMemoryRound() {
    state.path = state.paths[state.round];
    state.player = { x: state.path[0][0], y: state.path[0][1] };
    state.index = 0;
    state.show = 2.5;
    state.cool = 0;
  }

  function updateMemory(dt) {
    state.show = Math.max(0, state.show - dt);
    state.cool -= dt;
    if (state.show > 0 || state.cool > 0) return;
    const dirs = [["ArrowUp", 0, -1], ["KeyW", 0, -1], ["ArrowDown", 0, 1], ["KeyS", 0, 1], ["ArrowLeft", -1, 0], ["KeyA", -1, 0], ["ArrowRight", 1, 0], ["KeyD", 1, 0]];
    const dir = dirs.find(([code]) => keyQueue.includes(code));
    if (!dir) return;
    const nx = state.player.x + dir[1], ny = state.player.y + dir[2];
    const next = state.path[state.index + 1];
    if (next && nx === next[0] && ny === next[1]) {
      state.player = { x: nx, y: ny };
      state.index++;
      state.score += 80;
      beep("tap");
      if (state.index === state.path.length - 1) {
        state.round++;
        if (state.round >= state.paths.length) end(true);
        else {
          state.score += 250;
          loadMemoryRound();
        }
      }
    } else {
      pop(104 + state.player.x * 24, 48 + state.player.y * 24, NES.red, 10);
      damage();
      loadMemoryRound();
    }
    state.cool = 0.16;
  }

  function drawMemory() {
    const ox = 104, oy = 48, s = 24;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      px(ox + x * s, oy + y * s, s - 2, s - 2, "#090909");
      stroke(ox + x * s, oy + y * s, s - 2, s - 2, "#202733");
    }
    if (state.show > 0) {
      for (const [x, y] of state.path) px(ox + x * s + 5, oy + y * s + 5, 12, 12, colors.accent);
      text("MEMORIZE", 160, 34, colors.accent, 8, "center");
    } else {
      const px0 = ox + state.player.x * s + 11, py0 = oy + state.player.y * s + 11;
      px(px0 - 22, py0 - 22, 44, 44, "rgba(255,255,255,0.04)");
    }
    const exit = state.path[state.path.length - 1];
    stroke(ox + exit[0] * s + 4, oy + exit[1] * s + 4, 14, 14, colors.primary);
    sprite(sprites.runner, ox + state.player.x * s + 6, oy + state.player.y * s + 5, 2, { 1: colors.primary });
  }

  function update(dt) {
    if (!started || state.over) return;
    state.tick += dt * 60;
    updateParticles(dt);
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
    else updateDodge(dt);
    keyQueue.length = 0;
  }

  function draw() {
    ctx.save();
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const sx = state.shake > 0 ? Math.round(rand(-state.shake, state.shake) * 0.25) : 0;
    const sy = state.shake > 0 ? Math.round(rand(-state.shake, state.shake) * 0.25) : 0;
    ctx.translate(sx, sy);
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
    else drawDodge();
    drawParticles();
    ctx.translate(-sx, -sy);
    drawHud();
    drawOverlay();
    ctx.restore();
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
