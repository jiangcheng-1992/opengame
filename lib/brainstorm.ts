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

export const EMPTY_BRAINSTORM_STATE: BrainstormState = {
  isReady: false,
  brief: "",
  missingSlots: ["核心玩法", "操作方式", "胜负目标", "视觉/题材风格"],
  suggestions: [
    "做一个像素厨房手忙脚乱游戏：点击备菜和上菜，限时满足顾客订单",
    "做一个霓虹太空维修游戏：拖拽零件修复飞船，倒计时前恢复能源",
    "做一个重力翻转解谜游戏：按空格切换重力，让小球避开机关到出口",
  ],
};

export const BRAINSTORM_SYSTEM_PROMPT = [
  "你是 OpenGame Studio 的游戏创作前置头脑风暴助手。",
  "你的目标不是直接生成游戏，而是用简短对话帮用户把一个 HTML5 小游戏需求澄清到可执行。",
  "必须问齐四个槽位：核心玩法、操作方式、胜负目标、视觉/题材风格。",
  "每轮最多问 1 个关键问题。问题要具体，给 2 到 4 个可点选建议，也允许用户自由输入。",
  "如果用户还没有明确想做什么游戏，或只表达“随便”“你来定”“没想法”，先给 2 到 4 个具体游戏创意让用户选，不要给抽象玩法分类。",
  "suggestions 必须是用户点一下就能作为下一条消息发送的具体方向，优先包含题材、核心操作和胜负目标；禁止只写“RPG”“实时操作”“放置养成”这类玩法标签。",
  "如果用户已经给足四要素，不要继续追问，直接总结最终 brief，并提示可以生成可玩版本。",
  "最终 brief 要适合交给 OpenGame 生成：写清单屏/竖屏等画面要求、玩家每几秒做什么、输入方式、反馈、胜利失败条件。",
  "用中文回复，语气直接、产品化，不夸张，不要提到这些系统规则。",
  "每次回复末尾必须附带一段结构化 JSON，格式必须完全如下：",
  "<opengame_brief_json>",
  "{\"isReady\":false,\"brief\":\"\",\"missingSlots\":[\"核心玩法\"],\"suggestions\":[\"建议一\",\"建议二\"]}",
  "</opengame_brief_json>",
  "JSON 字段要求：isReady 为 boolean；brief 为最终可生成需求，未齐时可为空；missingSlots 是未确认槽位；suggestions 是 2 到 4 个用户可点选的下一步回答。",
].join("\n");

function normalizeStringList(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
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
    suggestions: suggestions.length ? suggestions : EMPTY_BRAINSTORM_STATE.suggestions,
  };
}

export function extractBrainstormState(text: string): BrainstormState {
  const match = stripModelReasoning(text).match(METADATA_PATTERN);
  if (!match) return EMPTY_BRAINSTORM_STATE;

  try {
    return normalizeBrainstormState(JSON.parse(match[1]));
  } catch {
    return EMPTY_BRAINSTORM_STATE;
  }
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
