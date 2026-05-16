import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { loginAccount } from "@/lib/auth";
import { loginSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const account = await loginAccount(parsed.data);
    if (!account) {
      return NextResponse.json({ error: "邮箱或密码不正确。" }, { status: 401 });
    }

    return NextResponse.json({
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return NextResponse.json({ error: "账号系统数据库尚未同步，请先完成数据库更新。" }, { status: 503 });
    }
    console.error("[auth] login failed", error);
    return NextResponse.json({ error: "登录失败，请稍后重试。" }, { status: 500 });
  }
}
