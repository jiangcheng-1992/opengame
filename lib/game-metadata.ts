import { getMiniMaxTextModel } from "@/lib/minimax-config";

export type GameMetadata = {
  title: string;
  summary: string;
  genre: string;
  tags: string[];
  controls: string[];
  coverPrompt: string;
};

type MetadataOptions = {
  sourceTitle?: string | null;
  allowAI?: boolean;
};

type PartialMetadata = Partial<Record<keyof GameMetadata, unknown>>;

const FALLBACK_GENRE = "街机";
const MAX_TITLE = 26;
const MAX_SUMMARY = 96;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const cleaned = compact(value);
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => compact(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function inferControls(prompt: string) {
  const lower = prompt.toLowerCase();
  const controls: string[] = [];
  if (/(wasd|键盘|keyboard|方向键|arrow)/i.test(prompt)) controls.push("键盘");
  if (/(mouse|鼠标|射击|瞄准|click|点击)/i.test(prompt)) controls.push("点击");
  if (/(drag|拖|拖拽|拖放)/i.test(prompt)) controls.push("拖拽");
  if (/(tap|触屏|手机|竖屏)/i.test(prompt)) controls.push("触屏");
  if (/(space|空格)/i.test(prompt)) controls.push("空格");
  if (/(gamepad|手柄)/i.test(lower)) controls.push("手柄");
  return unique(controls).slice(0, 3);
}

function inferGenre(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/(tower|塔防|炮塔)/i.test(prompt)) return "塔防";
  if (/(rhythm|节奏|beat)/i.test(prompt)) return "节奏";
  if (/(puzzle|解谜|合成|merge|2048)/i.test(prompt)) return "解谜";
  if (/(boss|首领|弹幕|shoot|射击|bullet)/i.test(prompt)) return "动作";
  if (/(runner|跑酷|躲避|survive|生存)/i.test(prompt)) return "跑酷";
  if (/(pong|brick|打砖块|球)/i.test(lower)) return "经典";
  return FALLBACK_GENRE;
}

function inferTags(prompt: string, genre: string, controls: string[]) {
  const tags = [genre];
  if (/单屏|one-screen|one screen/i.test(prompt)) tags.push("单屏");
  if (/像素|pixel/i.test(prompt)) tags.push("像素");
  if (/竖屏|vertical|portrait/i.test(prompt)) tags.push("竖屏");
  if (/boss|首领/i.test(prompt)) tags.push("首领战");
  if (/60 秒|60s|90 秒|90s|限时/i.test(prompt)) tags.push("限时");
  return unique([...tags, ...controls]).slice(0, 5);
}

function stripPromptPreamble(prompt: string) {
  return compact(prompt)
    .replace(/^你是一名[^。.!！？]*[。.!！？]\s*/, "")
    .replace(/^You are an? [^。.!！？]*[。.!！？]\s*/i, "")
    .replace(/^请帮我|^帮我|^please\s+/i, "");
}

function titleFromPrompt(prompt: string) {
  const cleaned = stripPromptPreamble(prompt);
  const namedTitle = cleaned.match(/(?:项目名叫|游戏名叫|名字叫|名为|called)\s*[《「“"]?([^》」”".。.!！？\n]{2,32})/i);
  if (namedTitle?.[1]) return truncate(namedTitle[1], MAX_TITLE);

  const firstClause = cleaned.split(/[。.!！？?,，；;：:\n]/)[0] ?? cleaned;

  const withoutLeadingVerb = firstClause
    .replace(/^(请|帮我|做一个|做一款|制作一个|制作一款|生成一个|生成一款|build a|make a)\s*/i, "")
    .replace(/^一个|^一款/, "");
  return truncate(withoutLeadingVerb || cleaned || "未命名游戏", MAX_TITLE);
}

function summaryFromPrompt(prompt: string) {
  const cleaned = stripPromptPreamble(prompt);
  const firstPart = cleaned.split(/(?:\s一、|\s二、|\s三、|核心要求|技术要求|玩法要求|要求[:：]|\n)/)[0] ?? cleaned;
  return truncate(firstPart || cleaned || "一个可试玩的 HTML5 小游戏。", MAX_SUMMARY);
}

