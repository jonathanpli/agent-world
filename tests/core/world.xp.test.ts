import { test, expect } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { Delta } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;

test("xp per event, credited overall and per repo", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  w.apply(ev("prompt")); w.apply(ev("tool")); w.apply(ev("task_done"));
  const c = chars(w)[0]; const repoId = sess(w)[0].repoId;
  expect(c.xp).toBe(32); expect(c.repoXp[repoId]).toBe(32); expect(c.stats).toEqual({ tasks: 1, tools: 1, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 });
});

test("tool xp caps at 60 per minute per session", () => {
  const w = newWorld(); w.apply(ev("session_start", { at: 0 }));
  for (let i = 0; i < 40; i++) w.apply(ev("tool", { at: i * 1000 }));
  expect(chars(w)[0].xp).toBe(60); expect(chars(w)[0].stats.tools).toBe(40);
  w.apply(ev("tool", { at: 60_000 })); expect(chars(w)[0].xp).toBe(62);
});

test("tool window is per session and restarts after the session is removed", () => {
  const w = newWorld(); w.apply(ev("session_start", { at: 0 }));
  for (let i = 0; i < 40; i++) w.apply(ev("tool", { at: i * 100 }));
  expect(chars(w)[0].xp).toBe(60);
  w.apply(ev("tool", { sessionId: "s2", at: 5000, tier: 2 }));          // other session has its own window
  expect(chars(w).reduce((n, c) => n + c.xp, 0)).toBe(62);
  w.apply(ev("session_end", { at: 5000 }));
  w.apply(ev("tool", { at: 6000, tier: 2 }));                           // fresh window, not the old exhausted one
  expect(chars(w).reduce((n, c) => n + c.xp, 0)).toBe(64);
});

test("temps earn nothing", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start"));
  w.apply(ev("session_start", { sessionId: "s2" }));
  const before = chars(w)[0].xp;
  for (let i = 0; i < 5; i++) w.apply(ev("task_done", { sessionId: "s2", at: 20_000 * i }));
  expect(sess(w).find(s => s.sessionId === "s2")!.characterId).toBeNull();
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0].xp).toBe(before);
  expect(chars(w)[0].stats).toEqual({ tasks: 0, tools: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 });
});

test("level up emits one notice", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  const notices: Delta[] = [];
  for (let i = 0; i < 7; i++) notices.push(...w.apply(ev("task_done", { at: 20_000 * i })));   // 175 xp >= 152
  const ups = notices.filter(d => d.type === "notice" && d.notice.kind === "level_up");
  expect(ups).toHaveLength(1);
  const name = chars(w)[0].name;
  expect((ups[0] as any).notice.text).toBe(`${name} reached level 2`);
});

test("xp follows the repo of the event", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  w.apply(ev("task_done", { repoPath: "/r/a", at: 1000 }));
  w.apply(ev("task_done", { repoPath: "/r/b", at: 30_000 }));
  const repos = w.snapshot(0, false).repos;
  const c = chars(w)[0];
  expect(repos).toHaveLength(2);
  for (const r of repos) expect(c.repoXp[r.id]).toBe(25);
});

test("character delta is emitted once per event, after the notices' changes", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  const d = w.apply(ev("task_done"));
  expect(d.filter(x => x.type === "character")).toHaveLength(1);
  const ch = d.find(x => x.type === "character")!;
  expect(ch.type === "character" && ch.character.achievements.first_task).toBe(1000);
  expect(d.filter(x => x.type === "notice" && x.notice.kind === "achievement")).toHaveLength(1);
  const n = d.find(x => x.type === "notice" && x.notice.kind === "achievement")!;
  expect(n.type === "notice" && n.notice.text).toBe(`${chars(w)[0].name} earned First Task`);
  const again = w.apply(ev("task_done", { at: 30_000 }));
  expect(again.filter(x => x.type === "notice" && x.notice.kind === "achievement")).toHaveLength(0);
});

test("snapshot stays exactly the shared shape", () => {
  const w = newWorld(); w.apply(ev("tool"));
  expect(Object.keys(sess(w)[0]).sort()).toEqual(["activity", "attention", "characterId", "context", "effort", "graceSince", "key", "lastEventAt", "lastSummary", "lastTool", "model", "moments", "pendingStats", "pendingUsage", "pendingXp", "repoId", "sessionId", "sidekicks", "source", "startedAt", "state", "stateSince", "task", "tempLook", "tier", "tierKnown", "usage"]);
});
