const fs = require('fs');
function load(file) {
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[k] = v.replace(/^\uFEFF/, '');
    }
  } catch {}
}
load('.env');
load('.env.local');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const game = await prisma.game.findUnique({
    where: { id: 'cmp18dz2c0001l804m18ujr9w' },
    select: { id: true, title: true, status: true, visibility: true, version: true, playUrl: true, sourceUrl: true, ownerId: true, updatedAt: true },
  });
  console.log(JSON.stringify(game, null, 2));
  await prisma.$disconnect();
})();
