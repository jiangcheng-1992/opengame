const fs = require("fs");
const path = require("path");

function load(file) {
  try {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value.replace(/^\uFEFF/, "");
    }
  } catch {}
}

load(".env");
load(".env.local");

const { put } = require("@vercel/blob");
const { PrismaClient } = require("@prisma/client");

const gameIds = [
  "cmp6d0g7f0001pvq0e7046a6q",
  "cmp6s731m0001pvm84eqynqhk",
];

(async () => {
  const prisma = new PrismaClient();
  const results = [];

  for (const gameId of gameIds) {
    const root = path.join("tmp-audit-fixes", gameId);
    const html = fs.readFileSync(path.join(root, "index.html"));
    const zip = fs.readFileSync(path.join(root, "source.zip"));
    const htmlBlob = await put(`games/${gameId}/play/index.html`, html, {
      access: "public",
      contentType: "text/html; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const sourceBlob = await put(`games/${gameId}/source.zip`, zip, {
      access: "public",
      contentType: "application/zip",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const game = await prisma.game.update({
      where: { id: gameId },
      data: {
        playUrl: htmlBlob.url,
        sourceUrl: sourceBlob.url,
        status: "READY",
        version: { increment: 1 },
      },
      select: { id: true, title: true, version: true, playUrl: true, sourceUrl: true },
    });
    results.push(game);
  }

  await prisma.$disconnect();
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
