import Image from "next/image";
import Link from "next/link";
import { Plus, WandSparkles } from "lucide-react";
import { GameFeed } from "@/components/game-feed";
import { listGames, type MineStatusFilter, normalizeMineStatusFilter } from "@/lib/games";

export const dynamic = "force-dynamic";

const mineStatusTabs: {
  value: MineStatusFilter;
  label: string;
  heading: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}[] = [
  {
    value: "all",
    label: "全部",
    heading: "全部作品",
    description: "草稿、生成中、已完成和待修复作品都在这里。",
    emptyTitle: "还没有你的作品",
    emptyDescription: "先生成一个最小游戏，确认 OpenGame 真链路能跑，再扩展更多玩法。",
  },
  {
    value: "active",
    label: "创作中",
    heading: "创作中",
    description: "继续完善草稿，或查看正在生成的作品进度。",
    emptyTitle: "没有创作中的作品",
    emptyDescription: "新的想法会先变成草稿，再进入生成流程。",
  },
  {
    value: "ready",
    label: "已完成",
    heading: "已完成",
    description: "这些作品已经通过自动试玩，可以继续修改或打开试玩。",
    emptyTitle: "还没有已完成作品",
    emptyDescription: "作品通过自动试玩后，会出现在这里。",
  },
  {
    value: "failed",
    label: "待修复",
    heading: "待修复",
    description: "生成或自动试玩失败的作品，点进去看原因并重新生成。",
    emptyTitle: "没有待修复作品",
    emptyDescription: "失败作品会停在这里，方便你集中处理。",
  },
];

function pageHref(tab: "all" | "mine", status: MineStatusFilter) {
  const params = new URLSearchParams();
  if (tab === "mine") {
    params.set("tab", "mine");
    if (status !== "all") params.set("status", status);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function MineHero() {
  return (
    <section className="mine-hero" aria-labelledby="mine-hero-title">
      <div className="mine-hero-copy">
        <p className="eyebrow">我的</p>
        <h1 id="mine-hero-title">我的作品</h1>
        <p>继续创作草稿，修复失败作品，把已经可玩的版本再打磨一轮。</p>
        <Link href="/create" className="button primary mine-hero-action">
          <WandSparkles size={18} aria-hidden />
          新建作品
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

function MineStatusTabs({ active }: { active: MineStatusFilter }) {
  return (
    <nav className="mine-status-tabs" aria-label="我的作品状态分类">
      {mineStatusTabs.map((item) => {
        const selected = item.value === active;
        return (
          <Link
            key={item.value}
            href={pageHref("mine", item.value)}
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
  searchParams: Promise<{ tab?: string; cursor?: string; status?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "mine" ? "mine" : "all";
  const mineStatus = normalizeMineStatusFilter(params.status);
  const activeMineTab = mineStatusTabs.find((item) => item.value === mineStatus) ?? mineStatusTabs[0];
  const data = await listGames(tab, params.cursor, mineStatus)
    .then((payload) => ({ ...payload, unavailable: false }))
    .catch(() => ({
      games: [] as Awaited<ReturnType<typeof listGames>>["games"],
      nextCursor: null,
      unavailable: true,
    }));
  const games = data.games;
  const feedDescription = "内置精选和公开作品铺在同一个试玩流里，直接点开试玩或 Like。";

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
          <MineHero />
          <MineStatusTabs active={mineStatus} />
          {games.length ? (
            <section className="feed-section" aria-labelledby="mine-feed-title">
              <div className="section-head">
                <div>
                  <h2 id="mine-feed-title">{activeMineTab.heading}</h2>
                  <p>{activeMineTab.description}</p>
                </div>
              </div>
              <GameFeed
                key={`${tab}-${mineStatus}`}
                initialGames={games}
                initialNextCursor={data.nextCursor}
                tab={tab}
                mineStatus={mineStatus}
                surface="studio"
              />
            </section>
          ) : (
            <section className="panel empty-panel">
              <h2>{activeMineTab.emptyTitle}</h2>
              <p className="helper">{activeMineTab.emptyDescription}</p>
              {mineStatus === "all" ? (
                <Link href="/create" className="button primary">
                  <Plus size={18} aria-hidden />
                  创建第一个游戏
                </Link>
              ) : null}
            </section>
          )}
        </>
      ) : games.length ? (
        <section className="feed-section" aria-labelledby="home-feed-title">
          <div className="section-head">
            <div>
              <h2 id="home-feed-title">全部作品</h2>
              <p>{feedDescription}</p>
            </div>
            <Link href="/create" className="button primary feed-create-button">
              <WandSparkles size={16} aria-hidden />
              新建作品
            </Link>
          </div>
          <GameFeed
            key={`${tab}-${mineStatus}`}
            initialGames={games}
            initialNextCursor={data.nextCursor}
            tab={tab}
            mineStatus={mineStatus}
            surface="gallery"
          />
        </section>
      ) : (
        <section className="panel empty-panel">
          <h2>作品广场还是空的</h2>
          <p className="helper">先生成一个最小游戏，确认 OpenGame 真链路能跑，再扩展更多玩法。</p>
          <Link href="/create" className="button primary">
            <Plus size={18} aria-hidden />
            创建第一个游戏
          </Link>
        </section>
      )}
    </div>
  );
}
