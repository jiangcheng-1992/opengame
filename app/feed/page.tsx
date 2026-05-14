import { GameReelsFeed } from "@/components/game-reels-feed";
import { listGames } from "@/lib/games";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const data = await listGames("all").then((payload) => ({ ...payload, unavailable: false })).catch(() => ({
    games: [],
    nextCursor: null,
    unavailable: true,
  }));

  return (
    <div className="page mobile-feed-page">
      <section className="mobile-page-head">
        <div>
          <p className="eyebrow">信息流</p>
          <h1>上下滑切换游戏</h1>
        </div>
        <p className="helper">默认先看封面，点开后就在当前页试玩，不跳详情页。</p>
      </section>

      {data.unavailable ? (
        <section className="panel empty-panel">
          <h2>当前暂时无法加载信息流</h2>
          <p className="helper">请先检查数据库连接，再回来继续试玩。</p>
        </section>
      ) : (
        <GameReelsFeed games={data.games} />
      )}
    </div>
  );
}
