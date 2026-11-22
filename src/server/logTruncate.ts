import { statSync, truncateSync } from "node:fs";

/** Empties the log when it is over maxBytes; a missing or unreadable file is left alone. */
export function truncateLog(path: string, maxBytes: number): void {
  try {
    if (statSync(path).size > maxBytes) truncateSync(path, 0);
  } catch { /* no log yet, or not ours to change */ }
}
