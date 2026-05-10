import { PrismaClient } from "@prisma/client";
import { generateGameMetadata } from "../lib/game-metadata";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const prisma = new PrismaClient();

function needsMetadata(game: {
  title: string;
  summary: string | null;
  genre: string | null;
  tags: string[];
  controls: string[];
  coverPrompt: string | null;
}) {
  return (
    !game.summary ||
    !game.genre ||
    !game.coverPrompt ||
    game.tags.length === 0 ||
    /资深|Agent|请帮我/i.test(game.title) ||
    /一、|核心要求|技术要求/.test(game.summary ?? "") ||
    game.title.length > 32
  );
}

async function main() {
  const games = await prisma.game.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      parent: { select: { title: true } },
      messages: { where: { role: "USER" }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });

  let updated = 0;

  for (const game of games) {
    if (!needsMetadata(game)) continue;

    const sourcePrompt = game.messages[0]?.content ?? game.title;
    const metadata = await generateGameMetadata(sourcePrompt, {
      sourceTitle: game.parent?.title,
      allowAI: Boolean(process.env.MINIMAX_API_KEY),
    });

    await prisma.game.update({
      where: { id: game.id },
      data: {
        title: metadata.title,
        summary: metadata.summary,
        genre: metadata.genre,
        tags: metadata.tags,
        controls: metadata.controls,
        coverPrompt: metadata.coverPrompt,
      },
    });

    updated += 1;
    console.log(`[metadata] ${game.id} -> ${metadata.title}`);
  }

  console.log(`[metadata] scanned ${games.length} games, updated ${updated}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
