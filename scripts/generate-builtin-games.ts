import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_GAMES } from "../lib/builtin-games";

const root = process.cwd();
const publicRoot = path.join(root, "public", "builtin-games");
const sharedRoot = path.join(publicRoot, "shared");
const enginePath = path.join(sharedRoot, "engine.js");

function pageHtml(game: (typeof BUILTIN_GAMES)[number]) {
  const config = {
    title: game.title,
    summary: game.summary,
    gameType: game.gameType,
    theme: game.theme,
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${game.title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #030609; overflow: hidden; }
    body { display: grid; place-items: center; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    canvas { width: 100vw; height: 100vh; display: block; background: ${game.theme.background}; image-rendering: pixelated; touch-action: none; }
  </style>
</head>
<body>
  <canvas id="game" width="960" height="600" aria-label="${game.title}"></canvas>
  <script>window.BUILTIN_GAME_CONFIG = ${JSON.stringify(config)};</script>
  <script src="../shared/engine.js"></script>
</body>
</html>
`;
}

async function main() {
  const engineJs = await readFile(enginePath, "utf8");
  if (!engineJs.trim()) throw new Error(`Shared engine is empty: ${enginePath}`);

  for (const game of BUILTIN_GAMES) {
    const gameRoot = path.join(publicRoot, game.slug);
    await mkdir(gameRoot, { recursive: true });
    await writeFile(path.join(gameRoot, "index.html"), pageHtml(game), "utf8");
  }

  console.log(`Generated ${BUILTIN_GAMES.length} built-in games in ${publicRoot}`);
  console.log(`Used shared engine from ${enginePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
