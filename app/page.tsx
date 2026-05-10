import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { GameCard } from "@/components/game-card";
import { listGames } from "@/lib/games";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "mine" ? "mine" : "all";
  const data = await listGames(tab, params.cursor)
    .then((payload) => ({ ...payload, unavailable: false }))
    .catch(() => ({
      games: [] as Awaited<ReturnType<typeof listGames>>["games"],
      nextCursor: null,
      unavailable: true,
    }));
  const games = data.games;
  const feedTitle = tab === "mine" ? "我的作品" : "全部作品";
  const feedDescription =
    tab === "mine"
      ? "你当前匿名身份下创建、继续修改和发布过的作品，按最近生成时间铺开。"
      : "内置精选和公开作品铺在同一个试玩流里，直接点开试玩或 Like。";

  return (
    <div className="page arcade-page">
      {data.unavailable ? (
        <section className="panel empty-panel">
          <h2>本地数据库暂不可用</h2>
          <p className="helper">
            当前页面没有使用假数据。启动 PostgreSQL 并执行 `npx prisma db push` 后，我的作品会显示真实草稿和作品。
          </p>
        </section>
      ) : games.length ? (
        <section className="feed-section" aria-labelledby="home-feed-title">
          <div className="section-head">
            <div>
              <h2 id="home-feed-title">{feedTitle}</h2>
              <p>{feedDescription}</p>
            </div>
            <Link href="/create" className="text-link">
              新建作品 <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
          <div className="feed-grid">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      ) : (
        <section className="panel empty-panel">
          <h2>{tab === "mine" ? "还没有你的作品" : "作品广场还是空的"}</h2>
          <p className="helper">先生成一个最小游戏，确认 OpenGame 真链路能跑，再扩展更多玩法。</p>
          <Link href="/create" className="button primary">
            <Plus size={18} aria-hidden />
            创建第一个游戏
          </Link>
        </section>
      )}

      {data.nextCursor ? (
        <div className="toolbar">
          <Link href={`/?tab=${tab}&cursor=${data.nextCursor}`} className="button secondary">
            下一页
          </Link>
        </div>
      ) : null}
    </div>
  );
}
