"use client";

import { progressForJobStatus, progressMaxForJobStatus, useAnimatedProgress } from "@/components/progress-motion";

export function GameCardProgress({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();
  const isSettled = normalizedStatus === "done" || normalizedStatus === "failed";
  const basePercent = progressForJobStatus(normalizedStatus);
  const maxPercent = progressMaxForJobStatus(normalizedStatus);
  const displayPercent = useAnimatedProgress({
    basePercent,
    maxPercent,
    active: !isSettled,
    resetKey: normalizedStatus,
    tickMs: 2400,
  });

  return (
    <div className="game-card-progress" aria-label={`任务进度 ${displayPercent}%`}>
      <span className={!isSettled ? "active" : ""} style={{ width: `${displayPercent}%` }} />
    </div>
  );
}
