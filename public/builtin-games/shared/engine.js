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
  const art = {};
  let state = {};
  let last = 0;
  let started = false;
  let message = "PRESS SPACE / TAP";
  let audioCtx = null;

  ctx.imageSmoothingEnabled = false;

  if (config.assets) {
    for (const [name, src] of Object.entries(config.assets)) {
      art[name] = new Image();
      art[name].onerror = () => {
        art[name].failed = true;
      };
      art[name].src = src;
    }
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(rand(0, items.length))];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rectHit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const has = (text) => title.includes(text);
  const progressText = (label, value, max) => `${label} ${Math.min(max, Math.floor(value))}/${max}`;

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

  function imageReady(image) {
    return image?.complete && image.naturalWidth > 0;
  }

  function drawAsset(name, x, y, w, h, angle = 0) {
    const image = art[name];
    if (!imageReady(image)) return false;
    ctx.save();
    ctx.translate(Math.round(x + w / 2), Math.round(y + h / 2));
    if (angle) ctx.rotate(angle);
    ctx.drawImage(image, Math.round(-w / 2), Math.round(-h / 2), Math.round(w), Math.round(h));
    ctx.restore();
    return true;
  }

  function starportAssetsReady() {
    if (!state.starport || state.cleaner) return true;
    return ["background", "ship", "drone", "asteroid", "chip", "shield", "boost", "boss"].every((name) => imageReady(art[name]));
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
    if (imageReady(art.background)) {
      ctx.drawImage(art.background, 0, 0, VW, VH);
      px(0, 0, VW, VH, "rgba(0,0,0,0.18)");
      px(0, 25, VW, VH - 25, "rgba(3,6,9,0.16)");
    } else if (["dodge", "turret", "swarm"].includes(type) && !has("弹幕")) {
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
    if (state.starport) {
      text("得分 " + String(Math.floor(state.score)).padStart(5, "0"), 6, 7, NES.ink, 8);
      text("生命 " + state.lives, 96, 7, state.lives <= 1 ? NES.red : NES.ink, 8);
      text("能量 " + Math.floor(state.energy || 0) + "%", 158, 7, colors.accent, 8);
      text("火力 L" + (state.weapon || 1), 238, 7, colors.primary, 8);
      return;
    }
    text("SCORE " + String(Math.floor(state.score)).padStart(5, "0"), 6, 7, NES.ink, 8);
    text("LIFE " + state.lives, 118, 7, state.lives <= 1 ? NES.red : NES.ink, 8);
    if (state.time !== undefined) text("TIME " + Math.max(0, Math.ceil(state.time)).toString().padStart(2, "0"), 184, 7, NES.ink, 8);
    if (state.combo > 1) text("x" + state.combo, 270, 7, colors.accent, 8);
  }

  function drawStageLabel(value, x = 160, y = 29) {
    text(value, x, y, colors.accent, 7, "center");
  }

  function drawOverlay() {
    if (started && !state.over && !message) return;
    const starport = state.starport;
    px(28, starport ? 38 : 48, 264, starport ? 126 : 104, "rgba(0,0,0,0.82)");
    stroke(28, starport ? 38 : 48, 264, starport ? 126 : 104, cssVar(colors.primary, NES.cyan));
    text(state.over ? (state.win ? "任务完成!" : "任务失败") : title, VW / 2, starport ? 52 : 65, NES.ink, 12, "center");
    text(state.over ? "空格 / 点击 再来一局" : message, VW / 2, starport ? 76 : 90, colors.accent, 8, "center");
    ctx.font = "700 7px sans-serif";
    ctx.fillStyle = NES.dim;
    ctx.textAlign = "center";
    if (starport && !state.over) {
      ctx.fillText("WASD/方向键移动，自动开火；按住鼠标/触屏可瞄准射击", VW / 2, 100, 252);
      ctx.fillText("捡能量升级火力，能量满按空格释放星港脉冲", VW / 2, 118, 252);
      ctx.fillText("清掉敌机推进战线，进度满后击败指挥舰 Boss", VW / 2, 136, 252);
    } else {
      ctx.fillText(config.summary, VW / 2, 116, 230);
    }
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
    const isCleaner = has("清道夫");
    const isStarport = has("星港");
    state.cleaner = isCleaner;
    state.starport = isStarport;
    if (isStarport && !isCleaner) {
      resetBase(90);
      state.cleaner = false;
      state.starport = true;
      message = "星港空战：移动、射击、升级、击败Boss";
      state.player = { x: 44, y: 108, w: 10, h: 8, cargo: [], shield: 0, boost: 0, invuln: 0 };
      state.energy = 0;
      state.weapon = 1;
      state.fire = 0;
      state.progress = 0;
      state.kills = 0;
      state.boss = null;
      state.bossSpawned = false;
      state.bossFire = 0;
      state.spawn = 0.2;
      state.items = [];
      state.hazards = [];
      state.bullets = [];
      state.enemyBullets = [];
      for (let i = 0; i < 5; i++) spawnDodgeItem();
      for (let i = 0; i < 4; i++) spawnStarportEnemy(rand(150, VW + 60));
      return;
    }
    state.player = { x: 42, y: 108, w: 10, h: 8, cargo: [], shield: 0, boost: 0 };
    state.drop = { x: 265, y: 146, w: 38, h: 28 };
    state.spawn = 0;
    state.dropStreak = 0;
    state.chipCombo = 0;
    for (let i = 0; i < 7; i++) spawnDodgeItem();
    for (let i = 0; i < 6; i++) spawnDodgeHazard(rand(110, VW));
  }

  function spawnDodgeItem() {
    const roll = Math.random();
    const type = state.cleaner ? "scrap" : roll > 0.86 ? "shield" : roll > 0.7 ? "boost" : "chip";
    state.items.push({ x: rand(72, 286), y: rand(44, 176), r: type === "scrap" ? rand(3, 5) : 3, type, pulse: rand(0, 6), vx: rand(-7, 7), vy: rand(-5, 5) });
  }

  function spawnDodgeHazard(x = VW + 12) {
    const kind = state.starport && Math.random() > 0.45 ? "drone" : "asteroid";
    state.hazards.push({ x, y: rand(38, 180), w: rand(7, 13), h: rand(7, 11), vx: -rand(38, 72), vy: rand(-20, 20), warned: false, near: false, kind, spin: rand(-1.2, 1.2) });
  }

  function spawnStarportEnemy(x = VW + 14) {
    const difficulty = clamp((state.progress || 0) / 100, 0, 1);
    const roll = Math.random();
    const kind = roll > 0.72 ? "drone" : "asteroid";
    const hp = kind === "drone" ? 2 + Math.floor(difficulty * 2) : 4 + Math.floor(difficulty * 3);
    state.hazards.push({
      x,
      y: rand(42, 176),
      w: kind === "drone" ? 12 : 16,
      h: kind === "drone" ? 10 : 14,
      hp,
      maxHp: hp,
      vx: -rand(22 + difficulty * 12, 48 + difficulty * 18),
      vy: kind === "drone" ? rand(-18, 18) : rand(-9, 9),
      fire: rand(0.6, 1.6),
      warned: false,
      near: false,
      kind,
      spin: rand(-1.2, 1.2),
    });
  }

  function fireStarportBullet(angle, offsetY = 0, power = 1) {
    const p = state.player;
    state.bullets.push({
      x: p.x + 13,
      y: p.y + offsetY,
      vx: Math.cos(angle) * 184,
      vy: Math.sin(angle) * 184,
      w: power > 1 ? 5 : 3,
      h: power > 1 ? 3 : 2,
      power,
      pierce: state.weapon >= 4 ? 1 : 0,
    });
  }

  function fireStarportWeapon() {
    const p = state.player;
    const aiming = pointer.down;
    const base = aiming ? Math.atan2(pointer.y - p.y, pointer.x - p.x) : 0;
    const level = state.weapon || 1;
    fireStarportBullet(base, 0, level >= 3 ? 2 : 1);
    if (level >= 2) {
      fireStarportBullet(base - 0.11, -4, 1);
      fireStarportBullet(base + 0.11, 4, 1);
    }
    if (level >= 3) {
      fireStarportBullet(base - 0.24, -2, 1);
      fireStarportBullet(base + 0.24, 2, 1);
    }
    state.fire = level >= 4 ? 0.13 : level >= 2 ? 0.16 : 0.2;
    beep("shoot");
  }

  function useStarportUltimate() {
    if ((state.energy || 0) < 100) return;
    state.energy = 0;
    state.shake = 12;
    state.flash = 0.22;
    for (const e of state.hazards) {
      e.hp -= e.kind === "boss" ? 42 : 99;
      pop(e.x, e.y, colors.accent, e.kind === "boss" ? 28 : 18);
      if (e.hp <= 0) e.dead = true;
    }
    if (state.boss) {
      state.boss.hp -= 42;
      if (state.boss.hp <= 0) state.boss.dead = true;
    }
    state.enemyBullets = [];
    beep("win");
  }

  function spawnStarportBoss() {
    state.bossSpawned = true;
    state.boss = { x: VW + 44, y: 102, w: 54, h: 42, hp: 240, maxHp: 240, vx: -18, phase: 0, fire: 0.8, dead: false };
    message = "";
  }

  function updateStarportWar(dt) {
    state.time -= dt;
    if (state.time <= 0) end(false);
    const p = state.player;
    p.shield = Math.max(0, p.shield - dt);
    p.boost = Math.max(0, p.boost - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    movePlayer(dt, 98 + (p.boost > 0 ? 34 : 0));
    state.fire -= dt;
    state.spawn -= dt;
    state.progress = Math.min(100, state.progress + dt * 2.5);
    state.weapon = state.energy >= 75 ? 4 : state.energy >= 50 ? 3 : state.energy >= 25 ? 2 : 1;
    if (keys.has("Space")) useStarportUltimate();
    if (state.fire <= 0) fireStarportWeapon();
    if (!state.bossSpawned && state.progress >= 100) spawnStarportBoss();
    if (!state.bossSpawned && state.spawn <= 0) {
      spawnStarportEnemy();
      state.spawn = rand(0.6, 1.1) - clamp(state.progress / 100, 0, 1) * 0.2;
    }
    for (const item of state.items) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      if (item.x < 45 || item.x > 302) item.vx *= -1;
      if (item.y < 35 || item.y > 184) item.vy *= -1;
      if (!item.dead && Math.hypot(p.x - item.x, p.y - item.y) < 12) {
        item.dead = true;
        if (item.type === "shield") p.shield = 7;
        else if (item.type === "boost") p.boost = 4;
        else state.energy = Math.min(100, state.energy + 14);
        state.score += item.type === "chip" ? 120 : 80;
        state.combo++;
        pop(item.x, item.y, item.type === "shield" ? NES.cyan : item.type === "boost" ? NES.yellow : colors.accent, 12);
        beep("pickup");
      }
    }
    state.items = state.items.filter((item) => !item.dead).slice(-10);
    if (state.items.length < 5 && Math.random() < dt * 1.6) spawnDodgeItem();

    for (const b of state.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const e of state.hazards) {
      const chase = e.kind === "drone" ? Math.sign(p.y - e.y) * 18 : 0;
      e.x += e.vx * dt;
      e.y += (e.vy + chase) * dt;
      if (e.y < 34 || e.y > 184) e.vy *= -1;
      e.fire -= dt;
      if (e.kind === "drone" && e.fire <= 0) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        state.enemyBullets.push({ x: e.x - 8, y: e.y, vx: Math.cos(a) * 82, vy: Math.sin(a) * 82, w: 3, h: 3 });
        e.fire = rand(1.2, 2);
      }
      if (rectHit({ x: p.x - 6, y: p.y - 5, w: 12, h: 10 }, { x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h })) {
        e.dead = true;
        if (p.shield > 0) {
          p.shield = 0;
          pop(p.x, p.y, NES.cyan, 18);
        } else if (p.invuln <= 0) {
          damage();
          p.invuln = 1.2;
        }
      }
    }
    if (state.boss) updateStarportBoss(dt);
    for (const eb of state.enemyBullets) {
      eb.x += eb.vx * dt;
      eb.y += eb.vy * dt;
      if (Math.hypot(eb.x - p.x, eb.y - p.y) < 8) {
        eb.dead = true;
        if (p.shield > 0) p.shield = 0;
        else if (p.invuln <= 0) {
          damage();
          p.invuln = 1.2;
        }
      }
    }
    for (const b of state.bullets) {
      for (const e of state.hazards) {
        if (e.dead || !rectHit({ x: b.x, y: b.y, w: b.w, h: b.h }, { x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h })) continue;
        e.hp -= b.power;
        if (b.pierce > 0) b.pierce--;
        else b.dead = true;
        pop(b.x, b.y, colors.accent, 5);
        if (e.hp <= 0) killStarportEnemy(e);
      }
      if (state.boss && !state.boss.dead && rectHit({ x: b.x, y: b.y, w: b.w, h: b.h }, { x: state.boss.x - state.boss.w / 2, y: state.boss.y - state.boss.h / 2, w: state.boss.w, h: state.boss.h })) {
        state.boss.hp -= b.power;
        b.dead = true;
        pop(b.x, b.y, colors.accent, 4);
        if (state.boss.hp <= 0) state.boss.dead = true;
      }
    }
    if (state.boss?.dead) {
      state.score += 1800;
      pop(state.boss.x, state.boss.y, colors.accent, 44);
      end(true);
    }
    state.bullets = state.bullets.filter((b) => !b.dead && b.x < VW + 20 && b.y > 24 && b.y < VH + 20).slice(-90);
    state.enemyBullets = state.enemyBullets.filter((b) => !b.dead && b.x > -20 && b.x < VW + 20 && b.y > 24 && b.y < VH + 20).slice(-80);
    state.hazards = state.hazards.filter((e) => !e.dead && e.x > -40).slice(-22);
  }

  function killStarportEnemy(e) {
    e.dead = true;
    state.kills++;
    state.combo++;
    state.progress = Math.min(100, state.progress + 7);
    state.energy = Math.min(100, state.energy + (e.kind === "drone" ? 6 : 4));
    state.score += (e.kind === "drone" ? 130 : 180) + state.combo * 8;
    pop(e.x, e.y, colors.secondary, 18);
    if (Math.random() > 0.35) state.items.push({ x: e.x, y: e.y, r: 3, type: "chip", pulse: rand(0, 6), vx: rand(-5, 5), vy: rand(-5, 5) });
    beep("hit");
  }

  function updateStarportBoss(dt) {
    const boss = state.boss;
    if (boss.x > 246) boss.x += boss.vx * dt;
    boss.phase += dt;
    boss.y = 102 + Math.sin(boss.phase * 1.5) * 42;
    boss.fire -= dt;
    if (boss.fire <= 0) {
      for (let i = -1; i <= 1; i++) {
        const a = Math.PI + i * 0.18 + Math.sin(boss.phase) * 0.08;
        state.enemyBullets.push({ x: boss.x - 22, y: boss.y + i * 7, vx: Math.cos(a) * 96, vy: Math.sin(a) * 96, w: 4, h: 4 });
      }
      boss.fire = boss.hp < boss.maxHp * 0.45 ? 0.55 : 0.8;
      beep("shoot");
    }
  }

  function updateDodge(dt) {
    if (state.starport && !state.cleaner) {
      if (!starportAssetsReady()) return;
      updateStarportWar(dt);
      return;
    }
    state.time -= dt;
    if (state.time <= 0) end(true);
    const p = state.player;
    p.shield = Math.max(0, p.shield - dt);
    p.boost = Math.max(0, p.boost - dt);
    const load = state.cleaner ? p.cargo.length : 0;
    movePlayer(dt, (state.cleaner ? 84 - load * 12 : 94) + (p.boost > 0 ? 34 : 0));
    if (state.cleaner && p.cargo.length > 0 && rectHit({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 }, state.drop)) {
      const delivered = p.cargo.length;
      state.dropStreak++;
      state.score += delivered * 150 + state.combo * 16 + state.dropStreak * 45;
      state.combo += delivered;
      pop(state.drop.x + 18, state.drop.y + 12, colors.accent, 14);
      p.cargo = [];
      for (let i = 0; i < delivered; i++) spawnDodgeItem();
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
          if (p.cargo.length < 3) {
            p.cargo.push(item);
            pop(item.x, item.y, NES.stone, 6);
            beep("pickup");
          }
          else item.dead = false;
        } else {
          if (item.type === "shield") {
            p.shield = 7;
            state.score += 80;
          } else if (item.type === "boost") {
            p.boost = 4.2;
            state.score += 90;
          } else {
            state.chipCombo++;
            state.combo++;
            state.score += 100 + state.combo * 12 + state.chipCombo * 18;
          }
          spawnDodgeItem();
          pop(item.x, item.y, item.type === "shield" ? NES.cyan : item.type === "boost" ? NES.yellow : colors.accent, 10);
          beep("pickup");
        }
      }
    }
    state.items = state.items.filter((item) => !item.dead).slice(-12);
    for (const h of state.hazards) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.y < 31 || h.y > 188) h.vy *= -1;
      if (h.x < -20) Object.assign(h, { x: VW + rand(10, 80), y: rand(38, 180), vx: -rand(45, 82), near: false, warned: false });
      if (!h.warned && h.x > VW - 18) {
        h.warned = true;
        state.flash = 0.06;
      }
      const hb = { x: h.x - h.w / 2, y: h.y - h.h / 2, w: h.w, h: h.h };
      if (rectHit({ x: p.x - 5, y: p.y - 4, w: 10, h: 8 }, hb)) {
        Object.assign(h, { x: VW + 20, y: rand(40, 178), near: false, warned: false });
        if (p.shield > 0) {
          p.shield = 0;
          state.shake = 6;
          pop(p.x, p.y, NES.cyan, 16);
          beep("hit");
        } else damage();
      } else if (!h.near && Math.abs(p.x - h.x) < 18 && Math.abs(p.y - h.y) < 15) {
        h.near = true;
        state.score += 45 + state.combo * 4;
        state.combo++;
        pop(p.x, p.y, NES.yellow, 4);
      }
    }
    state.spawn -= dt;
    if (state.spawn <= 0) {
      spawnDodgeHazard();
      state.spawn = rand(1.2, 2);
    }
  }

  function drawDodge() {
    if (state.starport && !state.cleaner) {
      drawStarportWar();
      return;
    }
    if (state.cleaner) {
      stroke(state.drop.x, state.drop.y, state.drop.w, state.drop.h, colors.accent);
      text("REC +" + state.dropStreak, state.drop.x + 4, state.drop.y + 10, colors.accent, 7);
    }
    for (const item of state.items) {
      const itemColor = item.type === "shield" ? NES.cyan : item.type === "boost" ? NES.yellow : state.cleaner ? NES.stone : colors.accent;
      const pulse = Math.sin(state.tick * 0.15 + item.pulse) > 0 ? 1 : 0;
      if (state.starport && !state.cleaner) {
        const asset = item.type === "shield" ? "shield" : item.type === "boost" ? "boost" : "chip";
        const size = item.type === "chip" ? 12 + pulse : 14 + pulse;
        if (!drawAsset(asset, item.x - size / 2, item.y - size / 2, size, size)) {
          dot(item.x, item.y, item.r + pulse, itemColor);
          px(item.x - 1, item.y - 1, 2, 2, NES.ink);
        }
      } else {
        dot(item.x, item.y, item.r + pulse, itemColor);
        px(item.x - 1, item.y - 1, 2, 2, NES.ink);
      }
    }
    for (const h of state.hazards) {
      if (h.x > VW - 22) {
        px(VW - 7, h.y - 7, 4, 14, NES.red);
        px(VW - 12, h.y - 2, 5, 4, NES.red);
      }
      if (state.starport) {
        const asset = h.kind === "drone" ? "drone" : "asteroid";
        const size = h.kind === "drone" ? Math.max(18, h.w * 2.1) : Math.max(20, h.w * 2.35);
        if (!drawAsset(asset, h.x - size / 2, h.y - size / 2, size, size, h.kind === "asteroid" ? state.tick * 0.015 * h.spin : 0)) {
          px(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, colors.secondary);
        }
        px(h.x + 5, h.y - 1, 10, 2, "rgba(255,255,255,0.14)");
      } else {
        px(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h, NES.red);
        px(h.x + 4, h.y - 1, 12, 2, "rgba(255,255,255,0.16)");
      }
    }
    const blink = state.hurt > 0 && Math.floor(state.tick / 5) % 2 === 0;
    if (!blink) {
      if (!state.starport || !drawAsset("ship", state.player.x - 14, state.player.y - 11, 28, 22)) {
        sprite(sprites.ship, state.player.x - 8, state.player.y - 6, 2, { 1: colors.primary, 2: colors.accent });
      }
    }
    if (state.player.shield > 0) stroke(state.player.x - 12, state.player.y - 10, 24, 20, NES.cyan);
    if (state.player.boost > 0) px(state.player.x - 17, state.player.y + 4, 8, 2, NES.yellow);
    for (let i = 0; i < state.player.cargo.length; i++) dot(state.player.x + 12 + i * 5, state.player.y - 6, 3, NES.stone);
  }

  function drawStarportWar() {
    if (!starportAssetsReady()) {
      px(42, 76, 236, 52, "rgba(0,0,0,0.72)");
      stroke(42, 76, 236, 52, colors.primary);
      text("正在装载星港战机素材...", 160, 92, NES.ink, 9, "center");
      text("请稍等，装载完成后自动开战", 160, 110, colors.accent, 7, "center");
      return;
    }
    for (const item of state.items) {
      const itemColor = item.type === "shield" ? NES.cyan : item.type === "boost" ? NES.yellow : colors.accent;
      const pulse = Math.sin(state.tick * 0.15 + item.pulse) > 0 ? 1 : 0;
      const asset = item.type === "shield" ? "shield" : item.type === "boost" ? "boost" : "chip";
      const size = item.type === "chip" ? 12 + pulse : 14 + pulse;
      if (!drawAsset(asset, item.x - size / 2, item.y - size / 2, size, size)) dot(item.x, item.y, item.r + pulse, itemColor);
    }
    for (const e of state.hazards) {
      const asset = e.kind === "drone" ? "drone" : "asteroid";
      const size = e.kind === "drone" ? 22 : 26;
      if (!drawAsset(asset, e.x - size / 2, e.y - size / 2, size, size, e.kind === "asteroid" ? state.tick * 0.014 * e.spin : 0)) {
        px(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, e.kind === "drone" ? colors.secondary : NES.stone);
      }
      bar(e.x - 10, e.y - size / 2 - 5, 20, 3, Math.max(0, e.hp), e.maxHp, colors.accent);
    }
    if (state.boss) {
      const boss = state.boss;
      if (!drawAsset("boss", boss.x - 38, boss.y - 30, 76, 60)) {
        px(boss.x - boss.w / 2, boss.y - boss.h / 2, boss.w, boss.h, NES.purple);
      }
      bar(78, 31, 164, 6, Math.max(0, boss.hp), boss.maxHp, NES.red);
      text("指挥舰", 48, 30, NES.red, 7);
    }
    for (const b of state.bullets) {
      px(b.x, b.y, b.w + 3, b.h, b.power > 1 ? NES.yellow : colors.accent);
      px(b.x - 4, b.y, 4, 1, "rgba(255,255,255,0.28)");
    }
    for (const b of state.enemyBullets) {
      dot(b.x, b.y, 3, NES.red);
      dot(b.x, b.y, 1, NES.yellow);
    }
    const blink = state.hurt > 0 && Math.floor(state.tick / 5) % 2 === 0;
    if (!blink) {
      if (!drawAsset("ship", state.player.x - 14, state.player.y - 11, 28, 22)) sprite(sprites.ship, state.player.x - 8, state.player.y - 6, 2, { 1: colors.primary, 2: colors.accent });
    }
    if (state.player.shield > 0) stroke(state.player.x - 14, state.player.y - 12, 28, 24, NES.cyan);
    if (state.player.boost > 0) px(state.player.x - 20, state.player.y + 4, 10, 2, NES.yellow);
    bar(8, 186, 84, 6, Math.min(100, state.progress || 0), 100, colors.primary);
    text(state.bossSpawned ? "击败Boss" : "战线推进", 10, 176, colors.primary, 7);
    bar(108, 186, 92, 6, Math.min(100, state.energy || 0), 100, colors.accent);
    text((state.energy || 0) >= 100 ? "空格释放大招" : "能量蓄积", 110, 176, colors.accent, 7);
    text("击落 " + state.kills, 226, 176, NES.ink, 7);
  }

  function initBreakout() {
    resetBase(90);
    state.time = undefined;
    state.paddle = { x: 130, y: 184, w: 58, h: 5 };
    state.ball = { x: 160, y: 174, w: 4, h: 4, vx: 72, vy: -74, spin: 0 };
    state.bricks = [];
    state.speedRamp = 0;
    const cols = [NES.red, NES.orange, NES.yellow, NES.green, colors.secondary];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) {
      const special = (x + y * 3) % 13 === 0 ? "bomb" : (x * 2 + y) % 17 === 0 ? "hard" : "";
      const hp = special === "hard" || y < 2 ? 2 : 1;
      state.bricks.push({ x: 12 + x * 30, y: 38 + y * 10, w: 24, h: 7, hp, max: hp, type: special, color: cols[y] });
    }
  }

  function breakBrick(brick, chain = 0) {
    if (brick.dead) return;
    brick.dead = true;
    state.combo++;
    state.score += 70 + state.combo * 9 + chain * 35;
    pop(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.type === "bomb" ? NES.yellow : brick.color, chain ? 10 : 7);
    if (brick.type !== "bomb") return;
    for (const other of state.bricks) {
      if (!other.dead && Math.abs(other.x - brick.x) <= 32 && Math.abs(other.y - brick.y) <= 14) breakBrick(other, chain + 1);
    }
  }

  function updateBreakout(dt) {
    const p = state.paddle;
    if (pointer.down) p.x = pointer.x - p.w / 2;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) p.x -= 128 * dt;
    if (keys.has("ArrowRight") || keys.has("KeyD")) p.x += 128 * dt;
    p.x = clamp(p.x, 5, VW - p.w - 5);
    const b = state.ball;
    state.speedRamp = Math.min(32, state.speedRamp + dt * 0.85);
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
      b.spin = t * 26;
      b.vx = clamp(t * (118 + state.speedRamp), -138, 138);
      b.vy = -Math.min(132 + state.speedRamp, Math.abs(b.vy) + 6);
      beep("hit");
    }
    b.vx += b.spin * dt;
    b.spin *= Math.max(0, 1 - dt * 1.8);
    const speed = Math.hypot(b.vx, b.vy);
    const targetSpeed = clamp(speed, 92, 150 + state.speedRamp);
    if (speed > 0) {
      b.vx = b.vx / speed * targetSpeed;
      b.vy = b.vy / speed * targetSpeed;
    }
    for (const brick of state.bricks) {
      if (brick.dead || !rectHit(b, brick)) continue;
      brick.hp--;
      b.vy *= -1;
      pop(b.x, b.y, brick.color, 8);
      beep("hit");
      if (brick.hp <= 0) breakBrick(brick);
      else state.score += 35;
      break;
    }
    if (state.bricks.every((brick) => brick.dead)) end(true);
  }

  function drawBreakout() {
    for (const brick of state.bricks) {
      if (brick.dead) continue;
      const color = brick.type === "bomb" ? NES.yellow : brick.hp < brick.max ? NES.stone : brick.color;
      px(brick.x, brick.y, brick.w, brick.h, color);
      px(brick.x + 2, brick.y + 2, brick.w - 4, 1, NES.black);
      if (brick.type === "bomb") px(brick.x + 10, brick.y + 2, 4, 3, NES.red);
      if (brick.type === "hard") stroke(brick.x + 1, brick.y + 1, brick.w - 2, brick.h - 2, NES.ink);
    }
    px(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, colors.primary);
    px(state.paddle.x + 4, state.paddle.y - 2, state.paddle.w - 8, 2, NES.ink);
    px(state.ball.x, state.ball.y, state.ball.w, state.ball.h, colors.accent);
  }

  function initGoalie() {
    resetBase(60);
    state.goalie = { y: 110, h: 32, dive: 0, flash: 0 };
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
    g.flash = Math.max(0, g.flash - dt);
    state.spawn -= dt;
    if (!state.shot && state.spawn <= 0) {
      state.shot = { y: rand(48, 172), wait: 0.64, curve: rand(-34, 34), spin: rand(-1, 1) };
    }
    if (state.shot) {
      state.shot.wait -= dt;
      if (state.shot.wait <= 0) {
        state.balls.push({ x: 282, y: state.shot.y + rand(-15, 15), w: 5, h: 5, vx: -rand(96, 134), vy: state.shot.curve * 0.16, curve: state.shot.curve, spin: state.shot.spin });
        state.shot = null;
        state.spawn = rand(0.7, 1.05);
        beep("shoot");
      }
    }
    for (const b of state.balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += (Math.sin(state.tick * 0.07 + b.spin * 5) * 12 + b.curve * 0.12) * dt;
      if (b.x < 38 && b.y > g.y - g.h / 2 && b.y < g.y + g.h / 2) {
        b.dead = true;
        g.dive = 0.18;
        g.flash = 0.22;
        state.combo++;
        state.score += 120 + state.combo * 28;
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
      let py = state.shot.y;
      for (let x = 270; x > 42; x -= 12) {
        py += Math.sin((270 - x) * 0.045 + state.shot.spin * 4) * 0.9 + state.shot.curve * 0.01;
        px(x, py, 6, 1, colors.accent);
      }
      sprite(sprites.runner, 275, state.shot.y - 14, 2, { 1: colors.secondary });
    } else sprite(sprites.runner, 275, 130, 2, { 1: colors.secondary });
    const gy = state.goalie.y - state.goalie.h / 2;
    if (state.goalie.flash > 0) stroke(27, gy - 4, 20, state.goalie.h + 8, NES.yellow);
    sprite(sprites.keeper, state.goalie.dive > 0 ? 36 : 32, gy, 2, { 1: colors.primary });
    for (const b of state.balls) {
      px(b.x, b.y, b.w, b.h, colors.accent);
      px(b.x + 1, b.y - 2, 3, 1, NES.ink);
    }
  }

  function initPlatform() {
    resetBase(65);
    state.cloud = has("云端");
    state.player = { x: 48, y: 128, w: 8, h: 12, vy: 0, grounded: false, coyote: 0, buffer: 0, land: 0 };
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
    const wasGrounded = p.grounded;
    state.time -= dt;
    if (state.time <= 0) end(true);
    p.land = Math.max(0, p.land - dt);
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
        if (!wasGrounded) {
          p.land = 0.16;
          state.shake = Math.max(state.shake, 2);
          pop(p.x + p.w / 2, p.y + p.h, colors.primary, 6);
        }
        if (!state.cloud) pl.sink = Math.max(pl.sink, 1);
      }
    }
    if (p.y > VH + 20) end(false);
    for (const item of state.items) {
      if (!item.dead && Math.hypot(p.x - (item.x - state.worldX), p.y - item.y) < 12) {
        item.dead = true;
        state.score += 140;
        if (!state.cloud) state.time = Math.min(75, state.time + 2.5);
        state.combo++;
        pop(item.x - state.worldX, item.y, colors.accent, 10);
        beep("pickup");
      }
    }
    const last = state.platforms[state.platforms.length - 1];
    if (last.x - state.worldX < VW) {
      const nextX = last.x + rand(56, 78);
      const nextY = clamp(last.y + rand(-28, 26), 92, 160);
      const width = rand(38, 62) - Math.max(0, state.combo - 4);
      state.platforms.push({ x: nextX, y: nextY, w: clamp(width, 32, 64), sink: 0 });
      state.items.push({ x: nextX + rand(12, 34), y: nextY - rand(16, 26) });
    }
    state.platforms = state.platforms.filter((pl) => pl.x - state.worldX > -90);
    state.items = state.items.filter((it) => it.x - state.worldX > -60 && !it.dead);
    if (state.score >= 1200) end(true);
  }

  function drawPlatform() {
    px(0, state.cloud ? 176 : 182, VW, 18, state.cloud ? "#243b55" : "#5c1e12");
    for (const pl of state.platforms) {
      const sx = pl.x - state.worldX;
      const sinking = !state.cloud && pl.sink > 0;
      px(sx, pl.y, pl.w, 6, state.cloud ? NES.ink : sinking ? NES.red : NES.orange);
      px(sx + 2, pl.y + 6, pl.w - 4, 3 + Math.min(5, pl.sink * 4), state.cloud ? "#a7c7e7" : sinking ? "#8f2418" : NES.red);
      if (sinking) {
        for (let x = sx + 5; x < sx + pl.w - 4; x += 12) px(x, pl.y - 3, 7, 1, NES.yellow);
      }
    }
    for (const item of state.items) {
      dot(item.x - state.worldX, item.y, 3 + (Math.sin(state.tick * 0.12) > 0 ? 1 : 0), colors.accent);
      px(item.x - state.worldX - 1, item.y - 1, 2, 2, NES.ink);
    }
    if (state.player.land > 0) px(state.player.x - 2, state.player.y + state.player.h + 1, 16, 2, NES.yellow);
    sprite(sprites.runner, state.player.x, state.player.y, 2, { 1: colors.primary });
  }

  function initRunner() {
    resetBase(55);
    message = "SPACE JUMP / DOWN DUCK";
    state.moon = has("月面");
    state.subway = has("地铁");
    state.player = { x: 42, y: 154, w: 8, h: 12, vy: 0, grounded: true, slide: 0, coyote: 0, buffer: 0 };
    state.speed = state.moon ? 70 : 86;
    state.obstacles = [];
    state.spawn = 0.8;
    state.distance = 0;
    state.goal = 900;
  }

  function spawnRunnerObstacle() {
    const difficulty = clamp(state.distance / state.goal, 0, 1);
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
    state.spawn = rand(0.78 - difficulty * 0.18, 1.28 - difficulty * 0.22);
  }

  function updateRunner(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    const p = state.player;
    state.distance += state.speed * dt;
    state.speed = Math.min(132, state.speed + dt * (1.7 + clamp(state.distance / state.goal, 0, 1) * 1.2));
    if (keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW") || pointer.clicked) p.buffer = 0.12;
    p.buffer = Math.max(0, p.buffer - dt);
    p.coyote = Math.max(0, p.coyote - dt);
    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
      p.vy = state.moon ? -124 : -150;
      p.grounded = false;
      p.buffer = 0;
      beep("jump");
      pop(p.x, p.y + p.h, colors.primary, 5);
    }
    p.slide = (keys.has("ArrowDown") || keys.has("KeyS")) && p.grounded ? 0.2 : Math.max(0, p.slide - dt);
    p.vy += (state.moon ? 235 : 330) * dt;
    p.y += p.vy * dt;
    if (p.y > 154) {
      p.y = 154;
      p.vy = 0;
      p.grounded = true;
      p.coyote = 0.08;
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
        if (state.combo % 4 === 0) pop(p.x, p.y, colors.accent, 8);
      }
    }
    state.obstacles = state.obstacles.filter((o) => o.x > -45 && !o.dead);
    if (state.distance >= state.goal) end(true);
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
    drawStageLabel(progressText("RUN", state.distance, state.goal));
  }

  function initLane() {
    resetBase(55);
    message = "UP/DOWN OR TAP A LANE";
    state.lane = 1;
    state.playerY = laneY(1);
    state.obstacles = [];
    state.pickups = [];
    state.spawn = 0.5;
    state.cool = 0;
    state.speed = 95;
    state.passed = 0;
    state.goal = 22;
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
      if (pointer.clicked) {
        state.lane = clamp(Math.round((pointer.y - 72) / 42), 0, 2);
        state.cool = 0.12;
        beep("tap");
      }
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
      const difficulty = clamp(state.passed / state.goal, 0, 1);
      const lane = Math.floor(rand(0, 3));
      state.obstacles.push({ x: VW + 10, lane, w: 14, h: 14, scored: false });
      if (Math.random() > 0.55) state.pickups.push({ x: VW + 40, lane: (lane + 1 + Math.floor(rand(0, 2))) % 3 });
      state.spawn = rand(0.58 - difficulty * 0.12, 0.98 - difficulty * 0.16);
    }
    for (const o of state.obstacles) {
      o.x -= state.speed * dt;
      if (o.x < 54 && o.x > 34 && o.lane === state.lane) {
        o.dead = true;
        damage();
      }
      if (!o.scored && o.x < 20) {
        o.scored = true;
        state.passed++;
        state.combo++;
        state.score += 70 + state.combo * 6;
        if (state.combo % 5 === 0) pop(44, state.playerY, colors.secondary, 8);
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
    if (state.passed >= state.goal) end(true);
  }

  function drawLane() {
    for (let i = 0; i < 3; i++) {
      px(0, laneY(i) + 9, VW, 2, "#293241");
      for (let x = 0; x < VW; x += 28) px((x - state.tick * 2) % VW, laneY(i) + 9, 12, 2, NES.dim);
    }
    sprite(sprites.runner, 36, state.playerY - 8, 2, { 1: colors.primary });
    for (const o of state.obstacles) px(o.x, laneY(o.lane) - 8, o.w, o.h, colors.accent);
    for (const p of state.pickups) dot(p.x, laneY(p.lane), 3, colors.secondary);
    drawStageLabel(progressText("GATES", state.passed, state.goal));
  }

  function initTurret() {
    resetBase(65);
    message = "AIM / HOLD TO FIRE";
    state.base = { x: 160, y: 110, r: 11 };
    state.spawn = 0.2;
    state.fire = 0;
    state.kills = 0;
    state.goal = 32;
  }

  function updateTurret(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const difficulty = clamp(state.kills / state.goal, 0, 1);
      const edge = Math.floor(rand(0, 4));
      const e = edge === 0 ? { x: rand(0, VW), y: 26 } : edge === 1 ? { x: VW + 8, y: rand(35, VH) } : edge === 2 ? { x: rand(0, VW), y: VH + 8 } : { x: -8, y: rand(35, VH) };
      const size = rand(6, 12);
      state.enemies.push({ ...e, w: size, h: size, hp: size > 9 ? 2 : 1, speed: rand(24 + difficulty * 8, 42 + difficulty * 10) });
      state.spawn = rand(0.48 - difficulty * 0.12, 0.92 - difficulty * 0.18);
    }
    if ((pointer.down || pointer.clicked) && state.fire <= 0) {
      const assisted = state.enemies
        .filter((e) => Math.hypot(e.x - pointer.x, e.y - pointer.y) < 20)
        .sort((a, b) => Math.hypot(a.x - pointer.x, a.y - pointer.y) - Math.hypot(b.x - pointer.x, b.y - pointer.y))[0];
      const tx = assisted ? assisted.x : pointer.x;
      const ty = assisted ? assisted.y : pointer.y;
      const a = Math.atan2(ty - state.base.y, tx - state.base.x);
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
    if (state.kills >= state.goal) end(true);
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
          state.kills = (state.kills || 0) + 1;
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
    drawStageLabel(progressText("KILLS", state.kills || 0, state.goal || 32));
  }

  function initDefense() {
    resetBase(65);
    message = "TAP TARGETS BEFORE WALL";
    state.bubble = has("泡泡");
    state.wallHp = 8;
    state.spawn = 0.4;
    state.fire = 0;
    state.bubbleColor = 0;
    state.stopped = 0;
    state.goal = 28;
  }

  function updateDefense(dt) {
    state.time -= dt;
    if (state.time <= 0) end(true);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const difficulty = clamp(state.stopped / state.goal, 0, 1);
      const palette = [colors.primary, colors.secondary, colors.accent];
      const colorIndex = Math.floor(rand(0, 3));
      state.enemies.push({ x: VW + 8, y: rand(50, 178), w: 10, h: 10, hp: state.bubble ? 1 : Math.floor(rand(1, 3)), colorIndex, color: palette[colorIndex], speed: rand(22 + difficulty * 6, 42 + difficulty * 10) });
      state.spawn = rand(0.48 - difficulty * 0.12, 0.88 - difficulty * 0.16);
    }
    if (pointer.clicked && state.fire <= 0) {
      const target = state.enemies
        .filter((e) => Math.abs(pointer.x - e.x) < 22 && Math.abs(pointer.y - e.y) < 22)
        .sort((a, b) => Math.hypot(a.x - pointer.x, a.y - pointer.y) - Math.hypot(b.x - pointer.x, b.y - pointer.y))[0];
      if (target) {
        const strong = !state.bubble || target.colorIndex === state.bubbleColor;
        target.hp -= strong ? 2 : 1;
        pop(target.x, target.y, strong ? colors.accent : colors.primary, 10);
        if (target.hp <= 0) {
          target.dead = true;
          state.score += strong ? 120 : 80;
          state.combo++;
          state.stopped++;
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
    if (state.stopped >= state.goal) end(true);
  }

  function drawDefense() {
    px(12, 42, 10, 142, state.bubble ? NES.cyan : NES.wood);
    bar(28, 31, 70, 5, state.wallHp, 8, colors.accent);
    if (state.bubble) dot(30, 180, 5, [colors.primary, colors.secondary, colors.accent][state.bubbleColor]);
    for (const e of state.enemies) {
      if (state.bubble) dot(e.x, e.y, 6, e.color);
      else sprite(sprites.enemy, e.x - 8, e.y - 6, 2, { 1: e.hp > 1 ? NES.red : colors.secondary });
    }
    drawStageLabel(progressText("STOP", state.stopped, state.goal));
  }

  function initSwarm() {
    resetBase(60);
    message = has("弹幕") ? "LEFT / RIGHT FIND THE GAP" : "MOVE TO DODGE";
    state.ring = has("弹幕");
    state.survive = 0;
    state.goal = state.ring ? 45 : 34;
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
    state.survive += dt;
    movePlayer(dt, 88);
    state.spawn -= dt;
    state.fire -= dt;
    if (state.spawn <= 0) {
      const difficulty = clamp(state.survive / state.goal, 0, 1);
      const edge = Math.floor(rand(0, 4));
      const e = edge === 0 ? { x: rand(0, VW), y: 26 } : edge === 1 ? { x: VW + 6, y: rand(35, VH) } : edge === 2 ? { x: rand(0, VW), y: VH + 6 } : { x: -6, y: rand(35, VH) };
      state.enemies.push({ ...e, w: 8, h: 8, hp: 1, speed: rand(26 + difficulty * 8, 48 + difficulty * 10) });
      state.spawn = rand(0.28 - difficulty * 0.08, 0.52 - difficulty * 0.1);
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
    if (state.survive >= state.goal) end(true);
  }

  function updateBulletRing(dt) {
    state.survive += dt;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) state.angle -= dt * 2.7;
    if (keys.has("ArrowRight") || keys.has("KeyD")) state.angle += dt * 2.7;
    state.player.x = 160 + Math.cos(state.angle) * state.ringR;
    state.player.y = 108 + Math.sin(state.angle) * state.ringR;
    state.spawn -= dt;
    if (state.spawn <= 0) {
      const difficulty = clamp(state.survive / state.goal, 0, 1);
      const gap = rand(0, Math.PI * 2);
      const count = 12 + Math.floor(difficulty * 4);
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2 + state.tick * 0.01;
        if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < 0.38 - difficulty * 0.06) continue;
        state.bullets.push({ x: 160, y: 108, vx: Math.cos(a) * rand(28 + difficulty * 6, 44 + difficulty * 8), vy: Math.sin(a) * rand(28 + difficulty * 6, 44 + difficulty * 8), w: 3, h: 3, hostile: true });
      }
      state.spawn = rand(1.15 - difficulty * 0.18, 1.75 - difficulty * 0.22);
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
    if (state.survive >= state.goal) end(true);
  }

  function drawSwarm() {
    if (state.ring) {
      stroke(160 - state.ringR, 108 - state.ringR, state.ringR * 2, state.ringR * 2, colors.secondary);
      dot(160, 108, 5, colors.accent);
      sprite(sprites.ship, state.player.x - 7, state.player.y - 5, 2, { 1: colors.primary });
      for (const b of state.bullets) px(b.x, b.y, b.w, b.h, colors.accent);
      drawStageLabel(progressText("SURVIVE", state.survive, state.goal));
      return;
    }
    sprite(sprites.ship, state.player.x - 7, state.player.y - 5, 2, { 1: colors.primary });
    for (const e of state.enemies) sprite(sprites.enemy, e.x - 8, e.y - 6, 2, { 1: colors.secondary });
    for (const b of state.bullets) px(b.x, b.y, 2, 2, colors.accent);
    drawStageLabel(progressText("SURVIVE", state.survive, state.goal));
  }

  function initTower() {
    resetBase(90);
    message = "TAP SLOTS TO BUILD";
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
    state.waveTotal = 5;
    state.cleared = 0;
  }

  function updateTower(dt) {
    if (state.wave > 7 && state.enemies.length === 0 && state.toSpawn <= 0) {
      end(true);
      return;
    }
    if (pointer.clicked) {
      const slot = state.slots.find((s) => !s.used && Math.hypot(pointer.x - s.x, pointer.y - s.y) < 17);
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
      state.waveTotal = state.toSpawn;
      state.cleared = 0;
      state.coins += 2;
      pop(160, 100, colors.primary, 18);
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
          state.cleared++;
          state.combo++;
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
    drawStageLabel(progressText("WAVE", state.cleared, state.waveTotal), 246, 29);
  }

  const beamLevels = [
    ["S./..", ".....", "../.C", "..#..", "....."],
    ["S/...", "...\\C", "..#..", ".\\.\\.", "....."],
    ["S.../", ".#...", ".....", "...#.", "....C"],
  ];

  function initBeam() {
    resetBase(180);
    message = "TAP MIRRORS TO AIM";
    state.time = undefined;
    state.level = 0;
    loadBeamLevel();
  }

  function loadBeamLevel() {
    state.grid = beamLevels[state.level].map((row) => row.split(""));
    state.beam = [];
    state.cool = 0;
    state.moves = 0;
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
      const gx = Math.round((pointer.x - 82) / 30);
      const gy = Math.round((pointer.y - 54) / 25);
      if (state.grid[gy] && ["/", "\\"].includes(state.grid[gy][gx])) {
        state.grid[gy][gx] = state.grid[gy][gx] === "/" ? "\\" : "/";
        state.cool = 0.12;
        state.moves++;
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
        if (Math.sin(state.tick * 0.08) > 0.65) stroke(ox + x * 30 + 2, oy + y * 25 + 2, s - 4, s - 4, colors.accent);
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
    text("ROOM " + (state.level + 1) + "/" + beamLevels.length + "  TURNS " + state.moves, 96, 174, colors.accent, 8);
  }

  function initSokoban() {
    resetBase(300);
    message = "PUSH BOXES TO MARKS";
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

  function undoSokoban() {
    if (!state.undo.length) return false;
      const prev = state.undo.pop();
      state.player = { ...prev.player };
      state.boxes = new Set(prev.boxes);
      state.moves = Math.max(0, state.moves - 1);
    return true;
  }

  function moveSokoban(dx, dy) {
    const nx = state.player.x + dx, ny = state.player.y + dy;
    const nk = nx + "," + ny;
    if (state.walls.has(nk)) return false;
    const nbx = nx + dx, nby = ny + dy, nbk = nbx + "," + nby;
    if (state.boxes.has(nk)) {
      if (state.walls.has(nbk) || state.boxes.has(nbk)) return false;
      state.undo.push({ player: { ...state.player }, boxes: [...state.boxes] });
      state.boxes.delete(nk);
      state.boxes.add(nbk);
      pop(54 + nbx * 22 + 11, 38 + nby * 22 + 11, colors.accent, 6);
    } else state.undo.push({ player: { ...state.player }, boxes: [...state.boxes] });
    state.player = { x: nx, y: ny };
    state.moves++;
    state.cool = 0.13;
    state.score = Math.max(0, 1200 - state.moves * 8);
    beep("tap");
    if ([...state.boxes].every((b) => state.targets.has(b))) end(true);
    return true;
  }

  function updateSokoban(dt) {
    state.cool -= dt;
    if (keyQueue.includes("KeyZ") && undoSokoban()) {
      keyQueue.length = 0;
      return;
    }
    if (state.cool > 0) return;
    const dirs = [["ArrowUp", 0, -1], ["KeyW", 0, -1], ["ArrowDown", 0, 1], ["KeyS", 0, 1], ["ArrowLeft", -1, 0], ["KeyA", -1, 0], ["ArrowRight", 1, 0], ["KeyD", 1, 0]];
    const dir = dirs.find(([code]) => keys.has(code));
    if (dir) moveSokoban(dir[1], dir[2]);
    else if (pointer.clicked) {
      const ox = 54, oy = 38, s = 22;
      const tx = Math.round((pointer.x - ox - s / 2) / s);
      const ty = Math.round((pointer.y - oy - s / 2) / s);
      const dx = clamp(tx - state.player.x, -1, 1);
      const dy = clamp(ty - state.player.y, -1, 1);
      if (Math.abs(dx) + Math.abs(dy) === 1) moveSokoban(dx, dy);
    }
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
    const placed = [...state.boxes].filter((b) => state.targets.has(b)).length;
    text("BOXES " + placed + "/" + state.targets.size + "  MOVES " + state.moves + "  Z UNDO", 58, 176, colors.accent, 7);
  }

  function initConnect() {
    resetBase(180);
    message = "DRAG MATCHING DOTS";
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
    const x = Math.round((pointer.x - ox - 11) / s);
    const y = Math.round((pointer.y - oy - 11) / s);
    if (x < 0 || y < 0 || x >= state.size || y >= state.size) return null;
    if (Math.hypot(pointer.x - (ox + x * s + 11), pointer.y - (oy + y * s + 11)) > 18) return null;
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
      state.combo++;
      pop(100 + cell.x * 24 + 11, 44 + cell.y * 24 + 11, state.nodes[endId][2], 12);
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
    beep("tap");
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
      if (state.selected === id) {
        stroke(ox + a.x * s + 3, oy + a.y * s + 3, 16, 16, NES.ink);
        stroke(ox + b.x * s + 3, oy + b.y * s + 3, 16, 16, NES.ink);
      }
    }
    const done = Object.keys(state.nodes).filter((id) => state.paths[id].length >= 2 && endpointId(state.paths[id][state.paths[id].length - 1].x, state.paths[id][state.paths[id].length - 1].y) === id).length;
    drawStageLabel(progressText("LINKS", done, Object.keys(state.nodes).length));
  }

  function initLock() {
    resetBase(120);
    message = "TAP NUMBERS THEN OPEN";
    state.time = undefined;
    state.code = [Math.floor(rand(1, 7)), Math.floor(rand(1, 7)), Math.floor(rand(1, 7))];
    state.guess = [1, 1, 1];
    state.history = [];
    state.attempts = 7;
    state.feedback = "TRY THE SAFE";
    state.hint = "";
  }

  function updateLock() {
    if (!pointer.clicked) return;
    for (let i = 0; i < 3; i++) {
      const x = 94 + i * 44;
      if (pointer.x > x - 6 && pointer.x < x + 40 && pointer.y > 68 && pointer.y < 116) {
        state.guess[i] = state.guess[i] % 6 + 1;
        beep("tap");
      }
    }
    if (pointer.x > 110 && pointer.x < 210 && pointer.y > 118 && pointer.y < 152) {
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
      state.hint = state.attempts <= 3 && exact < 3 ? "HINT D1=" + state.code[0] : "";
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
    if (state.hint) text(state.hint, 160, 178, colors.secondary, 7, "center");
    text("LEFT " + state.attempts, 222, 166, NES.dim, 7);
    for (let i = 0; i < Math.min(4, state.history.length); i++) {
      const h = state.history[i];
      text(h.guess.join("") + " " + h.exact + "/" + h.present, 14, 54 + i * 12, NES.dim, 7);
    }
  }

  function initMemory() {
    resetBase(120);
    message = "WATCH PATH THEN MOVE";
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
    state.grace = 1;
  }

  function stepMemory(dx, dy) {
    const nx = state.player.x + dx, ny = state.player.y + dy;
    const next = state.path[state.index + 1];
    if (next && nx === next[0] && ny === next[1]) {
      state.player = { x: nx, y: ny };
      state.index++;
      state.score += 80;
      state.combo++;
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
      state.combo = 0;
      if (state.grace > 0) {
        state.grace--;
        state.show = 1.1;
        beep("hit");
      } else {
        damage();
        loadMemoryRound();
      }
    }
    state.cool = 0.16;
  }

  function updateMemory(dt) {
    state.show = Math.max(0, state.show - dt);
    state.cool -= dt;
    if (state.show > 0 || state.cool > 0) return;
    const dirs = [["ArrowUp", 0, -1], ["KeyW", 0, -1], ["ArrowDown", 0, 1], ["KeyS", 0, 1], ["ArrowLeft", -1, 0], ["KeyA", -1, 0], ["ArrowRight", 1, 0], ["KeyD", 1, 0]];
    const dir = dirs.find(([code]) => keyQueue.includes(code));
    if (dir) stepMemory(dir[1], dir[2]);
    else if (pointer.clicked) {
      const ox = 104, oy = 48, s = 24;
      const tx = Math.round((pointer.x - ox - s / 2) / s);
      const ty = Math.round((pointer.y - oy - s / 2) / s);
      const dx = clamp(tx - state.player.x, -1, 1);
      const dy = clamp(ty - state.player.y, -1, 1);
      if (Math.abs(dx) + Math.abs(dy) === 1) stepMemory(dx, dy);
    }
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
      for (let i = 0; i <= state.index; i++) px(ox + state.path[i][0] * s + 8, oy + state.path[i][1] * s + 8, 6, 6, colors.secondary);
    }
    const exit = state.path[state.path.length - 1];
    stroke(ox + exit[0] * s + 4, oy + exit[1] * s + 4, 14, 14, colors.primary);
    sprite(sprites.runner, ox + state.player.x * s + 6, oy + state.player.y * s + 5, 2, { 1: colors.primary });
    drawStageLabel("ROUND " + (state.round + 1) + "/" + state.paths.length + "  STEP " + state.index + "/" + (state.path.length - 1), 160, 174);
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
