import { NextRequest, NextResponse } from "next/server";
import { getSuperAiFactoryLocalRuntimeStatus, runSuperAiFactory } from "@/lib/super-ai-factory";

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "超级 AI 工厂未授权。" }, { status: 401 });
}

function bearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || req.headers.get("x-super-ai-factory-token")?.trim() || "";
}

function verifyFactoryToken(req: NextRequest) {
  const expected = process.env.SUPER_AI_FACTORY_TOKEN?.trim();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  return bearerToken(req) === expected;
}

export async function GET(req: NextRequest) {
  if (!verifyFactoryToken(req)) return unauthorized();
  return NextResponse.json({
    ok: true,
    product: "OpenGame Super AI Factory",
    description: "自动策划短视频爆款风格小游戏/轻应用，并交给 OpenGame 生成和自动试玩校验。",
    enabled: Boolean(process.env.SUPER_AI_FACTORY_TOKEN || process.env.NODE_ENV !== "production"),
    runtime: getSuperAiFactoryLocalRuntimeStatus(),
  });
}

export async function POST(req: NextRequest) {
  if (!verifyFactoryToken(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const batchSize = Number.isFinite(Number(body?.batchSize)) ? Number(body.batchSize) : undefined;
  const dryRun = body?.dryRun === true;

  const result = await runSuperAiFactory({ batchSize, dryRun });
  return NextResponse.json(result, { status: result.ok === false ? 503 : 200 });
}