export function fallbackGameMetadata(prompt: string): GameMetadata {
  const cleaned = stripPromptPreamble(prompt);
  const genre = inferGenre(cleaned);
  const controls = inferControls(cleaned);
  const tags = inferTags(cleaned, genre, controls);
  const title = titleFromPrompt(cleaned);
  const summary = summaryFromPrompt(cleaned);

  return {
    title,
    summary,
    genre,
    tags,
    controls,
    coverPrompt: [
      "Bright playful arcade game cover, clear gameplay subject, readable composition, no text overlay.",
      `Game title: ${title}.`,
      `Gameplay: ${summary}.`,
      `Genre: ${genre}.`,
    ].join(" "),
  };
}

function endpoints() {
  const baseUrl = (process.env.MINIMAX_TEXT_BASE_URL ?? process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
  return unique([`${baseUrl}/text/chatcompletion_v2`, `${baseUrl}/chat/completions`]);
}

function parseJsonBlock(value: string): PartialMetadata | null {
  const cleaned = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as PartialMetadata;
  } catch {
    return null;
  }
}

function extractContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as {
    reply?: unknown;
    output_text?: unknown;
    choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }>;
  };
  const first = data.choices?.[0];
  const content = first?.message?.content ?? first?.delta?.content ?? first?.text ?? data.reply ?? data.output_text;
  return typeof content === "string" ? content : "";
}

function normalizeList(value: unknown, fallback: string[], max: number) {
  if (!Array.isArray(value)) return fallback;
  const normalized = unique(value.filter((item): item is string => typeof item === "string").map(localizeMetadataLabel));
  return normalized.length ? normalized.slice(0, max) : fallback;
}

function localizeMetadataLabel(value: string) {
  const normalized = compact(value);
  const key = normalized.toLowerCase();
  const labelMap: Record<string, string> = {
    arcade: "街机",
    action: "动作",
    classic: "经典",
    puzzle: "解谜",
    rhythm: "节奏",
    runner: "跑酷",
    "tower defense": "塔防",
    boss: "首领战",
  };
  return labelMap[key] ?? normalized;
}

function normalizeMetadata(raw: PartialMetadata | null, fallback: GameMetadata): GameMetadata {
  if (!raw) return fallback;
  const title = typeof raw.title === "string" ? truncate(raw.title, MAX_TITLE) : fallback.title;
  const summary = typeof raw.summary === "string" ? truncate(raw.summary, MAX_SUMMARY) : fallback.summary;
  const genre = typeof raw.genre === "string" ? truncate(localizeMetadataLabel(raw.genre), 24) : fallback.genre;
  const controls = normalizeList(raw.controls, fallback.controls, 4);
  const tags = normalizeList(raw.tags, fallback.tags, 5);
  const coverPrompt =
    typeof raw.coverPrompt === "string" && raw.coverPrompt.trim().length > 12
      ? truncate(raw.coverPrompt, 420)
      : fallback.coverPrompt;

  return {
    title: title || fallback.title,
    summary: summary || fallback.summary,
    genre: genre || fallback.genre,
    tags: tags.length ? tags : fallback.tags,
    controls,
    coverPrompt,
  };
}

async function requestMiniMaxMetadata(prompt: string, fallback: GameMetadata, options: MetadataOptions) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || options.allowAI === false) return null;

  const userPrompt = [
    "为一个 AI 生成的 HTML5 小游戏生成产品展示元数据。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段：title, summary, genre, tags, controls, coverPrompt。",
    "要求：title 12 个汉字或 26 个英文字符以内；summary 一句话；tags 最多 5 个；controls 最多 4 个；coverPrompt 用英文，适合生成明亮、玩具感、无文字封面的 16:9 游戏封面。",
    options.sourceTitle ? `源作品标题：${options.sourceTitle}` : "",
    `用户需求：${prompt}`,
    `兜底标题：${fallback.title}`,
  ]
    .filter(Boolean)
    .join("\n");

  for (const endpoint of endpoints()) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(7000),
        body: JSON.stringify({
          model: getMiniMaxTextModel(),
          stream: false,
          temperature: 0.2,
          messages: [
            { role: "system", content: "You write concise JSON metadata for game gallery cards." },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!response.ok) continue;
      const payload = (await response.json().catch(() => null)) as unknown;
      const content = extractContent(payload);
      const parsed = parseJsonBlock(content);
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

export async function generateGameMetadata(prompt: string, options: MetadataOptions = {}) {
  const fallback = fallbackGameMetadata(prompt);
  const aiMetadata = await requestMiniMaxMetadata(prompt, fallback, options);
  return normalizeMetadata(aiMetadata, fallback);
}
