"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, LoaderCircle } from "lucide-react";

type MakeSimilarButtonProps = {
  gameId: string;
  compact?: boolean;
};

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  if ("error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

export function MakeSimilarButton({ gameId, compact = false }: MakeSimilarButtonProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending) return;
    setError("");

    startTransition(async () => {
      const response = await fetch(`/api/games/${gameId}/edit-copy`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(readError(payload, "创建同款副本失败。"));
        return;
      }

      if (typeof payload.href === "string") {
        router.push(payload.href);
      }
    });
  }

  return (
    <div className={`make-similar-wrap ${compact ? "compact" : ""}`.trim()}>
      <button className={`button primary make-similar-button ${compact ? "compact" : ""}`.trim()} type="button" onClick={handleClick} disabled={isPending}>
        {isPending ? <LoaderCircle className="spin" size={16} aria-hidden /> : <CopyPlus size={16} aria-hidden />}
        {isPending ? "正在创建副本" : compact ? "做同款" : "做同款并调整"}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
