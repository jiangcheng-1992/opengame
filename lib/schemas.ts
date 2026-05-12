import { z } from "zod";

export const createGameSchema = z.object({
  prompt: z.string().trim().min(8, "提示词至少 8 个字符").max(4000),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});

export const createDraftSchema = z.object({
  initialPrompt: z.string().trim().max(4000).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});

export const brainstormMessageSchema = z.object({
  message: z.string().trim().min(1, "先说一句想做什么游戏。").max(2000, "单轮消息最多 2000 字。"),
});

export const generateDraftSchema = z.object({
  brief: z.string().trim().min(8, "生成需求至少 8 个字符。").max(4000),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  artEnhancementEnabled: z.boolean().default(false),
});

export const messageSchema = z.object({
  prompt: z.string().trim().min(4, "修改描述至少 4 个字符").max(4000),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
