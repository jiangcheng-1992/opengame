"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";

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

function statusDescription(status?: string) {
  switch (status) {
    case "queued":
      return "任务已经提交，正在等待生成 worker 接手。";
    case "running":
      return "正在把你的 brief 交给 OpenGame 生成可玩 HTML5 游戏。";
    case "validating":
      return "正在用浏览器自动试玩，确认页面能加载、输入有反馈、状态会变化。";
    case "repairing":
      return "自动试玩发现问题，正在尝试修复后重新验证。";
    case "finishing":
      return "验证已经通过，正在发布游戏文件和封面。";
    case "done":
      return "游戏已经生成完成，马上进入试玩。";
    case "failed":
      return "这次生成没有完成。保留当前需求，你可以调整后再试。";
    default:
      return "正在准备生成任务。";
  }
}

export function JobWatcher({
  initialJobId,
  initialProgress,
  completionHref,
  failureHref,
  title = "生成进度",
  variant = "panel",
}: {
  initialJobId?: string | null;
  initialProgress?: Progress | null;
  completionHref?: string;
  failureHref?: string;
  title?: string;
  variant?: "panel" | "inline";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = initialJobId ?? searchParams.get("job");
  const [progress, setProgress] = useState<Progress | null>(initialProgress ?? null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectLabel, setRedirectLabel] = useState("正在打开下一步");

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    function redirectTo(href: string, label: string) {
      setRedirectLabel(label);
      setIsRedirecting(true);
      redirectTimer = setTimeout(() => {
        if (!cancelled) router.push(href);
      }, 650);
    }

    function complete(nextProgress: Progress) {
      setProgress(nextProgress);
      router.refresh();

      if (!completionHref) return;
      redirectTo(completionHref, "完成，正在打开工作台");
    }

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
            complete({ status: "done", log: next.log });
            break;
          }

          if (finalized.status !== 409) {
            setProgress({ status: "failed", log: next.log, errorMsg: payload.error ?? "发布失败。" });
            router.refresh();
            break;
          }
        }

        if (!response.ok || next.status === "done" || next.status === "failed") {
          if (next.status === "done") {
            complete(next);
          } else {
            if (next.status === "failed" && failureHref) {
              redirectTo(failureHref, "失败，正在打开修复工作台");
              break;
            }
            router.refresh();
          }
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [completionHref, failureHref, jobId, router]);

  if (!jobId) return null;

  const isSettled = progress?.status === "done" || progress?.status === "failed";

  return (
    <section className={`job-panel ${variant === "inline" ? "inline-job-panel" : ""}`} aria-live="polite">
      <h3>{title}</h3>
      <p className="helper">
        {progress?.status === "failed" ? (
          <XCircle size={15} aria-hidden />
        ) : progress?.status === "done" ? (
          <CheckCircle2 size={15} aria-hidden />
        ) : (
          <LoaderCircle className={isSettled ? "" : "spin"} size={15} aria-hidden />
        )}
        {isRedirecting ? redirectLabel : isFinalizing ? "发布中" : statusLabel(progress?.status)}
      </p>
      <p className="job-description">{isRedirecting ? "正在切换到下一步页面。" : statusDescription(isFinalizing ? "finishing" : progress?.status)}</p>
      {progress?.errorMsg ? <p className="error">{progress.errorMsg}</p> : null}
      <pre className="log-box">
        {progress?.log || (progress?.status === "done" ? "游戏已发布。" : "等待 OpenGame 输出日志...")}
      </pre>
    </section>
  );
}
