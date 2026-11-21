import { expect, test } from "vitest";
import type { ToolKind } from "../../src/shared/types";
import type { Ctx } from "../../src/client/engine/theme";
import { space } from "../../src/client/themes/space";

/** A context that only counts the rectangles filled. */
function countingCtx(): { ctx: Ctx; fills: () => number } {
  let n = 0;
  const ctx = { fillStyle: "", globalAlpha: 1, fillRect: () => { n++; } } as unknown as Ctx;
  return { ctx, fills: () => n };
}

const KINDS: ToolKind[] = ["edit", "shell", "read", "web", "delegate", "other"];

test("space draws its own extras rather than the engine defaults", () => {
  for (const k of ["drawAction", "drawSidekick", "drawContextGauge", "drawCompaction"] as const) expect(typeof space[k]).toBe("function");
});

test("every tool kind, failed or not, paints something at the console", () => {
  for (const kind of KINDS) for (const failed of [false, true]) for (const frame of [0, 5, 19]) {
    const { ctx, fills } = countingCtx();
    space.drawAction!(ctx, { x: 60, y: 120 }, kind, failed, frame);
    expect(fills(), `${kind} failed=${failed} frame=${frame}`).toBeGreaterThan(0);
  }
});

test("the oxygen gauge, the drone and the tank swap all paint", () => {
  for (const step of [0, 1, 2, 3] as const) for (const hot of [false, true]) {
    const { ctx, fills } = countingCtx();
    space.drawContextGauge!(ctx, { x: 60, y: 120 }, step, hot, 0.3);
    expect(fills()).toBeGreaterThan(0);
  }
  for (const busy of [false, true]) {
    const { ctx, fills } = countingCtx();
    space.drawSidekick!(ctx, { x: 71, y: 120 }, 6, busy, 1.2);
    expect(fills()).toBeGreaterThan(0);
  }
  const { ctx, fills } = countingCtx();
  space.drawCompaction!(ctx, { x: 60, y: 120 }, 4);
  expect(fills()).toBeGreaterThan(0);
});

test("space social spots (the viewport window) sit inside the lounge", () => {
  const { x, y, w, h } = space.lounge;
  expect(space.socialSpots?.length).toBe(2);
  for (const p of space.socialSpots ?? []) {
    expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
    expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
  }
});
