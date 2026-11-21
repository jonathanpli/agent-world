import { expect, test, vi } from "vitest";
import { DEFAULTS, drawAction, drawCompaction, drawGauge, drawSidekicks } from "../../src/client/engine/extras";
import { getTheme, safeDraw, THEMES, type Ctx, type Theme } from "../../src/client/engine/theme";
import { randomLook } from "../../src/core/names";
import { mulberry32 } from "../../src/shared/rng";
import type { CharState, Effort, Tier, ToolKind } from "../../src/shared/types";
import { mockCtx } from "../helpers/mockCtx";

for (const theme of THEMES) test(`${theme.id} satisfies the contract`, () => {
  const ctx = mockCtx();
  const look = randomLook(mulberry32(1));
  expect(Object.keys(theme.tierTitles)).toHaveLength(4);
  for (let n = 1; n <= 6; n++) for (let i = 0; i < n; i++) expect(theme.placeFor(i, n).spots).toHaveLength(6);
  theme.drawBackdrop(ctx, 0, 0);
  theme.drawBackdrop(ctx, 0, 1);
  theme.drawAmbient?.(ctx, 0);
  theme.drawPlace(ctx, theme.placeFor(0, 1), "agents-dashboard", 0);
  for (const tier of [1, 2, 3, 4] as Tier[]) for (const state of ["working", "needs_input", "done", "idle", "off_duty"] as CharState[]) {
    theme.drawWorkSpot(ctx, { x: 50, y: 50 }, tier, state, 0);
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as Effort[]) for (const moving of [true, false]) {
      theme.drawCharacter(ctx, { x: 50, y: 50 }, look, tier, state, effort, 3, 1, moving);
    }
  }
  theme.drawWorkSpot(ctx, { x: 50, y: 50 }, null, null, 0);
  expect(theme.effects.celebrate({ x: 1, y: 1 }, mulberry32(1)).length).toBeGreaterThan(0);
  expect(theme.effects.levelUp({ x: 1, y: 1 }, mulberry32(1)).length).toBeGreaterThan(0);
});

test("every hat, accessory and hair style draws", async () => {
  const { HATS, ACCESSORIES, HAIR_STYLES } = await import("../../src/shared/cosmetics");
  const { drawBase } = await import("../../src/client/engine/sprite");
  const ctx = mockCtx();
  const base = randomLook(mulberry32(2));
  for (let hairStyle = 0; hairStyle < HAIR_STYLES; hairStyle++) for (const hat of [null, ...HATS]) for (const accessory of [null, ...ACCESSORIES]) {
    for (const pose of ["stand", "walk", "sit_type", "raise_hand", "cheer", "lean"] as const) {
      drawBase(ctx, { x: 20, y: 30 }, { ...base, hairStyle, hat, accessory }, pose, 1, -1);
    }
  }
});

test("getTheme falls back to office", () => {
  expect(getTheme("office").id).toBe("office");
  expect(getTheme("nope").id).toBe("office");
  expect(THEMES[0]!.id).toBe("office");
});

test("safeDraw falls back when a theme throws", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const bad = { ...getTheme("office"), id: "bad" } as Theme;
  const fallback = getTheme("office");
  const seen: string[] = [];
  const fn = (t: Theme): void => { seen.push(t.id); if (t.id === "bad") throw new Error("boom"); };
  expect(() => safeDraw(bad, fallback, fn)).not.toThrow();
  expect(seen).toEqual(["bad", "office"]);
  safeDraw(bad, fallback, fn);
  expect(seen).toEqual(["bad", "office", "bad", "office"]);
  expect(errors).toHaveBeenCalledTimes(1);                     // once per theme id
  safeDraw(fallback, fallback, fn);
  expect(seen.at(-1)).toBe("office");
  errors.mockRestore();
});

test("safeDraw with a ctx brackets each attempt in save/restore, even when it throws", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  let depth = 0, saves = 0;
  const ctx = { save: () => { depth++; saves++; }, restore: () => { depth--; } } as unknown as Ctx;
  const bad = { ...getTheme("office"), id: "bad-ctx" } as Theme;
  const depths: number[] = [];
  safeDraw(bad, getTheme("office"), t => { depths.push(depth); if (t.id === "bad-ctx") throw new Error("mid-draw"); }, ctx);
  expect(depths).toEqual([1, 1]);       // the fallback starts from a clean save stack
  expect(saves).toBe(2);
  expect(depth).toBe(0);
  errors.mockRestore();
});

const sks = (n: number): { id: string; since: number }[] => Array.from({ length: n }, (_, i) => ({ id: `sk${i}`, since: i * 10 }));
const KINDS: ToolKind[] = ["edit", "shell", "read", "web", "delegate", "other"];
const EXTRAS = ["drawAction", "drawSidekick", "drawContextGauge", "drawCompaction"] as const;

