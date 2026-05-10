import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function targetUrl(path: string[]) {
  const baseUrl = (process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const normalizedPath = path[0] === "v1" ? path.slice(1) : path;
  return `${baseUrl}/${normalizedPath.map(encodeURIComponent).join("/")}`;
}

async function proxy(req: NextRequest, context: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await context.params;
  const job = await prisma.job.findFirst({
    where: {
      id,
      sandboxId: { startsWith: "github:" },
      status: { in: ["QUEUED", "RUNNING", "VALIDATING", "REPAIRING", "FINISHING"] },
    },
    select: { id: true },
  });

  if (!job) {
    return Response.json({ error: "Job is not active." }, { status: 404 });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Missing MINIMAX_API_KEY." }, { status: 500 });
  }

  const response = await fetch(targetUrl(path), {
    method: req.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": req.headers.get("content-type") ?? "application/json",
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
