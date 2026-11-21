import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Compaction, Delta, EventKind } from "../../src/shared/types";
import { ARRIVAL_NAME, type World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const MODEL = "claude-opus-4-1";
const sess = (w: World) => w.snapshot(0, false).sessions[0]!;
const chars = (w: World) => w.snapshot(0, false).characters;
const notices = (ds: Delta[]) => ds.flatMap(d => (d.type === "notice" ? [d.notice] : []));
const credits = (ds: Delta[]) => ds.flatMap(d => (d.type === "credit" ? [d] : []));
const learned = (ds: Delta[]) => ds.flatMap(d => (d.type === "learned_limit" ? [d] : []));

const b = (uuid: string, over: Partial<Compaction> = {}): Compaction => ({ uuid, trigger: "auto", preTokens: 150_000, postTokens: 20_000, ...over });
const ctx = (contextTokens: number, boundaries: Compaction[] = [], over: Partial<AgentEvent> = {}): AgentEvent =>
  ev("context", { at: 5000, contextTokens, boundaries, ...over });

/** A bound session with model MODEL in the working state. */
function working(w: World = newWorld()): World {
  w.apply(ev("session_start", { at: 1000, model: MODEL }));
  w.apply(ev("prompt", { at: 2000, detail: { text: "go" } }));
  return w;
}

/** An event that carries no tier, like a real Claude Code SessionStart or UserPromptSubmit. */
function bare(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  const e = ev(kind, over);
  if (!("tier" in over)) delete e.tier;
  return e;
}

test("the first reading records the boundaries already in the tail without applying them", () => {
  const w = working();
  const activity = sess(w).activity.length;
  const ds = w.apply(ctx(50_000, [b("u1", { trigger: "manual", preTokens: 40_000 }), b("u2", { trigger: "manual", preTokens: 45_000 })]));
  expect(sess(w).context).toEqual({ tokens: 50_000, peak: 50_000, limit: 200_000, estimated: true, compactions: 0, warned: false, seen: ["u1", "u2"] });
  expect(notices(ds)).toEqual([]);
  expect(credits(ds)).toEqual([]);
  expect(learned(ds)).toEqual([]);
  expect(sess(w).activity).toHaveLength(activity);
});

test("seeded boundaries on the first reading count toward peak", () => {
  const w = working();
  w.apply(ctx(30_000, [b("u1", { trigger: "manual", preTokens: 120_000 }), b("u2", { trigger: "manual", preTokens: 90_000 })]));
  expect(sess(w).context).toMatchObject({ tokens: 30_000, peak: 120_000, limit: 200_000, compactions: 0 });
});

test("seeded auto boundaries teach the learned limit (the last one) but are not compactions", () => {
  const w = working();
  const activity = sess(w).activity.length;
  const ds = w.apply(ctx(30_000, [b("u1", { preTokens: 170_000 }), b("u2", { preTokens: 150_000 }), b("u3", { trigger: "manual", preTokens: 190_000 })]));
  expect(learned(ds)).toEqual([{ type: "learned_limit", model: MODEL, limit: 150_000 }]);
  expect(sess(w).context).toMatchObject({ compactions: 0, peak: 190_000, limit: 200_000 });
  expect(sess(w).activity).toHaveLength(activity);
  expect(sess(w).pendingStats.compactions).toBe(0);
  expect(credits(ds)).toEqual([]);
  // the most recent wins: a later session's seeded boundary replaces it, up or down; the same value is not re-taught
  w.apply(ev("session_start", { at: 1000, sessionId: "s2", model: MODEL }));
  expect(learned(w.apply(ctx(30_000, [b("v1", { preTokens: 160_000 })], { sessionId: "s2" })))).toEqual([{ type: "learned_limit", model: MODEL, limit: 160_000 }]);
  w.apply(ev("session_start", { at: 1000, sessionId: "s3", model: MODEL }));
  expect(learned(w.apply(ctx(30_000, [b("x1", { preTokens: 160_000 })], { sessionId: "s3" })))).toEqual([]);
});

test("seeded auto boundaries teach nothing without a model", () => {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000 }));
  expect(learned(w.apply(ctx(30_000, [b("u1", { preTokens: 170_000 })])))).toEqual([]);
});

