import { existsSync, readFileSync } from "node:fs";

function loadDotEnvFile(path: string, initialKeys: Set<string>) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!initialKeys.has(key)) process.env[key] = value;
  }
}

export function loadDotEnv(paths: string | string[] = [".env", ".env.local"]) {
  const initialKeys = new Set(Object.keys(process.env));
  for (const path of Array.isArray(paths) ? paths : [paths]) {
    loadDotEnvFile(path, initialKeys);
  }
}
