import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { getMiniMaxTextModel } from "@/lib/minimax-config";

export function createMiniMaxTextModel() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;

  const baseURL = (process.env.MINIMAX_TEXT_BASE_URL ?? process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1").replace(
    /\/$/,
    "",
  );
  const provider = createOpenAICompatible({
    name: "minimax",
    apiKey,
    baseURL,
    includeUsage: true,
  });

  return wrapLanguageModel({
    model: provider(getMiniMaxTextModel()),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}
