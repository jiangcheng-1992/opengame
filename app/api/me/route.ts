import { NextResponse } from "next/server";
import { getAnonId } from "@/lib/auth";

export async function GET() {
  const anonId = await getAnonId();
  return NextResponse.json({ anonId });
}
