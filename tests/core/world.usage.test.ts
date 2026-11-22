import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Delta, EventKind, UsageDelta, UsageTotals } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;
const credits = (ds: Delta[]) => ds.flatMap(d => (d.type === "credit" ? [d] : []));
const ZERO: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 };
const OPUS = "claude-opus-5-5";

/** An event that carries no tier, like a real Claude Code SessionStart or UserPromptSubmit. */
function bare(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  const e = ev(kind, over);
  if (!("tier" in over)) delete e.tier;
  return e;
}
const delta = (over: Partial<UsageDelta> = {}): UsageDelta => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...over });
const usage = (u: UsageDelta, over: Partial<AgentEvent> = {}) => ev("usage", { usage: u, ...over });

/** A bound session on Opus 5.5 that has had a prompt. */
function bound(): World {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000, model: OPUS }));
  w.apply(ev("prompt", { at: 1000, detail: { text: "go" } }));
  return w;
}

test("a usage event adds to the session and the character and emits one credit carrying it with its cost", () => {
  const w = bound();
  const ds = w.apply(usage(delta({ input: 1000, output: 500 }), { at: 2000 }));
  const cost = 1000 * 4 + 500 * 20;                     // Opus 5.5: $4 / $20 per million = 4 / 20 micros per token
  const totals = { ...ZERO, input: 1000, output: 500, costMicros: cost };
  expect(credits(ds)).toEqual([{
    type: "credit", at: 2000, characterId: chars(w)[0]!.id, repoId: sess(w)[0]!.repoId,
    tasks: 0, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0,
    commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0, usage: totals,
  }]);
  expect(sess(w)[0]!.usage).toEqual(totals);
  expect(sess(w)[0]!.pendingUsage).toEqual(ZERO);
  expect(chars(w)[0]!.usage).toEqual(totals);
  expect(ds.map(d => d.type)).toEqual(["credit", "character", "session"]);
});

test("two usage events sum, each priced on its own", () => {
  const w = bound();
  w.apply(usage(delta({ input: 10, cacheRead: 3 }), { at: 2000 }));
  w.apply(usage(delta({ output: 2, cacheWrite: 1, cacheWrite1h: 1 }), { at: 3000 }));
  // 10×4 + 3×0.2 = 40.6 → 41; 2×20 + 5 + 8 = 53
  const totals = { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, cacheWrite1h: 1, costMicros: 41 + 53 };
  expect(sess(w)[0]!.usage).toEqual(totals);
  expect(chars(w)[0]!.usage).toEqual(totals);
});

test("usageModel prices the usage ahead of the session's model", () => {
  const w = bound();
  w.apply(usage(delta({ input: 1000 }), { at: 2000, usageModel: "claude-haiku-4-5" }));
  expect(sess(w)[0]!.usage.costMicros).toBe(1000);
  expect(sess(w)[0]!.model).toBe(OPUS);
});

test("longPrompt picks Haiku's higher rate", () => {
  const w = bound();
  w.apply(usage(delta({ input: 1000 }), { at: 2000, usageModel: "claude-haiku-5-5", longPrompt: true }));
  expect(sess(w)[0]!.usage.costMicros).toBe(500);
});

test("an unpriced model adds its tokens at cost 0", () => {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000, model: "gpt-x" }));
  const ds = w.apply(usage(delta({ input: 1000, output: 10 }), { at: 2000 }));
  expect(credits(ds)[0]!.usage).toEqual({ ...ZERO, input: 1000, output: 10 });
  expect(chars(w)[0]!.usage).toEqual({ ...ZERO, input: 1000, output: 10 });
});

test("a session with no model yet adds its tokens at cost 0", () => {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000 }));
  w.apply(usage(delta({ input: 5 }), { at: 2000 }));
  expect(sess(w)[0]!.usage).toEqual({ ...ZERO, input: 5 });
});

test("an Arriving session holds usage in pendingUsage and credits it on binding in one credit", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  const held = w.apply(bare("usage", { at: 2500, usage: delta({ input: 100 }), usageModel: OPUS }));
  expect(credits(held)).toEqual([]);
  expect(chars(w)).toEqual([]);
  expect(sess(w)[0]!.usage).toEqual({ ...ZERO, input: 100, costMicros: 400 });
  expect(sess(w)[0]!.pendingUsage).toEqual({ ...ZERO, input: 100, costMicros: 400 });
  w.apply(bare("usage", { at: 2600, usage: delta({ output: 1 }), usageModel: OPUS }));
  const ds = w.apply(bare("tool", { at: 3000, tier: 3 }));
  expect(credits(ds)).toHaveLength(1);
  expect(credits(ds)[0]).toMatchObject({ tools: 1, xp: CONFIG.xp.prompt + CONFIG.xp.tool, usage: { ...ZERO, input: 100, output: 1, costMicros: 420 } });
  expect(chars(w)[0]!.usage).toEqual({ ...ZERO, input: 100, output: 1, costMicros: 420 });
  expect(sess(w)[0]!.pendingUsage).toEqual(ZERO);
});

