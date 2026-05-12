import { generateGameArtImage } from "@/lib/minimax";

type VisualTemplate = {
  id: string;
  name: string;
  summary: string;
  keywords: string[];
  palette: string;
  backgroundDirection: string;
  spriteDirection: string;
  gameplayDirection: string[];
};

type ArtAssetResult = {
  backgroundUrl: string | null;
  spritesheetUrl: string | null;
  backgroundPrompt: string;
  spritesheetPrompt: string;
};

const ART_ASSET_TIMEOUT_MS = 45_000;

export type ArtEnhancementResult = ArtAssetResult & {
  template: VisualTemplate;
  generationPrompt: string;
  coverPrompt: string;
  systemMessage: string;
};

const VISUAL_TEMPLATES: VisualTemplate[] = [
  {
    id: "neon-arcade",
    name: "Neon Arcade",
    summary: "deep arcade contrast, glowing silhouettes, particles, energetic HUD",
    keywords: ["太空", "飞船", "射击", "躲避", "霓虹", "赛博", "弹幕", "反应", "陨石", "space", "shooter", "arcade"],
    palette: "midnight black, electric cyan, magenta, amber, clean white",
    backgroundDirection: "cinematic neon arcade background with depth, glow, particles, and generous playable negative space",
    spriteDirection: "glowing arcade objects with sharp silhouettes, rim lighting, small VFX bursts, and readable icon-like shapes",
    gameplayDirection: [
      "Use glow, trails, hit flashes, particles, and subtle screen shake for feedback.",
      "Style the start screen, score, lives, and game-over panel as a cohesive arcade HUD.",
    ],
  },
  {
    id: "pixel-quest",
    name: "Pixel Quest",
    summary: "modern pixel-art adventure, tile texture, retro readable characters",
    keywords: ["像素", "平台", "跳跃", "冒险", "地牢", "收集", "金币", "迷宫", "platform", "pixel", "dungeon", "quest"],
    palette: "indigo shadow, moss green, warm gold, coral, parchment highlight",
    backgroundDirection: "modern pixel-art inspired scene with tile rhythm, layered scenery, and readable play space",
    spriteDirection: "small pixel-art inspired heroes, enemies, collectibles, obstacles, and puffs with chunky silhouettes",
    gameplayDirection: [
      "Use crisp edges, tile-like panels, bouncy pickups, and retro score/life UI.",
      "Keep every moving object visually distinct from the background.",
    ],
  },
  {
    id: "cozy-handdrawn",
    name: "Cozy Handdrawn",
    summary: "warm hand-drawn casual style, soft shapes, friendly UI",
    keywords: ["厨房", "经营", "休闲", "可爱", "手绘", "农场", "养成", "整理", "烹饪", "cozy", "cute", "kitchen", "puzzle"],
    palette: "warm cream, tomato red, leaf green, sky blue, honey yellow",
    backgroundDirection: "cozy hand-drawn game scene with soft texture, rounded props, and calm readable play space",
    spriteDirection: "friendly rounded hand-drawn characters, items, obstacles, rewards, and small feedback effects",
    gameplayDirection: [
      "Use soft shadows, rounded panels, cheerful pickup feedback, and warm UI buttons.",
      "Avoid harsh empty screens; make the playfield feel inhabited and approachable.",
    ],
  },
  {
    id: "toy-boardgame",
    name: "Toy Boardgame",
    summary: "tactile tabletop game, clear grid, toy pieces, readable strategy state",
    keywords: ["棋", "棋盘", "桌游", "策略", "塔防", "卡牌", "格子", "防守", "路径", "board", "tower", "card", "strategy"],
    palette: "paper white, walnut brown, teal, ruby red, brass yellow",
    backgroundDirection: "polished tabletop boardgame scene with a clear board surface, paths or grid hints, and tactile material",
    spriteDirection: "toy-like pawns, towers, tokens, enemies, pickups, and action markers with clear silhouettes",
    gameplayDirection: [
      "Use readable grid/path cues, token-like pieces, and compact status panels.",
      "Make strategy state visible through position, color, icons, and small motion feedback.",
    ],
  },
];

function normalized(value: string) {
  return value.toLowerCase();
}

export function selectVisualTemplate(brief: string) {
  const text = normalized(brief);
  let best = VISUAL_TEMPLATES[0];
  let bestScore = -1;

  for (const template of VISUAL_TEMPLATES) {
    const score = template.keywords.reduce((total, keyword) => total + (text.includes(normalized(keyword)) ? 1 : 0), 0);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }

  return best;
}

function baseImagePrompt({
  brief,
  template,
  assetType,
  direction,
}: {
  brief: string;
  template: VisualTemplate;
  assetType: string;
  direction: string;
}) {
  return [
    `Use case: stylized-concept`,
    `Asset type: ${assetType} for an AI-generated HTML5 game`,
    `Game brief: ${brief}`,
    `Visual template: ${template.name} - ${template.summary}`,
    `Palette: ${template.palette}`,
    `Primary request: ${direction}`,
    "Style: polished 2D game art, crisp, readable at small sizes, cohesive with a lightweight browser game.",
    "Avoid: text, labels, watermark, logos, photorealism, muddy low-contrast details, UI buttons baked into game art.",
  ].join("\n");
}

export function buildBackgroundPrompt(brief: string, template: VisualTemplate) {
  return baseImagePrompt({
    brief,
    template,
    assetType: "16:9 in-game background",
    direction: [
      template.backgroundDirection,
      "Create a 16:9 background with no text and no HUD.",
      "Leave the central play area readable for moving characters, obstacles, projectiles, and score overlays.",
      "The image should improve the game screen immediately even if all gameplay objects are simple.",
    ].join(" "),
  });
}

