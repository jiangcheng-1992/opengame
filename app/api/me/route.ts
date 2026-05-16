import { NextResponse } from "next/server";
import { getAnonId, getCurrentAccount } from "@/lib/auth";

export async function GET() {
  const [anonId, account] = await Promise.all([getAnonId(), getCurrentAccount()]);
  return NextResponse.json({
    anonId,
    account: account
      ? {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          primaryAnonId: account.primaryAnonId,
        }
      : null,
  });
}
