import { put } from "@vercel/blob";
import type { GameMetadata } from "@/lib/game-metadata";

type ImageAspectRatio = "1:1" | "16:9";

async function generateImageBlob({
  blobPath,
  prompt,
  aspectRatio,
}: {
  blobPath: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
}) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1";
  if (!apiKey) return null;

  const response = await fetch(`${baseUrl}/image_generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "image-01",
      prompt,
      aspect_ratio: aspectRatio,
      response_format: "url",
      n: 1,
      prompt_optimizer: true,
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    data?: { image_urls?: string[] };
  };
  const imageUrl = payload.data?.image_urls?.[0];
  if (!imageUrl) return null;

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) return null;

  const blob = await put(blobPath, imageResponse.body!, {
    access: "public",
    contentType: imageResponse.headers.get("content-type") ?? "image/png",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return blob.url;
}

export async function generateCoverImage(gameId: string, metadata: Pick<GameMetadata, "title" | "summary" | "coverPrompt">) {
  const prompt =
    metadata.coverPrompt ||
    `A polished bright arcade game cover for "${metadata.title}", ${metadata.summary}, clear gameplay subject, vibrant but readable, no text overlay.`;

  return generateImageBlob({
    blobPath: `games/${gameId}/cover.png`,
    prompt,
    aspectRatio: "16:9",
  });
}

export async function generateGameArtImage({
  gameId,
  name,
  prompt,
  aspectRatio,
}: {
  gameId: string;
  name: "background" | "spritesheet";
  prompt: string;
  aspectRatio: ImageAspectRatio;
}) {
  return generateImageBlob({
    blobPath: `games/${gameId}/art/${name}.png`,
    prompt,
    aspectRatio,
  });
}
