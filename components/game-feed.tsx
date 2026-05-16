"use client";

import { useState } from "react";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { GameCard, type GameCardGame } from "@/components/game-card";
import type { MineStatusFilter } from "@/lib/games";
import type { ContentTypeTab } from "@/lib/content-type";

type GameFeedProps = {
  initialGames: GameCardGame[];
  initialNextCursor?: string | null;
  tab: "all" | "mine";
  mineStatus: MineStatusFilter;
  contentTab?: ContentTypeTab;
  surface: "gallery" | "studio";
};

type GamesPayload = {
  games?: GameCardGame[];
  nextCursor?: string | null;
  error?: unknown;
};

function gamesUrl(tab: "all" | "mine", mineStatus: MineStatusFilter, contentTab: ContentTypeTab, cursor: string) {
  const params = new URLSearchParams();
  if (tab === "mine") {
    params.set("tab", "mine");
    if (mineStatus !== "all") params.set("status", mineStatus);
  }
  params.set("content", contentTab);
  params.set("cursor", cursor);
  return `/api/games?${params.toString()}`;
}

function payloadError(payload: GamesPayload, fallback: string) {
  if (typeof payload.error === "string") return payload.error;
  return fallback;
}

export function GameFeed({ initialGames, initialNextCursor = null, tab, mineStatus, contentTab = "game", surface }: GameFeedProps) {
  const [games, setGames] = useState(initialGames);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(gamesUrl(tab, mineStatus, contentTab, nextCursor), { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as GamesPayload;

      if (!response.ok) {
        throw new Error(payloadError(payload, "加载失败，请稍后重试。"));
      }

      setGames((currentGames) => {
        const existing = new Set(currentGames.map((game) => game.id));
        const nextGames = (payload.games ?? []).filter((game) => !existing.has(game.id));
        return [...currentGames, ...nextGames];
      });
      setNextCursor(payload.nextCursor ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="feed-grid">
        {games.map((game, index) => (
          <GameCard key={game.id} game={game} surface={surface} priority={index < 4} />
        ))}
      </div>

      <div className="feed-load-area" aria-live="polite">
        {error ? <p className="feed-load-error">{error}</p> : null}
        {nextCursor ? (
          <button className="button secondary feed-load-button" type="button" onClick={loadMore} disabled={loading}>
            {loading ? <LoaderCircle className="spin-icon" size={17} aria-hidden /> : error ? <RefreshCw size={17} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
            {loading ? "加载中..." : error ? "重试" : "查看更多作品"}
          </button>
        ) : (
          <p className="feed-end-note">已经到底了</p>
        )}
      </div>
    </>
  );
}
