import { test, expect } from "vitest";
import type { Character, Session } from "../../src/shared/types";
import { ACHIEVEMENTS, earned } from "../../src/core/achievements";
import { xpForLevel } from "../../src/core/levels";

const char = (over: Partial<Character> = {}): Character => ({
  id: "c", name: "Ada", tier: 2, look: {} as Character["look"], xp: 0, createdAt: 0, lastActiveAt: 0,
  retired: false, repoXp: {}, stats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0 }, achievements: {}, ...over,
});
const session = (startedAt = 0) => ({ startedAt } as Session);
const noon = new Date(2026, 0, 1, 12).getTime();
const ctx = (over: Partial<Parameters<typeof earned>[1]> = {}) => ({ at: noon, session: session(noon), levelBefore: 1, ...over });

test("the eleven achievements", () => {
  expect(ACHIEVEMENTS.map(a => a.id).sort()).toEqual(["delegator", "early_bird", "first_task", "legend", "level_10", "level_25", "marathon", "night_owl", "repos_5", "tasks_100", "tools_1000"]);
});

test("first_task once only", () => {
  const c = char({ stats: { tasks: 1, tools: 0, compactions: 0, sidekicks: 0 } });
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
  expect(earned(char({ stats: { tasks: 100, tools: 1000, compactions: 0, sidekicks: 0 } }), ctx())).toEqual(expect.arrayContaining(["tasks_100", "tools_1000"]));
  expect(earned(char({ stats: { tasks: 99, tools: 999, compactions: 0, sidekicks: 0 } }), ctx())).not.toEqual(expect.arrayContaining(["tasks_100"]));
});

test("delegator at 25 finished sidekicks", () => {
  const stats = (sidekicks: number) => ({ tasks: 0, tools: 0, compactions: 0, sidekicks });
  expect(earned(char({ stats: stats(25) }), ctx({ finishedTask: false }))).toContain("delegator");
  expect(earned(char({ stats: stats(24) }), ctx({ finishedTask: false }))).not.toContain("delegator");
  expect(ACHIEVEMENTS.find(a => a.id === "delegator")).toEqual({ id: "delegator", title: "Delegator", description: "25 sidekicks finished" });
});
