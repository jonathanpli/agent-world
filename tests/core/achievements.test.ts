import { test, expect } from "vitest";
import type { Character, Session } from "../../src/shared/types";
import { ACHIEVEMENTS, earned } from "../../src/core/achievements";
import { xpForLevel } from "../../src/core/levels";

const NO_STATS: Character["stats"] = { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 };
const stats = (over: Partial<Character["stats"]>): Character["stats"] => ({ ...NO_STATS, ...over });
const char = (over: Partial<Character> = {}): Character => ({
  id: "c", name: "Ada", tier: 2, look: {} as Character["look"], xp: 0, createdAt: 0, lastActiveAt: 0,
  retired: false, repoXp: {}, stats: NO_STATS, achievements: {},
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 }, ...over,
});
const session = (startedAt = 0) => ({ startedAt } as Session);
const noon = new Date(2026, 0, 1, 12).getTime();
const ctx = (over: Partial<Parameters<typeof earned>[1]> = {}) => ({ at: noon, session: session(noon), levelBefore: 1, ...over });

test("the fifteen achievements", () => {
  expect(ACHIEVEMENTS.map(a => a.id).sort()).toEqual(["committed", "delegator", "early_bird", "first_commit", "first_task", "green_machine", "legend", "level_10", "level_25", "marathon", "night_owl", "repos_5", "ship_it", "tasks_100", "tools_1000"]);
});

test("first_task once only", () => {
  const c = char({ stats: stats({ tasks: 1 }) });
  expect(earned(c, ctx())).toEqual(["first_task"]);
  c.achievements.first_task = noon;
  expect(earned(c, ctx())).toEqual([]);
});

test("night_owl by local hour", () => {
  const c = char();
  expect(earned(c, ctx({ at: new Date(2026, 0, 1, 2).getTime() }))).toContain("night_owl");
  expect(earned(c, ctx({ at: new Date(2026, 0, 1, 12).getTime() }))).not.toContain("night_owl");
  expect(earned(c, ctx({ at: new Date(2026, 0, 1, 5).getTime() }))).not.toContain("night_owl");
});

test("early_bird by local hour", () => {
  const c = char();
  expect(earned(c, ctx({ at: new Date(2026, 0, 1, 6).getTime() }))).toContain("early_bird");
  expect(earned(c, ctx({ at: new Date(2026, 0, 1, 7).getTime() }))).not.toContain("early_bird");
});

test("task-time achievements need a finished task", () => {
  const at = new Date(2026, 0, 1, 2).getTime();
  expect(earned(char(), ctx({ at, finishedTask: false }))).not.toContain("night_owl");
});

test("repos_5", () => {
  const five = Object.fromEntries(["a", "b", "c", "d", "e"].map(k => [k, 1]));
  expect(earned(char({ repoXp: five }), ctx())).toContain("repos_5");
  expect(earned(char({ repoXp: { ...five, e: 0 } }), ctx())).not.toContain("repos_5");
});

test("legend", () => {
  expect(earned(char({ repoXp: { a: 6000 } }), ctx())).toContain("legend");
  expect(earned(char({ repoXp: { a: 5999 } }), ctx())).not.toContain("legend");
});

test("marathon", () => {
  const four = 4 * 3_600_000;
  expect(earned(char(), ctx({ session: session(noon - four) }))).toContain("marathon");
  expect(earned(char(), ctx({ session: session(noon - four + 1) }))).not.toContain("marathon");
});

test("level_10 and level_25", () => {
  expect(earned(char({ xp: xpForLevel(10) }), ctx())).toContain("level_10");
  expect(earned(char({ xp: xpForLevel(10) - 1 }), ctx())).not.toContain("level_10");
  expect(earned(char({ xp: xpForLevel(25) }), ctx())).toEqual(expect.arrayContaining(["level_10", "level_25"]));
  expect(earned(char({ xp: xpForLevel(25) - 1 }), ctx())).not.toContain("level_25");
});

test("tasks_100 and tools_1000", () => {
  expect(earned(char({ stats: stats({ tasks: 100, tools: 1000 }) }), ctx())).toEqual(expect.arrayContaining(["tasks_100", "tools_1000"]));
  expect(earned(char({ stats: stats({ tasks: 99, tools: 999 }) }), ctx())).not.toEqual(expect.arrayContaining(["tasks_100"]));
});

test("delegator at 25 finished sidekicks", () => {
  expect(earned(char({ stats: stats({ sidekicks: 25 }) }), ctx({ finishedTask: false }))).toContain("delegator");
  expect(earned(char({ stats: stats({ sidekicks: 24 }) }), ctx({ finishedTask: false }))).not.toContain("delegator");
  expect(ACHIEVEMENTS.find(a => a.id === "delegator")).toEqual({ id: "delegator", title: "Delegator", description: "25 sidekicks finished" });
});

test("first_commit and committed at 1 and 100 commits", () => {
  expect(earned(char(), ctx({ finishedTask: false }))).not.toContain("first_commit");
  expect(earned(char({ stats: stats({ commits: 1 }) }), ctx({ finishedTask: false }))).toContain("first_commit");
  expect(earned(char({ stats: stats({ commits: 99 }) }), ctx({ finishedTask: false }))).not.toContain("committed");
  expect(earned(char({ stats: stats({ commits: 100 }) }), ctx({ finishedTask: false }))).toContain("committed");
});

test("ship_it at the first merged pull request; opened ones do not count", () => {
  expect(earned(char({ stats: stats({ prsOpened: 5 }) }), ctx({ finishedTask: false }))).not.toContain("ship_it");
  expect(earned(char({ stats: stats({ prsMerged: 1 }) }), ctx({ finishedTask: false }))).toContain("ship_it");
});

test("green_machine at 50 passing runs; failed runs do not count", () => {
  expect(earned(char({ stats: stats({ testRuns: 50 }) }), ctx({ finishedTask: false }))).toContain("green_machine");
  expect(earned(char({ stats: stats({ testRuns: 49 }) }), ctx({ finishedTask: false }))).not.toContain("green_machine");
  expect(earned(char({ stats: stats({ testRuns: 60, testFails: 11 }) }), ctx({ finishedTask: false }))).not.toContain("green_machine");
  expect(earned(char({ stats: stats({ testRuns: 60, testFails: 10 }) }), ctx({ finishedTask: false }))).toContain("green_machine");
});

test("the moment achievements' titles", () => {
  const title = (id: string) => ACHIEVEMENTS.find(a => a.id === id)?.title;
  expect(["first_commit", "committed", "ship_it", "green_machine"].map(title)).toEqual(["First Commit", "Committed", "Ship It", "Green Machine"]);
});
