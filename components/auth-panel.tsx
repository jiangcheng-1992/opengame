"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";

type AuthPanelProps = {
  nextPath?: string;
};

type Mode = "login" | "register";

function errorMessageFromPayload(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "fieldErrors" in error) {
      const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      const first = fieldErrors ? Object.values(fieldErrors).flat()[0] : null;
      if (first) return first;
    }
    if (error && typeof error === "object" && "formErrors" in error) {
      const formErrors = (error as { formErrors?: string[] }).formErrors;
      if (formErrors?.[0]) return formErrors[0];
    }
  }
  return fallback;
}

export function AuthPanel({ nextPath = "/create" }: AuthPanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(mode === "register" ? { displayName } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessageFromPayload(payload, mode === "register" ? "注册失败。" : "登录失败。"));
        return;
      }
      router.refresh();
      router.push(nextPath || "/create");
    } catch {
      setError(mode === "register" ? "注册请求失败，请检查网络后重试。" : "登录请求失败，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-panel-title">
      <div className="auth-panel-copy">
        <p className="eyebrow">账号资产</p>
        <h1 id="auth-panel-title">登录后再创建游戏</h1>
        <p>登录后，草稿、已生成作品和后续修改都会绑定到你的账号。当前浏览器已有的匿名作品会自动合并到账号资产里。</p>
      </div>

      <div className="auth-card">
        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            <LogIn size={16} aria-hidden />
            登录
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            <UserPlus size={16} aria-hidden />
            注册
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === "register" ? (
            <label>
              昵称
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：星际玩家" />
            </label>
          ) : null}
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : "输入密码"}
              minLength={mode === "register" ? 8 : 1}
              required
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="button primary auth-submit" type="submit" disabled={pending}>
            {pending ? "处理中..." : mode === "register" ? "注册并开始创作" : "登录并开始创作"}
          </button>
        </form>
      </div>
    </section>
  );
}
