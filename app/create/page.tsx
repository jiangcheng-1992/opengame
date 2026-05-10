import { CreateGameForm } from "@/components/create-game-form";
import { getCreateDraft } from "@/lib/games";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; game?: string }>;
}) {
  const params = await searchParams;
  const draft = params.game ? await getCreateDraft(params.game) : null;
  const draftForCreate = draft
    ? {
        id: draft.id,
        visibility: draft.visibility,
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
