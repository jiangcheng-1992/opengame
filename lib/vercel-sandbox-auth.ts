type SandboxCredentials = {
  token: string;
  teamId: string;
  projectId: string;
};

function envValue(env: NodeJS.ProcessEnv, key: string) {
  return env[key]?.trim() || "";
}

export function sandboxCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<SandboxCredentials> {
  if (envValue(env, "VERCEL_OIDC_TOKEN")) {
    return {};
  }

  const token = envValue(env, "VERCEL_TOKEN");
  const teamId = envValue(env, "VERCEL_TEAM_ID");
  const projectId = envValue(env, "VERCEL_PROJECT_ID");

  if (!token || !teamId || !projectId) return {};
  return { token, teamId, projectId };
}

function objectValue(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function sandboxErrorPayload(error: unknown) {
  const payload = objectValue(error, "json");
  return objectValue(payload, "error");
}

function sandboxErrorStatus(error: unknown) {
  const response = objectValue(error, "response");
  const responseStatus = objectValue(response, "status");
  if (typeof responseStatus === "number") return responseStatus;

  const directStatus = objectValue(error, "status") ?? objectValue(error, "statusCode");
  if (typeof directStatus === "number") return directStatus;

  const fallbackMessage = error instanceof Error ? error.message : "";
  const match = fallbackMessage.match(/\b(?:status code|http)\s+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

function sandboxErrorText(error: unknown) {
  const fallbackMessage = error instanceof Error ? error.message : "";
  const apiError = sandboxErrorPayload(error);
  const code = objectValue(apiError, "code");
  const message = objectValue(apiError, "message");
  const text = objectValue(error, "text");

  return [fallbackMessage, code, message, text]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function isSandboxAuthError(error: unknown) {
  const fallbackMessage = sandboxErrorText(error);
  const apiError = sandboxErrorPayload(error);
  const invalidToken = objectValue(apiError, "invalidToken");
  const code = objectValue(apiError, "code");
  const message = objectValue(apiError, "message");
  const status = sandboxErrorStatus(error);

  return (
    status === 401 ||
    status === 403 ||
    invalidToken === true ||
    code === "forbidden" ||
    code === "unauthorized" ||
    message === "Not authorized" ||
    /oidc|invalid token|not authorized|forbidden/i.test(fallbackMessage)
  );
}

export function isSandboxBillingOrLimitError(error: unknown) {
  const status = sandboxErrorStatus(error);
  const detail = sandboxErrorText(error);
  return status === 402 || /payment required|billing|quota|usage limit|spend management/i.test(detail);
}

export function isSandboxUnrecoverableProvisioningError(error: unknown) {
  return isSandboxAuthError(error) || isSandboxBillingOrLimitError(error);
}

export function describeSandboxError(error: unknown) {
  if (isSandboxAuthError(error)) {
    return [
      "Vercel Sandbox 凭据无效或已过期。",
      "本地开发优先刷新 VERCEL_OIDC_TOKEN：运行 `vercel link` 后执行 `vercel env pull`。",
      "如果不用 OIDC，则更新 VERCEL_TOKEN，并确认它有当前 VERCEL_TEAM_ID / VERCEL_PROJECT_ID 的访问权限。",
    ].join(" ");
  }

  if (isSandboxBillingOrLimitError(error)) {
    return [
      "Vercel Sandbox 账单或额度不可用（HTTP 402）。",
      "线上生成需要当前 Vercel 团队有可用的 Sandbox 额度；Hobby 免费额度用完会暂停创建，Pro/Enterprise 也可能被账单状态或 Spend Management 阻止。",
      "请到 Vercel Dashboard 检查 Usage / Billing / Sandbox 用量，恢复额度或升级后再重试。",
    ].join(" ");
  }

  const fallbackMessage = sandboxErrorText(error);
  return fallbackMessage || "Vercel Sandbox 启动失败。";
}

export function describeSandboxAuthError(error: unknown) {
  return describeSandboxError(error);
}
