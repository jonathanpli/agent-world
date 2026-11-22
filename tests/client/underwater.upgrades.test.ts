import { expect, test } from "vitest";
import type { Ctx, Rect } from "../../src/client/engine/theme";
import { VIEW } from "../../src/client/engine/view";
import { UPGRADES } from "../../src/shared/shop";
import { underwater } from "../../src/client/themes/underwater";

const MINE = UPGRADES.filter(u => u.theme === "underwater").map(u => u.id);
const ANEMONES = "underwater.sea-anemones", CHEST = "underwater.treasure-chest", STATUE = "underwater.sunken-statue";
const JELLIES = "underwater.glowing-jellyfish-swarm", WRECK = "underwater.shipwreck", WHALE = "underwater.friendly-whale-that-passes-by";
/** The chest and the statue stand by the lounge, which only screen 0 has. */
const LOUNGE_ONLY = [CHEST, STATUE];

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
  underwater.drawUpgrades?.(ctx, new Set(owned), t, screen);
  return { fills, alpha: ctx.globalAlpha };
}

type Fill = { x: number; y: number; w: number; h: number; a: number };
const parse = (fill: string): Fill => {
  const [x, y, w, h, , a] = fill.split(",").map(Number) as number[];
  return { x: x!, y: y!, w: w!, h: h!, a: a! };
};
const overlaps = (f: Fill, r: Rect): boolean => f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y;
const within = (f: Fill, r: Rect): boolean => f.x >= r.x && f.y >= r.y && f.x + f.w <= r.x + r.w && f.y + f.h <= r.y + r.h;

/** Two minutes of frames, a quarter second apart. */
const TIMES = Array.from({ length: 481 }, (_, i) => i * 0.25);
const whaleFrames = (screen: number): number[] => TIMES.filter(t => paint([WHALE], screen, t).fills.length > 0);
/** A moment the whale is crossing screen 0, well clear of either edge. */
const WHALE_T = (() => {
  const seen = whaleFrames(0);
  return seen[Math.floor(seen.length / 2)] ?? 1.3;
})();

test("underwater has six upgrades in the catalog and draws its own", () => {
  expect(MINE).toEqual([ANEMONES, CHEST, STATUE, JELLIES, WRECK, WHALE]);
  expect(typeof underwater.drawUpgrades).toBe("function");
});

test("nothing owned paints nothing", () => {
  for (const screen of [0, 1, 2]) for (const t of [0, 1.3, WHALE_T]) expect(paint([], screen, t).fills).toHaveLength(0);
});

test("each upgrade alone paints on screen 0, and each paints something different", () => {
  const seen = new Map<string, string>();
  for (const id of MINE) {
    const { fills } = paint([id], 0, WHALE_T);
    expect(fills.length, id).toBeGreaterThan(0);
    const key = fills.join("|");
    expect(seen.has(key), `${id} paints the same as ${seen.get(key)}`).toBe(false);
    seen.set(key, id);
  }
});

test("all six paint more than any one alone on screen 0", () => {
  const all = paint(MINE, 0, WHALE_T).fills.length;
  for (const id of MINE) expect(all, id).toBeGreaterThan(paint([id], 0, WHALE_T).fills.length);
});

test("the chest and the statue show only on screen 0; the seabed and open-water pieces show on every screen", () => {
  for (const screen of [1, 2, 3]) {
    for (const id of LOUNGE_ONLY) expect(paint([id], screen).fills, `${id} on screen ${screen}`).toHaveLength(0);
    for (const id of [ANEMONES, JELLIES, WRECK]) expect(paint([id], screen).fills.length, `${id} on screen ${screen}`).toBeGreaterThan(0);
    expect(whaleFrames(screen).length, `whale on screen ${screen}`).toBeGreaterThan(0);
  }
});

test("the whale passes by now and then: off-screen between passes, moving while it crosses", () => {
  const seen = whaleFrames(0);
  expect(seen.length).toBeGreaterThan(TIMES.length * 0.1);
  expect(seen.length).toBeLessThan(TIMES.length * 0.6);
  const leftmost = (t: number): number => Math.min(...paint([WHALE], 0, t).fills.map(f => parse(f).x));
  const mid = seen[Math.floor(seen.length / 2)]!;
  expect(leftmost(mid + 2)).not.toBe(leftmost(mid));
  // it swims on from one screen to the next rather than crossing them all at once
  expect(whaleFrames(1)).not.toEqual(seen);
});

