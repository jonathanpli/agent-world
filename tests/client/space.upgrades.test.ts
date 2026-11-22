import { expect, test } from "vitest";
import type { Ctx, Rect } from "../../src/client/engine/theme";
import { VIEW } from "../../src/client/engine/view";
import { UPGRADES } from "../../src/shared/shop";
import { space } from "../../src/client/themes/space";
import { DECK_WINDOW } from "../../src/client/themes/space/scenery";

const MINE = UPGRADES.filter(u => u.theme === "space").map(u => u.id);
/** Everything but the shuttle lives on or around the observation deck, which only screen 0 has. */
const DECK_ONLY = MINE.filter(id => id !== "space.docked-shuttle");

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
  space.drawUpgrades!(ctx, new Set(owned), t, screen);
  return { fills, alpha: ctx.globalAlpha };
}

type Fill = { x: number; y: number; w: number; h: number; a: number };
const parse = (fill: string): Fill => {
  const [x, y, w, h, , a] = fill.split(",").map(Number) as number[];
  return { x: x!, y: y!, w: w!, h: h!, a: a! };
};
const overlaps = (f: Fill, r: Rect): boolean => f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y;
const within = (f: Fill, r: Rect): boolean => f.x >= r.x && f.y >= r.y && f.x + f.w <= r.x + r.w && f.y + f.h <= r.y + r.h;

test("space has six upgrades in the catalog and draws its own", () => {
  expect(MINE).toEqual([
    "space.hydroponic-planter", "space.drink-dispenser", "space.star-chart-display",
    "space.observation-dome", "space.docked-shuttle", "space.ringed-planet-in-the-window",
  ]);
  expect(typeof space.drawUpgrades).toBe("function");
});

test("nothing owned paints nothing", () => {
  for (const screen of [0, 1, 2]) expect(paint([], screen).fills).toHaveLength(0);
});

test("each upgrade alone paints on screen 0, and each paints something different", () => {
  const seen = new Map<string, string>();
  for (const id of MINE) {
    const { fills } = paint([id], 0);
    expect(fills.length, id).toBeGreaterThan(0);
    const key = fills.join("|");
    expect(seen.has(key), `${id} paints the same as ${seen.get(key)}`).toBe(false);
    seen.set(key, id);
  }
});

test("all six paint more than any one alone on screen 0", () => {
  const all = paint(MINE, 0).fills.length;
  for (const id of MINE) expect(all, id).toBeGreaterThan(paint([id], 0).fills.length);
});

test("deck pieces show only on screen 0; the shuttle docks on every screen", () => {
  for (const screen of [1, 2, 3]) {
    for (const id of DECK_ONLY) expect(paint([id], screen).fills, `${id} on screen ${screen}`).toHaveLength(0);
    expect(paint(["space.docked-shuttle"], screen).fills.length, `shuttle on screen ${screen}`).toBeGreaterThan(0);
  }
});

test("animated pieces (grow lights, star chart, shuttle lights, ring sparkle) change over time", () => {
  for (const id of ["space.hydroponic-planter", "space.star-chart-display", "space.docked-shuttle", "space.ringed-planet-in-the-window"]) {
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
    const r = paint(["space.nope", "office.coffee-machine", "", "space.", "__proto__", "space.docked-shuttle.x"], screen);
    expect(r.fills).toHaveLength(0);
  }
  expect(() => paint([...MINE, "space.nope"], 0, Number.NaN)).not.toThrow();
  expect(() => paint(MINE, -1)).not.toThrow();
});

test("the drink dispenser adds a social spot inside the lounge, and nothing else does", () => {
  const spots = space.upgradeSocialSpots ?? {};
  expect(Object.keys(spots)).toEqual(["space.drink-dispenser"]);
  const p = spots["space.drink-dispenser"]!;
  const { x, y, w, h } = space.lounge;
  expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
  expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
});

test("everything stays inside the view", () => {
  for (const screen of [0, 1]) for (const fill of paint(MINE, screen).fills) {
    expect(within(parse(fill), { x: 0, y: 0, w: VIEW.w, h: VIEW.h }), `screen ${screen}: ${fill}`).toBe(true);
  }
});

test("no upgrade paints over a module, its docking tube or its name band, for any number of modules", () => {
  const blocked: Rect[] = [];
  for (let count = 1; count <= 6; count++) for (let i = 0; i < count; i++) {
    const r = space.placeFor(i, count).rect;
    blocked.push(r);
    const cx = Math.round(r.x + r.w / 2);
    blocked.push({ x: cx - 6, y: 33, w: 12, h: r.y - 33 });        // scenery.ts: the top row docks to the truss
  }
  for (const screen of [0, 1]) for (const fill of paint(MINE, screen).fills) {
    const f = parse(fill);
    if (f.a < 0.5) continue;                                         // translucent glow may fall anywhere
    for (const r of blocked) expect(overlaps(f, r), `screen ${screen}: ${fill} over ${JSON.stringify(r)}`).toBe(false);
  }
});

test("inside the lounge, upgrades paint only on the window glass, behind the floating astronauts", () => {
  for (const fill of paint(MINE, 0).fills) {
    const f = parse(fill);
    if (f.a < 0.5 || !overlaps(f, space.lounge)) continue;
    expect(within(f, DECK_WINDOW), fill).toBe(true);
  }
});