test("a new auto boundary is applied once: count, line, stat, credit and learned limit", () => {
  const w = working();
  w.apply(ctx(50_000, [b("u1"), b("u2")]));
  const before = sess(w);
  const ds = w.apply(ctx(31_000, [b("u1"), b("u2"), b("u3", { preTokens: 180_000, postTokens: 30_000 })], { at: 6000 }));
  const s = sess(w);
  expect(s.context).toMatchObject({ tokens: 31_000, compactions: 1, seen: ["u1", "u2", "u3"] });
  expect(s.activity.slice(before.activity.length)).toEqual([{ at: 6000, kind: "context", text: "Compacted 180k → 30k, auto" }]);
  expect(chars(w)[0]!.stats.compactions).toBe(1);
  expect(credits(ds)).toHaveLength(1);
  expect(credits(ds)[0]).toMatchObject({ compactions: 1, xp: 0, tools: 0, tasks: 0 });
  expect(learned(ds)).toEqual([{ type: "learned_limit", model: MODEL, limit: 180_000 }]);
  expect(notices(ds)).toEqual([]);
  expect({ state: s.state, stateSince: s.stateSince, attention: s.attention }).toEqual({ state: before.state, stateSince: before.stateSince, attention: before.attention });

  const snap = w.snapshot(0, false);
  const again = w.apply(ctx(31_000, [b("u1"), b("u2"), b("u3", { preTokens: 180_000, postTokens: 30_000 })], { at: 7000 }));
  expect(again).toEqual([]);
  expect(w.snapshot(0, false)).toEqual(snap);
});

test("the learned limit is used for the next reading of that model", () => {
  const w = working();
  w.apply(ctx(50_000));
  w.apply(ctx(30_000, [b("u1", { preTokens: 180_000 })]));
  w.apply(ctx(40_000, [b("u1", { preTokens: 180_000 })]));
  expect(sess(w).context).toMatchObject({ limit: 180_000, estimated: true });
});

test("a manual boundary does not teach a limit", () => {
  const w = working();
  w.apply(ctx(50_000));
  const ds = w.apply(ctx(30_000, [b("u1", { trigger: "manual", preTokens: 120_000, postTokens: 30_000 })]));
  expect(learned(ds)).toEqual([]);
  expect(sess(w).activity.at(-1)!.text).toBe("Compacted 120k → 30k, manual");
  expect(sess(w).context!.compactions).toBe(1);
});

test("the most recent auto preTokens is the learned limit, lower or higher", () => {
  const w = working();
  w.apply(ctx(50_000));
  expect(learned(w.apply(ctx(30_000, [b("u1", { preTokens: 180_000 })])))).toHaveLength(1);
  expect(learned(w.apply(ctx(30_000, [b("u1", { preTokens: 180_000 }), b("u2", { preTokens: 170_000 })])))).toEqual([{ type: "learned_limit", model: MODEL, limit: 170_000 }]);
  w.apply(ctx(40_000, [b("u1", { preTokens: 180_000 }), b("u2", { preTokens: 170_000 })]));
  expect(sess(w).context!.limit).toBe(200_000);           // the session's peak (180 000) is past the new estimate: it takes the next step
  const w2 = working();
  w2.apply(ctx(50_000));
  w2.apply(ctx(30_000, [b("u1", { preTokens: 120_000 })]));
  expect(sess(w2).context!.limit).toBe(120_000);
  // two new boundaries in one reading: the later one wins, emitted once
  expect(learned(w2.apply(ctx(30_000, [b("u1", { preTokens: 120_000 }), b("u2", { preTokens: 140_000 }), b("u3", { preTokens: 130_000 })])))).toEqual([{ type: "learned_limit", model: MODEL, limit: 130_000 }]);
  // the same value again is not re-emitted
  expect(learned(w2.apply(ctx(30_000, [b("u3", { preTokens: 130_000 }), b("u4", { preTokens: 130_000 })])))).toEqual([]);
});

test("a compaction line renders 999 600 tokens as 1M, not 1000k", () => {
  const w = working();
  w.apply(ctx(50_000));
  w.apply(ctx(30_000, [b("u1", { preTokens: 999_600, postTokens: 30_000 })]));
  expect(sess(w).activity.at(-1)!.text).toBe("Compacted 1M → 30k, auto");
});

test("a session with no model teaches no limit", () => {
  const w = newWorld();
  w.apply(ev("session_start", { at: 1000 }));
  w.apply(ctx(50_000));
  const ds = w.apply(ctx(30_000, [b("u1", { preTokens: 180_000 })]));
  expect(learned(ds)).toEqual([]);
  expect(sess(w).context!.compactions).toBe(1);
});

