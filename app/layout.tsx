import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AppShellNav } from "@/components/app-shell-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenGame 游戏创作器",
  description: "用提示词生成可玩的 HTML5 小游戏。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const AnalyticsComponent =
    process.env.NODE_ENV === "production"
      ? (await import("@vercel/analytics/next")).Analytics
      : null;

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Suspense fallback={null}>
          <AppShellNav />
        </Suspense>
        <main className="app-main">{children}</main>
        {AnalyticsComponent ? <AnalyticsComponent /> : null}
      </body>
    </html>
  );
}
