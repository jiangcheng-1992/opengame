export type BuiltinGame = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  genre: string;
  tags: string[];
  controls: string[];
  playCount: number;
  likeCount: number;
  coverPrompt: string;
  brief: string;
  gameType:
    | "dodge"
    | "breakout"
    | "goalie"
    | "platform"
    | "shooter"
    | "beam"
    | "sokoban"
    | "connect"
    | "lock"
    | "memory"
    | "runner"
    | "lane"
    | "turret"
    | "defense"
    | "swarm"
    | "tower"
    | "routing"
    | "recipe"
    | "loading"
    | "rhythm"
    | "pong"
    | "timing";
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
};

const CREATED_AT = new Date("2026-05-10T08:00:00.000Z");

export const BUILTIN_GAMES: BuiltinGame[] = [
  {
    id: "builtin-starport-dash",
    slug: "starport-dash",
    title: "星港空战",
    summary: "驾驶穿梭战机守住星港航线，击落巡逻无人机，收集能量升级火力，释放星港脉冲并击败指挥舰。",
    genre: "空战射击",
    tags: ["空战", "升级", "Boss"],
    controls: ["键盘", "鼠标"],
    playCount: 1840,
    likeCount: 216,
    gameType: "dodge",
    theme: { primary: "#65e4ff", secondary: "#8a7dff", accent: "#ffd166", background: "#08111f" },
    coverPrompt: "a sleek tiny shuttle weaving through a busy neon spaceport debris field, glowing energy chips, cinematic arcade game cover art, rich color, no text, no watermark",
    brief: "Top-down space combat game. The player pilots a shuttle fighter, shoots patrol drones, collects energy to upgrade weapons, releases an ultimate pulse at full energy, and defeats the command ship boss.",
  },
  {
    id: "builtin-neon-bricks",
    slug: "neon-bricks",
    title: "霓虹砖块",
    summary: "用光能挡板反弹电球，击碎会连锁爆亮的霓虹砖阵。",
    genre: "街机动作",
    tags: ["反弹", "连击", "霓虹"],
    controls: ["键盘", "鼠标"],
    playCount: 2210,
    likeCount: 278,
    gameType: "breakout",
    theme: { primary: "#ff4fd8", secondary: "#4fffe8", accent: "#ffe45e", background: "#11071c" },
    coverPrompt: "neon cyber arcade brick breaker scene with glowing paddle and electric ball shattering colorful blocks, high polish game cover, no text, no watermark",
    brief: "Brick breaker game. Move a glowing paddle, bounce the ball, break all neon bricks, and keep the ball from falling.",
  },
  {
    id: "builtin-pixel-keeper",
    slug: "pixel-keeper",
    title: "像素守门员",
    summary: "守住复古球门，判断来球角度，把连续射门挡出去。",
    genre: "体育反应",
    tags: ["守门", "反应", "复古"],
    controls: ["键盘"],
    playCount: 1396,
    likeCount: 144,
    gameType: "goalie",
    theme: { primary: "#7bf07b", secondary: "#4aa3ff", accent: "#fff275", background: "#092013" },
    coverPrompt: "retro pixel soccer goalkeeper diving under stadium lights, bright ball trail, charming modern pixel-art inspired cover, no text, no watermark",
    brief: "Goalkeeper reaction game. Move along the goal line to block incoming shots before they cross the net.",
  },
  {
    id: "builtin-lava-hop",
    slug: "lava-hop",
    title: "熔岩跳台",
    summary: "在不断下沉的火山平台间跳跃，抢到冷却晶石延长生存。",
    genre: "平台跳跃",
    tags: ["跳跃", "生存", "火山"],
    controls: ["键盘"],
    playCount: 1768,
    likeCount: 198,
    gameType: "platform",
    theme: { primary: "#ff7043", secondary: "#ffc857", accent: "#3ddc97", background: "#1d0b08" },
    coverPrompt: "small brave explorer leaping across crumbling lava platforms inside a glowing volcano cavern, dynamic arcade cover art, no text, no watermark",
    brief: "Side-view platform survival game. Jump between lava platforms, collect cooling crystals, and avoid falling into lava.",
  },
  {
    id: "builtin-deep-space-sweeper",
    slug: "deep-space-sweeper",
    title: "深空清道夫",
    summary: "清理轨道垃圾，边躲流星边把废件拖进回收区。",
    genre: "街机动作",
    tags: ["清理", "拖拽", "太空"],
    controls: ["鼠标", "键盘"],
    playCount: 1642,
    likeCount: 173,
    gameType: "dodge",
    theme: { primary: "#9bf6ff", secondary: "#bdb2ff", accent: "#fdffb6", background: "#06101a" },
    coverPrompt: "space salvage pilot cleaning orbital junk near a blue planet, meteors streaking past, elegant colorful game cover illustration, no text, no watermark",
    brief: "Top-down cleanup game. Collect drifting space junk and deliver it to a recycler zone while dodging meteors.",
  },
  {
    id: "builtin-mirror-beam",
    slug: "mirror-beam",
    title: "镜面光束",
    summary: "旋转镜面，把激光导向能量核心，避开会吸收光线的暗格。",
    genre: "解谜",
    tags: ["光线", "镜面", "逻辑"],
    controls: ["鼠标"],
    playCount: 1190,
    likeCount: 132,
    gameType: "beam",
    theme: { primary: "#80ffdb", secondary: "#64dfdf", accent: "#ffd166", background: "#071b1d" },
    coverPrompt: "glowing laser beam reflecting through crystal mirrors in a dark puzzle chamber, luminous elegant game cover, no text, no watermark",
    brief: "Laser reflection puzzle. Rotate mirrors to guide a beam into the energy core without hitting blockers.",
  },
  {
    id: "builtin-warehouse-push",
    slug: "warehouse-push",
    title: "仓库推箱",
    summary: "在紧凑仓库里推箱入库，少走弯路才能拿到三星。",
    genre: "解谜",
    tags: ["推箱", "规划", "经典"],
    controls: ["键盘"],
    playCount: 1314,
    likeCount: 118,
    gameType: "sokoban",
    theme: { primary: "#f9c74f", secondary: "#90be6d", accent: "#f9844a", background: "#1a1710" },
    coverPrompt: "cozy top-down warehouse puzzle with wooden crates, painted floor targets, warm lights, polished casual game cover, no text, no watermark",
    brief: "Sokoban-style puzzle. Push crates onto marked targets in as few moves as possible.",
  },
  {
    id: "builtin-color-links",
    slug: "color-links",
    title: "颜色连线",
    summary: "把同色能量节点连起来，线路不能交叉，填满整块电路板。",
    genre: "解谜",
    tags: ["连线", "颜色", "空间"],
    controls: ["鼠标"],
    playCount: 1522,
    likeCount: 165,
    gameType: "connect",
    theme: { primary: "#ff6b6b", secondary: "#4ecdc4", accent: "#ffe66d", background: "#101820" },
    coverPrompt: "colorful glowing nodes connected by clean light paths on a futuristic circuit board, premium puzzle game cover, no text, no watermark",
    brief: "Color connection puzzle. Connect matching color nodes without crossing lines and cover the board.",
  },
  {
    id: "builtin-number-lock",
    slug: "number-lock",
    title: "数字开锁",
    summary: "根据反馈调整密码盘，越少尝试破解越高分。",
    genre: "解谜",
    tags: ["数字", "推理", "密码"],
    controls: ["鼠标"],
    playCount: 1118,
    likeCount: 109,
    gameType: "lock",
    theme: { primary: "#ffd166", secondary: "#06d6a0", accent: "#ef476f", background: "#10131f" },
    coverPrompt: "sleek digital vault lock with glowing number wheels and subtle logic symbols, sophisticated puzzle game cover, no text, no watermark",
    brief: "Deduction puzzle. Guess the three-digit lock code using higher/lower and exact-match feedback.",
  },
  {
    id: "builtin-maze-memory",
    slug: "maze-memory",
    title: "迷宫记忆",
    summary: "先记住迷宫亮起的路径，灯灭后凭记忆走到出口。",
    genre: "记忆解谜",
    tags: ["记忆", "迷宫", "路径"],
    controls: ["键盘"],
    playCount: 1276,
    likeCount: 141,
    gameType: "memory",
    theme: { primary: "#c77dff", secondary: "#80ffdb", accent: "#ffea00", background: "#12091e" },
    coverPrompt: "mysterious maze corridor with briefly glowing path tiles fading into darkness, atmospheric puzzle game cover art, no text, no watermark",
    brief: "Memory maze game. Study the highlighted safe path, then navigate after the guide disappears.",
  },
  {
    id: "builtin-moon-runner",
    slug: "moon-runner",
    title: "月面跑者",
    summary: "低重力冲刺，跨过陨坑和通讯塔，保持氧气节奏。",
    genre: "跑酷",
    tags: ["跑酷", "低重力", "月面"],
    controls: ["键盘"],
    playCount: 2440,
    likeCount: 302,
    gameType: "runner",
    theme: { primary: "#d7e3fc", secondary: "#abc4ff", accent: "#ffca3a", background: "#0b1020" },
    coverPrompt: "astronaut sprinting across the moon with low gravity jumps over craters, Earth glowing in the sky, dynamic runner game cover, no text, no watermark",
    brief: "Endless runner. Jump over craters and antennas on the moon while collecting oxygen cells.",
  },
  {
    id: "builtin-storm-skate",
    slug: "storm-skate",
    title: "风暴滑板",
    summary: "在暴雨天台间滑行，换道躲避广告牌和闪电水坑。",
    genre: "跑酷",
    tags: ["换道", "滑板", "赛博"],
    controls: ["键盘"],
    playCount: 1984,
    likeCount: 231,
    gameType: "lane",
    theme: { primary: "#00f5d4", secondary: "#f15bb5", accent: "#fee440", background: "#070b18" },
    coverPrompt: "cyberpunk skateboarder racing across rain-slick rooftops, lightning puddles and neon billboards, stylish arcade cover, no text, no watermark",
    brief: "Three-lane runner. Switch lanes to avoid rooftop hazards and collect boost sparks.",
  },
  {
    id: "builtin-subway-hop",
    slug: "subway-hop",
    title: "地铁跳跃",
    summary: "在地铁维修区跳过护栏，低头滑过信号门，连击不断加速。",
    genre: "跑酷",
    tags: ["跳跃", "滑行", "城市"],
    controls: ["键盘"],
    playCount: 2136,
    likeCount: 247,
    gameType: "runner",
    theme: { primary: "#f72585", secondary: "#4cc9f0", accent: "#ffd166", background: "#120f17" },
    coverPrompt: "stylized subway tunnel runner leaping over barriers under colorful station lights, energetic mobile game cover, no text, no watermark",
    brief: "Runner game. Jump over barriers, duck under signal gates, and keep the combo alive.",
  },
  {
    id: "builtin-cloud-relay",
    slug: "cloud-relay",
    title: "云端接力",
    summary: "踩着漂浮云朵向前接力，抓住风环才能延长跳跃距离。",
    genre: "跑酷",
    tags: ["跳跃", "云朵", "接力"],
    controls: ["键盘"],
    playCount: 1458,
    likeCount: 154,
    gameType: "platform",
    theme: { primary: "#bde0fe", secondary: "#ffc8dd", accent: "#caffbf", background: "#0d1826" },
    coverPrompt: "hero hopping across floating clouds with glowing wind rings in a bright fantasy sky, polished platformer game cover, no text, no watermark",
    brief: "Cloud platformer. Jump across moving clouds and catch wind rings to extend airtime.",
  },
  {
    id: "builtin-gear-sprint",
    slug: "gear-sprint",
    title: "齿轮冲刺",
    summary: "穿过巨型机械钟楼，按时跳过齿轮、躲开蒸汽喷口。",
    genre: "跑酷",
    tags: ["机械", "节奏", "跳跃"],
    controls: ["键盘"],
    playCount: 1692,
    likeCount: 182,
    gameType: "runner",
    theme: { primary: "#f4a261", secondary: "#2a9d8f", accent: "#e9c46a", background: "#17120c" },
    coverPrompt: "runner sprinting through a giant clockwork tower with brass gears and steam vents, adventurous arcade cover, no text, no watermark",
    brief: "Clockwork runner. Time jumps over gears and steam vents as the level speeds up.",
  },
  {
    id: "builtin-asteroid-turret",
    slug: "asteroid-turret",
    title: "小行星炮塔",
    summary: "旋转轨道炮塔击碎来袭小行星，保护中央能源站。",
    genre: "射击防守",
    tags: ["炮塔", "瞄准", "太空"],
    controls: ["鼠标"],
    playCount: 2056,
    likeCount: 236,
    gameType: "turret",
    theme: { primary: "#90e0ef", secondary: "#48cae4", accent: "#ffb703", background: "#050f1d" },
    coverPrompt: "orbital defense turret firing at incoming asteroids around a glowing space station, cinematic arcade shooter cover, no text, no watermark",
    brief: "Turret defense game. Aim with the mouse, shoot asteroids before they hit the central station.",
  },
  {
    id: "builtin-bubble-line",
    slug: "bubble-line",
    title: "泡泡防线",
    summary: "发射彩色泡泡堵住海底裂缝，三连同色会爆开清场。",
    genre: "射击防守",
    tags: ["泡泡", "匹配", "海底"],
    controls: ["鼠标"],
    playCount: 1888,
    likeCount: 219,
    gameType: "defense",
    theme: { primary: "#48cae4", secondary: "#80ed99", accent: "#ffafcc", background: "#041a24" },
    coverPrompt: "underwater bubble cannon defending a coral reef with colorful bubbles and soft caustic light, charming game cover, no text, no watermark",
    brief: "Bubble defense game. Shoot colored bubbles at advancing bubbles; matching colors clear clusters.",
  },
  {
    id: "builtin-swarm-breakout",
    slug: "swarm-breakout",
    title: "蜂群突围",
    summary: "小飞船被蜂群围困，穿梭弹幕缝隙并反击母巢节点。",
    genre: "射击防守",
    tags: ["弹幕", "突围", "蜂群"],
    controls: ["键盘", "鼠标"],
    playCount: 1972,
    likeCount: 225,
    gameType: "swarm",
    theme: { primary: "#f9c74f", secondary: "#f94144", accent: "#43aa8b", background: "#160d09" },
    coverPrompt: "tiny starfighter breaking through a glowing alien swarm, intense bullet patterns and hive nodes, arcade shooter cover, no text, no watermark",
    brief: "Arena shooter. Move through enemy swarms, auto-fire at hive nodes, and survive the bullet patterns.",
  },
  {
    id: "builtin-wall-guard",
    slug: "wall-guard",
    title: "城墙守卫",
    summary: "在城墙上布置弩箭和油锅，挡住一波波小怪冲锋。",
    genre: "防守策略",
    tags: ["防守", "中世纪", "波次"],
    controls: ["鼠标"],
    playCount: 1734,
    likeCount: 188,
    gameType: "defense",
    theme: { primary: "#dda15e", secondary: "#606c38", accent: "#fefae0", background: "#16160f" },
    coverPrompt: "fantasy castle wall defense with ballista bolts, glowing torches, waves of small monsters approaching, polished strategy game cover, no text, no watermark",
    brief: "Wall defense game. Place shots along the wall, stop waves of enemies, and protect the gate.",
  },
  {
    id: "builtin-bullet-ring",
    slug: "bullet-ring",
    title: "弹幕圆环",
    summary: "绕着圆形竞技场移动，在旋转弹幕中寻找安全缺口。",
    genre: "射击防守",
    tags: ["弹幕", "圆环", "反应"],
    controls: ["键盘"],
    playCount: 1598,
    likeCount: 177,
    gameType: "swarm",
    theme: { primary: "#ff006e", secondary: "#8338ec", accent: "#3a86ff", background: "#0f0718" },
    coverPrompt: "abstract circular bullet-hell arena with a tiny hero orbiting through radiant projectile rings, vivid arcade cover, no text, no watermark",
    brief: "Circular bullet-hell survival. Orbit the arena, dodge rotating projectile rings, and collect shield shards.",
  },
  {
    id: "builtin-mini-tower",
    slug: "mini-tower",
    title: "迷你塔防",
    summary: "在短小路径旁放置三种塔，用有限金币挡住十波敌人。",
    genre: "轻策略",
    tags: ["塔防", "布置", "波次"],
    controls: ["鼠标"],
    playCount: 2324,
    likeCount: 286,
    gameType: "tower",
    theme: { primary: "#52b788", secondary: "#40916c", accent: "#ffba08", background: "#081c15" },
    coverPrompt: "cute miniature tower defense map with tiny turrets beside a winding path, colorful enemies, polished cozy strategy cover, no text, no watermark",
    brief: "Mini tower defense. Place towers beside a path, spend limited coins, and stop enemies from reaching the base.",
  },
];

