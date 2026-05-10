export const DEFAULT_MINIMAX_TEXT_MODEL = "MiniMax-M2.7";

export function getMiniMaxTextModel() {
  return process.env.MINIMAX_TEXT_MODEL || DEFAULT_MINIMAX_TEXT_MODEL;
}
