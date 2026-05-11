import { redirect } from "next/navigation";
import { CreateGameForm } from "@/components/create-game-form";
import { getCreateDraft, getGameDetail } from "@/lib/games";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; game?: string }>;
}) {
  const params = await searchParams;
  const draft = params.game ? await getCreateDraft(params.game) : null;
  if (params.game && !draft) {
    const game = await getGameDetail(params.game);
    if (game && !game.isBuiltin && game.ownedByMe && (game.status === "ready" || game.status === "failed" || game.playUrl)) {
      redirect(`/games/${game.id}/edit`);
    }
  }
  const draftForCreate = draft
    ? {
        id: draft.id,
        visibility: draft.visibility,
        status: draft.status,
        latestJob: draft.latestJob
          ? {
              id: draft.latestJob.id,
              status: draft.latestJob.status,
              errorMsg: draft.latestJob.errorMsg,
            }
          : null,
        messages: draft.messages?.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      }
    : null;

  return (
    <div className="page create-page">
      <CreateGameForm initialPrompt={params.prompt ?? ""} draft={draftForCreate} />
    </div>
  );
}