test("an Arriving session whose only held activity is usage is credited when it ends", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("usage", { at: 2000, usage: delta({ input: 7 }) }));
  const ds = w.apply(bare("session_end", { at: 3000 }));
  expect(credits(ds)).toHaveLength(1);
  expect(credits(ds)[0]).toMatchObject({ characterId: chars(w)[0]!.id, usage: { ...ZERO, input: 7 } });
  expect(chars(w)[0]!.usage.input).toBe(7);
});

test("a temp's usage is credited with characterId null", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start", { model: OPUS }));
  w.apply(ev("session_start", { sessionId: "s2", model: OPUS }));
  const ds = w.apply(usage(delta({ input: 1 }), { sessionId: "s2", at: 2000 }));
  expect(credits(ds)).toEqual([expect.objectContaining({ characterId: null, xp: 0, usage: { ...ZERO, input: 1, costMicros: 4 } })]);
  expect(sess(w)[1]!.usage.input).toBe(1);
  expect(chars(w)[0]!.usage).toEqual(ZERO);
});

test("a usage event for an unknown session does nothing and creates nothing", () => {
  const w = newWorld();
  expect(w.apply(usage(delta({ input: 1 }), { tier: 2 }))).toEqual([]);
  expect(w.snapshot(0, false)).toMatchObject({ sessions: [], repos: [], characters: [] });
});

test("a usage event with no tokens does nothing", () => {
  const w = bound();
  expect(w.apply(usage(delta(), { at: 2000 }))).toEqual([]);
  expect(w.apply(ev("usage", { at: 2000 }))).toEqual([]);
});

test("usage moves no state, attention, XP, activity or lastEventAt", () => {
  const w = bound();
  w.apply(ev("task_done", { at: 1500 }));
  const before = sess(w)[0]!, xp = chars(w)[0]!.xp;
  w.apply(usage(delta({ input: 1 }), { at: 9000, model: "claude-sonnet-5-5", tier: 3 }));
  const after = sess(w)[0]!;
  expect(after).toMatchObject({
    state: before.state, stateSince: before.stateSince, attention: before.attention, lastEventAt: before.lastEventAt,
    model: before.model, tier: before.tier, characterId: before.characterId, activity: before.activity,
  });
  expect(chars(w)[0]!.xp).toBe(xp);
});

test("a tool event's usage is ignored: only usage events add tokens (subagent tokens arrive as sidekick usage events)", () => {
  const w = bound();
  const ds = w.apply(ev("tool", {
    at: 2000, detail: { tool: "Agent", toolKind: "delegate" },
    usage: delta({ input: 10, output: 1 }), usageModel: "claude-sonnet-5-5", sidekick: true,
  }));
  expect(credits(ds)).toEqual([expect.objectContaining({ tools: 1, xp: CONFIG.xp.tool, usage: ZERO })]);
  expect(sess(w)[0]!.usage).toEqual(ZERO);
  expect(chars(w)[0]!.usage).toEqual(ZERO);
});

test("a sidekick usage event is credited like any usage event, at its own model", () => {
  const w = bound();
  w.apply(usage(delta({ input: 1000 }), { at: 2000, usageModel: "claude-haiku-5-5", sidekick: true }));
  expect(sess(w)[0]!.usage).toEqual({ ...ZERO, input: 1000, costMicros: 100 });
  expect(chars(w)[0]!.usage).toEqual({ ...ZERO, input: 1000, costMicros: 100 });
});

test("usage credits sum to the character's lifetime usage", () => {
  const w = bound();
  const ds = [
    ...w.apply(usage(delta({ input: 3 }), { at: 2000 })),
    ...w.apply(usage(delta({ output: 7 }), { at: 2500, sidekick: true })),
    ...w.apply(usage(delta({ cacheRead: 9 }), { at: 3000 })),
  ];
  const sum = credits(ds).reduce((n, c) => n + c.usage.costMicros, 0);
  expect(sum).toBe(chars(w)[0]!.usage.costMicros);
  expect(chars(w)[0]!.usage).toEqual(sess(w)[0]!.usage);
});

test("showCost defaults on, takes a boolean and rejects anything else", () => {
  expect(CONFIG.defaultSettings.showCost).toBe(true);
  const w = newWorld();
  expect(w.updateSettings({ showCost: false })).toEqual([{ type: "settings", settings: { ...CONFIG.defaultSettings, showCost: false } }]);
  expect(() => w.updateSettings({ showCost: "no" as unknown as boolean })).toThrow("showCost must be a boolean");
  expect(w.snapshot(0, false).settings.showCost).toBe(false);
});
