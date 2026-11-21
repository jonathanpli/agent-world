import { expect, test } from "vitest";
import { computeLayout } from "../../src/client/engine/actors";
import { layoutPlates, plateText, type PlateText } from "../../src/client/engine/overlay";
import { THEMES, VIEW, type Point, type Rect } from "../../src/client/engine/theme";
import type { Repo } from "../../src/shared/types";
import { repo } from "../helpers/clientFixtures";

const repos = (n: number): Repo[] => Array.from({ length: n }, (_, i) => repo(`r${i}`, i));
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const NAMES = ["Margaret", "Katherine", "Yukihiro", "Barbara", "Kathleen", "Frances"];

function expectOnScreen(r: Rect, screen: number): void {
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.y + r.h).toBeLessThanOrEqual(VIEW.h);
  expect(r.x).toBeGreaterThanOrEqual(screen * VIEW.w);
  expect(r.x + r.w).toBeLessThanOrEqual((screen + 1) * VIEW.w);
}

test("plate text: compact is name and level, full adds the title, temps are just Temp", () => {
  expect(plateText("Ada", 3, "Senior", false)).toEqual({ name: "Ada", rest: " 3" });
  expect(plateText("Ada", 3, "Senior", true)).toEqual({ name: "Ada", rest: " · Senior · Lv 3" });
  expect(plateText("Temp", null, "Engineer", false)).toEqual({ name: "Temp", rest: "" });
  expect(plateText("Temp", null, "Engineer", true)).toEqual({ name: "Temp", rest: " · Engineer" });
});

for (const theme of THEMES) test(`${theme.id}: a full place in the bottom row keeps every plate inside the view, on screens 0 and 1`, () => {
  for (const [count, screen] of [[6, 0], [12, 1]] as const) {
    const L = computeLayout(theme, repos(count));
    for (const idx of [3, 4, 5]) {
      const { place, screen: s } = L.places.get(`r${screen * 6 + idx}`)!;
      expect(s).toBe(screen);
      const items = place.spots.map((p, i) => ({ at: { x: p.x + s * VIEW.w, y: p.y }, text: plateText(NAMES[i]!, 12, "Principal", false) }));
      const rects = layoutPlates(items);
      for (const r of rects) expectOnScreen(r, screen);
      for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
  }
});

for (const theme of THEMES) test(`${theme.id}: a lounge actor at the right edge keeps its full plate on screen`, () => {
  for (const at of [{ x: VIEW.w - 1, y: theme.lounge.y + theme.lounge.h }, { x: 1, y: VIEW.h }, { x: VIEW.w + 2, y: 0 }] as Point[]) {
    const screen = Math.floor(at.x / VIEW.w);
    const [r] = layoutPlates([{ at, text: plateText("Margaret", 24, "Principal", true) }]);
    expectOnScreen(r!, screen);
  }
});

for (const theme of THEMES) test(`${theme.id}: compact plates for full rows at the tightest spot pitch never overlap`, () => {
  const L = computeLayout(theme, repos(6));
  const items: { at: Point; text: PlateText }[] = [];
  for (const { place } of L.places.values()) place.spots.forEach((p, i) => items.push({ at: p, text: plateText(NAMES[i]!, 24, "Principal", false) }));
  const pitch = L.places.get("r0")!.place.spots[1]!.x - L.places.get("r0")!.place.spots[0]!.x;
  expect(pitch).toBeLessThan(45);                                  // this really is the crowded case
  const rects = layoutPlates(items);
  for (const r of rects) expectOnScreen(r, 0);
  for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
});

for (const theme of THEMES) test(`${theme.id}: compact plates move out of the way of an obstacle (the hovered actor's full plate)`, () => {
  const L = computeLayout(theme, repos(6));
  const spots = L.places.get("r5")!.place.spots;
  const [full] = layoutPlates([{ at: spots[0]!, text: plateText("Margaret", 24, "Principal", true) }]);
  const rects = layoutPlates(spots.slice(1).map((p, i) => ({ at: p, text: plateText(NAMES[i + 1]!, 3, "Senior", false) })), [full!]);
  for (const r of rects) { expectOnScreen(r, 0); expect(overlaps(r, full!)).toBe(false); }
});
