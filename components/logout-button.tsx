"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
      router.push("/me");
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="button secondary logout-button" type="button" onClick={() => void logout()} disabled={pending}>
      <LogOut size={16} aria-hidden />
      {pending ? "退出中..." : "退出登录"}
    </button>
  );
}
