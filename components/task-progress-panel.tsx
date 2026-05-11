import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, LoaderCircle, XCircle } from "lucide-react";

export type TaskStepState = "done" | "active" | "pending" | "failed";

export type TaskStep = {
  label: string;
  state: TaskStepState;
};

type TaskMetaItem = {
  label: string;
  value: string;
};

type TaskResult = {
  label: string;
  tone?: "muted" | "success" | "danger";
};

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
}) {
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
        <ul className="task-step-list" aria-label="生成进度">
          {steps.map((step) => (
            <li key={step.label} className={step.state}>
              <TaskStepIcon state={step.state} />
              <span>{step.label}</span>
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