test("a learned limit from WorldInit is used for a session with that model", () => {
  const w = working(newWorld({ learnedLimits: { [MODEL]: 150_000 } }));
  w.apply(ctx(50_000));
  expect(sess(w).context).toMatchObject({ limit: 150_000, estimated: true });
  const other = newWorld({ learnedLimits: { other: 150_000 } });
  working(other);
  other.apply(ctx(50_000));
  expect(sess(other).context!.limit).toBe(200_000);
});

test("the running-low notice fires once per fill and re-arms below the threshold or after a compaction", () => {
  const w = working();
  const xp = chars(w)[0]!.xp;
  const before = sess(w);
  expect(notices(w.apply(ctx(159_999, [], { at: 5000 })))).toEqual([]);
  const ds = w.apply(ctx(160_000, [], { at: 6000 }));
  const ns = notices(ds);
  expect(ns).toHaveLength(1);
  expect(ns[0]).toMatchObject({ kind: "context_low", sessionKey: before.key, characterId: chars(w)[0]!.id });
  expect(ns[0]!.text).toContain(chars(w)[0]!.name);
  expect(ns[0]!.text).toContain("80%");
  expect(sess(w).context!.warned).toBe(true);
  const s = sess(w);
  expect({ state: s.state, stateSince: s.stateSince, attention: s.attention }).toEqual({ state: before.state, stateSince: before.stateSince, attention: before.attention });
  expect(chars(w)[0]!.xp).toBe(xp);
  expect(credits(ds)).toEqual([]);

  expect(notices(w.apply(ctx(170_000, [], { at: 7000 })))).toEqual([]);
  expect(notices(w.apply(ctx(139_999, [], { at: 8000 })))).toEqual([]);
  expect(sess(w).context!.warned).toBe(false);
  expect(notices(w.apply(ctx(165_000, [], { at: 9000 })))).toHaveLength(1);
  expect(notices(w.apply(ctx(30_000, [b("u1")], { at: 10_000 })))).toEqual([]);
  expect(sess(w).context!.warned).toBe(false);
  expect(notices(w.apply(ctx(165_000, [b("u1")], { at: 11_000 })))).toHaveLength(1);
});

test("a limit that steps up never re-arms the low notice: one notice per fill on a large-window model", () => {
  const w = working();
  const fired: number[] = [];
  for (const t of [160_000, 210_000, 405_000, 510_000, 805_000]) fired.push(notices(w.apply(ctx(t))).length);
  expect(fired).toEqual([1, 0, 0, 0, 0]);
  expect(sess(w).context).toMatchObject({ limit: 1_000_000, warned: true });
  // a compaction re-arms; the climb past 80% of the sticky 1 000 000 limit fires exactly once more
  const compacted = b("u1", { trigger: "manual", preTokens: 805_000, postTokens: 30_000 });
  expect(notices(w.apply(ctx(30_000, [compacted])))).toEqual([]);
  expect(sess(w).context!.warned).toBe(false);
  const more: number[] = [];
  for (const t of [400_000, 790_000, 810_000, 850_000, 900_000]) more.push(notices(w.apply(ctx(t, [compacted]))).length);
  expect(more).toEqual([0, 0, 1, 0, 0]);
  expect(sess(w).context!.limit).toBe(1_000_000);
});

test("a ratio below the re-arm point only re-arms when the tokens fell", () => {
  const w = working();
  w.apply(ctx(160_000));
  w.apply(ctx(210_000));                                   // 42% of 500 000, but more tokens than before: still warned
  expect(sess(w).context!.warned).toBe(true);
  w.apply(ctx(200_000));                                   // fewer tokens and 40%: re-armed
  expect(sess(w).context!.warned).toBe(false);
});

test("a drop to exactly 10 points below the threshold does not re-arm", () => {
  const w = working();
  w.apply(ctx(160_000));
  w.apply(ctx(140_000));
  expect(sess(w).context!.warned).toBe(true);
  expect(notices(w.apply(ctx(165_000)))).toEqual([]);
});

test("the threshold follows contextWarnPct", () => {
  const w = working();
  w.updateSettings({ contextWarnPct: 50 });
  const ns = notices(w.apply(ctx(100_000)));
  expect(ns).toHaveLength(1);
  expect(ns[0]!.text).toContain("50%");
});

test("notifyContext off: warned still flips, no notice", () => {
  const w = working();
  w.updateSettings({ notifyContext: false });
  expect(notices(w.apply(ctx(160_000)))).toEqual([]);
  expect(sess(w).context!.warned).toBe(true);
});

