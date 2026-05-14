import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenGame 游戏创作器",
    short_name: "OpenGame",
    description: "用提示词生成、试玩和继续修改 HTML5 小游戏。",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#faf8f3",
    theme_color: "#c96442",
    categories: ["games", "entertainment", "productivity"],
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/pwa/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "创建游戏",
        short_name: "创建",
        description: "打开游戏创作页",
        url: "/create?source=pwa-shortcut",
        icons: [{ src: "/pwa/shortcut-create.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "我的作品",
        short_name: "作品",
        description: "打开我的作品列表",
        url: "/?tab=mine&source=pwa-shortcut",
        icons: [{ src: "/pwa/shortcut-mine.png", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}
