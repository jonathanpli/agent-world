import { expect, test } from "vitest";
import { office } from "../../src/client/themes/office";

test("the office draws its own extras rather than the engine defaults", () => {
  for (const k of ["drawAction", "drawSidekick", "drawContextGauge", "drawCompaction"] as const) expect(typeof office[k]).toBe("function");
});

test("office social spots (water cooler, sofa) sit inside the lounge", () => {
  const { x, y, w, h } = office.lounge;
  expect(office.socialSpots?.length).toBe(2);
  for (const p of office.socialSpots ?? []) {
    expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
    expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
  }
});
