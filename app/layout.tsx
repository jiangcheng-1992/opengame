import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AppShellNav } from "@/components/app-shell-nav";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = "G-05Z5WGWPD8";

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
  const shouldLoadAnalytics = process.env.NODE_ENV === "production";

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {shouldLoadAnalytics ? (
          <>
            <script
              src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`}
              async
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  window.gtag = gtag;
                  gtag('js', new Date());
                  gtag('config', '${GOOGLE_ANALYTICS_ID}');
                `,
              }}
            />
          </>
        ) : null}
      </head>
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
