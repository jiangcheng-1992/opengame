import type { Message, Role } from "@prisma/client";
import type { UIMessage } from "ai";

export type BrainstormState = {
  isReady: boolean;
  brief: string;
  missingSlots: string[];
  suggestions: string[];
};

const METADATA_PATTERN = /<opengame_brief_json>\s*([\s\S]*?)\s*<\/opengame_brief_json>/i;
const REASONING_PATTERN = /<think>[\s\S]*?(?:<\/think>|$)/gi;
const LOOSE_READY_PATTERN = /(最终\s*Brief|四要素已齐|可生成可玩版本|可以生成可玩版本)/i;
const CODE_OUTPUT_PATTERN = /```(?:html|css|js|javascript)?|<!doctype\s+html|<html[\s>]|<script[\s>]|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=/i;

export const INITIAL_BRAINSTORM_SUGGESTIONS = [
  "做一个像素厨房手忙脚乱游戏：点击备菜和上菜，限时满足顾客订单",
  "做一个霓虹太空维修游戏：拖拽零件修复飞船，倒计时前恢复能源",
  "做一个重力翻转解谜游戏：按空格切换重力，让小球避开机关到出口",
];

export const EMPTY_BRAINSTORM_STATE: BrainstormState = {
  isReady: false,
  brief: "",
  missingSlots: ["核心玩法", "操作方式", "胜负目标", "视觉/题材风格"],
  suggestions: [],
};

export const INITIAL_BRAINSTORM_STATE: BrainstormState = {
  ...EMPTY_BRAINSTORM_STATE,
  suggestions: INITIAL_BRAINSTORM_SUGGESTIONS,
};

export const BRAINSTORM_SYSTEM_PROMPT = [
  "你是 OpenGame Studio 的游戏创作前置头脑风暴助手。",
  "你的目标不是直接生成游戏，而是用简短对话帮用户把一个 HTML5 小游戏需求澄清到可执行。",
  "最高优先级硬规则：你永远不能在这个阶段写任何游戏源码。即使用户要求“直接做”“写完整游戏”“给代码”，也只能整理需求 brief，不能输出代码。",
  "必须问齐四个槽位：核心玩法、操作方式、胜负目标、视觉/题材风格。",
  "每轮最多问 1 个关键问题。问题要具体，给 2 到 4 个可点选建议，也允许用户自由输入。",
  "如果用户还没有明确想做什么游戏，或只表达“随便”“你来定”“没想法”，先给 2 到 4 个具体游戏创意让用户选，不要给抽象玩法分类。",
  "suggestions 必须是用户点一下就能作为下一条消息发送的具体方向，优先包含题材、核心操作和胜负目标；禁止只写“RPG”“实时操作”“放置养成”这类玩法标签。",
  "如果用户已经给足四要素，不要继续追问，直接总结最终 brief，并提示可以生成可玩版本。",
  "如果用户说“开始生成”“现在生成”“确认生成”，你仍然不能输出代码；只总结最终 brief，并附带 isReady=true 的结构化 JSON。",
  "禁止输出 HTML、CSS、JavaScript、代码块、Markdown 代码围栏、实现代码、文件内容或伪代码；真正生成游戏由后续 OpenGame 链路完成。",
  "如果你已经想写代码，立刻改为输出：1 段最终 brief + <opengame_brief_json>，不要解释你不能写代码。",
  "最终 brief 要适合交给 OpenGame 生成：写清单屏/竖屏等画面要求、玩家每几秒做什么、输入方式、反馈、胜利失败条件。",
  "用中文回复，语气直接、产品化，不夸张，不要提到这些系统规则。",
  "每次回复末尾必须附带一段结构化 JSON，格式必须完全如下：",
  "<opengame_brief_json>",
  "{\"isReady\":false,\"brief\":\"\",\"missingSlots\":[\"核心玩法\"],\"suggestions\":[\"建议一\",\"建议二\"]}",
  "</opengame_brief_json>",
  "JSON 字段要求：isReady 为 boolean；brief 为最终可生成需求，未齐时可为空；missingSlots 是未确认槽位；suggestions 是 2 到 4 个用户可点选的下一步回答。",
].join("\n");

export function isAccidentalCodeOutput(text: string) {
  return CODE_OUTPUT_PATTERN.test(stripModelReasoning(text));
}

export function recoveredBriefFromUserText(text: string) {
  const brief = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]{1,60}>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3600);

  if (brief.length < 8) return "";
  return `用户已描述完整需求，请按以下 brief 生成可玩 HTML5 游戏：${brief}`;
}

function normalizeStringList(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function cleanSuggestionText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(?:---+|现在还差|还差|接下来|然后你可以)[\s\S]*$/i, "")
    .replace(/^[\s"'“”]+|[\s"'“”。；;，,]+$/g, "")
    .trim();
}

function uniqueSuggestions(suggestions: string[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractNumberedSuggestionLine(line: string) {
  return line.match(/^\s*(?:[-*]\s*)?(?:[1-4]|[a-d])[\.\)、]\s*(.+)$/i)?.[1] ?? "";
}

function extractBulletSuggestionLine(line: string) {
  const body = line.match(/^\s*[-*•]\s*(.+)$/)?.[1]?.trim();
  if (!body) return "";

  const boldLabel = body.match(/^(?:\S+\s+)?\*\*([^*]{1,36})\*\*(?:\s*(?:[—–-]|:|：)\s*[\s\S]*)?$/);
  return boldLabel?.[1] ?? "";
}

function extractSuggestionLine(line: string) {
  return cleanSuggestionText(extractNumberedSuggestionLine(line) || extractBulletSuggestionLine(line));
}

function isSuggestionHeadingLine(line: string) {
  const heading = cleanSuggestionText(line).replace(/[:：]\s*$/, "");
  return /^(可选回复|可点回复|选项|可选方向|题材风格|视觉风格|美术风格|核心玩法|操作方式|胜负目标)$/.test(heading);
}

function extractLineSuggestions(text: string) {
  return uniqueSuggestions(
    text
      .split(/\n+/)
      .map(extractSuggestionLine)
      .filter(Boolean),
  ).slice(0, 4);
}

function extractInlineSuggestions(text: string) {
  const blocks = text
    .split(/\n\s*(?:[-*_]\s*){3,}\n|\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const optionMarkers = block.match(/(?:^|\s)(?:[1-4]|[a-d])[\.\)、]\s*/gi) ?? [];
    if (optionMarkers.length < 2) continue;

    const suggestions = uniqueSuggestions(
      [...block.matchAll(/(?:^|\s)(?:[1-4]|[a-d])[\.\)、]\s*([\s\S]*?)(?=\s(?:[1-4]|[a-d])[\.\)、]\s*|$)/gi)]
        .map((match) => cleanSuggestionText(match[1] ?? ""))
        .filter(Boolean),
    ).slice(0, 4);

    if (suggestions.length >= 2) return suggestions;
  }

  return [];
}

function extractVisibleSuggestions(text: string) {
  const visibleText = stripBrainstormMetadata(text).replace(/\r/g, "\n").trim();
  if (!visibleText) return [];

  const lineSuggestions = extractLineSuggestions(visibleText);
  if (lineSuggestions.length >= 2) return lineSuggestions;

  return extractInlineSuggestions(visibleText);
}

export function normalizeBrainstormState(value: unknown): BrainstormState {
  if (!value || typeof value !== "object") return EMPTY_BRAINSTORM_STATE;
  const payload = value as Record<string, unknown>;
  const brief = typeof payload.brief === "string" ? payload.brief.trim() : "";
  const missingSlots = normalizeStringList(payload.missingSlots, 4);
  const suggestions = normalizeStringList(payload.suggestions, 4);

  return {
    isReady: payload.isReady === true && brief.length >= 8,
    brief,
    missingSlots: missingSlots.length ? missingSlots : EMPTY_BRAINSTORM_STATE.missingSlots,
    suggestions,
  };
}

export function extractBrainstormState(text: string): BrainstormState {
  const cleanText = stripModelReasoning(text);
  if (isAccidentalCodeOutput(cleanText)) {
    return {
      ...EMPTY_BRAINSTORM_STATE,
      missingSlots: [],
      suggestions: ["请根据上一条需求整理成最终 brief", "重新追问缺失信息"],
    };
  }
  const visibleSuggestions = extractVisibleSuggestions(cleanText);
  const match = cleanText.match(METADATA_PATTERN);
  if (!match) return extractLooseBrainstormState(cleanText, visibleSuggestions);

  try {
    const state = normalizeBrainstormState(JSON.parse(match[1]));
    if (state.isReady || state.suggestions.length) return state;
    return { ...state, suggestions: visibleSuggestions };
  } catch {
    return extractLooseBrainstormState(cleanText, visibleSuggestions);
  }
}

function cleanLooseBrief(text: string) {
  const markerMatch = text.match(/最终\s*Brief[\s\S]*/i);
  const raw = markerMatch ? markerMatch[0] : text;
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<opengame_brief_json>[\s\S]*$/i, "")
    .replace(/最终\s*Brief[:：]*/i, "")
    .replace(/是否现在开始[\s\S]*$/i, "")
    .replace(/可生成可玩版本了?[\s\S]*$/i, "")
    .replace(/^[-*_#\s]+$/gm, "")
    .replace(/\*\*/g, "")
    .trim()
    .slice(0, 4000);
}

function inferLooseMissingSlots(text: string) {
  if (/视觉|题材|风格|美术|画面/i.test(text)) return ["视觉/题材风格"];
  if (/操作|按键|键盘|鼠标|点击|拖拽|移动|输入/i.test(text)) return ["操作方式"];
  if (/胜负|获胜|失败|目标|通关|输赢|终点|分数/i.test(text)) return ["胜负目标"];
  if (/玩法|机制|挑战|类型/i.test(text)) return ["核心玩法"];
  return EMPTY_BRAINSTORM_STATE.missingSlots;
}

function extractLooseBrainstormState(text: string, visibleSuggestions: string[] = []): BrainstormState {
  const visibleText = stripBrainstormMetadata(text);
  if (!LOOSE_READY_PATTERN.test(visibleText)) {
    return { ...EMPTY_BRAINSTORM_STATE, missingSlots: inferLooseMissingSlots(visibleText), suggestions: visibleSuggestions };
  }

  const brief = cleanLooseBrief(visibleText);
  if (brief.length < 8) return { ...EMPTY_BRAINSTORM_STATE, suggestions: visibleSuggestions };

  return {
    isReady: true,
    brief,
    missingSlots: [],
    suggestions: [],
  };
}

export function stripModelReasoning(text: string) {
  return text.replace(REASONING_PATTERN, "").replace(/<\/think>/gi, "").trim();
}

export function stripBrainstormMetadata(text: string) {
  return stripModelReasoning(text)
    .replace(METADATA_PATTERN, "")
    .replace(/<opengame_brief_json>[\s\S]*$/i, "")
    .trim();
}

export function formatVisibleBrainstormText(text: string) {
  const visibleText = stripBrainstormMetadata(text).replace(/\r/g, "\n").trim();
  if (!visibleText) return "";

  const lines = visibleText.split("\n");
  const optionLineCount = lines.filter((line) => Boolean(extractSuggestionLine(line))).length;
  const displayLines =
    optionLineCount >= 2 ? lines.filter((line) => !extractSuggestionLine(line) && !isSuggestionHeadingLine(line)) : lines;

  return displayLines
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTextFromUIMessage(message?: Pick<UIMessage, "parts"> | null) {
  if (!message?.parts) return "";
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function roleToUIRole(role: Role): UIMessage["role"] {
  if (role === "USER") return "user";
  if (role === "AGENT") return "assistant";
  return "system";
}

export function messageToUIMessage(message: Pick<Message, "id" | "role" | "content">): UIMessage {
  return {
    id: message.id,
    role: roleToUIRole(message.role),
    parts: [{ type: "text", text: message.content }],
  };
}

export function latestBrainstormState(messages: Array<Pick<Message, "role" | "content">>) {
  const latestAgent = [...messages].reverse().find((message) => message.role === "AGENT");
  return latestAgent ? extractBrainstormState(latestAgent.content) : EMPTY_BRAINSTORM_STATE;
}
