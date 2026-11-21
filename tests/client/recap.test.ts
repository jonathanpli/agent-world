import { expect, test } from "vitest";
import { compactionText, applyDeltas, applySnapshot, emptyState } from "../../src/client/state";
import { nudgeText, recapExtras, recapHeadline, recapIsEmpty, shouldNudge, spriteBounds, streakText } from "../../src/client/ui/recap";
import { tickerItems } from "../../src/client/ui/ticker";
import type { Recap, RecapTotals } from "../../src/shared/types";
import { char, repo, session, snap } from "../helpers/clientFixtures";

const totals = (over: Partial<RecapTotals> = {}): RecapTotals => ({ tasks: 0, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0, ...over });
const recap = (t: Partial<RecapTotals> = {}): Recap => ({
  day: "2026-11-20", today: "2026-11-21", totals: totals(t), characters: [], repos: [], mvpCharacterId: null, streak: 0, prevDay: null, nextDay: null,
});
const ctx = (tokens: number, compactions: number) => ({ tokens, peak: tokens, limit: 200_000, estimated: true, compactions, warned: false, seen: [] });

test("headline handles singulars and plurals", () => {
  expect(recapHeadline(recap({ tasks: 14, tools: 212, xp: 480, levels: 3 }))).toEqual(["14 tasks finished", "212 tools used", "480 XP earned", "3 levels gained"]);
  expect(recapHeadline(recap({ tasks: 1, tools: 1, xp: 1, levels: 1 }))).toEqual(["1 task finished", "1 tool used", "1 XP earned", "1 level gained"]);
});

test("extras list only non-zero totals", () => {
  expect(recapExtras(recap())).toEqual([]);
  expect(recapExtras(recap({ compactions: 2, sidekicks: 5, failures: 1 }))).toEqual(["2 compactions", "5 sidekicks", "1 failed tool"]);
  expect(recapExtras(recap({ sidekicks: 1, failures: 3 }))).toEqual(["1 sidekick", "3 failed tools"]);
});

test("streak text", () => {
  expect(streakText(0)).toBeNull();
  expect(streakText(1)).toBe("1 day running");
  expect(streakText(4)).toBe("4 days running");
});

test("nudge text is null on an empty day", () => {
  expect(nudgeText(recap({ tools: 9 }))).toBeNull();
  expect(nudgeText(recap({ tasks: 14, levels: 3 }))).toBe("Yesterday: 14 tasks, 3 levels. See recap");
  expect(nudgeText(recap({ tasks: 1, levels: 1 }))).toBe("Yesterday: 1 task, 1 level. See recap");
  expect(nudgeText(recap({ tasks: 2 }))).toBe("Yesterday: 2 tasks. See recap");
});

test("shouldNudge is false once shown today", () => {
  expect(shouldNudge("2026-11-21", null)).toBe(true);
  expect(shouldNudge("2026-11-21", "2026-11-20")).toBe(true);
  expect(shouldNudge("2026-11-21", "2026-11-21")).toBe(false);
});

test("compactionText: numbers when available, null without a rise", () => {
  const old = session("k", "a", "r", { context: ctx(217_000, 0) });
  expect(compactionText(old, session("k", "a", "r", { context: ctx(35_000, 1) }), "Ada", "agent-world")).toBe("Ada compacted context in agent-world (217k → 35k)");
  expect(compactionText(old, session("k", "a", "r", { context: ctx(217_000, 1) }), "Ada", "agent-world")).toBe("Ada compacted context in agent-world");
  expect(compactionText(old, session("k", "a", "r", { context: ctx(35_000, 0) }), "Ada", "agent-world")).toBeNull();
  expect(compactionText(session("k", "a", "r"), session("k", "a", "r", { context: ctx(35_000, 2) }), "Ada", "r")).toBeNull();   // first reading
  expect(compactionText(undefined, session("k", "a", "r", { context: ctx(35_000, 2) }), "Ada", "r")).toBeNull();
});

test("applyDeltas adds a ticker note for a compaction, not a notice", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a", { name: "Ada" })], repos: [repo("r1")], sessions: [session("k", "a", "r1", { context: ctx(217_000, 0) })] }));
  const out = applyDeltas(s, [{ type: "session", session: session("k", "a", "r1", { context: ctx(35_000, 1) }) }]);
  expect(out).toEqual([]);
  expect(s.notices).toEqual([]);
  expect(tickerItems(s.notices, s.notes)).toEqual(["Ada compacted context in r1 (217k → 35k)"]);
  applyDeltas(s, [{ type: "session", session: session("k", "a", "r1", { context: ctx(40_000, 1) }) }]);
  expect(s.notes).toHaveLength(1);
});

test("an unbound session is named by its label", () => {
  const s = emptyState();
  applySnapshot(s, snap({ sessions: [session("k", null, "r1", { context: ctx(100_000, 0) })] }));
  applyDeltas(s, [{ type: "session", session: session("k", null, "r1", { context: ctx(10_000, 1) }) }]);
  expect(s.notes[0]!.text).toBe("Temp compacted context (100k → 10k)");
});

test("a day is empty only when every total is zero", () => {
  expect(recapIsEmpty(recap())).toBe(true);
  for (const k of ["tasks", "tools", "failures", "xp", "levels", "compactions", "sidekicks"] as const) {
    expect(recapIsEmpty(recap({ [k]: 1 }))).toBe(false);
  }
});

test("spriteBounds: the smallest box holding every visible pixel, or null for a blank image", () => {
  const img = (w: number, h: number, opaque: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of opaque) data[(y * w + x) * 4 + 3] = 255;
    return { width: w, height: h, data };
  };
  expect(spriteBounds(img(32, 40, []))).toBeNull();
  expect(spriteBounds(img(32, 40, [[10, 8], [21, 35], [15, 20]]))).toEqual({ x: 10, y: 8, w: 12, h: 28 });
  expect(spriteBounds(img(32, 40, [[0, 0]]))).toEqual({ x: 0, y: 0, w: 1, h: 1 });
});
