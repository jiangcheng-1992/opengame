import { z } from "zod";
import { DEFAULT_GAMEPLAY_SKELETON_KEY, GAMEPLAY_SKELETON_KEYS } from "@/lib/gameplay-skeleton";
import { DEFAULT_GENERATION_MODEL_KEY, GENERATION_MODEL_KEYS } from "@/lib/minimax-config";
import { CONTENT_TYPE_VALUES } from "@/lib/content-type";

export const createGameSchema = z.object({
  prompt: z.string().trim().min(8, "提示词至少 8 个字符").max(4000),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  contentType: z.enum(CONTENT_TYPE_VALUES).default("GAME"),
});

export const createDraftSchema = z.object({
  initialPrompt: z.string().trim().max(4000).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  contentType: z.enum(CONTENT_TYPE_VALUES).default("GAME"),
});

export const brainstormMessageSchema = z.object({
  message: z.string().trim().min(1, "先说一句想做什么游戏。").max(2000, "单轮消息最多 2000 字。"),
});

export const generateDraftSchema = z.object({
  brief: z.string().trim().min(8, "生成需求至少 8 个字符。").max(4000),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  contentType: z.enum(CONTENT_TYPE_VALUES).default("GAME"),
  artEnhancementEnabled: z.boolean().default(false),
  modelKey: z.enum(GENERATION_MODEL_KEYS).default(DEFAULT_GENERATION_MODEL_KEY),
  skeletonKey: z.enum(GAMEPLAY_SKELETON_KEYS).default(DEFAULT_GAMEPLAY_SKELETON_KEY),
});

export const messageSchema = z.object({
  prompt: z.string().trim().min(4, "修改描述至少 4 个字符").max(4000),
});

export const updateVisibilitySchema = z.object({
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
});

export const registerSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(120),
  password: z.string().min(8, "密码至少 8 位").max(80),
  displayName: z.string().trim().max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(120),
  password: z.string().min(1, "请输入密码").max(80),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
