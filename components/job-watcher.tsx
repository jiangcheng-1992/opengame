"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";

type Progress = {
  status: string;
  log?: string;
  errorMsg?: string | null;
  error?: string;
};

function statusLabel(status?: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "validating":
      return "自动试玩中";
    case "repairing":
      return "自动修复中";
    case "finishing":
      return "发布中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "准备中";
  }
}

export function JobWatcher({
  initialJobId,
  initialProgress,
}: {
  initialJobId?: string | null;
  initialProgress?: Progress | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = initialJobId ?? searchParams.get("job");
  const [progress, setProgress] = useState<Progress | null>(initialProgress ?? null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    async function tick() {
      while (!cancelled) {
        const response = await fetch(`/api/jobs/${jobId}/progress`, { cache: "no-store" });
        const next = (await response.json().catch(() => ({ error: "进度读取失败。" }))) as Progress;
        if (cancelled) return;
        setProgress(response.ok ? next : { status: "failed", errorMsg: next.error ?? "任务不存在。" });

        if (response.ok && next.status === "finishing") {
          setIsFinalizing(true);
          const finalized = await fetch(`/api/jobs/${jobId}/finalize`, { method: "POST" });
          const payload = (await finalized.json().catch(() => ({}))) as { error?: string };
          setIsFinalizing(false);

          if (finalized.ok) {
            setProgress({ status: "done", log: next.log });
            router.refresh();
            break;
          }

          if (finalized.status !== 409) {
            setProgress({ status: "failed", log: next.log, errorMsg: payload.error ?? "发布失败。" });
            router.refresh();
            break;
          }
        }

        if (!response.ok || next.status === "done" || next.status === "failed") {
          router.refresh();
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  if (!jobId) return null;

  const isSettled = progress?.status === "done" || progress?.status === "failed";

  return (
    <section className="job-panel" aria-live="polite">
      <h3>生成进度</h3>
      <p className="helper">
        <LoaderCircle className={isSettled ? "" : "spin"} size={15} aria-hidden />
        {isFinalizing ? "发布中" : statusLabel(progress?.status)}
      </p>
      {progress?.errorMsg ? <p className="error">{progress.errorMsg}</p> : null}
      <pre className="log-box">
        {progress?.log || (progress?.status === "done" ? "游戏已发布。" : "等待 OpenGame 输出日志...")}
      </pre>
    </section>
  );
}
