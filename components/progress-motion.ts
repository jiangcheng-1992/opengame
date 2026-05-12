"use client";

import { useEffect, useState } from "react";

type AnimatedProgressInput = {
  basePercent: number;
  maxPercent: number;
  active: boolean;
  resetKey: string;
  tickMs: number;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function useAnimatedProgress({ basePercent, maxPercent, active, resetKey, tickMs }: AnimatedProgressInput) {
  const normalizedBase = clampPercent(basePercent);
  const normalizedMax = clampPercent(Math.max(basePercent, maxPercent));
  const [displayPercent, setDisplayPercent] = useState(normalizedBase);

  useEffect(() => {
    setDisplayPercent(normalizedBase);
  }, [normalizedBase, resetKey]);

  useEffect(() => {
    if (!active || normalizedBase >= normalizedMax) return;
    const timer = setInterval(() => {
      setDisplayPercent((current) => {
        if (current >= normalizedMax) return Math.max(normalizedBase, normalizedMax - 2);
        return Math.min(normalizedMax, current + 1);
      });
    }, tickMs);
    return () => clearInterval(timer);
  }, [active, normalizedBase, normalizedMax, resetKey, tickMs]);

  return displayPercent;
}

export function progressForJobStatus(status?: string, isFinalizing = false) {
  if (isFinalizing) return 92;
  switch (status?.toLowerCase()) {
    case "queued":
      return 12;
    case "running":
      return 42;
    case "validating":
      return 70;
    case "repairing":
      return 78;
    case "finishing":
      return 92;
    case "done":
    case "failed":
      return 100;
    default:
      return 6;
  }
}

export function progressMaxForJobStatus(status?: string, isFinalizing = false) {
  if (isFinalizing) return 97;
  switch (status?.toLowerCase()) {
    case "queued":
      return 28;
    case "running":
      return 68;
    case "validating":
      return 82;
    case "repairing":
      return 88;
    case "finishing":
      return 97;
    case "done":
    case "failed":
      return 100;
    default:
      return 12;
  }
}
