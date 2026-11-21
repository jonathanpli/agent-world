import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Delta, EventKind } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { xpForLevel } from "../../src/core/levels";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;
const credits = (ds: Delta[]) => ds.flatMap(d => (d.type === "credit" ? [d] : []));

/** A bound session in the working state. */
function working(at = 1000): World {
  const w = newWorld();
  w.apply(ev("session_start", { at }));
  w.apply(ev("prompt", { at, detail: { text: "go" } }));
  return w;
}

const subStart = (agentId: string, over: Partial<AgentEvent> = {}) => ev("sub_start", { detail: { agentId, agentType: "Explore" }, ...over });
const subEnd = (agentId: string, over: Partial<AgentEvent> = {}) => ev("sub_end", { detail: { agentId, agentType: "Explore" }, ...over });

/** An event that carries no tier, like a real Claude Code SessionStart or UserPromptSubmit. */
function bare(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  const e = ev(kind, over);
  if (!("tier" in over)) delete e.tier;
  return e;
}

test("sub_start adds a sidekick; a repeat with the same id refreshes lastAt only", () => {
  const w = working();
  w.apply(subStart("a1", { at: 2000 }));
  expect(sess(w)[0]!.sidekicks).toEqual([{ id: "a1", type: "Explore", since: 2000, lastAt: 2000 }]);
  w.apply(subStart("a1", { at: 3000, detail: { agentId: "a1", agentType: "Plan" } }));
  expect(sess(w)[0]!.sidekicks).toEqual([{ id: "a1", type: "Explore", since: 2000, lastAt: 3000 }]);
});

test("sub_end removes the sidekick and counts it once; an unknown id changes nothing", () => {
  const w = working();
  w.apply(subStart("a1", { at: 2000 }));
  const before = sess(w)[0]!;
  const unknown = w.apply(subEnd("zz", { at: 2500 }));
  expect(credits(unknown)).toEqual([]);
  expect(sess(w)[0]!.sidekicks).toEqual(before.sidekicks);
  expect(chars(w)[0]!.stats.sidekicks).toBe(0);
  w.apply(subEnd("a1", { at: 3000 }));
  expect(sess(w)[0]!.sidekicks).toEqual([]);
  expect(chars(w)[0]!.stats.sidekicks).toBe(1);
  w.apply(subEnd("a1", { at: 3500 }));
  expect(chars(w)[0]!.stats.sidekicks).toBe(1);
});

test("a tool with an unknown agent id creates the sidekick; a known id refreshes lastAt", () => {
  const w = working();
  w.apply(ev("tool", { at: 2000, detail: { tool: "Read", toolKind: "read", agentId: "a1", agentType: "general-purpose" } }));
  expect(sess(w)[0]!.sidekicks).toEqual([{ id: "a1", type: "general-purpose", since: 2000, lastAt: 2000 }]);
  w.apply(ev("tool", { at: 3000, detail: { tool: "Read", toolKind: "read", agentId: "a1", agentType: "general-purpose" } }));
  expect(sess(w)[0]!.sidekicks).toEqual([{ id: "a1", type: "general-purpose", since: 2000, lastAt: 3000 }]);
  w.apply(ev("tool", { at: 4000, detail: { tool: "Read", agentId: "a2" } }));
  expect(sess(w)[0]!.sidekicks[1]).toEqual({ id: "a2", type: "agent", since: 4000, lastAt: 4000 });
});

test("every tool sets lastTool", () => {
  const w = working();
  w.apply(ev("tool", { at: 2000, detail: { tool: "Bash", toolKind: "shell" } }));
  expect(sess(w)[0]!.lastTool).toEqual({ kind: "shell", at: 2000, failed: false, agentId: null });
  w.apply(ev("tool", { at: 3000, failed: true, detail: { tool: "Edit", toolKind: "edit", agentId: "a1", agentType: "Explore" } }));
  expect(sess(w)[0]!.lastTool).toEqual({ kind: "edit", at: 3000, failed: true, agentId: "a1" });
  w.apply(ev("tool", { at: 4000, detail: { tool: "mystery" } }));
  expect(sess(w)[0]!.lastTool).toEqual({ kind: "other", at: 4000, failed: false, agentId: null });
});

