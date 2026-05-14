import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AppShellNav } from "@/components/app-shell-nav";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = "G-05Z5WGWPD8";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://opengame-production.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: "OpenGame",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OpenGame",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  title: "OpenGame 游戏创作器",
  description: "用提示词生成可玩的 HTML5 小游戏。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#c96442",
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
        <Suspense fallback={null}>
          <MobileBottomNav />
        </Suspense>
        <PwaRegister />
        {AnalyticsComponent ? <AnalyticsComponent /> : null}
      </body>
    </html>
  );
}
