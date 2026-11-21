import { expect, test, vi } from "vitest";
import { getTheme, safeDraw, THEMES, type Theme } from "../../src/client/engine/theme";
import { randomLook } from "../../src/core/names";
import { mulberry32 } from "../../src/shared/rng";
import type { CharState, Effort, Tier } from "../../src/shared/types";
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
