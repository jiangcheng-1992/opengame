"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, PencilLine, WandSparkles } from "lucide-react";

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
          canContinue ? (
            <Link className="button primary" href={`/games/${gameId}/edit`}>
              <PencilLine size={17} aria-hidden />
              进入修改工作台
            </Link>
          ) : (
            <button className="button secondary" type="button" disabled>
              <PencilLine size={17} aria-hidden />
              生成完成后可修改
            </button>
          )
        ) : null}
      </div>
      {!ownedByMe ? (
        <p className="helper action-note">
          <WandSparkles size={15} aria-hidden />
          {isBuiltin ? "内置精选只用于试玩示例。" : "继续修改只开放给作者。"}
        </p>
      ) : null}
    </section>
  );
}
