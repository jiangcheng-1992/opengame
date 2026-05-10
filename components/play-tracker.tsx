"use client";

import { useEffect } from "react";

export function PlayTracker({ gameId, enabled }: { gameId: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    fetch(`/api/games/${gameId}/play`, { method: "POST" }).catch(() => undefined);
  }, [enabled, gameId]);

  return null;
}