export type BuiltinClientGame = ReturnType<typeof toBuiltinClientGame>;
const BUILTIN_COPY_PLAY_URL_PREFIX = "builtin://";

export function isBuiltinGameId(id: string) {
  return id.startsWith("builtin-");
}

export function toBuiltinCopyPlayUrl(slug: string) {
  return `${BUILTIN_COPY_PLAY_URL_PREFIX}${slug}`;
}

export function parseBuiltinCopyPlayUrl(playUrl?: string | null) {
  if (!playUrl?.startsWith(BUILTIN_COPY_PLAY_URL_PREFIX)) return null;
  const slug = playUrl.slice(BUILTIN_COPY_PLAY_URL_PREFIX.length).trim();
  return slug || null;
}

export function builtinPublicFilePath(slug: string, filePath = "index.html") {
  return `/builtin-games/${slug}/${filePath.replace(/^\/+/, "")}`;
}

export function getBuiltinGame(id: string) {
  const game = BUILTIN_GAMES.find((item) => item.id === id || item.slug === id);
  return game ? toBuiltinClientGame(game) : null;
}

export function listBuiltinGames() {
  return BUILTIN_GAMES.map((game) => toBuiltinClientGame(game));
}

export function toBuiltinClientGame(game: BuiltinGame) {
  const basePath = `/builtin-games/${game.slug}`;

  return {
    id: game.id,
    ownerId: "builtin",
    title: game.title,
    summary: game.summary,
    genre: game.genre,
    tags: game.tags,
    controls: game.controls,
    coverPrompt: game.coverPrompt,
    coverUrl: `${basePath}/cover.png`,
    status: "ready",
    visibility: "public",
    playUrl: `${basePath}/index.html`,
    blobPlayUrl: null,
    sourceUrl: null,
    version: 1,
    playCount: game.playCount,
    likeCount: game.likeCount,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ownedByMe: false,
    likedByMe: false,
    latestJob: null,
    isBuiltin: true,
    messages: [
      {
        id: `${game.id}-brief`,
        gameId: game.id,
        role: "system",
        content: game.brief,
        jobId: null,
        createdAt: CREATED_AT,
      },
    ],
  };
}
