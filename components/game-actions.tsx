"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Send, WandSparkles } from "lucide-react";

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return fallback;
  if ("error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      if ("formErrors" in error && Array.isArray(error.formErrors) && error.formErrors[0]) {
        return String(error.formErrors[0]);
      }
      if ("fieldErrors" in error && error.fieldErrors && typeof error.fieldErrors === "object") {
        const first = Object.values(error.fieldErrors).flat()[0];
        if (first) return String(first);
      }
    }
  }
  return fallback;
}

export function GameActions({
  gameId,
  liked,
  ownedByMe,
  isBuiltin,
  canContinue,
}: {
  gameId: string;
  liked: boolean;
  ownedByMe: boolean;
  isBuiltin?: boolean;
  canContinue: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [likedNow, setLikedNow] = useState(liked);
  const [isPending, startTransition] = useTransition();
  const likeStorageKey = `builtin-like:${gameId}`;

  useEffect(() => {
    if (!isBuiltin) return;
    setLikedNow(window.localStorage.getItem(likeStorageKey) === "1");
  }, [isBuiltin, likeStorageKey]);

  function like() {
    if (isBuiltin) {
      const nextLiked = !likedNow;
      setLikedNow(nextLiked);
      if (nextLiked) {
        window.localStorage.setItem(likeStorageKey, "1");
      } else {
        window.localStorage.removeItem(likeStorageKey);
      }
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/games/${gameId}/like`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.liked === "boolean") {
        setLikedNow(payload.liked);
      }
      router.refresh();
    });
  }

  function continueGame() {
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/games/${gameId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessage(payload, "继续修改失败。"));
        return;
      }
      router.push(`/games/${gameId}?job=${payload.jobId}`);
      router.refresh();
    });
  }

  return (
    <section className="panel action-panel" aria-label="游戏操作">
      <div className="action-head">
        <div>
          <p className="eyebrow">{isBuiltin ? "内置玩法" : ownedByMe ? "继续修改" : "作品操作"}</p>
          <h3>{ownedByMe ? "继续打磨这个作品" : "试玩后收藏喜欢"}</h3>
          <p className="helper">
            {ownedByMe
              ? "继续修改会在当前作品上生成新版本；如果修改失败，旧版本仍然保留可玩。"
              : "当前阶段先聚焦一创和游玩；想做自己的游戏，请从创建页开始。"}
          </p>
        </div>
        <button className="icon-button like-button" type="button" onClick={like} disabled={isPending} aria-pressed={likedNow} aria-label={likedNow ? "取消喜欢" : "喜欢"}>
          <Heart size={19} aria-hidden fill={likedNow ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="action-fields">
        {ownedByMe ? (
          <div className="field">
            <label htmlFor="continue">继续修改</label>
            <input
              id="continue"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="比如：增加第二关和更明显的失败提示"
              disabled={!canContinue}
            />
            <button
              className="button primary"
              type="button"
              onClick={continueGame}
              disabled={isPending || !canContinue || prompt.length < 4}
            >
              <Send size={16} aria-hidden />
              提交修改
            </button>
          </div>
        ) : null}
      </div>
      {!ownedByMe ? (
        <p className="helper action-note">
          <WandSparkles size={15} aria-hidden />
          {isBuiltin ? "内置精选只用于试玩示例。" : "继续修改只开放给作者。"}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
