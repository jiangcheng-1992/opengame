export const CONTENT_TYPE_VALUES = ["GAME", "APPLICATION"] as const;

export type ContentTypeValue = (typeof CONTENT_TYPE_VALUES)[number];
export type ContentTypeTab = "game" | "application";

export function normalizeContentType(value?: string | null): ContentTypeValue {
  return value === "APPLICATION" || value?.toLowerCase() === "application" ? "APPLICATION" : "GAME";
}

export function contentTypeToTab(value?: string | null): ContentTypeTab {
  return normalizeContentType(value) === "APPLICATION" ? "application" : "game";
}

export function normalizeContentTypeTab(value?: string | null): ContentTypeTab {
  return value === "application" || value === "app" ? "application" : "game";
}

export function tabToContentType(value?: string | null): ContentTypeValue {
  return normalizeContentTypeTab(value) === "application" ? "APPLICATION" : "GAME";
}

export function contentTypeLabel(value?: string | null) {
  return normalizeContentType(value) === "APPLICATION" ? "应用" : "游戏";
}
