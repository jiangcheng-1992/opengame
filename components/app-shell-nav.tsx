"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Gamepad2, Home, Library, PlusCircle, Sparkles } from "lucide-react";

function isActive(href: string, pathname: string, tab: string | null) {
  if (href === "/") return pathname === "/" && tab !== "mine";
  if (href === "/?tab=mine") return pathname === "/" && tab === "mine";
  return pathname.startsWith(href);
}

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/create", label: "创建", icon: PlusCircle },
  { href: "/?tab=mine", label: "工作室", icon: Library },
];

export function AppShellNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  return (
    <>
      <aside className="app-sidebar" aria-label="主导航">
        <Link href="/" className="brand" aria-label="OpenGame 游戏厅首页">
          <span className="brand-mark">
            <Sparkles size={24} aria-hidden />
          </span>
          <span>OpenGame</span>
        </Link>

        <nav className="side-nav" aria-label="桌面主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, pathname, tab);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <Icon size={25} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-status" aria-label="当前身份">
          <span className="sidebar-status-icon">
            <Gamepad2 size={20} aria-hidden />
          </span>
          <span>
            <strong>匿名模式</strong>
            <small>草稿自动保存</small>
          </span>
        </div>
      </aside>

      <nav className="mobile-tabbar" aria-label="移动端主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, pathname, tab);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={20} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
