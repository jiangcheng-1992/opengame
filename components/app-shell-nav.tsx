"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles, WandSparkles } from "lucide-react";
import { PwaInstallButton } from "@/components/pwa-install-button";

function isActive(href: string, pathname: string, tab: string | null) {
  if (href === "/") return pathname === "/" && tab !== "mine";
  if (href === "/feed") return pathname === "/feed";
  if (href === "/create") return pathname === "/create";
  if (href === "/me") return pathname === "/me" || (pathname === "/" && tab === "mine") || (pathname.startsWith("/games/") && pathname.endsWith("/edit"));
  return pathname.startsWith(href);
}

const navItems = [
  { href: "/", label: "广场" },
  { href: "/feed", label: "信息流" },
  { href: "/create", label: "创建" },
  { href: "/me", label: "我的" },
];

export function AppShellNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  useEffect(() => {
    for (const item of navItems) {
      router.prefetch(item.href);
    }
  }, [router]);

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

        <div className="top-actions">
          <PwaInstallButton />
          <Link href="/create" className="button primary top-create-button">
            <WandSparkles size={17} aria-hidden />
          创建游戏
          </Link>
        </div>
      </div>
    </header>
  );
}
