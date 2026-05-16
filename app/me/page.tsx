import Image from "next/image";
import Link from "next/link";
import { WandSparkles } from "lucide-react";
import { AuthPanel } from "@/components/auth-panel";
import { GameFeed } from "@/components/game-feed";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentAccount } from "@/lib/auth";
import { hasMineGames, listGames, type MineStatusFilter, normalizeMineStatusFilter } from "@/lib/games";

export const dynamic = "force-dynamic";

const mineStatusTabs: {
  value: MineStatusFilter;
  label: string;
  emptyTitle: string;
  emptyDescription: string;
}[] = [
  { value: "all", label: "全部", emptyTitle: "还没有你的作品", emptyDescription: "先生成一个最小游戏，确认 OpenGame 真链路能跑，再扩展更多玩法。" },
  { value: "active", label: "创作中", emptyTitle: "没有创作中的作品", emptyDescription: "这里会显示草稿和正在生成的作品。已有作品可以在“全部”里查看。" },
  { value: "ready", label: "已完成", emptyTitle: "还没有已完成作品", emptyDescription: "作品生成成功并通过自动试玩后，会出现在这里。" },
  { value: "failed", label: "待修复", emptyTitle: "没有待修复作品", emptyDescription: "生成或自动试玩失败的作品会停在这里，方便你集中处理。" },
];

function pageHref(status: MineStatusFilter) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  const query = params.toString();
  return query ? `/me?${query}` : "/me";
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

function MineStatusTabs({ active }: { active: MineStatusFilter }) {
  return (
    <nav className="mine-status-tabs" aria-label="我的作品状态分类">
      {mineStatusTabs.map((item) => {
        const selected = item.value === active;
        return (
          <Link key={item.value} href={pageHref(item.value)} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string; next?: string }>;
}) {
  const params = await searchParams;
  const account = await getCurrentAccount();
  const nextPath = params.next?.startsWith("/") ? params.next : "/create";
  if (!account) {
    return (
      <div className="page me-page">
        <AuthPanel nextPath={nextPath} />
      </div>
    );
  }

  const mineStatus = normalizeMineStatusFilter(params.status);
  const activeMineTab = mineStatusTabs.find((item) => item.value === mineStatus) ?? mineStatusTabs[0];
  const data = await listGames("mine", params.cursor, mineStatus)
    .then((payload) => ({ ...payload, unavailable: false }))
    .catch(() => ({ games: [], nextCursor: null, unavailable: true }));
  const hasAnyMineGames = !data.unavailable ? await hasMineGames().catch(() => false) : false;

  return (
    <div className="page me-page">
      <section className="mobile-page-head">
        <div>
          <p className="eyebrow">我的</p>
          <h1>{account.displayName || account.email} 的作品</h1>
        </div>
        <div className="mine-account-row">
          <p className="helper">已登录：{account.email}。继续修改、修失败作品、查看已完成版本都从这里进入。</p>
          <LogoutButton />
        </div>
      </section>

      {data.unavailable ? (
        <section className="panel empty-panel">
          <h2>本地数据库暂不可用</h2>
          <p className="helper">当前页面没有使用假数据。启动 PostgreSQL 并执行 `npx prisma db push` 后，我的作品会显示真实草稿和作品。</p>
        </section>
      ) : hasAnyMineGames ? (
        <>
          <MineStatusTabs active={mineStatus} />
          {data.games.length ? (
            <section className="feed-section" aria-label="我的作品列表">
              <GameFeed initialGames={data.games} initialNextCursor={data.nextCursor} tab="mine" mineStatus={mineStatus} surface="studio" />
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
    </div>
  );
}
