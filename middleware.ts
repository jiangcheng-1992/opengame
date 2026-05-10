import * as nextServer from "next/server.js";
import type { NextRequest } from "next/server";

const { NextResponse } = nextServer as typeof import("next/server");

const ANON_COOKIE = "anon_id";
const ANON_HEADER = "x-anon-id";

export function middleware(req: NextRequest) {
  const existingAnonId = req.cookies.get(ANON_COOKIE)?.value;
  const requestedAnonId = req.headers.get(ANON_HEADER);
  const anonId = existingAnonId ?? requestedAnonId ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(ANON_HEADER, anonId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!existingAnonId) {
    res.cookies.set(ANON_COOKIE, anonId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  return res;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
