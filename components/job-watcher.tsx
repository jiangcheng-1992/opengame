"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, CheckCircle2, LoaderCircle, ScrollText, XCircle } from "lucide-react";
import { clampProgress, progressForJobStatus, progressMaxForJobStatus } from "@/lib/job-progress";

type Progress = {
  status: string;
  log?: string;
  errorMsg?: string | null;
  error?: string;
  progress?: number;
  nextJobId?: string;
  retrying?: boolean;
  blocker?: {
    kind: string;
    title: string;
    body: string;
    actions?: string[];
  } | null;
};

function statusLabel(status?: string) {
  switch (status?.toLowerCase()) {
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
  switch (status?.toLowerCase()) {
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

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
}

export function JobWatcher({
  initialJobId,
  initialProgress,
  completionHref,
  failureHref,
  title = "生成进度",
  variant = "panel",
  logDefaultOpen = false,
}: {
  initialJobId?: string | null;
  initialProgress?: Progress | null;
  completionHref?: string;
  failureHref?: string;
  title?: string;
  variant?: "panel" | "inline";
  logDefaultOpen?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedJobId = initialJobId ?? searchParams.get("job");
  const [jobId, setJobId] = useState<string | null>(requestedJobId);
  const [progress, setProgress] = useState<Progress | null>(initialProgress ?? null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectLabel, setRedirectLabel] = useState("正在打开下一步");
  const [isLogOpen, setIsLogOpen] = useState(logDefaultOpen);
  const [isBlockerOpen, setIsBlockerOpen] = useState(false);
  const [dismissedBlockerKey, setDismissedBlockerKey] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const normalizedStatus = progress?.status?.toLowerCase();
  const isSettled = normalizedStatus === "done" || normalizedStatus === "failed";
  const logText = progress?.log || (normalizedStatus === "done" ? "游戏已发布。" : "等待 OpenGame 输出日志...");
  const serverPercent = clampProgress(progress?.progress ?? progressForJobStatus(normalizedStatus, isFinalizing));
  const stageMaxPercent = clampProgress(progressMaxForJobStatus(normalizedStatus, isFinalizing));
  const [displayPercent, setDisplayPercent] = useState(serverPercent);
  const elapsedText = isSettled ? "" : `已运行 ${formatElapsed(now - startedAt)}`;
  const blocker = progress?.blocker ?? null;
  const blockerKey = blocker ? `${jobId ?? "none"}:${blocker.kind}:${blocker.title}` : null;

  useEffect(() => {
    setDisplayPercent((current) => (isSettled ? serverPercent : Math.max(current, serverPercent)));
  }, [isSettled, serverPercent]);

  useEffect(() => {
    setDisplayPercent(serverPercent);
  }, [jobId]);

  useEffect(() => {
    if (isSettled) return;
    if (displayPercent >= stageMaxPercent) return;
    const timer = setInterval(() => {
      setDisplayPercent((current) => {
        const floor = Math.max(current, serverPercent);
        if (floor >= stageMaxPercent) return floor;
        return Math.min(stageMaxPercent, floor + 1);
      });
    }, 1200);
    return () => clearInterval(timer);
  }, [displayPercent, isSettled, serverPercent, stageMaxPercent]);

  useEffect(() => {
    setJobId(requestedJobId);
    setStartedAt(Date.now());
  }, [requestedJobId]);

  useEffect(() => {
    if (!blocker || !blockerKey) return;
    if (dismissedBlockerKey === blockerKey) return;
    setIsBlockerOpen(true);
  }, [blocker, blockerKey, dismissedBlockerKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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

        if (response.ok && next.nextJobId && next.nextJobId !== jobId) {
          setJobId(next.nextJobId);
          setProgress(next);
          router.refresh();
          break;
        }

        if (response.ok && next.status === "finishing") {
          setIsFinalizing(true);
          const finalized = await fetch(`/api/jobs/${jobId}/finalize`, { method: "POST" });
          const payload = (await finalized.json().catch(() => ({}))) as Progress;
          setIsFinalizing(false);

          if (finalized.ok && payload.nextJobId && payload.nextJobId !== jobId) {
            setJobId(payload.nextJobId);
            setProgress(payload);
            router.refresh();
            break;
          }

          if (finalized.ok) {
            complete({ status: "done", progress: progressForJobStatus("done"), log: next.log });
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

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [completionHref, failureHref, jobId, router]);

  if (!jobId) return null;

  return (
    <section className={`job-panel ${variant === "inline" ? "inline-job-panel" : ""}`} aria-live="polite">
      <h3>{title}</h3>
      <p className="helper">
        {normalizedStatus === "failed" ? (
          <XCircle size={15} aria-hidden />
        ) : normalizedStatus === "done" ? (
          <CheckCircle2 size={15} aria-hidden />
        ) : (
          <LoaderCircle className={isSettled ? "" : "spin"} size={15} aria-hidden />
        )}
        {isRedirecting ? redirectLabel : isFinalizing ? "发布中" : statusLabel(normalizedStatus)}
      </p>
      <p className="job-description">{isRedirecting ? "正在切换到下一步页面。" : statusDescription(isFinalizing ? "finishing" : normalizedStatus)}</p>
      <div className="job-progress-wrap">
        <div className="job-progress-meta">
          <span>{isFinalizing ? "发布中" : statusLabel(normalizedStatus)}</span>
          <span>{displayPercent}%{elapsedText ? ` · ${elapsedText}` : ""}</span>
        </div>
        <div className="job-progress-bar" role="progressbar" aria-label={`运行进度 ${displayPercent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}>
          <span className={!isSettled ? "active" : ""} style={{ width: `${displayPercent}%` }} />
        </div>
      </div>
      {progress?.errorMsg ? <p className="error">{progress.errorMsg}</p> : null}
      {blocker && isBlockerOpen ? (
        <div className="job-blocker-dialog" role="alertdialog" aria-live="assertive" aria-label={blocker.title}>
          <div className="job-blocker-head">
            <strong>{blocker.title}</strong>
            <span>需要确认</span>
          </div>
          <p>{blocker.body}</p>
          {blocker.actions?.length ? (
            <ul className="job-blocker-list" aria-label="建议动作">
              {blocker.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : null}
          <div className="job-blocker-actions">
            <button
              className="button button-ghost"
              type="button"
              onClick={() => {
                setIsLogOpen(true);
                setIsBlockerOpen(false);
                setDismissedBlockerKey(blockerKey);
              }}
            >
              展开日志
            </button>
            {failureHref ? (
              <button className="button button-ghost" type="button" onClick={() => router.push(failureHref)}>
                返回工作台
              </button>
            ) : null}
            <button
              className="button"
              type="button"
              onClick={() => {
                setIsBlockerOpen(false);
                setDismissedBlockerKey(blockerKey);
              }}
            >
              继续等待
            </button>
          </div>
        </div>
      ) : null}
      <div className="job-log">
        <button className="job-log-toggle" type="button" onClick={() => setIsLogOpen((current) => !current)} aria-expanded={isLogOpen}>
          <span>
            <ScrollText size={15} aria-hidden />
            运行日志
          </span>
          <ChevronDown className={isLogOpen ? "open" : ""} size={16} aria-hidden />
        </button>
        {isLogOpen ? <pre className="log-box">{logText}</pre> : null}
      </div>
    </section>
  );
}
