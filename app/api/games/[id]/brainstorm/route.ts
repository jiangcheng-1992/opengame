import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { NextRequest, NextResponse } from "next/server";
import {
  BRAINSTORM_SYSTEM_PROMPT,
  extractBrainstormState,
  extractTextFromUIMessage,
  messageToUIMessage,
  stripModelReasoning,
} from "@/lib/brainstorm";
import { prisma } from "@/lib/db";
import { fallbackGameMetadata } from "@/lib/game-metadata";
import { createMiniMaxTextModel } from "@/lib/minimax-text";
import { getAnonId, requireAccount } from "@/lib/auth";
import { brainstormMessageSchema } from "@/lib/schemas";

export const maxDuration = 60;

function latestMessageText(messages: unknown) {
  if (!Array.isArray(messages)) return "";
  return extractTextFromUIMessage(messages[messages.length - 1] as UIMessage | undefined);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL("/create", req.url);
  url.searchParams.set("game", id);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  if (!account) {
    return NextResponse.json({ error: "请先登录后再继续创作。" }, { status: 401 });
  }
  const [{ id }, anonId, body] = await Promise.all([params, getAnonId(), req.json().catch(() => ({}))]);
  const parsed = brainstormMessageSchema.safeParse({
    message: typeof body?.message === "string" ? body.message : latestMessageText(body?.messages),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const model = createMiniMaxTextModel();
  if (!model) {
    return NextResponse.json({ error: "MiniMax 文本模型未配置，无法进行流式头脑风暴。" }, { status: 503 });
  }

  const game = await prisma.game.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!game || game.ownerId !== anonId) {
    return NextResponse.json({ error: "找不到这个草稿。" }, { status: 404 });
  }

  if (game.status !== "DRAFT") {
    return NextResponse.json({ error: "这个作品已经开始生成，不能继续头脑风暴。" }, { status: 409 });
  }

  const userMessage = await prisma.message.create({
    data: {
      gameId: game.id,
      role: "USER",
      content: parsed.data.message,
    },
  });
  const originalMessages = [...game.messages.map(messageToUIMessage), messageToUIMessage(userMessage)];
  const systemPrompt =
    game.contentType === "APPLICATION"
      ? [
          BRAINSTORM_SYSTEM_PROMPT,
          "",
          "当前作品类型是应用，不是游戏。",
          "头脑风暴必须问齐应用需求：核心用途/用户任务、主要交互方式、完成状态或输出结果、视觉/品牌风格。",
          "不要强行追问胜负目标、关卡、敌人、生命值或游戏规则；最终 brief 要适合生成 HTML5 互动应用、工具、展示页或轻应用。",
          "suggestions 要给应用方向，例如工具、仪表盘、生成器、互动表单、展示页、练习/学习应用等具体可点选方案。",
        ].join("\n")
      : BRAINSTORM_SYSTEM_PROMPT;
  const result = streamText({
    model,
    system: systemPrompt,
    messages: await convertToModelMessages(originalMessages),
    temperature: 0.4,
    maxOutputTokens: 900,
  });

  return result.toUIMessageStreamResponse({
    originalMessages,
    sendReasoning: false,
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) return;
      const content = stripModelReasoning(extractTextFromUIMessage(responseMessage));
      if (!content) return;

      await prisma.message.create({
        data: {
          gameId: game.id,
          role: "AGENT",
          content,
        },
      });

      const state = extractBrainstormState(content);
      const metadata = fallbackGameMetadata(state.brief || parsed.data.message);
      await prisma.game.update({
        where: { id: game.id },
        data: {
          title: metadata.title || "创作草稿",
          summary: state.brief || metadata.summary,
          genre: metadata.genre,
          tags: metadata.tags,
          controls: metadata.controls,
          coverPrompt: metadata.coverPrompt,
        },
      });
    },
  });
}
