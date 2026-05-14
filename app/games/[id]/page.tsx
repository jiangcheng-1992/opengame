import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Heart, Play } from "lucide-react";
import { MakeSimilarButton } from "@/components/make-similar-button";
import { PlayTracker } from "@/components/play-tracker";
import { ResponsiveGameFrame } from "@/components/responsive-game-frame";
import { ShareGameButton } from "@/components/share-game-button";
import { getGameDetail } from "@/lib/games";

export const dynamic = "force-dynamic";

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

  const isBuiltin = Boolean(game.isBuiltin);
  const statusText = isBuiltin ? "内置精选 · 可玩" : statusLabel(game.status);
  const playableUrl = game.playUrl && (game.status === "ready" || isBuiltin) ? game.playUrl : null;
  const summary = game.summary ?? "进入游戏后按画面提示操作。";
  const canMakeSimilar = !game.ownedByMe && Boolean(game.playUrl) && (isBuiltin || game.status === "ready");

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
          <ShareGameButton gameId={game.id} title={game.title} summary={summary} />
        </div>
      </header>

      <section className="play-brief-card" aria-label="玩法说明">
        <span>玩法说明</span>
        <p>{summary}</p>
      </section>

      {canMakeSimilar ? (
        <section className="play-brief-card similar-action-card" aria-label="基于当前作品继续创作">
          <span>继续创作</span>
          <p>{isBuiltin ? "基于这个内置精选模板创建到你的可编辑副本，然后通过对话继续二创玩法、画面和难度。" : "基于这个公开作品创建到你的可编辑副本，然后通过对话继续调整玩法、画面和难度。"}</p>
          <MakeSimilarButton gameId={game.id} />
        </section>
      ) : null}

      <section className="game-stage play-stage" aria-label="游戏舞台">
        {playableUrl ? (
          <>
            <PlayTracker gameId={game.id} enabled={!isBuiltin} />
            <ResponsiveGameFrame
              title={game.title}
              src={playableUrl}
              shellClassName="game-frame play-game-frame-wrap responsive-game-shell"
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
    </div>
  );
}