test("a new session has no sidekicks and no last tool", () => {
  const w = newWorld();
  w.apply(ev("session_start"));
  expect(sess(w)[0]).toMatchObject({ sidekicks: [], lastTool: null });
  expect(chars(w)[0]!.stats).toEqual({ tasks: 0, tools: 0, compactions: 0, sidekicks: 0 });
});

test("a failed tool earns nothing, counts a failure, and reads 'Failed: '", () => {
  const w = working();
  const xp = chars(w)[0]!.xp;
  const ds = w.apply(ev("tool", { at: 2000, failed: true, detail: { tool: "Bash", summary: "Bash npm test", toolKind: "shell" } }));
  expect(chars(w)[0]!.xp).toBe(xp);
  expect(chars(w)[0]!.stats.tools).toBe(0);
  expect(sess(w)[0]!.activity.at(-1)!.text).toBe("Failed: Bash npm test");
  expect(credits(ds)).toHaveLength(1);
  expect(credits(ds)[0]).toMatchObject({ failures: 1, tools: 0, xp: 0, levels: 0 });
});

test("a failed tool moves state exactly as a successful one", () => {
  const setups: Record<string, (w: World) => void> = {
    done: w => { w.apply(ev("task_done", { at: 2000 })); },
    idle: w => { w.apply(ev("task_done", { at: 2000 })); w.tick(2000 + CONFIG.doneToIdleMs); },
    needs_input: w => { w.apply(ev("needs_input", { at: 2000 })); },
  };
  for (const [state, setup] of Object.entries(setups)) {
    const ok = working(); setup(ok);
    const bad = working(); setup(bad);
    expect(sess(ok)[0]!.state).toBe(state);
    const at = 2000 + CONFIG.doneToIdleMs + 1;
    ok.apply(ev("tool", { at, detail: { tool: "Bash" } }));
    bad.apply(ev("tool", { at, failed: true, detail: { tool: "Bash" } }));
    const pick = (w: World) => { const s = sess(w)[0]!; return { state: s.state, stateSince: s.stateSince, attention: s.attention }; };
    expect(pick(bad)).toEqual(pick(ok));
  }
});

test("a successful subagent tool earns the parent the usual XP", () => {
  const w = working();
  const xp = chars(w)[0]!.xp;
  w.apply(ev("tool", { at: 2000, detail: { tool: "Read", toolKind: "read", agentId: "a1", agentType: "Explore" } }));
  expect(chars(w)[0]!.xp).toBe(xp + CONFIG.xp.tool);
  expect(chars(w)[0]!.stats.tools).toBe(1);
});

test("session_end clears sidekicks", () => {
  const w = working();
  w.apply(subStart("a1", { at: 2000 }));
  w.apply(ev("session_end", { at: 3000 }));
  expect(sess(w)).toEqual([]);
  w.apply(ev("session_start", { at: 4000 }));
  expect(sess(w)[0]!.sidekicks).toEqual([]);
});

test("tick drops stale sidekicks, keeps fresh ones, and counts nothing", () => {
  const w = working();
  w.apply(subStart("old", { at: 2000 }));
  w.apply(subStart("new", { at: 5000 }));
  expect(w.tick(2000 + CONFIG.sidekickStaleMs)).toEqual([]);             // exactly at the limit: kept
  const ds = w.tick(2001 + CONFIG.sidekickStaleMs);
  expect(ds.some(d => d.type === "session")).toBe(true);
  expect(sess(w)[0]!.sidekicks.map(k => k.id)).toEqual(["new"]);
  expect(chars(w)[0]!.stats.sidekicks).toBe(0);
  expect(credits(ds)).toEqual([]);
});

