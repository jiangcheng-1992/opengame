"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

type ShareGameButtonProps = {
  gameId: string;
  title: string;
  summary?: string | null;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function ShareGameButton({ gameId, title, summary }: ShareGameButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [canNativeShare, setCanNativeShare] = useState(false);
  const sharePath = `/games/${gameId}`;
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return sharePath;
    return new URL(sharePath, window.location.origin).toString();
  }, [sharePath]);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && Boolean(navigator.share));
  }, []);

  async function handleShare() {
    setStatus("idle");
    const shareText = summary || "我发现了一个可以直接玩的 HTML5 小游戏。";

    try {
      if (canNativeShare && navigator.share) {
        await navigator.share({
          title,
          text: shareText,
          url: shareUrl,
        });
        setStatus("copied");
      } else {
        await copyText(shareUrl);
        setStatus("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await copyText(shareUrl);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
    } finally {
      window.setTimeout(() => setStatus("idle"), 1800);
    }
  }

  const copied = status === "copied";

  return (
    <button className="share-game-button" type="button" onClick={handleShare} aria-live="polite">
      {copied ? <Check size={15} aria-hidden /> : canNativeShare ? <Share2 size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      <span>{copied ? "已复制" : "快速分享"}</span>
    </button>
  );
}
