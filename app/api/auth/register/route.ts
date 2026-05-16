import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { registerAccount } from "@/lib/auth";
import { registerSchema } from "@/lib/schemas";

function uniqueConstraintMessage(error: Prisma.PrismaClientKnownRequestError) {
  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
  if (target.includes("email")) return "这个邮箱已经注册，请直接登录。";
  return "账号注册冲突，请刷新后重试。";
}

export async function POST(req: Request) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const account = await registerAccount(parsed.data);
    return NextResponse.json({
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: uniqueConstraintMessage(error) }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return NextResponse.json({ error: "账号系统数据库尚未同步，请先完成数据库更新。" }, { status: 503 });
    }
    console.error("[auth] register failed", error);
    return NextResponse.json({ error: "注册失败，请稍后重试。" }, { status: 500 });
  }
}
