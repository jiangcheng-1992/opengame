import Link from "next/link";
import Image from "next/image";
import { Gamepad2, Heart, Play } from "lucide-react";
import { GameCardProgress } from "@/components/game-card-progress";
import { MakeSimilarButton } from "@/components/make-similar-button";

export type GameCardGame = {
    id: string;
    title: string;
    coverUrl?: string | null;
    status: string;
    summary?: string | null;
    genre?: string | null;
    tags?: string[];
    controls?: string[];
    playUrl?: string | null;
    playCount: number;
    likeCount: number;
    shareCount?: number;
    likedByMe?: boolean;
    createdAt: Date | string;
    ownedByMe?: boolean;
    isBuiltin?: boolean;
    latestJob?: {
      id?: string;
      status: string;
      progress?: number | null;
      errorMsg?: string | null;
    } | null;
  };

type GameCardProps = {
  game: GameCardGame;
  surface?: "gallery" | "studio";
  priority?: boolean;
};

function formatCount(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function statusLabel(status: string) {
  switch (status) {
    case "draft":
      return "创作草稿";
    case "ready":
      return "可玩";
    case "generating":
      return "生成中";
    case "validating":
      return "自动试玩";
    case "repairing":
      return "自动修复";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function latestJobLabel(status: string) {
  switch (status) {
    case "queued":
      return "新版本排队中";
    case "running":
      return "新版本生成中";
    case "validating":
      return "新版本自动试玩";
    case "repairing":
      return "新版本自动修复";
    case "finishing":
      return "新版本发布中";
    default:
      return "";
  }
}

function hasActiveJob(game: GameCardProps["game"]) {
  return Boolean(game.latestJob && latestJobLabel(game.latestJob.status));
}

function isPlayableRevisionActive(game: GameCardProps["game"]) {
  return Boolean(game.playUrl && hasActiveJob(game));
}

function visibleTags(game: GameCardProps["game"]) {
  const seen = new Set<string>();
  return [game.genre, ...(game.tags ?? []), ...(game.controls ?? [])]
    .filter((tag): tag is string => Boolean(tag))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
}

function displayLabel(label: string) {
  const key = label.trim().toLowerCase();
  const labels: Record<string, string> = {
    arcade: "街机",
    action: "动作",
    classic: "经典",
    puzzle: "解谜",
    rhythm: "节奏",
    runner: "跑酷",
    "tower defense": "塔防",
    boss: "首领战",
    keyboard: "键盘",
    mouse: "鼠标",
    click: "点击",
  };
  return labels[key] ?? label;
}

function hrefForGame(game: GameCardProps["game"], surface: NonNullable<GameCardProps["surface"]>) {
  if (surface === "studio" && game.ownedByMe && !game.isBuiltin) {
    if (game.status === "draft") {
      return `/create?game=${game.id}`;
    }
    if (game.status === "generating" && !game.playUrl) {
      return `/create?game=${game.id}`;
    }
    if (game.status === "ready" || game.status === "failed" || isPlayableRevisionActive(game) || (game.status === "generating" && game.playUrl)) {
      return `/games/${game.id}/edit`;
    }
  }

  if (game.status === "draft") return `/create?game=${game.id}`;
  return `/games/${game.id}`;
}

export function GameCard({ game, surface = "gallery", priority = false }: GameCardProps) {
  const isReady = game.status === "ready";
  const isDraft = game.status === "draft";
  const tags = visibleTags(game);
  const date = new Date(game.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  const infoChips = tags.length ? tags.map(displayLabel) : [date];
  const href = hrefForGame(game, surface);
  const revisionStatusText = surface === "studio" && isPlayableRevisionActive(game) ? latestJobLabel(game.latestJob!.status) : "";
  const statusText = game.isBuiltin ? "内置精选" : revisionStatusText || statusLabel(game.status);
  const canMakeSimilar = surface === "gallery" && !game.ownedByMe && Boolean(game.playUrl) && (game.isBuiltin || game.status === "ready");

  return (
    <article className={`game-card ${isReady ? "ready" : ""} ${isDraft ? "draft" : ""} ${game.isBuiltin ? "builtin" : ""} surface-${surface}`}>
      <Link href={href} className="game-card-link" aria-label={`打开 ${game.title}`}>
        <div className="card-media">
          {game.coverUrl ? (
            <Image
              src={game.coverUrl}
              alt={`${game.title} 封面`}
              fill
              sizes="(max-width: 760px) calc(100vw - 28px), (max-width: 1180px) calc((100vw - 50px) / 2), 330px"
              className="card-cover"
              priority={priority}
            />
          ) : (
            <span className="card-placeholder" aria-hidden>
              <Gamepad2 size={34} />
            </span>
          )}
          <span className="card-scrim" aria-hidden />
          <span className={`status-pill ${isReady ? "ready" : ""}`}>{statusText}</span>
          {hasActiveJob(game) ? <GameCardProgress status={game.latestJob!.status} progress={game.latestJob!.progress} /> : null}
          {isReady ? (
            <span className="play-pill">
              <Play size={14} aria-hidden fill="currentColor" />
              {formatCount(game.playCount)}
            </span>
          ) : null}
          <h3 className="card-title-overlay">{game.title}</h3>
        </div>
        <div className="card-body">
          <div className="card-info-line">
            <div className="card-chip-row" aria-label={tags.length ? "作品标签" : "创建日期"}>
              {infoChips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
            <span className="card-like">
              <Heart size={14} aria-hidden /> {formatCount(game.likeCount)}
            </span>
          </div>
        </div>
      </Link>
      {canMakeSimilar ? (
        <div className="game-card-quick-actions">
          <MakeSimilarButton gameId={game.id} compact />
        </div>
      ) : null}
    </article>
  );
}
