export const JOB_PROGRESS = {
  queued: 6,
  running: 28,
  validating: 72,
  repairing: 82,
  finishing: 94,
  done: 100,
  failed: 100,
} as const;

export function clampProgress(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

export function progressForJobStatus(status?: string | null, isFinalizing = false) {
  if (isFinalizing) return JOB_PROGRESS.finishing;
  const key = status?.toLowerCase() as keyof typeof JOB_PROGRESS | undefined;
  return key && key in JOB_PROGRESS ? JOB_PROGRESS[key] : 0;
}

export function progressMaxForJobStatus(status?: string | null, isFinalizing = false) {
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

export function progressFromPhaseAndLog(status?: string | null, log = "") {
  const normalizedStatus = status?.toLowerCase();
  const normalizedLog = log.toLowerCase();
  let progress = progressForJobStatus(normalizedStatus);

  if (normalizedStatus === "queued") {
    if (/queued github actions workflow|queued locally|queued for github actions/.test(normalizedLog)) progress = 8;
  }

  if (normalizedStatus === "running") {
    if (/\[setup\]/.test(normalizedLog)) progress = Math.max(progress, 18);
    if (/installing opengame|npm install|npm run build/.test(normalizedLog)) progress = Math.max(progress, 24);
    if (/starting generation|running continue pass/.test(normalizedLog)) progress = Math.max(progress, 35);
    if (/open(game)?|generated|index\.html/.test(normalizedLog)) progress = Math.max(progress, 52);
    if (/spec\.md created|complete game implementation|build the complete game|creating the game|create the html5 game|implement the game/.test(normalizedLog)) progress = Math.max(progress, 60);
    if (/implementation complete|wrote index\.html|created index\.html|game implementation/.test(normalizedLog)) progress = Math.max(progress, 66);
  }

  if (normalizedStatus === "validating") {
    if (/headless chromium|opening generated game/.test(normalizedLog)) progress = Math.max(progress, 74);
    if (/validation passed|build is ready to publish/.test(normalizedLog)) progress = Math.max(progress, 90);
  }

  if (normalizedStatus === "repairing") {
    if (/repair|retry|regenerating/.test(normalizedLog)) progress = Math.max(progress, 84);
  }

  if (normalizedStatus === "finishing") {
    if (/uploading playable files|game published|published/.test(normalizedLog)) progress = Math.max(progress, 96);
  }

  return clampProgress(progress);
}

export function mergeProgress(current: unknown, next: unknown) {
  return Math.max(clampProgress(current), clampProgress(next));
}
