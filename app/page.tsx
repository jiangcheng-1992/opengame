import Image from "next/image";
import Link from "next/link";
import { Play, Plus, WandSparkles } from "lucide-react";
import { GameFeed } from "@/components/game-feed";
import type { GameCardGame } from "@/components/game-card";
import { hasMineGames, listGames, type MineStatusFilter, normalizeMineStatusFilter } from "@/lib/games";
import { normalizeContentTypeTab, type ContentTypeTab } from "@/lib/content-type";

export const dynamic = "force-dynamic";

const mineStatusTabs: {
  value: MineStatusFilter;
  label: string;
  emptyTitle: string;
  emptyDescription: string;
}[] = [
  {
    value: "all",
    label: "全部",
    emptyTitle: "还没有你的作品",
    emptyDescription: "先生成一个最小游戏，确认 OpenGame 真链路能跑，再扩展更多玩法。",
  },
  {
    value: "active",
    label: "创作中",
    emptyTitle: "没有创作中的作品",
    emptyDescription: "这里会显示草稿和正在生成的作品。已有作品可以在“全部”里查看。",
  },
  {
    value: "ready",
    label: "已完成",
    emptyTitle: "还没有已完成作品",
    emptyDescription: "作品生成成功并通过自动试玩后，会出现在这里。",
  },
  {
    value: "failed",
    label: "待修复",
    emptyTitle: "没有待修复作品",
    emptyDescription: "生成或自动试玩失败的作品会停在这里，方便你集中处理。",
  },
];

const contentTabs: Array<{ value: ContentTypeTab; label: string; description: string }> = [
  { value: "game", label: "游戏", description: "可玩的 HTML5 游戏作品" },
  { value: "application", label: "应用", description: "工具、展示、互动页面和轻应用" },
];