export function buildSpritesheetPrompt(brief: string, template: VisualTemplate) {
  return baseImagePrompt({
    brief,
    template,
    assetType: "1:1 core sprite sheet",
    direction: [
      template.spriteDirection,
      "Create a clean 2 rows by 4 columns sprite sheet with exactly eight isolated game assets.",
      "Include a player character or vehicle, two enemies or obstacles, one collectible, one goal or base, one projectile or tool, one impact effect, and one bonus or shield item.",
      "Use equal cell spacing, generous padding, consistent scale, and no labels.",
      "Use a plain neutral background so the sheet can be cropped or used as a visual source by code.",
    ].join(" "),
  });
}

export function enhanceCoverPrompt(originalCoverPrompt: string, template: VisualTemplate) {
  return [
    originalCoverPrompt || "A polished bright arcade game cover with clear gameplay subject, no text overlay.",
    `Match the in-game art direction: ${template.name}; ${template.summary}; palette: ${template.palette}.`,
    "No text, no watermark, no fake logo.",
  ]
    .join(" ")
    .slice(0, 900);
}

function buildAssetLines(assets: Pick<ArtAssetResult, "backgroundUrl" | "spritesheetUrl">) {
  const lines = [];
  if (assets.backgroundUrl) lines.push(`- Background image URL: ${assets.backgroundUrl}`);
  if (assets.spritesheetUrl) lines.push(`- Core sprite sheet URL: ${assets.spritesheetUrl}`);
  if (!lines.length) lines.push("- No generated image assets are available; use the visual template to create programmatic Canvas/CSS art.");
  return lines;
}

export function buildArtEnhancedGamePrompt({
  brief,
  template,
  assets,
}: {
  brief: string;
  template: VisualTemplate;
  assets: Pick<ArtAssetResult, "backgroundUrl" | "spritesheetUrl">;
}) {
  return [
    brief,
    "",
    "AI Art Enhancement: enabled.",
    `Visual template: ${template.name}. ${template.summary}.`,
    `Palette: ${template.palette}.`,
    "",
    "Generated assets:",
    ...buildAssetLines(assets),
    "",
    "Art direction requirements:",
    `- ${template.backgroundDirection}.`,
    `- ${template.spriteDirection}.`,
    ...template.gameplayDirection.map((item) => `- ${item}`),
    "- Use the background image as the actual in-game background when the URL is available. It may be referenced directly as an HTTPS asset.",
    "- Use the sprite sheet as the visual source for the player, enemies, obstacles, collectibles, projectiles, goals, or effects when the URL is available. Crop cells if practical; otherwise use it as a strict style reference and draw matching Canvas/CSS shapes.",
    "- If loading a remote image in canvas, set image.crossOrigin = 'anonymous' before assigning src, and do not call getImageData.",
    "- Add a designed start screen, game HUD, score/lives/progress feedback, and game-over/restart state that match the same art direction.",
    "- Avoid plain rectangles, empty flat backgrounds, default browser buttons, placeholder circles, and collisions with no visible feedback.",
    "- If any asset fails to load at runtime, fall back to programmatic Canvas/CSS art in the same visual style instead of showing a broken image.",
  ].join("\n");
}

function assetStatusLabel(url: string | null) {
  return url ? "已生成" : "未生成，已降级为程序化美术要求";
}

export function buildArtEnhancementSystemMessage(result: ArtEnhancementResult) {
  return [
    "AI 美术增强: 已开启",
    `视觉模板: ${result.template.name}`,
    `背景图: ${assetStatusLabel(result.backgroundUrl)}`,
    `核心图集: ${assetStatusLabel(result.spritesheetUrl)}`,
  ].join("\n");
}

async function createAsset<T extends "background" | "spritesheet">({
  gameId,
  name,
  prompt,
  aspectRatio,
}: {
  gameId: string;
  name: T;
  prompt: string;
  aspectRatio: "1:1" | "16:9";
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    generateGameArtImage({ gameId, name, prompt, aspectRatio }).catch(() => null),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), ART_ASSET_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function createArtEnhancement({
  gameId,
  brief,
  coverPrompt,
}: {
  gameId: string;
  brief: string;
  coverPrompt: string;
}): Promise<ArtEnhancementResult> {
  const template = selectVisualTemplate(brief);
  const backgroundPrompt = buildBackgroundPrompt(brief, template);
  const spritesheetPrompt = buildSpritesheetPrompt(brief, template);
  const [backgroundUrl, spritesheetUrl] = await Promise.all([
    createAsset({ gameId, name: "background", prompt: backgroundPrompt, aspectRatio: "16:9" }),
    createAsset({ gameId, name: "spritesheet", prompt: spritesheetPrompt, aspectRatio: "1:1" }),
  ]);
  const generationPrompt = buildArtEnhancedGamePrompt({
    brief,
    template,
    assets: { backgroundUrl, spritesheetUrl },
  });
  const result: ArtEnhancementResult = {
    template,
    backgroundUrl,
    spritesheetUrl,
    backgroundPrompt,
    spritesheetPrompt,
    generationPrompt,
    coverPrompt: enhanceCoverPrompt(coverPrompt, template),
    systemMessage: "",
  };

  return {
    ...result,
    systemMessage: buildArtEnhancementSystemMessage(result),
  };
}