test("a stepped limit sticks after a compaction: no spurious low notice", () => {
  const w = working();
  w.apply(ctx(250_000));
  expect(sess(w).context!.limit).toBe(500_000);
  w.apply(ctx(30_000, [b("u1", { trigger: "manual", preTokens: 250_000, postTokens: 30_000 })]));
  expect(sess(w).context).toMatchObject({ tokens: 30_000, limit: 500_000 });
  const ds = w.apply(ctx(165_000, [b("u1", { trigger: "manual", preTokens: 250_000, postTokens: 30_000 })]));
  expect(sess(w).context).toMatchObject({ tokens: 165_000, limit: 500_000, warned: false });
  expect(notices(ds)).toEqual([]);
});

test("a learned limit below the default applies, and the low notice uses it", () => {
  const w = working(newWorld({ learnedLimits: { [MODEL]: 180_000 } }));
  for (const t of [50_000, 100_000, 143_999]) expect(notices(w.apply(ctx(t)))).toEqual([]);
  expect(sess(w).context).toMatchObject({ limit: 180_000, estimated: true });
  const ns = notices(w.apply(ctx(144_000)));
  expect(ns).toHaveLength(1);
  expect(ns[0]!.text).toContain("80%");
  w.apply(ctx(150_000));
  expect(sess(w).context!.limit).toBe(180_000);
});

test("a peak exactly at a step takes that step", () => {
  const w = working();
  w.apply(ctx(500_000));
  expect(sess(w).context).toMatchObject({ peak: 500_000, limit: 500_000 });
});

test("peak never decreases", () => {
  const w = working();
  const peaks: number[] = [];
  for (const [t, bs] of [[100_000, []], [250_000, []], [30_000, [b("u1", { preTokens: 260_000 })]], [60_000, [b("u1", { preTokens: 260_000 })]]] as const) {
    w.apply(ctx(t, [...bs]));
    peaks.push(sess(w).context!.peak);
  }
  expect(peaks).toEqual([100_000, 250_000, 260_000, 260_000]);
});

test("tokens above the limit step it up; above the last step the limit is the tokens", () => {
  const w = working();
  const ds = w.apply(ctx(250_000));
  expect(sess(w).context).toMatchObject({ tokens: 250_000, limit: 500_000, estimated: true });
  expect(notices(ds)).toEqual([]);
  w.apply(ctx(600_000));
  expect(sess(w).context!.limit).toBe(1_000_000);
  w.apply(ctx(1_200_000));
  expect(sess(w).context!.limit).toBe(1_200_000);
});

test("an override sets the limit and stops estimation; null restores it", () => {
  const w = working();
  w.apply(ctx(50_000));
  w.updateSettings({ contextLimitOverride: 400_000 });
  w.apply(ctx(60_000));
  expect(sess(w).context).toMatchObject({ limit: 400_000, estimated: false });
  w.apply(ctx(450_000));
  expect(sess(w).context).toMatchObject({ limit: 400_000, estimated: false });
  w.updateSettings({ contextLimitOverride: null });
  w.apply(ctx(60_000));
  // the 450 000 reading under the override still counts toward the peak
  expect(sess(w).context).toMatchObject({ peak: 450_000, limit: 500_000, estimated: true });
});

test("updateSettings validates the context settings", () => {
  const w = newWorld();
  for (const contextWarnPct of [49, 96, 80.5]) expect(() => w.updateSettings({ contextWarnPct })).toThrow();
  for (const contextLimitOverride of [0, -1, 1.5, 9_999, 10_000.5, "400000" as unknown as number]) expect(() => w.updateSettings({ contextLimitOverride })).toThrow();
  expect(w.updateSettings({ contextLimitOverride: 10_000 })[0]).toMatchObject({ settings: { contextLimitOverride: 10_000 } });
  expect(() => w.updateSettings({ notifyContext: "yes" as unknown as boolean })).toThrow();
  const ds = w.updateSettings({ contextWarnPct: 95, contextLimitOverride: 1_000_000, notifyContext: false });
  expect(ds).toEqual([{ type: "settings", settings: { ...CONFIG.defaultSettings, contextWarnPct: 95, contextLimitOverride: 1_000_000, notifyContext: false } }]);
  expect(w.updateSettings({ contextWarnPct: 50, contextLimitOverride: null })[0]).toMatchObject({ settings: { contextWarnPct: 50, contextLimitOverride: null } });
});

