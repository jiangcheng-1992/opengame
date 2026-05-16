import { NextResponse } from "next/server";
import { logoutAccount } from "@/lib/auth";

export async function POST() {
  await logoutAccount();
  return NextResponse.json({ ok: true });
}
