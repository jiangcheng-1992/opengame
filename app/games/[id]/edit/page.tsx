import { notFound, redirect } from "next/navigation";
import { EditGameWorkbench } from "@/components/edit-game-workbench";
import { getGameDetail } from "@/lib/games";

export const dynamic = "force-dynamic";

function canOpenEditWorkbench(game: NonNullable<Awaited<ReturnType<typeof getGameDetail>>>) {
  return !game.isBuiltin && game.ownedByMe && (game.status === "ready" || game.status === "failed" || (game.status === "generating" && game.playUrl));
}

function canRedirectToPublicPlay(game: NonNullable<Awaited<ReturnType<typeof getGameDetail>>>) {
  return Boolean(game.isBuiltin || (game.visibility === "public" && game.status === "ready" && game.playUrl));
}

export default async function EditGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = await getGameDetail(id);

  if (!game) notFound();

  if (!canOpenEditWorkbench(game)) {
    if (canRedirectToPublicPlay(game)) redirect(`/games/${id}`);
    notFound();
  }

  return (
    <div className="page edit-page">
      <EditGameWorkbench
        game={{
          id: game.id,
          title: game.title,
          summary: game.summary,
          status: game.status,
          visibility: game.visibility,
          playUrl: game.playUrl,
          version: game.version,
          updatedAt: game.updatedAt.toISOString(),
          controls: game.controls,
          genre: game.genre,
          tags: game.tags,
          latestJob: game.latestJob
            ? {
                id: game.latestJob.id,
                status: game.latestJob.status,
                errorMsg: game.latestJob.errorMsg,
              }
            : null,
        }}
      />
    </div>
  );
}
