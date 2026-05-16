"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Heart, Play, PlayCircle, Share2 } from "lucide-react";
import type { GameCardGame } from "@/components/game-card";
import { ResponsiveGameFrame } from "@/components/responsive-game-frame";

function formatCount(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

type GameReelsFeedProps = {
  games: GameCardGame[];
  pangleFeedAd?: PangleFeedAdConfig | null;
};

export type PangleFeedAdConfig = {
  appId: string;
  slotId: string;
  sdkUrl: string;
  interval: number;
  startIndex: number;
};

type FeedActionState = {
  playCount: number;
  likeCount: number;
  shareCount: number;
  likedByMe: boolean;
  shareState: "idle" | "copied";
  liking: boolean;
  playedTracked: boolean;
  likeBurst: number;
  sharePulse: number;
};

type FeedItem =
  | { type: "game"; game: GameCardGame; gameIndex: number }
  | { type: "ad"; id: string; adIndex: number };

type PangleSdkPayload = {
  appId: string;
  codeId: string;
  slotId: string;
  adSlotId: string;
  adCount: number;
  width: number;
  height: number;
  container: HTMLElement;
  containerId: string;
};

type PangleSdk = {
  init?: (config: { appId: string }) => unknown;
  showFeedAd?: (payload: PangleSdkPayload) => unknown;
  loadFeedAd?: (payload: PangleSdkPayload) => unknown;
  loadNativeExpressAd?: (payload: PangleSdkPayload) => unknown;
  renderFeedAd?: (payload: PangleSdkPayload) => unknown;
};

type PangleWindow = Window & {
  pangle?: PangleSdk;
  __pangleFeedSdkPromise?: Promise<void>;
};

function createFeedActionState(game: GameCardGame): FeedActionState {
  return {
    playCount: game.playCount,
    likeCount: game.likeCount,
    shareCount: game.shareCount ?? 0,
    likedByMe: Boolean(game.likedByMe),
    shareState: "idle",
    liking: false,
    playedTracked: false,
    likeBurst: 0,
    sharePulse: 0,
  };
}

function controlHintLabel(control: string) {
  const key = control.trim().toLowerCase();
  if (["keyboard", "键盘", "arrow keys", "arrows", "wasd", "方向键"].includes(key)) return "方向键 / WASD";
  if (["mouse", "鼠标", "click", "点击", "drag", "拖动"].includes(key)) return "点击 / 拖动";
  if (["touch", "触摸", "触屏", "tap", "轻触"].includes(key)) return "轻触";
  if (["swipe", "滑动", "gesture", "手势"].includes(key)) return "滑动 / 手势";
  return control;
}

function controlHintsFor(game: GameCardGame) {
  const hints = (game.controls ?? []).map(controlHintLabel).filter(Boolean);
  const deduped = hints.filter((hint, index) => hints.indexOf(hint) === index);
  const hasTouchHint = deduped.some((hint) => hint.includes("轻触") || hint.includes("滑动"));
  const hasPointerHint = deduped.some((hint) => hint.includes("点击") || hint.includes("拖动"));

  if (hasPointerHint && !hasTouchHint) {
    deduped.push("轻触 / 滑动");
  }

  return deduped.slice(0, 3);
}

function buildFeedItems(games: GameCardGame[], pangleFeedAd?: PangleFeedAdConfig | null): FeedItem[] {
  if (!pangleFeedAd || games.length < pangleFeedAd.startIndex) {
    return games.map((game, gameIndex) => ({ type: "game", game, gameIndex }));
  }

  const items: FeedItem[] = [];
  let adIndex = 0;
  games.forEach((game, gameIndex) => {
    items.push({ type: "game", game, gameIndex });
    const position = gameIndex + 1;
    const shouldInsertAd = position >= pangleFeedAd.startIndex && (position - pangleFeedAd.startIndex) % pangleFeedAd.interval === 0 && position < games.length;
    if (shouldInsertAd) {
      adIndex += 1;
      items.push({ type: "ad", id: `pangle-feed-ad-${adIndex}`, adIndex });
    }
  });
  return items;
}

function loadPangleSdk(sdkUrl: string) {
  const pangleWindow = window as PangleWindow;
  if (pangleWindow.pangle) return Promise.resolve();
  if (pangleWindow.__pangleFeedSdkPromise) return pangleWindow.__pangleFeedSdkPromise;

  pangleWindow.__pangleFeedSdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-pangle-sdk="${sdkUrl}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Pangle SDK failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.dataset.pangleSdk = sdkUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Pangle SDK failed to load."));
    document.head.appendChild(script);
  });

  return pangleWindow.__pangleFeedSdkPromise;
}