test("for an unknown session sub_start, sub_end and a subagent tool do nothing", () => {
  const w = newWorld();
  expect(w.apply(subStart("a1"))).toEqual([]);
  expect(w.apply(subEnd("a1"))).toEqual([]);
  expect(w.apply(ev("tool", { tier: 2, detail: { tool: "Read", agentId: "a1", agentType: "Explore" } }))).toEqual([]);
  const snap = w.snapshot(0, false);
  expect(snap.sessions).toEqual([]);
  expect(snap.repos).toEqual([]);
  expect(snap.characters).toEqual([]);
});

test("an arriving session holds sidekick counts and credits them on binding", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  w.apply(bare("sub_start", { at: 2500, detail: { agentId: "a1", agentType: "Explore" } }));
  const held = w.apply(bare("sub_end", { at: 3000, detail: { agentId: "a1", agentType: "Explore" } }));
  expect(credits(held)).toEqual([]);
  expect(chars(w)).toEqual([]);
  expect(sess(w)[0]!.pendingStats).toEqual({ tasks: 0, tools: 0, compactions: 0, sidekicks: 1 });
  const ds = w.apply(bare("tool", { at: 4000, tier: 3 }));
  expect(chars(w)[0]!.stats.sidekicks).toBe(1);
  expect(credits(ds)).toEqual([{
    type: "credit", at: 4000, characterId: chars(w)[0]!.id, repoId: sess(w)[0]!.repoId,
    tasks: 0, tools: 1, failures: 0, xp: CONFIG.xp.prompt + CONFIG.xp.tool, levels: 0, compactions: 0, sidekicks: 1,
  }]);
});

test("an arriving session holds failures and credits them on binding", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  expect(credits(w.apply(bare("tool", { at: 2000, failed: true })))).toEqual([]);
  const ds = w.apply(bare("prompt", { at: 3000, tier: 2 }));
  expect(credits(ds)).toHaveLength(1);
  expect(credits(ds)[0]).toMatchObject({ failures: 1, tools: 0, xp: CONFIG.xp.prompt });
});

test("credits sum to the character's XP and stats", () => {
  const w = newWorld();
  const ds = [
    ...w.apply(ev("session_start", { at: 1000 })),
    ...w.apply(ev("prompt", { at: 2000 })),
    ...w.apply(ev("tool", { at: 3000 })),
    ...w.apply(ev("task_done", { at: 4000 })),
  ];
  const cs = credits(ds);
  expect(cs).toHaveLength(3);
  const c = chars(w)[0]!;
  expect(cs.every(x => x.characterId === c.id && x.repoId === sess(w)[0]!.repoId)).toBe(true);
  const sum = (k: "xp" | "tasks" | "tools") => cs.reduce((n, x) => n + x[k], 0);
  expect(sum("xp")).toBe(c.xp);
  expect(sum("tasks")).toBe(c.stats.tasks);
  expect(sum("tools")).toBe(c.stats.tools);
});

test("a credit that levels up reports levels: 1", () => {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000 }));
  let at = 2000, level: Delta[] = [];
  while (chars(w)[0]!.xp + CONFIG.xp.taskDone < xpForLevel(2)) { w.apply(ev("task_done", { at })); at += 20_000; }
  level = w.apply(ev("task_done", { at }));
  expect(credits(level)).toHaveLength(1);
  expect(credits(level)[0]!.levels).toBe(1);
});

test("a temp's credit carries counters with characterId null and no XP", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start"));
  w.apply(ev("session_start", { sessionId: "s2" }));
  const ds = w.apply(ev("task_done", { sessionId: "s2", at: 2000 }));
  expect(credits(ds)).toEqual([{
    type: "credit", at: 2000, characterId: null, repoId: sess(w)[1]!.repoId,
    tasks: 1, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0,
  }]);
  expect(credits(w.apply(ev("prompt", { sessionId: "s2", at: 3000 })))).toEqual([]);
});
