import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Heart, Play } from "lucide-react";
import { GameActions } from "@/components/game-actions";
import { PlayTracker } from "@/components/play-tracker";
import { getGameDetail } from "@/lib/games";

export const dynamic = "force-dynamic";

function uniqueLabels(labels: Array<string | null | undefined>, count: number) {
  const seen = new Set<string>();
  return labels
    .filter((label): label is string => Boolean(label))
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
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

function statusLabel(status: string) {
  switch (status) {
    case "ready":
      return "可玩";
    case "failed":
      return "暂不可玩";
    default:
      return "暂不可玩";
  }
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const game = await getGameDetail(id);

  if (!game) notFound();

  const tags = uniqueLabels([game.genre, ...(game.tags ?? []), ...(game.controls ?? [])], 6);
  const isBuiltin = Boolean(game.isBuiltin);
  const statusText = isBuiltin ? "内置精选 · 可玩" : statusLabel(game.status);
  const playableUrl = game.playUrl && (game.status === "ready" || isBuiltin) ? game.playUrl : null;
  const summary = game.summary ?? "试玩这个作品，喜欢就点 Like。";

  return (
    <div className="page detail-page immersive-detail-page">
      <header className="play-topbar" aria-label="游戏播放器信息">
        <Link href="/" className="button secondary play-back">
          <ArrowLeft size={17} aria-hidden />
          返回作品广场
        </Link>

        <div className="play-title">
          <p className="eyebrow">{statusText}</p>
          <h1>{game.title}</h1>
        </div>

        <div className="detail-stats play-stats" aria-label="作品数据">
          <span>
            <Play size={15} aria-hidden /> {game.playCount}
          </span>
          <span>
            <Heart size={15} aria-hidden /> {game.likeCount}
          </span>
        </div>
      </header>

      <section className="game-stage play-stage" aria-label="游戏舞台">
        {playableUrl ? (
          <>
            <PlayTracker gameId={game.id} enabled={!isBuiltin} />
            <iframe
              title={game.title}
              src={playableUrl}
              sandbox="allow-scripts allow-same-origin allow-pointer-lock"
              allow="autoplay; fullscreen; gamepad"
              className="game-frame"
            />
          </>
        ) : (
          <div className="empty-frame">
            <div>
              <h2>游戏暂不可玩</h2>
              <p className="helper">公共游玩页只展示已经通过自动试玩验证的版本。</p>
            </div>
          </div>
        )}
      </section>

      <div className="play-below">
        <GameActions
          gameId={game.id}
          liked={game.likedByMe}
          isBuiltin={isBuiltin}
        />

        <section className="panel play-info-panel" aria-labelledby="play-info-heading">
          <div>
            <p className="eyebrow">作品信息</p>
            <h2 id="play-info-heading">玩法说明</h2>
          </div>
          <p className="lede">{summary}</p>
          {tags.length ? (
            <div className="tag-row large" aria-label="作品标签">
              {tags.map((tag) => (
                <span key={tag}>{displayLabel(tag)}</span>
              ))}
            </div>
          ) : null}
        </section>

        {isBuiltin ? (
          <details className="support-panel play-support-panel">
            <summary>内置说明</summary>
            <div className="message-list">
              <article className="message">
                <div className="message-role">SOURCE</div>
                <p>这是项目内置精选游戏，用来保证新用户进入作品广场后可以立即试玩。它不是 OpenGame 真实生成结果。</p>
              </article>
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
