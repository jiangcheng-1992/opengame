"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

export function GameActions({
  gameId,
  liked,
  isBuiltin,
}: {
  gameId: string;
  liked: boolean;
  isBuiltin?: boolean;
}) {
  const router = useRouter();
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

  return (
    <section className="panel action-panel" aria-label="游戏操作">
      <div className="action-head">
        <div>
          <p className="eyebrow">{isBuiltin ? "内置玩法" : "作品操作"}</p>
          <h3>试玩后收藏喜欢</h3>
          <p className="helper">{isBuiltin ? "内置精选只用于试玩示例。" : "喜欢这个作品，就把它留在你的匿名喜欢记录里。"}</p>
        </div>
        <button className="icon-button like-button" type="button" onClick={like} disabled={isPending} aria-pressed={likedNow} aria-label={likedNow ? "取消喜欢" : "喜欢"}>
          <Heart size={19} aria-hidden fill={likedNow ? "currentColor" : "none"} />
        </button>
      </div>
    </section>
  );
}