test("animated pieces (anemones, jellyfish, chest glint, whale) change over time", () => {
  for (const id of [ANEMONES, JELLIES, CHEST]) {
    const frames = new Set([0, 0.4, 0.9, 1.7, 2.6].map(t => paint([id], 0, t).fills.join("|")));
    expect(frames.size, id).toBeGreaterThan(1);
  }
});

test("globalAlpha is back to 1 afterwards, whatever is owned and whenever", () => {
  for (const owned of [[], ...MINE.map(id => [id]), MINE]) for (const screen of [0, 1]) for (const t of [0, 0.7, 13.3, WHALE_T, 1e6]) {
    expect(paint(owned, screen, t).alpha).toBe(1);
  }
});

test("unknown and foreign ids never throw and paint nothing", () => {
  for (const screen of [0, 1]) {
    const r = paint(["underwater.nope", "space.docked-shuttle", "", "underwater.", "__proto__", "underwater.shipwreck.x"], screen);
    expect(r.fills).toHaveLength(0);
  }
  expect(() => paint([...MINE, "underwater.nope"], 0, Number.NaN)).not.toThrow();
  expect(() => paint(MINE, -1)).not.toThrow();
  expect(() => paint(MINE, Number.NaN, Number.POSITIVE_INFINITY)).not.toThrow();
});

test("the treasure chest adds a social spot inside the lounge, next to the chest, and nothing else does", () => {
  const spots = underwater.upgradeSocialSpots ?? {};
  expect(Object.keys(spots)).toEqual([CHEST]);
  const p = spots[CHEST]!;
  const { x, y, w, h } = underwater.lounge;
  expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + w);
  expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + h);
  const chest = paint([CHEST], 0).fills.map(parse);
  const left = Math.min(...chest.map(f => f.x)), right = Math.max(...chest.map(f => f.x + f.w));
  const top = Math.min(...chest.map(f => f.y));
  expect(p.x).toBeGreaterThanOrEqual(left - 12); expect(p.x).toBeLessThanOrEqual(right + 12);
  expect(Math.abs(p.y - top)).toBeLessThanOrEqual(12);
});

test("everything stays inside the view", () => {
  for (const screen of [0, 1]) for (const t of [0, 1.3, WHALE_T, ...whaleFrames(screen).filter((_, i) => i % 9 === 0)]) {
    for (const fill of paint(MINE, screen, t).fills) {
      expect(within(parse(fill), { x: 0, y: 0, w: VIEW.w, h: VIEW.h }), `screen ${screen} t ${t}: ${fill}`).toBe(true);
    }
  }
});

test("no upgrade paints over a dive site or its name plate, for any number of sites", () => {
  const blocked: Rect[] = [];
  for (let count = 1; count <= 6; count++) for (let i = 0; i < count; i++) blocked.push(underwater.placeFor(i, count).rect);
  for (const screen of [0, 1]) for (const t of [0, 1.3, WHALE_T, ...whaleFrames(screen).filter((_, i) => i % 9 === 0)]) {
    for (const fill of paint(MINE, screen, t).fills) {
      const f = parse(fill);
      if (f.a < 0.5) continue;                                         // translucent glow may fall anywhere
      for (const r of blocked) expect(overlaps(f, r), `screen ${screen} t ${t}: ${fill} over ${JSON.stringify(r)}`).toBe(false);
    }
  }
});

test("nothing solid where a lounge diver can be (the lounge, and the 24 px above it a diver's body reaches)", () => {
  const l = underwater.lounge, swim: Rect = { x: l.x, y: l.y - 24, w: l.w, h: l.h + 24 };
  for (const t of [0, 1.3, 5.2, WHALE_T]) for (const fill of paint(MINE, 0, t).fills) {
    const f = parse(fill);
    if (f.a < 0.5) continue;
    expect(overlaps(f, swim), `t ${t}: ${fill}`).toBe(false);
  }
});

test("the whale keeps to the open water above every dive site", () => {
  for (const screen of [0, 1]) for (const t of whaleFrames(screen)) for (const fill of paint([WHALE], screen, t).fills) {
    const f = parse(fill);
    expect(f.y + f.h, `screen ${screen} t ${t}: ${fill}`).toBeLessThanOrEqual(42);
  }
});
