"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Sparkles, WandSparkles } from "lucide-react";

function isActive(href: string, pathname: string, tab: string | null) {
  if (href === "/") return pathname === "/" && tab !== "mine";
  if (href === "/?tab=mine") return (pathname === "/" && tab === "mine") || (pathname.startsWith("/games/") && pathname.endsWith("/edit"));
  return pathname.startsWith(href);
}

const navItems = [
  { href: "/", label: "广场" },
  { href: "/?tab=mine", label: "我的" },
];

export function AppShellNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  return (
    <header className="app-topbar" aria-label="主导航">
      <div className="app-topbar-inner">
        <Link href="/" className="brand" aria-label="OpenGame 游戏厅首页">
          <span className="brand-mark">
            <Sparkles size={24} aria-hidden />
          </span>
          <span>OpenGame</span>
        </Link>

        <nav className="top-nav" aria-label="主导航">
          {navItems.map((item) => {
            const active = isActive(item.href, pathname, tab);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <Link href="/create" className="button primary top-create-button">
          <WandSparkles size={17} aria-hidden />
          创建游戏
        </Link>
      </div>
    </header>
  );
}
