import { expect, test } from "vitest";
import type { Ctx } from "../../src/client/engine/theme";
import { UPGRADES } from "../../src/shared/shop";
import { office } from "../../src/client/themes/office";

const MINE = UPGRADES.filter(u => u.theme === "office").map(u => u.id);
const LOUNGE_ONLY = ["office.coffee-machine", "office.arcade-cabinet"];

/** A context that records each filled rectangle (with its colour and alpha) and the alpha left at the end. */
function recordingCtx(): { ctx: Ctx; fills: string[] } {
  const fills: string[] = [];
  const ctx = {
    fillStyle: "", globalAlpha: 1,
    fillRect(this: { fillStyle: string; globalAlpha: number }, x: number, y: number, w: number, h: number) {
      fills.push(`${x},${y},${w},${h},${this.fillStyle},${this.globalAlpha}`);
    },
  } as unknown as Ctx;
  return { ctx, fills };
}

function paint(owned: Iterable<string>, screen: number, t = 1.3): { fills: string[]; alpha: number } {
  const { ctx, fills } = recordingCtx();
  office.drawUpgrades!(ctx, new Set(owned), t, screen);
  return { fills, alpha: ctx.globalAlpha };
}

test("the office has six upgrades in the catalog and draws its own", () => {
  expect(MINE).toEqual([
    "office.desk-plants", "office.coffee-machine", "office.wall-art",
    "office.arcade-cabinet", "office.fish-tank", "office.rooftop-skylight",
  ]);
  expect(typeof office.drawUpgrades).toBe("function");
});

test("nothing owned paints nothing", () => {
  for (const screen of [0, 1, 2]) expect(paint([], screen).fills).toHaveLength(0);
});

test("each upgrade alone paints on the lounge screen, and each paints something different", () => {
  const seen = new Map<string, string>();
  for (const id of MINE) {
    const { fills } = paint([id], 0);
    expect(fills.length, id).toBeGreaterThan(0);
    const key = fills.join("|");
    expect(seen.has(key), `${id} paints the same as ${seen.get(key)}`).toBe(false);
    seen.set(key, id);
  }
});

test("all six paint more than any one alone, on every screen", () => {
  for (const screen of [0, 1, 3]) {
    const all = paint(MINE, screen).fills.length;
    for (const id of MINE) expect(all, `${id} on screen ${screen}`).toBeGreaterThan(paint([id], screen).fills.length);
  }
});

test("lounge pieces show only on the lounge screen; wall and floor pieces repeat on later screens", () => {
  for (const id of MINE) {
    const later = paint([id], 1).fills.length;
    if (LOUNGE_ONLY.includes(id)) expect(later, id).toBe(0);
    else expect(later, id).toBeGreaterThan(0);
  }
});

test("animated pieces (fish, arcade screen, light shaft) change over time", () => {
  for (const id of ["office.fish-tank", "office.arcade-cabinet", "office.rooftop-skylight"]) {
    const frames = new Set([0, 0.4, 0.9, 1.7, 2.6].map(t => paint([id], 0, t).fills.join("|")));
    expect(frames.size, id).toBeGreaterThan(1);
  }
});

test("globalAlpha is back to 1 afterwards, whatever is owned and whenever", () => {
  for (const owned of [[], ...MINE.map(id => [id]), MINE]) for (const screen of [0, 1]) for (const t of [0, 0.7, 13.3, 1e6]) {
    expect(paint(owned, screen, t).alpha).toBe(1);
  }
});

test("unknown and foreign ids never throw and paint nothing", () => {
  for (const screen of [0, 1]) {
    const r = paint(["office.nope", "space.drink-dispenser", "", "office.", "__proto__", "office.desk-plants.x"], screen);
    expect(r.fills).toHaveLength(0);
  }
  expect(() => paint([...MINE, "office.nope"], 0, Number.NaN)).not.toThrow();
  expect(() => paint(MINE, -1)).not.toThrow();
});

test("the coffee machine adds a social spot inside the lounge, and nothing else does", () => {
  const spots = office.upgradeSocialSpots ?? {};
  expect(Object.keys(spots)).toEqual(["office.coffee-machine"]);
  const p = spots["office.coffee-machine"]!;
  const { x, y, w, h } = office.lounge;
  expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
  expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
});

test("no upgrade paints inside the place area, where carpets, desks and name plates go", () => {
  // The place area is x 4..384, y 38..266 on every screen (room.ts AREA); places stay at least 4 px inside it.
  for (const screen of [0, 1]) for (const fill of paint(MINE, screen).fills) {
    const [fx, fy, fw, fh, , a] = fill.split(",").map(Number) as number[];
    if (a! < 0.5) continue;                                        // translucent light may fall anywhere
    const inside = fx! < 380 && fx! + fw! > 8 && fy! < 262 && fy! + fh! > 42;
    expect(inside, `screen ${screen}: ${fill}`).toBe(false);
  }
});

test("no upgrade paints solid inside the lounge, where idle characters walk", () => {
  const { x, y, w, h } = office.lounge;
  for (const fill of paint(MINE, 0).fills) {
    const [fx, fy, fw, fh, , a] = fill.split(",").map(Number) as number[];
    if (a! < 0.5) continue;
    const inside = fx! < x + w && fx! + fw! > x && fy! < y + h && fy! + fh! > y;
    expect(inside, fill).toBe(false);
  }
});
