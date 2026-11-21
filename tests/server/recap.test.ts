process.env.TZ = "America/New_York";   // before anything formats a date; this file owns its worker

import { expect, test } from "vitest";
import { addDays, localDay } from "../../src/server/recap";
import { openStore, type Store } from "../../src/server/store";
import type { Character, Delta } from "../../src/shared/types";

const zero = { tasks: 0, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0 };
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00-05:00`).getTime();
const credit = (day: string, characterId: string | null, repoId: string, over: Partial<typeof zero> = {}): Delta =>
  ({ type: "credit", at: at(day), characterId, repoId, ...zero, ...over });
const char = (id: string, name: string, retired = false): Delta => ({
  type: "character", character: { id, name, tier: 1, look: {}, xp: 0, createdAt: 0, lastActiveAt: 0, retired, repoXp: {}, achievements: {},
    stats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0 } } as unknown as Character });
const repo = (id: string, name: string): Delta => ({ type: "repo", repo: { id, path: `/${name}`, name, createdAt: 0 } });
function seeded(...d: Delta[]): Store { const s = openStore(":memory:"); s.persist(d); return s; }

test("localDay splits at local midnight; addDays is calendar arithmetic across DST", () => {
  expect(localDay(new Date(2026, 5, 10, 23, 59, 59).getTime())).toBe("2026-06-10");
  expect(localDay(new Date(2026, 5, 11, 0, 0, 1).getTime())).toBe("2026-06-11");
  expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

test("empty database", () => {
  const r = openStore(":memory:").recap("2026-06-10", "2026-06-10");
  expect(r).toEqual({ day: "2026-06-10", today: "2026-06-10", totals: zero, characters: [], repos: [], mvpCharacterId: null, streak: 0, prevDay: null, nextDay: null });
});

test("credits aggregate per day and repo; temp counts in totals and repos only; retired characters keep their name", () => {
  const s = seeded(char("a", "Ada"), char("b", "Bo", true), repo("r1", "alpha"), repo("r2", "beta"),
    credit("2026-06-10", "a", "r1", { tasks: 1, tools: 5, xp: 10 }),
    credit("2026-06-10", "a", "r1", { tasks: 1, tools: 2, xp: 5, levels: 1 }),
    credit("2026-06-10", "b", "r2", { tasks: 1, tools: 9, xp: 3, failures: 1 }),
    credit("2026-06-10", null, "r2", { tasks: 2, tools: 1, xp: 99, compactions: 1, sidekicks: 2 }),
    credit("2026-06-09", "a", "r1", { tasks: 4, xp: 40 }));
  const r = s.recap("2026-06-10", "2026-06-10");
  expect(r.totals).toEqual({ tasks: 5, tools: 17, failures: 1, xp: 117, levels: 1, compactions: 1, sidekicks: 2 });
  expect(r.characters.map(c => [c.characterId, c.name, c.xp])).toEqual([["a", "Ada", 15], ["b", "Bo", 3]]);
  expect(r.repos.map(x => [x.repoId, x.name, x.tasks, x.tools])).toEqual([["r2", "beta", 3, 10], ["r1", "alpha", 2, 7]]);
  expect(r.mvpCharacterId).toBe("a");
  expect(r.prevDay).toBe("2026-06-09");
  expect(s.recap("2026-06-09", "2026-06-10").totals.tasks).toBe(4);
});

test("a temp is never MVP, and zero xp gives no MVP", () => {
  const s = seeded(char("a", "Ada"), credit("2026-06-10", null, "r", { xp: 500, tasks: 1 }), credit("2026-06-10", "a", "r", { tasks: 1 }));
  expect(s.recap("2026-06-10", "2026-06-10").mvpCharacterId).toBeNull();
});

test("MVP ties: most tasks, then name", () => {
  const d = (aTasks: number, bTasks: number) => seeded(char("a", "Zed"), char("b", "Amy"),
    credit("2026-06-10", "a", "r", { xp: 10, tasks: aTasks }), credit("2026-06-10", "b", "r", { xp: 10, tasks: bTasks }))
    .recap("2026-06-10", "2026-06-10").mvpCharacterId;
  expect(d(3, 1)).toBe("a");
  expect(d(1, 1)).toBe("b");
});

test("streak", () => {
  const days = (...ds: string[]) => seeded(...ds.map(x => credit(x, null, "r", { tasks: 1 }))).recap("2026-06-10", "2026-06-10").streak;
  expect(days()).toBe(0);
  expect(days("2026-06-10")).toBe(1);
  expect(days("2026-06-09", "2026-06-08")).toBe(2);              // today empty: counts from yesterday
  expect(days("2026-06-10", "2026-06-09", "2026-06-07")).toBe(2); // gap breaks it
  expect(days("2026-06-08")).toBe(0);
  expect(seeded(credit("2026-06-10", null, "r", { xp: 5 })).recap("2026-06-10", "2026-06-10").streak).toBe(0);
});

test("prevDay and nextDay skip empty days", () => {
  const s = seeded(credit("2026-06-01", null, "r", { tasks: 1 }), credit("2026-06-05", null, "r", { tasks: 1 }), credit("2026-06-09", null, "r", { tasks: 1 }));
  const r = s.recap("2026-06-05", "2026-06-10");
  expect([r.prevDay, r.nextDay]).toEqual(["2026-06-01", "2026-06-09"]);
  const e = s.recap("2026-06-07", "2026-06-10");
  expect([e.prevDay, e.nextDay]).toEqual(["2026-06-05", "2026-06-09"]);
  expect(s.recap("2026-06-09", "2026-06-10").nextDay).toBeNull();
});