test("a context event for an unknown session does nothing", () => {
  const w = newWorld();
  expect(w.apply(ctx(160_000, [b("u1")]))).toEqual([]);
  expect(w.snapshot(0, false)).toMatchObject({ sessions: [], repos: [], characters: [] });
});

test("an arriving session tracks context, names the arrival and holds its compactions", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  w.apply(ctx(50_000));
  const ds = w.apply(ctx(30_000, [b("u1")], { at: 3000 }));
  expect(credits(ds)).toEqual([]);
  expect(chars(w)).toEqual([]);
  expect(sess(w).pendingStats.compactions).toBe(1);
  const ns = notices(w.apply(ctx(170_000, [b("u1")], { at: 4000 })));
  expect(ns).toHaveLength(1);
  expect(ns[0]).toMatchObject({ characterName: ARRIVAL_NAME, characterId: null });
  expect(ns[0]!.text).toContain(ARRIVAL_NAME);
  expect(sess(w)).toMatchObject({ tierKnown: false, state: "working" });
  const bound = w.apply(bare("tool", { at: 5000, tier: 3 }));
  expect(credits(bound)[0]).toMatchObject({ compactions: 1 });
  expect(chars(w)[0]!.stats.compactions).toBe(1);
});

test("a context event does not refresh lastEventAt or bind an arrival whose grace is over", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  w.apply(ctx(50_000, [], { at: 2000 + CONFIG.modelGraceMs + 1 }));
  expect(sess(w)).toMatchObject({ tierKnown: false, lastEventAt: 2000 });
});

test("seen keeps the newest 20 boundary uuids, and older boundaries in the tail stay applied", () => {
  const w = working();
  const many = Array.from({ length: 25 }, (_, i) => b(`u${i}`));
  w.apply(ctx(50_000, many));
  expect(sess(w).context!.seen).toEqual(many.slice(5).map(x => x.uuid));
  const more = [...many, b("u25"), b("u26")];
  w.apply(ctx(20_000, more));
  const c = sess(w).context!;
  expect(c.seen).toHaveLength(CONFIG.context.seenMax);
  expect(c.seen).toEqual(more.slice(7).map(x => x.uuid));
  expect(c.compactions).toBe(2);
});

test("a changed override or warn threshold reaches live sessions at once, without a notice", () => {
  const w = working();
  w.apply(ctx(50_000));
  const sessions = (ds: Delta[]) => ds.flatMap(d => (d.type === "session" ? [d.session] : []));
  let ds = w.updateSettings({ contextLimitOverride: 100_000 });
  expect(ds[0]!.type).toBe("settings");
  expect(sessions(ds).map(s => s.context)).toEqual([expect.objectContaining({ tokens: 50_000, limit: 100_000, estimated: false, warned: false })]);
  expect(sess(w).context).toMatchObject({ limit: 100_000, estimated: false });
  // past the threshold now: warned, silently, so the next reading does not fire either
  ds = w.updateSettings({ contextLimitOverride: 60_000 });
  expect(notices(ds)).toEqual([]);
  expect(sess(w).context).toMatchObject({ limit: 60_000, warned: true });
  expect(notices(w.apply(ctx(55_000)))).toEqual([]);
  // back to the estimate: the ratio falls only because the limit moved, so it stays warned
  ds = w.updateSettings({ contextLimitOverride: null });
  expect(sess(w).context).toMatchObject({ limit: 200_000, estimated: true, warned: true });
  // a real token drop below the re-arm point re-arms it
  w.apply(ctx(40_000));
  expect(sess(w).context!.warned).toBe(false);
  // the warn threshold: lowering it below the reading marks it warned without a notice
  ds = w.updateSettings({ contextWarnPct: 50 });
  expect(notices(ds)).toEqual([]);
  expect(sessions(ds)).toEqual([]);                        // 40 000 of 200 000 is 20%: nothing changed
  expect(notices(w.apply(ctx(95_000)))).toEqual([]);       // 47.5%: under the new threshold
  expect(sess(w).context!.warned).toBe(false);
  ds = w.updateSettings({ contextWarnPct: 50, contextLimitOverride: 180_000 });
  expect(notices(ds)).toEqual([]);
  expect(sessions(ds).map(s => s.context)).toEqual([expect.objectContaining({ limit: 180_000, warned: true })]);
  // unrelated settings leave sessions alone
  expect(w.updateSettings({ sound: false })).toHaveLength(1);
});
