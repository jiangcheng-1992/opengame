"use client";

import { clampProgress, progressForJobStatus } from "@/lib/job-progress";

export function GameCardProgress({ status, progress }: { status: string; progress?: number | null }) {
  const normalizedStatus = status.toLowerCase();
  const isSettled = normalizedStatus === "done" || normalizedStatus === "failed";
  const displayPercent = clampProgress(progress ?? progressForJobStatus(normalizedStatus));

  return (
    <div className="game-card-progress" aria-label={`任务进度 ${displayPercent}%`}>
      <span className={!isSettled ? "active" : ""} style={{ width: `${displayPercent}%` }} />
    </div>
  );
}
