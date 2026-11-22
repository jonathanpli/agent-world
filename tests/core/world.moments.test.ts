import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Delta, EventKind, MomentKind } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;
const credits = (ds: Delta[]) => ds.flatMap(d => (d.type === "credit" ? [d] : []));
const moments = (ds: Delta[]) => ds.flatMap(d => (d.type === "notice" && d.notice.kind === "moment" ? [d.notice] : []));
const REPO = "/r/agent-world";
const HOUR = 3_600_000;

function bare(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  const e = ev(kind, over);
  if (!("tier" in over)) delete e.tier;
  return e;
}
/** A Bash tool event carrying `moment`. */
const bash = (moment: MomentKind, over: Partial<AgentEvent> = {}, momentText?: string): AgentEvent =>
  ev("tool", { repoPath: REPO, moment, detail: { tool: "Bash", toolKind: "shell", ...(momentText !== undefined && { momentText }) }, ...over });

function bound(sessionId = "s1"): World {
  const w = newWorld();
  w.apply(ev("session_start", { at: 0, repoPath: REPO, sessionId }));
  return w;
}
const xpOf = (ds: Delta[]) => credits(ds).reduce((n, c) => n + c.xp, 0);

test.each([
  ["commit", 10, { commits: 1 }],
  ["pr_opened", 20, { prsOpened: 1 }],
  ["pr_merged", 40, { prsMerged: 1 }],
  ["tests_passed", 5, { testRuns: 1 }],
  ["push", 0, {}],
] as const)("%s earns %i XP on top of the tool and counts", (moment, xp, counted) => {
  const w = bound();
  const ds = w.apply(bash(moment, { at: 1000 }));
  const none = { commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 };
  expect(credits(ds)).toEqual([expect.objectContaining({ tools: 1, xp: CONFIG.xp.tool + xp, ...none, ...counted })]);
  expect(chars(w)[0]!.stats).toMatchObject({ tools: 1, ...none, ...counted });
  expect(chars(w)[0]!.xp).toBe(CONFIG.xp.tool + xp);
});

test("the moment XP table", () => {
  expect(CONFIG.moments).toEqual({
    xp: { commit: 10, pr_opened: 20, pr_merged: 40, tests_passed: 5 },
    caps: { commit: [6, HOUR], pr_opened: [2, HOUR], pr_merged: [2, HOUR], tests_passed: [1, 300_000] },
  });
});

test("the 7th commit within an hour earns 0 but still counts and still has its notice", () => {
  const w = bound();
  const t0 = 1000;
  for (let i = 0; i < 6; i++) expect(xpOf(w.apply(bash("commit", { at: t0 + i * 60_000 })))).toBe(CONFIG.xp.tool + 10);
  const seventh = w.apply(bash("commit", { at: t0 + 30 * 60_000 }));
  expect(xpOf(seventh)).toBe(CONFIG.xp.tool);
  expect(credits(seventh)[0]!.commits).toBe(1);
  expect(moments(seventh)).toHaveLength(1);
  expect(chars(w)[0]!.stats.commits).toBe(7);
  expect(sess(w)[0]!.moments.commit).toHaveLength(6);
});

test("a commit at +3 600 001 ms after the first earns again; at +3 600 000 it does not", () => {
  const w = bound();
  const t0 = 1000;
  for (let i = 0; i < 6; i++) w.apply(bash("commit", { at: t0 + i * 60_000 }));
  expect(xpOf(w.apply(bash("commit", { at: t0 + HOUR })))).toBe(CONFIG.xp.tool);
  expect(xpOf(w.apply(bash("commit", { at: t0 + HOUR + 1 })))).toBe(CONFIG.xp.tool + 10);
});

test("tests_passed earns once per 300 000 ms", () => {
  const w = bound();
  expect(xpOf(w.apply(bash("tests_passed", { at: 1000 })))).toBe(CONFIG.xp.tool + 5);
  expect(xpOf(w.apply(bash("tests_passed", { at: 1000 + 300_000 })))).toBe(CONFIG.xp.tool);
  expect(xpOf(w.apply(bash("tests_passed", { at: 1000 + 300_001 })))).toBe(CONFIG.xp.tool + 5);
  expect(chars(w)[0]!.stats.testRuns).toBe(3);
});

test("pull request caps: two per hour each", () => {
  const w = bound();
  const gains = [0, 1, 2].map(i => xpOf(w.apply(bash("pr_merged", { at: 1000 + i * 60_000 }))));
  expect(gains).toEqual([CONFIG.xp.tool + 40, CONFIG.xp.tool + 40, CONFIG.xp.tool]);
  const opened = [0, 1, 2].map(i => xpOf(w.apply(bash("pr_opened", { at: 500_000 + i * 60_000 }))));
  expect(opened).toEqual([CONFIG.xp.tool + 20, CONFIG.xp.tool + 20, CONFIG.xp.tool]);
});

