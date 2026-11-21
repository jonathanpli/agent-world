import { describe, expect, test } from "vitest";
import { ACTION_MS, COMPACTION_MS, gaugeStep, nextAction, nextCompaction, sidekickSlots } from "../../src/client/engine/actions";
import { VIEW } from "../../src/client/engine/view";
import type { ContextInfo, LastTool } from "../../src/shared/types";

const tool = (at: number, over: Partial<LastTool> = {}): LastTool => ({ kind: "edit", at, failed: false, agentId: null, ...over });

describe("nextAction", () => {
  test("null when there is no last tool", () => {
    expect(nextAction(null, null, 1_000)).toBeNull();
    expect(nextAction({ kind: "edit", failed: false, agentId: null, startedAt: 900 }, null, 1_000)).toBeNull();
  });

  test("starts when lastTool.at changes", () => {
    const a = nextAction(null, tool(1_000, { kind: "shell", failed: true, agentId: "sk1" }), 1_000);
    expect(a).toEqual({ kind: "shell", failed: true, agentId: "sk1", startedAt: 1_000 });
  });

  test("persists within the action length and ends after it", () => {
    const lt = tool(1_000);
    const a = nextAction(null, lt, 1_000)!;
    const mid = nextAction(a, lt, 1_000 + ACTION_MS - 1);
    expect(mid).toBe(a);
    expect(nextAction(mid, lt, 1_000 + ACTION_MS)).toBeNull();
    expect(ACTION_MS).toBe(2_500);
  });

  test("an old tool seen for the first time does not play", () => {
    expect(nextAction(null, tool(1_000), 1_000 + ACTION_MS + 5)).toBeNull();
  });

  test("a newer tool replaces the current action", () => {
    const a = nextAction(null, tool(1_000, { kind: "read" }), 1_200)!;
    const b = nextAction(a, tool(2_000, { kind: "web" }), 2_100)!;
    expect(b).not.toBe(a);
    expect(b).toEqual({ kind: "web", failed: false, agentId: null, startedAt: 2_000 });
    expect(nextAction(b, tool(2_000, { kind: "web" }), 2_000 + ACTION_MS - 1)).toBe(b);
  });
});

describe("gaugeStep", () => {
  const ctx = (tokens: number, limit = 200_000): ContextInfo => ({ tokens, limit, peak: tokens, estimated: true, compactions: 0, warned: false, seen: [] });
  test("boundaries at 25, 50 and 75 percent", () => {
    expect(gaugeStep(ctx(0))).toBe(0);
    expect(gaugeStep(ctx(49_999))).toBe(0);
    expect(gaugeStep(ctx(50_000))).toBe(1);
    expect(gaugeStep(ctx(99_999))).toBe(1);
    expect(gaugeStep(ctx(100_000))).toBe(2);
    expect(gaugeStep(ctx(149_999))).toBe(2);
    expect(gaugeStep(ctx(150_000))).toBe(3);
    expect(gaugeStep(ctx(400_000))).toBe(3);
  });
  test("a zero limit reads as empty", () => {
    expect(gaugeStep(ctx(10, 0))).toBe(0);
  });
});

describe("sidekickSlots", () => {
  const spot = { x: 100, y: 120 };
  const inView = (p: { x: number; y: number }): boolean => p.x >= 0 && p.x < VIEW.w && p.y >= 0 && p.y < VIEW.h;

  test("none for zero", () => {
    expect(sidekickSlots(spot, 0)).toEqual({ points: [], more: 0 });
  });
  test("one point for one", () => {
    const s = sidekickSlots(spot, 1);
    expect(s.points).toHaveLength(1);
    expect(s.more).toBe(0);
    expect(inView(s.points[0]!)).toBe(true);
  });
  test("three distinct points for three", () => {
    const s = sidekickSlots(spot, 3);
    expect(s.points).toHaveLength(3);
    expect(new Set(s.points.map(p => `${p.x},${p.y}`)).size).toBe(3);
    expect(s.more).toBe(0);
  });
  test("five: three distinct points inside the view and two more", () => {
    for (const at of [spot, { x: 2, y: 120 }, { x: VIEW.w - 2, y: 120 }]) {
      const s = sidekickSlots(at, 5);
      expect(s.points).toHaveLength(3);
      expect(new Set(s.points.map(p => `${p.x},${p.y}`)).size).toBe(3);
      for (const p of s.points) expect(inView(p)).toBe(true);
      expect(s.more).toBe(2);
    }
  });
  test("a spot on a later screen keeps its slots on that screen", () => {
    const s = sidekickSlots({ x: VIEW.w * 2 - 2, y: 120 }, 3);
    for (const p of s.points) expect(p.x >= VIEW.w && p.x < VIEW.w * 2).toBe(true);
  });
});

describe("nextCompaction", () => {
  test("the first reading only sets the baseline", () => {
    expect(nextCompaction(undefined, 2, 1_000)).toEqual({ count: 2, startedAt: null });
  });
  test("an increase starts a moment that ends after its length", () => {
    const a = nextCompaction({ count: 2, startedAt: null }, 3, 1_000);
    expect(a).toEqual({ count: 3, startedAt: 1_000 });
    expect(nextCompaction(a, 3, 1_000 + COMPACTION_MS - 1)).toEqual(a);
    expect(nextCompaction(a, 3, 1_000 + COMPACTION_MS)).toEqual({ count: 3, startedAt: null });
    expect(COMPACTION_MS).toBe(2_000);
  });
  test("a decrease (a new session) resets the baseline without a moment", () => {
    expect(nextCompaction({ count: 4, startedAt: null }, 0, 1_000)).toEqual({ count: 0, startedAt: null });
  });
});
