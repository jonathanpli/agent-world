import { expect, test } from "vitest";
import { createFader, fadeAlpha } from "../../src/client/engine/fade";
import { CONFIG } from "../../src/shared/config";

const D = CONFIG.client.fadeMs;

test("the fade lasts 400 ms", () => {
  expect(D).toBe(400);
});

test("fade alpha rises to black at the midpoint and falls back to clear", () => {
  expect(fadeAlpha(-5)).toBe(0);
  expect(fadeAlpha(0)).toBe(0);
  expect(fadeAlpha(D / 4)).toBeCloseTo(0.5);
  expect(fadeAlpha(D / 2)).toBe(1);
  expect(fadeAlpha((3 * D) / 4)).toBeCloseTo(0.5);
  expect(fadeAlpha(D)).toBe(0);
  expect(fadeAlpha(D * 3)).toBe(0);
  for (let e = 0; e < D / 2; e += 10) expect(fadeAlpha(e + 10)).toBeGreaterThan(fadeAlpha(e));
});

test("the swap fires exactly once, at the midpoint, at any frame rate", () => {
  for (const frameMs of [1, 16, 33, 150]) {
    const f = createFader();
    f.start("space", 1000);
    const swaps: { at: number; id: string }[] = [];
    for (let now = 1000; now <= 1000 + 2 * D; now += frameMs) {
      const { swap } = f.step(now);
      if (swap !== null) swaps.push({ at: now, id: swap });
    }
    expect(swaps).toHaveLength(1);
    expect(swaps[0]!.id).toBe("space");
    expect(swaps[0]!.at).toBeGreaterThanOrEqual(1000 + D / 2);
    expect(swaps[0]!.at).toBeLessThan(1000 + D / 2 + frameMs);
    expect(f.busy()).toBe(false);
    expect(f.step(1000 + 3 * D)).toEqual({ alpha: 0, swap: null });
  }
});

test("a frame that skips the whole fade still swaps, once", () => {
  const f = createFader();
  f.start("underwater", 0);
  expect(f.step(0)).toEqual({ alpha: 0, swap: null });
  expect(f.step(10 * D)).toEqual({ alpha: 0, swap: "underwater" });
  expect(f.step(11 * D).swap).toBeNull();
});

test("no fade, no overlay, no swap", () => {
  const f = createFader();
  expect(f.busy()).toBe(false);
  expect(f.step(123)).toEqual({ alpha: 0, swap: null });
});

test("a second switch before the midpoint retargets the same fade", () => {
  const f = createFader();
  f.start("space", 0);
  f.step(D / 4);
  f.start("underwater", D / 4);
  expect(f.step(D / 2)).toEqual({ alpha: 1, swap: "underwater" });
  expect(f.step(D).swap).toBeNull();
});

test("a second switch while fading back in turns round from the current darkness", () => {
  const f = createFader();
  f.start("space", 0);
  expect(f.step(D / 2).swap).toBe("space");
  const before = f.step((3 * D) / 4).alpha;                     // half dark, clearing
  f.start("office", (3 * D) / 4);
  expect(f.step((3 * D) / 4).alpha).toBeCloseTo(before);        // no jump
  expect(f.step((3 * D) / 4 + D / 4)).toEqual({ alpha: 1, swap: "office" });
  expect(f.busy()).toBe(true);
  f.step(10 * D);
  expect(f.busy()).toBe(false);
});

test("a switch long after a fade ended, before any step cleared it, swaps to the new target once", () => {
  // a hidden tab: the fade passed its midpoint, then no frames ran until the next switch arrived
  const f = createFader();
  f.start("space", 0);
  expect(f.step(D / 2 + 10).swap).toBe("space");
  f.start("underwater", 10 * D);
  const swaps: string[] = [];
  for (let now = 10 * D; now <= 12 * D; now += 16) {
    const { swap, alpha } = f.step(now);
    expect(alpha).toBeGreaterThanOrEqual(0);
    if (swap !== null) swaps.push(swap);
  }
  expect(swaps).toEqual(["underwater"]);
  expect(f.busy()).toBe(false);
});

test("a fade never stepped and then retargeted long after its end ends on the new target", () => {
  const f = createFader();
  f.start("space", 0);
  f.start("underwater", 10 * D);
  const swaps: string[] = [];
  for (let now = 10 * D; now <= 12 * D; now += 16) { const { swap } = f.step(now); if (swap !== null) swaps.push(swap); }
  expect(swaps.at(-1)).toBe("underwater");
  expect(f.busy()).toBe(false);
});

test("a step before the fade's start (clock skew) neither swaps nor shows the overlay", () => {
  const f = createFader();
  f.start("space", 1000);
  expect(f.step(500)).toEqual({ alpha: 0, swap: null });
  expect(f.step(1000 + D / 2).swap).toBe("space");
});

test("cancel drops a running fade", () => {
  const f = createFader();
  f.start("space", 0);
  f.cancel();
  expect(f.busy()).toBe(false);
  expect(f.step(D / 2)).toEqual({ alpha: 0, swap: null });
});
