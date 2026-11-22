import type { DatabaseSync } from "node:sqlite";
import type { Recap, RecapTotals } from "../shared/types";

export type { Recap, RecapTotals };

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** "YYYY-MM-DD" in the server's local time zone. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar arithmetic on a "YYYY-MM-DD" day; done in UTC so a DST change never moves it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** True for a real calendar day written "YYYY-MM-DD". */
export function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

export const TEMP_ID = "temp";
/** The daily columns and the RecapTotals key each sums into. */
const COLS = [
  ["tasks", "tasks"], ["tools", "tools"], ["failures", "failures"], ["xp", "xp"], ["levels", "levels"],
  ["compactions", "compactions"], ["sidekicks", "sidekicks"], ["commits", "commits"], ["prs_opened", "prsOpened"],
  ["prs_merged", "prsMerged"], ["test_runs", "testRuns"], ["test_fails", "testFails"], ["input", "input"], ["output", "output"],
  ["cache_read", "cacheRead"], ["cache_write", "cacheWrite"], ["cache_write_1h", "cacheWrite1h"], ["cost_micros", "costMicros"],
] as const satisfies readonly (readonly [string, keyof RecapTotals])[];
const sums = (table: string) => COLS.map(([c, k]) => `SUM(${table}${c}) AS ${k}`).join(", ");
const totalsOf = (r: Record<string, unknown>): RecapTotals =>
  Object.fromEntries(COLS.map(([, k]) => [k, Number(r[k] ?? 0)])) as RecapTotals;

export function buildRecap(db: DatabaseSync, day: string, today: string): Recap {
  const one = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
  const totals = totalsOf(one(`SELECT ${sums("")} FROM daily WHERE day = ?`, day) ?? {});   // no rows: every SUM is NULL, read as 0

  const characters = (db.prepare(
    `SELECT d.character_id AS id, COALESCE(c.name, d.character_id) AS name, ${sums("d.")}
     FROM daily d LEFT JOIN characters c ON c.id = d.character_id
     WHERE d.day = ? AND d.character_id <> ? GROUP BY d.character_id`).all(day, TEMP_ID) as Record<string, unknown>[])
    .map(r => ({ characterId: String(r.id), name: String(r.name), ...totalsOf(r) }))
    .sort((a, b) => b.xp - a.xp || b.tasks - a.tasks || a.name.localeCompare(b.name));

  const repos = (db.prepare(
    `SELECT d.repo_id AS id, COALESCE(r.name, d.repo_id) AS name, ${sums("d.")}
     FROM daily d LEFT JOIN repos r ON r.id = d.repo_id WHERE d.day = ? GROUP BY d.repo_id`).all(day) as Record<string, unknown>[])
    .map(r => ({ repoId: String(r.id), name: String(r.name), ...totalsOf(r) }))
    .sort((a, b) => b.tasks - a.tasks || b.tools - a.tools || a.name.localeCompare(b.name));

  // characters are already ordered xp desc, tasks desc, name: the first with xp > 0 is the MVP
  const mvpCharacterId = characters[0] !== undefined && characters[0].xp > 0 ? characters[0].characterId : null;

  const taskDays = new Set((db.prepare("SELECT day FROM daily GROUP BY day HAVING SUM(tasks) > 0").all() as { day: string }[]).map(r => r.day));
  let cursor = taskDays.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (taskDays.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const prev = one("SELECT MAX(day) AS d FROM daily WHERE day < ?", day);
  const next = one("SELECT MIN(day) AS d FROM daily WHERE day > ?", day);
  return {
    day, today, totals, characters, repos, mvpCharacterId, streak,
    prevDay: (prev?.d as string | null | undefined) ?? null, nextDay: (next?.d as string | null | undefined) ?? null,
  };
}
