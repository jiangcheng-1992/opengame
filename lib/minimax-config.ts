export const DEFAULT_MINIMAX_TEXT_MODEL = "MiniMax-M2.7";
export const DEFAULT_GENERATION_MODEL_KEY = "standard";
export const GENERATION_MODEL_KEYS = ["standard", "quality"] as const;

export type GenerationModelKey = (typeof GENERATION_MODEL_KEYS)[number];

export const GENERATION_MODEL_OPTIONS: Array<{
  key: GenerationModelKey;
  label: string;
  description: string;
}> = [
  {
    key: "standard",
    label: "标准",
    description: "默认速度和成本档位，适合大多数生成需求。",
  },
  {
    key: "quality",
    label: "高质",
    description: "优先更强的生成质量，后续可接入付费能力。",
  },
];

export function getMiniMaxTextModel() {
  return process.env.MINIMAX_TEXT_MODEL || DEFAULT_MINIMAX_TEXT_MODEL;
}

export function normalizeGenerationModelKey(value?: string | null): GenerationModelKey {
  return value === "quality" ? "quality" : DEFAULT_GENERATION_MODEL_KEY;
}

export function getGenerationModelLabel(value?: string | null) {
  return normalizeGenerationModelKey(value) === "quality" ? "高质" : "标准";
}

export function getOpenGameModelForKey(value?: string | null) {
  const modelKey = normalizeGenerationModelKey(value);

  if (modelKey === "quality") {
    return (
      process.env.MINIMAX_QUALITY_TEXT_MODEL ||
      process.env.MINIMAX_TEXT_MODEL_QUALITY ||
      process.env.MINIMAX_TEXT_MODEL ||
      DEFAULT_MINIMAX_TEXT_MODEL
    );
  }

  return (
    process.env.MINIMAX_STANDARD_TEXT_MODEL ||
    process.env.MINIMAX_TEXT_MODEL_STANDARD ||
    process.env.MINIMAX_TEXT_MODEL ||
    DEFAULT_MINIMAX_TEXT_MODEL
  );
}
