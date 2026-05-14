"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PlaySquare, PlusSquare, User } from "lucide-react";

const items = [
  { href: "/", label: "广场", icon: Home },
  { href: "/feed", label: "信息流", icon: PlaySquare },
  { href: "/create", label: "创建", icon: PlusSquare },
  { href: "/me", label: "我的", icon: User },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/me") return pathname === "/me" || (pathname.startsWith("/games/") && pathname.endsWith("/edit"));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-bottom-nav" aria-label="移动端主导航">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon size={20} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