/** Every extra the subject has, for every kind, failed value, gauge step and hot value, over a few frames. */
function runExtras(subject: Partial<Pick<Theme, (typeof EXTRAS)[number]>>, ctx: Ctx): void {
  const spot = { x: 60, y: 80 };
  for (const frame of [0, 3, 19]) {
    for (const kind of KINDS) for (const failed of [false, true]) subject.drawAction?.(ctx, spot, kind, failed, frame);
    for (const busy of [false, true]) subject.drawSidekick?.(ctx, spot, frame, busy, frame / 8);
    subject.drawCompaction?.(ctx, spot, frame);
  }
  for (const step of [0, 1, 2, 3] as const) for (const hot of [false, true]) for (const t of [0, 0.7, 1.3]) subject.drawContextGauge?.(ctx, spot, step, hot, t);
}

for (const theme of THEMES) test(`${theme.id}: every optional extra it has draws without throwing`, () => {
  expect(() => runExtras(theme, mockCtx())).not.toThrow();
  for (const p of theme.socialSpots ?? []) {
    expect(p.x >= theme.lounge.x && p.x <= theme.lounge.x + theme.lounge.w && p.y >= theme.lounge.y && p.y <= theme.lounge.y + theme.lounge.h).toBe(true);
  }
});

test("the engine defaults draw without throwing", () => {
  expect(() => runExtras(DEFAULTS, mockCtx())).not.toThrow();
  expect(() => drawSidekicks(mockCtx(), getTheme("office"), { x: 60, y: 80 }, sks(5), null, 9_000, 1)).not.toThrow();
});

/** Office without any of the extras: what every world looked like before them. */
function bare(id: string): Theme {
  const t = { ...getTheme("office"), id } as Theme;
  for (const k of EXTRAS) delete t[k];
  return t;
}

test("a theme with none of the extras draws through DEFAULTS", () => {
  const plain = bare("plain");
  const spies = EXTRAS.map(k => vi.spyOn(DEFAULTS, k));
  const ctx = mockCtx();
  drawAction(ctx, plain, { x: 60, y: 80 }, "shell", true, 2);
  drawGauge(ctx, plain, { x: 60, y: 80 }, 2, true, 0.5);
  drawCompaction(ctx, plain, { x: 60, y: 80 }, 4);
  drawSidekicks(ctx, plain, { x: 60, y: 80 }, sks(4), "sk1", 1_000, 0.5);
  const [action, sidekick, gauge, compaction] = spies;
  expect(action).toHaveBeenCalledWith(ctx, { x: 60, y: 80 }, "shell", true, 2);
  expect(gauge).toHaveBeenCalledWith(ctx, { x: 60, y: 80 }, 2, true, 0.5);
  expect(compaction).toHaveBeenCalledWith(ctx, { x: 60, y: 80 }, 4);
  expect(sidekick).toHaveBeenCalledTimes(3);               // three drawn, the fourth is "+1"
  for (const s of spies) s.mockRestore();
});

for (const id of ["space", "office"]) test(`${id}: an extra that throws draws the engine default, never another theme's art`, () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const boom = (): never => { throw new Error("boom"); };
  // every extra throws, including office's own: the engine default is the last fallback
  const bad = { ...getTheme(id), id: `${id}-broken`, drawAction: boom, drawSidekick: boom, drawContextGauge: boom, drawCompaction: boom } as Theme;
  const office = getTheme("office");
  const officeSpies = EXTRAS.map(k => vi.spyOn(office, k));
  const defaultSpies = EXTRAS.map(k => vi.spyOn(DEFAULTS, k));
  const ctx = mockCtx();
  expect(() => {
    drawAction(ctx, bad, { x: 60, y: 80 }, "edit", false, 0);
    drawGauge(ctx, bad, { x: 60, y: 80 }, 1, false, 0);
    drawCompaction(ctx, bad, { x: 60, y: 80 }, 2);
    drawSidekicks(ctx, bad, { x: 60, y: 80 }, sks(2), null, 1_000, 0);
  }).not.toThrow();
  const [action, sidekick, gauge, compaction] = defaultSpies;
  expect(action).toHaveBeenCalledTimes(1);
  expect(gauge).toHaveBeenCalledTimes(1);
  expect(compaction).toHaveBeenCalledTimes(1);
  expect(sidekick).toHaveBeenCalledTimes(2);
  for (const spy of officeSpies) expect(spy).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledTimes(1);               // reported once per theme
  for (const spy of [...officeSpies, ...defaultSpies]) spy.mockRestore();
  errors.mockRestore();
});