function pageHref(tab: "all" | "mine", status: MineStatusFilter, content: ContentTypeTab = "game") {
  const params = new URLSearchParams();
  if (content !== "game") params.set("content", content);
  if (tab === "mine") {
    params.set("tab", "mine");
    if (status !== "all") params.set("status", status);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function formatCount(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function gameHref(game: GameCardGame) {
  return `/games/${game.id}`;
}

function featureLabel(game: GameCardGame) {
  return game.isBuiltin ? "内置精选" : game.genre || "公开作品";
}

function FeaturedGameHeader({ games }: { games: GameCardGame[] }) {
  const hero = games[0];
  const sideGames = games.slice(1, 5);
  if (!hero) return null;

  return (
    <section className="featured-games" aria-labelledby="featured-games-title">
      <div className="section-head featured-head">
        <div>
          <h2 id="featured-games-title">今日推荐</h2>
        </div>
      </div>

      <div className="featured-layout">
        <Link href={gameHref(hero)} className="featured-hero-card" aria-label={`打开 ${hero.title}`}>
          <Image
            src={hero.coverUrl || "/playful-creator-hero.png"}
            alt={`${hero.title} 封面`}
            fill
            priority
            sizes="(max-width: 760px) calc(100vw - 28px), (max-width: 1180px) calc(100vw - 56px), 58vw"
            className="featured-cover"
          />
          <span className="featured-scrim" aria-hidden />
          <span className="featured-label">{featureLabel(hero)}</span>
          <span className="featured-play">
            <Play size={15} aria-hidden fill="currentColor" />
            {formatCount(hero.playCount)}
          </span>
          <div className="featured-copy">
            <h3>{hero.title}</h3>
            {hero.summary ? <p>{hero.summary}</p> : null}
          </div>
        </Link>

        {sideGames.length ? (
          <div className="featured-side-grid">
            {sideGames.map((game, index) => (
              <Link key={game.id} href={gameHref(game)} className="featured-mini-card" aria-label={`打开 ${game.title}`}>
                <Image
                  src={game.coverUrl || "/playful-creator-hero.png"}
                  alt={`${game.title} 封面`}
                  fill
                  priority={index < 2}
                  sizes="(max-width: 760px) calc((100vw - 40px) / 2), (max-width: 1180px) calc((100vw - 74px) / 2), 20vw"
                  className="featured-cover"
                />
                <span className="featured-scrim" aria-hidden />
                <span className="featured-label">{featureLabel(game)}</span>
                <div className="featured-mini-meta">
                  <h3>{game.title}</h3>
                  <span>
                    <Play size={13} aria-hidden fill="currentColor" />
                    {formatCount(game.playCount)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ContentTypeTabs({ active, tab, status }: { active: ContentTypeTab; tab: "all" | "mine"; status: MineStatusFilter }) {
  return (
    <nav className="content-type-tabs" aria-label="作品类型">
      {contentTabs.map((item) => {
        const selected = item.value === active;
        return (
          <Link
            key={item.value}
            href={pageHref(tab, status, item.value)}
            className={selected ? "active" : ""}
            aria-current={selected ? "page" : undefined}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MineHero() {
  return (
    <section className="mine-hero" aria-labelledby="mine-hero-title">
      <div className="mine-hero-copy">
        <p className="eyebrow">开始创作</p>
        <h1 id="mine-hero-title">创建你的第一款游戏</h1>
        <p>把一个游戏点子变成可试玩作品。先描述玩法，我们会帮你梳理清楚，再生成第一版。</p>
        <Link href="/create" className="button primary mine-hero-action">
          <WandSparkles size={18} aria-hidden />
          创建第一个游戏
        </Link>
      </div>
      <div className="mine-hero-art" aria-hidden="true">
        <Image
          src="/playful-creator-hero.png"
          alt=""
          fill
          priority
          sizes="(max-width: 760px) calc(100vw - 28px), (max-width: 1180px) 45vw, 520px"
          className="mine-hero-image"
        />
      </div>
    </section>
  );
}

function MineStatusTabs({ active, contentTab }: { active: MineStatusFilter; contentTab: ContentTypeTab }) {
  return (
    <nav className="mine-status-tabs" aria-label="我的作品状态分类">
      {mineStatusTabs.map((item) => {
        const selected = item.value === active;
        return (
          <Link
            key={item.value}
            href={pageHref("mine", item.value, contentTab)}
            className={selected ? "active" : ""}
            aria-current={selected ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cursor?: string; status?: string; content?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "mine" ? "mine" : "all";
  const mineStatus = normalizeMineStatusFilter(params.status);
  const contentTab = normalizeContentTypeTab(params.content);
  const activeMineTab = mineStatusTabs.find((item) => item.value === mineStatus) ?? mineStatusTabs[0];
  const data = await listGames(tab, params.cursor, mineStatus, tab === "mine" ? contentTab : null)
    .then((payload) => ({ ...payload, unavailable: false }))
    .catch(() => ({
      games: [] as Awaited<ReturnType<typeof listGames>>["games"],
      nextCursor: null,
      unavailable: true,
    }));
  const games = data.games;
  const featuredGames = tab === "all" ? games.slice(0, 5) : [];
  const feedGames = tab === "all" ? games.slice(featuredGames.length) : games;
  const hasAnyMineGames = !data.unavailable && tab === "mine" ? await hasMineGames().catch(() => false) : false;

  return (
    <div className="page arcade-page">
      {data.unavailable ? (
        <section className="panel empty-panel">
          <h2>本地数据库暂不可用</h2>
          <p className="helper">
            当前页面没有使用假数据。启动 PostgreSQL 并执行 `npx prisma db push` 后，我的作品会显示真实草稿和作品。
          </p>
        </section>
      ) : tab === "mine" ? (
        <>
          <ContentTypeTabs active={contentTab} tab={tab} status={mineStatus} />
          {hasAnyMineGames ? (
            <>
              <MineStatusTabs active={mineStatus} contentTab={contentTab} />
              {games.length ? (
                <section className="feed-section" aria-label="我的作品列表">
                  <GameFeed
                    key={`${tab}-${mineStatus}-${contentTab}`}
                    initialGames={games}
                    initialNextCursor={data.nextCursor}
                    tab={tab}
                    mineStatus={mineStatus}
                    contentTab={contentTab}
                    surface="studio"
                  />
                </section>
              ) : (
                <section className="panel empty-panel">
                  <h2>{activeMineTab.emptyTitle}</h2>
                  <p className="helper">{activeMineTab.emptyDescription}</p>
                </section>
              )}
            </>
          ) : (
            <MineHero />
          )}
        </>
      ) : (
        <>
          {games.length ? (
            <>
              <FeaturedGameHeader games={featuredGames} />
              {feedGames.length ? (
                <section className="feed-section" aria-labelledby="home-feed-title">
                  <div className="section-head">
                    <div>
                      <h2 id="home-feed-title">全部作品</h2>
                    </div>
                  </div>
                  <GameFeed
                    key={`${tab}-${mineStatus}-mixed`}
                    initialGames={feedGames}
                    initialNextCursor={data.nextCursor}
                    tab={tab}
                    mineStatus={mineStatus}
                    surface="gallery"
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="panel empty-panel">
              <h2>作品广场还是空的</h2>
              <p className="helper">先创建一个游戏或应用，完成后会出现在作品广场。</p>
              <Link href="/create" className="button primary">
                <Plus size={18} aria-hidden />
                创建第一个作品
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  );
}
