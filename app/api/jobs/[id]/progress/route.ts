import { NextResponse } from "next/server";
import { getJobProgress } from "@/lib/sandbox";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const progress = await getJobProgress(id);
    return NextResponse.json(progress);
  } catch {
    return NextResponse.json({ error: "找不到这个任务。" }, { status: 404 });
  }
}
