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

export function isSandboxAuthError(error: unknown) {
  const fallbackMessage = error instanceof Error ? error.message : "";
  const payload = objectValue(error, "json");
  const apiError = objectValue(payload, "error");
  const invalidToken = objectValue(apiError, "invalidToken");
  const code = objectValue(apiError, "code");
  const message = objectValue(apiError, "message");

  return (
    invalidToken === true ||
    code === "forbidden" ||
    message === "Not authorized" ||
    /oidc|invalid token|not authorized|forbidden/i.test(fallbackMessage)
  );
}

export function describeSandboxAuthError(error: unknown) {
  const fallbackMessage = error instanceof Error ? error.message : "";

  if (isSandboxAuthError(error)) {
    return [
      "Vercel Sandbox 凭据无效或已过期。",
      "本地开发优先刷新 VERCEL_OIDC_TOKEN：运行 `vercel link` 后执行 `vercel env pull`。",
      "如果不用 OIDC，则更新 VERCEL_TOKEN，并确认它有当前 VERCEL_TEAM_ID / VERCEL_PROJECT_ID 的访问权限。",
    ].join(" ");
  }

  return fallbackMessage || "Vercel Sandbox 启动失败。";
}
