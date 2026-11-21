import { expect, test } from "vitest";
import type { ToolKind } from "../../src/shared/types";
import type { Ctx } from "../../src/client/engine/theme";
import { underwater } from "../../src/client/themes/underwater";

/** A context that only counts the rectangles filled. */
function countingCtx(): { ctx: Ctx; fills: () => number } {
  let n = 0;
  const ctx = { fillStyle: "", globalAlpha: 1, fillRect: () => { n++; } } as unknown as Ctx;
  return { ctx, fills: () => n };
}

const KINDS: ToolKind[] = ["edit", "shell", "read", "web", "delegate", "other"];

test("underwater draws its own extras rather than the engine defaults", () => {
  for (const k of ["drawAction", "drawSidekick", "drawContextGauge", "drawCompaction"] as const) expect(typeof underwater[k]).toBe("function");
});

test("every tool kind, failed or not, paints something at the site", () => {
  for (const kind of KINDS) for (const failed of [false, true]) for (const frame of [0, 5, 19]) {
    const { ctx, fills } = countingCtx();
    underwater.drawAction!(ctx, { x: 60, y: 120 }, kind, failed, frame);
    expect(fills(), `${kind} failed=${failed} frame=${frame}`).toBeGreaterThan(0);
  }
});

test("the air gauge, the pilot fish and the bubble burst all paint", () => {
  for (const step of [0, 1, 2, 3] as const) for (const hot of [false, true]) for (const t of [0.3, 0.9]) {
    const { ctx, fills } = countingCtx();
    underwater.drawContextGauge!(ctx, { x: 60, y: 120 }, step, hot, t);
    expect(fills()).toBeGreaterThan(0);
  }
  for (const busy of [false, true]) for (const frame of [0, 6]) {
    const { ctx, fills } = countingCtx();
    underwater.drawSidekick!(ctx, { x: 71, y: 120 }, frame, busy, 1.2);
    expect(fills()).toBeGreaterThan(0);
  }
  for (const frame of [0, 4, 12]) {
    const { ctx, fills } = countingCtx();
    underwater.drawCompaction!(ctx, { x: 60, y: 120 }, frame);
    expect(fills()).toBeGreaterThan(0);
  }
});

test("underwater social spots (round the coral head) sit inside the lounge", () => {
  const { x, y, w, h } = underwater.lounge;
  expect(underwater.socialSpots?.length).toBe(2);
  for (const p of underwater.socialSpots ?? []) {
    expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
    expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
  }
});