function PangleFeedAdCard({ adId, config }: { adId: string; config: PangleFeedAdConfig }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;

    async function renderAd() {
      const container = containerRef.current;
      if (!container) return;

      try {
        await loadPangleSdk(config.sdkUrl);
        if (cancelled) return;

        const pangle = (window as PangleWindow).pangle;
        if (!pangle) throw new Error("Pangle SDK global is missing.");

        pangle.init?.({ appId: config.appId });
        const payload: PangleSdkPayload = {
          appId: config.appId,
          codeId: config.slotId,
          slotId: config.slotId,
          adSlotId: config.slotId,
          adCount: 1,
          width: Math.max(320, Math.round(container.clientWidth || 390)),
          height: 0,
          container,
          containerId: adId,
        };
        const renderers = [pangle.showFeedAd, pangle.loadFeedAd, pangle.loadNativeExpressAd, pangle.renderFeedAd].filter(
          (renderer): renderer is (payload: PangleSdkPayload) => unknown => typeof renderer === "function",
        );

        if (!renderers.length) throw new Error("Pangle feed renderer is missing.");
        await Promise.resolve(renderers[0](payload));
        if (!cancelled) setStatus("ready");
      } catch (error) {
        console.warn("[pangle-feed-ad]", error);
        if (!cancelled) setStatus("failed");
      }
    }

    void renderAd();

    return () => {
      cancelled = true;
    };
  }, [adId, config.appId, config.sdkUrl, config.slotId]);

  if (status === "failed") return null;

  return (
    <article className="reel-card reel-ad-card" aria-label="信息流广告">
      <div className="reel-stage reel-ad-stage">
        <div className="reel-ad-shell">
          <div className="reel-ad-head">
            <span>广告</span>
            <small>赞助内容</small>
          </div>
          <div id={adId} ref={containerRef} className="pangle-feed-ad-container" data-code-id={config.slotId}>
            {status === "loading" ? <span className="reel-ad-loading">广告加载中...</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function GameReelsFeed({ games, pangleFeedAd }: GameReelsFeedProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [gameState, setGameState] = useState(() =>
    Object.fromEntries(
      games.map((game) => [game.id, createFeedActionState(game)]),
    ),
  );
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const autoScrollLockUntilRef = useRef(0);
  const shareResetTimers = useRef<Map<string, number>>(new Map());
  const likeResetTimers = useRef<Map<string, number>>(new Map());

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

  function shareUrlFor(gameId: string) {
    if (typeof window === "undefined") return `/games/${gameId}`;
    return new URL(`/games/${gameId}`, window.location.origin).toString();
  }

  function scheduleLikeBurstReset(gameId: string) {
    const existing = likeResetTimers.current.get(gameId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      setGameState((state) => ({
        ...state,
        [gameId]: {
          ...state[gameId],
          likeBurst: 0,
        },
      }));
      likeResetTimers.current.delete(gameId);
    }, 900);
    likeResetTimers.current.set(gameId, timer);
  }

  async function trackPlay(game: GameCardGame) {
    if (game.isBuiltin) return;
    const current = gameState[game.id];
    if (!current || current.playedTracked) return;

    setGameState((state) => ({
      ...state,
      [game.id]: {
        ...state[game.id],
        playedTracked: true,
        playCount: state[game.id].playCount + 1,
      },
    }));

    try {
      const response = await fetch(`/api/games/${game.id}/play`, { method: "POST" });
      if (!response.ok) {
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            playedTracked: false,
            playCount: Math.max(game.playCount, state[game.id].playCount - 1),
          },
        }));
      }
    } catch {
      setGameState((state) => ({
        ...state,
        [game.id]: {
          ...state[game.id],
          playedTracked: false,
          playCount: Math.max(game.playCount, state[game.id].playCount - 1),
        },
      }));
    }
  }

  async function toggleLike(game: GameCardGame) {
    const current = gameState[game.id];
    if (!current || current.liking) return;
    const nextLiked = !current.likedByMe;
    const nextCount = Math.max(0, current.likeCount + (nextLiked ? 1 : -1));
    const nextBurst = nextLiked ? current.likeBurst + 1 : current.likeBurst;

    setGameState((state) => ({
      ...state,
      [game.id]: {
        ...state[game.id],
        liking: true,
        likedByMe: nextLiked,
        likeCount: nextCount,
        likeBurst: nextBurst,
      },
    }));
    if (nextLiked) scheduleLikeBurstReset(game.id);

    try {
      const response = await fetch(`/api/games/${game.id}/like`, { method: "POST" });
      if (!response.ok) throw new Error("like request failed");
      const payload = (await response.json()) as { liked?: boolean; localOnly?: boolean };
      if (payload.localOnly) {
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            liking: false,
          },
        }));
        return;
      }

      const liked = Boolean(payload.liked);
      setGameState((state) => {
        const previous = state[game.id];
        const correctedCount = Math.max(0, previous.likeCount + (liked === previous.likedByMe ? 0 : liked ? 1 : -1));
        return {
          ...state,
          [game.id]: {
            ...previous,
            liking: false,
            likedByMe: liked,
            likeCount: correctedCount,
          },
        };
      });
    } catch {
      setGameState((state) => ({
        ...state,
        [game.id]: {
          ...state[game.id],
          liking: false,
          likedByMe: current.likedByMe,
          likeCount: current.likeCount,
          likeBurst: current.likeBurst,
        },
      }));
    }
  }

  async function shareGame(game: GameCardGame) {
    const url = shareUrlFor(game.id);
    const text = game.summary || "我发现了一个可以直接玩的 HTML5 小游戏。";

    try {
      if (navigator.share) {
        await navigator.share({ title: game.title, text, url });
      } else {
        await copyText(url);
      }
      setGameState((state) => ({
        ...state,
        [game.id]: {
          ...state[game.id],
          shareState: "copied",
          sharePulse: state[game.id].sharePulse + 1,
        },
      }));
      const response = await fetch(`/api/games/${game.id}/share`, { method: "POST" }).catch(() => null);
      if (response?.ok) {
        const payload = (await response.json()) as { count?: number };
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            shareCount: payload.count ?? state[game.id].shareCount,
          },
        }));
      }
      const existing = shareResetTimers.current.get(game.id);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            shareState: "idle",
          },
        }));
        shareResetTimers.current.delete(game.id);
      }, 1800);
      shareResetTimers.current.set(game.id, timer);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await copyText(url);
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            shareState: "copied",
            sharePulse: state[game.id].sharePulse + 1,
          },
        }));
      } catch {
        setGameState((state) => ({
          ...state,
          [game.id]: {
            ...state[game.id],
            shareState: "idle",
          },
        }));
      }
    }
  }

  function bindCardRef(gameId: string) {
    return (node: HTMLElement | null) => {
      if (node) cardRefs.current.set(gameId, node);
      else cardRefs.current.delete(gameId);
    };
  }

  useEffect(() => {
    function stopWhenHidden() {
      if (document.visibilityState === "hidden") setPlayingId(null);
    }

    function stopOnPageHide() {
      setPlayingId(null);
    }

    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopOnPageHide);
    };
  }, []);

  useEffect(
    () => () => {
      for (const timer of shareResetTimers.current.values()) {
        window.clearTimeout(timer);
      }
      shareResetTimers.current.clear();
      for (const timer of likeResetTimers.current.values()) {
        window.clearTimeout(timer);
      }
      likeResetTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!playingId) return;
    const currentCard = cardRefs.current.get(playingId);
    if (!currentCard) return;

    requestAnimationFrame(() => {
      currentCard.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
    });

    const activeGame = games.find((game) => game.id === playingId);
    if (activeGame) {
      void trackPlay(activeGame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (Date.now() < autoScrollLockUntilRef.current) return;
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) {
          setPlayingId((current) => (current === playingId ? null : current));
        }
      },
      {
        threshold: [0, 0.35, 0.6, 1],
      },
    );

    observer.observe(currentCard);
    return () => observer.disconnect();
  }, [playingId]);

  const feedItems = buildFeedItems(games, pangleFeedAd);

  return (
    <section className="reels-feed" aria-label="游戏信息流">
      {feedItems.map((item) => {
        if (item.type === "ad") {
          return pangleFeedAd ? <PangleFeedAdCard key={item.id} adId={item.id} config={pangleFeedAd} /> : null;
        }

        const { game, gameIndex: index } = item;
        const isPlaying = playingId === game.id;
        const playable = Boolean(game.playUrl);
        const state = gameState[game.id] ?? createFeedActionState(game);
        const controlHints = controlHintsFor(game);

        return (
          <article key={game.id} className={`reel-card ${isPlaying ? "is-playing" : ""}`} ref={bindCardRef(game.id)}>
            <div className={`reel-stage ${isPlaying ? "is-playing" : ""}`}>
              {isPlaying && game.coverUrl ? (
                <>
                  <Image src={game.coverUrl} alt="" fill sizes="100vw" className="reel-playback-backdrop" aria-hidden />
                  <div className="reel-playback-backdrop-tint" aria-hidden />
                </>
              ) : null}
              {!isPlaying ? (
                <div className="reel-side-actions" aria-label="当前作品操作">
                  <button className="reel-side-action is-static" type="button" aria-label={`播放次数 ${formatCount(state.playCount)}`}>
                    <span className="reel-side-icon">
                      <Play size={18} aria-hidden fill="currentColor" />
                    </span>
                    <strong>{formatCount(state.playCount)}</strong>
                  </button>
                  <button
                    className={`reel-side-action ${state.likedByMe ? "liked" : ""} ${state.likeBurst ? "burst" : ""}`}
                    type="button"
                    onClick={() => void toggleLike(game)}
                    aria-pressed={state.likedByMe}
                    aria-label={state.likedByMe ? "取消点赞" : "点赞"}
                    disabled={state.liking}
                  >
                    <span className="reel-side-icon">
                      <Heart size={18} aria-hidden fill={state.likedByMe ? "currentColor" : "none"} />
                    </span>
                    {state.likeBurst ? (
                      <span className="reel-like-hearts" aria-hidden key={`${game.id}-like-${state.likeBurst}`}>
                        <span>❤</span>
                        <span>❤</span>
                        <span>❤</span>
                        <span>❤</span>
                        <span>❤</span>
                      </span>
                    ) : null}
                    <strong>{formatCount(state.likeCount)}</strong>
                  </button>
                  <button
                    className={`reel-side-action ${state.shareState === "copied" ? "copied" : ""}`}
                    type="button"
                    onClick={() => void shareGame(game)}
                    aria-label="分享当前游戏"
                  >
                    <span className="reel-side-icon">
                      {state.shareState === "copied" ? <Check size={18} aria-hidden /> : <Share2 size={18} aria-hidden />}
                    </span>
                    <strong key={`${game.id}-share-${state.sharePulse}`} className={state.sharePulse ? "share-pop" : ""}>
                      {formatCount(state.shareCount)}
                    </strong>
                  </button>
                </div>
              ) : null}
              {!isPlaying && state.shareState === "copied" ? (
                <div className="reel-share-toast" role="status" aria-live="polite">
                  复制链接成功
                </div>
              ) : null}
              {isPlaying && playable ? (
                <>
                  {controlHints.length ? (
                    <div className="reel-play-hints" aria-label="当前游戏操作说明">
                      <span className="reel-play-hints-title">操作</span>
                      <div className="reel-play-hints-list">
                        {controlHints.map((hint) => (
                          <span key={`${game.id}-${hint}`}>{hint}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <ResponsiveGameFrame
                    key={`reel-frame-${game.id}`}
                    title={game.title}
                    src={game.playUrl!}
                    shellClassName="reel-frame-shell responsive-game-shell"
                    iframeClassName="responsive-game-iframe reel-frame"
                    fallbackWidth={1280}
                    fallbackHeight={800}
                  />
                </>
              ) : (
                <>
                  {game.coverUrl ? (
                    <Image
                      src={game.coverUrl}
                      alt={`${game.title} 封面`}
                      fill
                      sizes="(max-width: 760px) 100vw, 720px"
                      className="reel-cover"
                      priority={index < 2}
                    />
                  ) : (
                    <div className="reel-fallback-cover" aria-hidden />
                  )}
                  <div className="reel-scrim" aria-hidden />
                  <div className="reel-overlay">
                    <span className="reel-badge">{game.isBuiltin ? "内置精选" : game.genre || "公开作品"}</span>
                    <div className="reel-copy">
                      <h2>{game.title}</h2>
                      <p>{game.summary || "向上滑切换下一个作品，点击按钮后可在当前页直接试玩。"}</p>
                    </div>
                    <button
                      className="button primary reel-play-button"
                      type="button"
                      onClick={() => {
                        autoScrollLockUntilRef.current = Date.now() + 450;
                        setPlayingId(game.id);
                      }}
                      disabled={!playable}
                    >
                      <PlayCircle size={18} aria-hidden />
                      {playable ? "点击试玩" : "暂不可玩"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
