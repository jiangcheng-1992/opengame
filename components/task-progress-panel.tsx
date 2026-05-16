"use client";

import { useMemo, type ReactNode } from "react";
import { CheckCircle2, CircleDashed, LoaderCircle, XCircle } from "lucide-react";
import { useAnimatedProgress } from "@/components/progress-motion";

export type TaskStepState = "done" | "active" | "pending" | "failed";

export type TaskStep = {
  label: string;
  state: TaskStepState;
  description?: string;
};

type TaskMetaItem = {
  label: string;
  value: string;
};

type TaskResult = {
  label: string;
  tone?: "muted" | "success" | "danger";
};

function taskProgressPercent(steps: TaskStep[]) {
  if (!steps.length) return 0;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const hasActive = steps.some((step) => step.state === "active");
  const hasFailed = steps.some((step) => step.state === "failed");
  const weighted = doneCount + (hasActive ? 0.55 : 0);
  if (hasFailed) return Math.max(8, Math.round((doneCount / steps.length) * 100));
  return Math.min(100, Math.round((weighted / steps.length) * 100));
}

function taskProgressMax(steps: TaskStep[]) {
  if (!steps.length) return 0;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const hasActive = steps.some((step) => step.state === "active");
  const hasFailed = steps.some((step) => step.state === "failed");
  if (hasFailed) return taskProgressPercent(steps);
  if (!hasActive) return doneCount === steps.length ? 100 : taskProgressPercent(steps);
  return 96;
}

function TaskStepIcon({ state }: { state: TaskStepState }) {
  if (state === "done") return <CheckCircle2 size={15} aria-hidden />;
  if (state === "active") return <LoaderCircle className="spin" size={15} aria-hidden />;
  if (state === "failed") return <XCircle size={15} aria-hidden />;
  return <CircleDashed size={15} aria-hidden />;
}

export function TaskProgressPanel({
  eyebrow,
  title,
  status,
  icon,
  meta = [],
  steps,
  result,
  children,
  className = "",
  progressStarted = true,
  idleProgressLabel = "等待下一步",
  hideProgressMeter = false,
}: {
  eyebrow: string;
  title: string;
  status: string;
  icon?: ReactNode;
  meta?: TaskMetaItem[];
  steps: TaskStep[];
  result: TaskResult;
  children?: ReactNode;
  className?: string;
  progressStarted?: boolean;
  idleProgressLabel?: string;
  hideProgressMeter?: boolean;
}) {
  const progressKey = useMemo(() => steps.map((step) => `${step.label}:${step.state}`).join("|"), [steps]);
  const baseProgressPercent = taskProgressPercent(steps);
  const maxProgressPercent = taskProgressMax(steps);
  const isActive = steps.some((step) => step.state === "active");
  const effectiveProgressPercent = progressStarted ? baseProgressPercent : 0;
  const displayProgressPercent = useAnimatedProgress({
    basePercent: effectiveProgressPercent,
    maxPercent: progressStarted ? maxProgressPercent : 0,
    active: progressStarted && isActive,
    resetKey: progressKey,
    tickMs: 1800,
  });
  const progressLabel = !progressStarted
    ? idleProgressLabel
    : isActive
      ? "正在推进当前步骤"
      : displayProgressPercent === 100
        ? "全部完成"
        : "等待下一步";

  return (
    <section className={`task-card ${className}`.trim()}>
      <div className="task-card-head">
        <div>
          <p className="mini-heading">
            {icon}
            {eyebrow}
          </p>
          <h2>{title}</h2>
        </div>
        <span className="task-status-pill">{status}</span>
      </div>

      {meta.length ? (
        <dl className="task-meta">
          {meta.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="task-section">
        <h3>进度</h3>
        {!hideProgressMeter ? (
          <>
            <div className="task-progress-bar" aria-label={`总体进度 ${displayProgressPercent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayProgressPercent} role="progressbar">
              <span className={progressStarted && isActive ? "active" : ""} style={{ width: `${displayProgressPercent}%` }} />
            </div>
            <p className="task-progress-caption">{displayProgressPercent}% · {progressLabel}</p>
          </>
        ) : null}
        <ul className="task-step-list" aria-label="生成进度">
          {steps.map((step) => (
            <li key={step.label} className={step.state}>
              <TaskStepIcon state={step.state} />
              <span className="task-step-copy">
                <span>{step.label}</span>
                {step.description ? <small>{step.description}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="task-section task-result">
        <h3>生成结果</h3>
        <p className={result.tone ?? "muted"}>{result.label}</p>
      </div>

      {children ? <div className="task-card-extra">{children}</div> : null}
    </section>
  );
}