test("caps are per session", () => {
  const w = bound();
  w.apply(ev("session_start", { at: 0, repoPath: REPO, sessionId: "s2" }));
  expect(xpOf(w.apply(bash("tests_passed", { at: 1000 })))).toBe(CONFIG.xp.tool + 5);
  expect(xpOf(w.apply(bash("tests_passed", { at: 2000, sessionId: "s2" })))).toBe(CONFIG.xp.tool + 5);
  expect(xpOf(w.apply(bash("tests_passed", { at: 3000 })))).toBe(CONFIG.xp.tool);
});

test("a temp earns no moment XP but counts its moments and gets its notice", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start", { repoPath: REPO }));
  w.apply(ev("session_start", { sessionId: "s2", repoPath: REPO }));
  const ds = w.apply(bash("commit", { sessionId: "s2", at: 2000 }, "fix the gauge"));
  expect(credits(ds)).toEqual([expect.objectContaining({ characterId: null, xp: 0, commits: 1, tools: 1 })]);
  expect(moments(ds).map(n => n.text)).toEqual(["Temp committed in agent-world: fix the gauge"]);
  expect(sess(w)[1]!.moments).toEqual({});
});

test("a failed tool with tests_failed earns nothing and counts a test run and a failure", () => {
  const w = bound();
  const ds = w.apply(bash("tests_failed", { at: 1000, failed: true }));
  expect(credits(ds)).toEqual([expect.objectContaining({ xp: 0, tools: 0, failures: 1, testRuns: 1, testFails: 1 })]);
  expect(chars(w)[0]!.stats).toMatchObject({ testRuns: 1, testFails: 1 });
});

test("an Arriving session holds moment XP and counters and credits them on binding", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 0, repoPath: REPO }));
  expect(credits(w.apply(bare("tool", { at: 1000, repoPath: REPO, moment: "commit", detail: { tool: "Bash" } })))).toEqual([]);
  expect(sess(w)[0]!.pendingStats.commits).toBe(1);
  const ds = w.apply(bare("prompt", { at: 2000, repoPath: REPO, tier: 2 }));
  expect(credits(ds)).toEqual([expect.objectContaining({ commits: 1, xp: CONFIG.xp.tool + 10 + CONFIG.xp.prompt })]);
  expect(chars(w)[0]!.stats.commits).toBe(1);
});

test("a subagent's moment is credited to the session's agent", () => {
  const w = bound();
  const ds = w.apply(bash("pr_merged", { at: 1000, detail: { tool: "Bash", agentId: "a1", agentType: "Explore" } }));
  expect(credits(ds)).toEqual([expect.objectContaining({ characterId: chars(w)[0]!.id, prsMerged: 1, xp: CONFIG.xp.tool + 40 })]);
});

test.each([
  ["commit", "Ada committed in agent-world"],
  ["push", "Ada pushed in agent-world"],
  ["pr_opened", "Ada opened a pull request in agent-world"],
  ["pr_merged", "Ada merged a pull request in agent-world"],
  ["tests_passed", "Ada's tests passed in agent-world"],
  ["tests_failed", "Ada's tests failed in agent-world"],
] as const)("the %s notice reads %j, with momentText after a colon", (moment, text) => {
  for (const momentText of [undefined, "fix the gauge"]) {
    const w = bound();
    w.updateCharacter(chars(w)[0]!.id, { name: "Ada" });
    const ds = w.apply(bash(moment, { at: 1000, ...(moment === "tests_failed" && { failed: true as const }) }, momentText));
    const want = momentText === undefined ? text : `${text}: ${momentText}`;
    expect(moments(ds)).toEqual([expect.objectContaining({
      kind: "moment", moment, text: want, characterName: "Ada", characterId: chars(w)[0]!.id, sessionKey: "t:s1", repoName: "agent-world",
    })]);
    expect(sess(w)[0]!.activity.at(-1)).toEqual({ at: 1000, kind: "tool", text: want });
  }
});

test("a moment adds an activity line after the tool's own", () => {
  const w = bound();
  w.apply(ev("tool", { at: 1000, repoPath: REPO, moment: "push", detail: { tool: "Bash", summary: "git push" } }));
  expect(sess(w)[0]!.activity.slice(-2).map(a => a.text)).toEqual(["git push", `${chars(w)[0]!.name} pushed in agent-world`]);
});

test("a tool event without a moment emits no moment notice and counts nothing new", () => {
  const w = bound();
  const ds = w.apply(ev("tool", { at: 1000, repoPath: REPO }));
  expect(moments(ds)).toEqual([]);
  expect(credits(ds)[0]).toMatchObject({ commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 });
});

test("moment achievements are earned through the world", () => {
  const w = bound();
  const ds = w.apply(bash("commit", { at: 1000 }));
  const merged = w.apply(bash("pr_merged", { at: 2000 }));
  const titles = (x: Delta[]) => x.flatMap(d => (d.type === "notice" && d.notice.kind === "achievement" ? [d.notice.text] : []));
  expect(titles(ds)).toEqual([`${chars(w)[0]!.name} earned First Commit`]);
  expect(titles(merged)).toEqual([`${chars(w)[0]!.name} earned Ship It`]);
  expect(Object.keys(chars(w)[0]!.achievements).sort()).toEqual(["first_commit", "ship_it"]);
});
