import { GameReelsFeed, type PangleFeedAdConfig } from "@/components/game-reels-feed";
import { listGames } from "@/lib/games";
import { normalizeContentTypeTab, type ContentTypeTab } from "@/lib/content-type";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pangleFeedAdConfig(): PangleFeedAdConfig | null {
  const appId = process.env.NEXT_PUBLIC_PANGLE_APP_ID?.trim();
  const slotId = process.env.NEXT_PUBLIC_PANGLE_FEED_SLOT_ID?.trim();
  const sdkUrl = process.env.NEXT_PUBLIC_PANGLE_SDK_URL?.trim();
  if (!appId || !slotId || !sdkUrl) return null;

  return {
    appId,
    slotId,
    sdkUrl,
    interval: Math.max(2, Number(process.env.NEXT_PUBLIC_PANGLE_FEED_INTERVAL || 4)),
    startIndex: Math.max(2, Number(process.env.NEXT_PUBLIC_PANGLE_FEED_START_INDEX || 3)),
  };
}

function feedTabHref(content: ContentTypeTab) {
  return content === "application" ? "/feed?content=application" : "/feed";
}

function FeedTypeTabs({ active }: { active: ContentTypeTab }) {
  const tabs: Array<{ value: ContentTypeTab; label: string }> = [
    { value: "game", label: "游戏" },
    { value: "application", label: "应用" },
  ];

  return (
    <nav className="feed-type-tabs" aria-label="信息流类型">
      {tabs.map((tab) => {
        const selected = active === tab.value;
        return (
          <Link key={tab.value} href={feedTabHref(tab.value)} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ content?: string }> }) {
  const params = await searchParams;
  const contentTab = normalizeContentTypeTab(params.content);
  const data = await listGames("all", null, "all", contentTab).then((payload) => ({ ...payload, unavailable: false })).catch(() => ({
    games: [],
    nextCursor: null,
    unavailable: true,
  }));
  const pangleFeedAd = pangleFeedAdConfig();

  return (
    <div className="page mobile-feed-page immersive-feed-page">
      <FeedTypeTabs active={contentTab} />
      {data.unavailable ? (
        <section className="panel empty-panel">
          <h2>当前暂时无法加载信息流</h2>
          <p className="helper">请先检查数据库连接，再回来继续试玩。</p>
        </section>
      ) : (
        <GameReelsFeed games={data.games} pangleFeedAd={pangleFeedAd} />
      )}
    </div>
  );
}
