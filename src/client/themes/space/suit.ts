import type { Tier } from "../../../shared/types";
import type { Costume, Frame } from "../../engine/sprite";
import { SPACE } from "./palette";

const S = SPACE.suit;

/** The helmet bubble: an ellipse round the head, wide enough for every hair style. */
const inHelmet = (x: number, y: number, f: Frame): boolean => ((x - 7.5) / 7) ** 2 + ((y - (f.hy + 2.5)) / 6.6) ** 2 <= 1;

function helmet(f: Frame, gold: boolean): void {
  const { g, hy } = f;
  for (let y = hy - 5; y <= hy + 10; y++) for (let x = -1; x <= 16; x++) {
    if (!inHelmet(x, y, f)) continue;
    const rim = !inHelmet(x - 1, y, f) || !inHelmet(x + 1, y, f) || !inHelmet(x, y - 1, f) || !inHelmet(x, y + 1, f);
    if (rim) g.set(x, y, gold ? (y > hy + 4 ? S.goldS : S.gold) : y > hy + 4 ? S.rimS : S.rim);
    else if (g.get(x, y) === null) g.set(x, y, S.glass);
  }
  for (const [x, y] of [[3, hy - 1], [2, hy], [2, hy + 1]] as const) if (g.get(x, y) === S.glass) g.set(x, y, S.glassL);
  g.set(f.back ? 13 : 14, hy + 3, gold ? S.gold : SPACE.led.g);              // helmet lamp
}

/** Life-support pack: peeking out at the sides from the front, covering the back from behind. */
function pack(f: Frame, tier: Tier): void {
  const { g, by } = f;
  const big = tier >= 3;
  const trim = tier === 4 ? S.gold : S.packD;
  if (f.back) {
    const [x0, x1] = big ? [3, 12] : [4, 11];
    g.fill(x0, by - 1, x1, by + 6, S.pack);
    g.fill(x0, by + 6, x1, by + 6, S.packS);
    g.fill(x0, by - 1, x1, by - 1, trim);
    g.fill(6, by + 1, 9, by + 3, S.packS);
    g.set(7, by + 2, SPACE.led.g); g.set(8, by + 2, tier >= 2 ? SPACE.led.b : S.packS);
    if (big) for (const x of [4, 10]) g.fill(x, by + 7, x + 1, by + 8, SPACE.truss.d);   // jet nozzles
    return;
  }
  const [x0, x1] = big ? [2, 13] : [3, 12];
  g.fill(x0, by - 1, x1, by + 6, S.pack);
  g.fill(x0, by + 6, x1, by + 6, S.packS);
  g.set(x0, by - 1, trim); g.set(x1, by - 1, trim);
  if (big) for (const x of [2, 12]) g.fill(x, by + 7, x + 1, by + 8, SPACE.truss.d);
}

function suitBody(f: Frame, tier: Tier): void {
  const { g, by, back } = f;
  if (back) pack(f, tier);
  else {
    g.fill(7, by + 2, 8, by + 3, S.pack);                 // chest control box
    g.set(7, by + 2, tier === 4 ? S.gold : SPACE.led.b); g.set(8, by + 3, SPACE.led.r);
  }
  if (tier === 2) {                                       // tool belt with pouches and a wrench
    g.fill(5, by + 5, 10, by + 5, S.belt);
    if (!back) g.fill(7, by + 5, 8, by + 5, S.gold);
    g.fill(3, by + 5, 4, by + 7, S.pouch); g.fill(11, by + 5, 12, by + 6, S.pouch);
    g.fill(12, by + 7, 12, by + 8, SPACE.hull.l);
  }
  if (tier === 3) {                                       // command stripes on the legs and a chest band
    for (const x of [5, 10]) g.fill(x, by + 7, x, by + 9, S.stripe);
    if (!back) { g.fill(5, by + 1, 6, by + 1, S.white); g.fill(9, by + 1, 10, by + 1, S.white); }
  }
  if (tier === 4) {                                       // gold trim
    g.fill(5, by + 5, 10, by + 5, S.gold);
    for (const x of [5, 10]) g.fill(x, by + 6, x, by + 9, S.goldS);
  }
  // boots: a lighter cuff above each
  for (let x = 3; x <= 12; x++) for (let y = by + 6; y <= by + 11; y++) {
    if (g.get(x, y) === S.boot && g.get(x, y - 1) === S.white) g.set(x, y - 1, S.whiteS);
  }
}

const cache = new Map<Tier, Costume>();

/** Helmet and suit over the base look: tool belt at tier 2, stripes and jetpack at 3, gold trim at 4. The hat sits on the helmet. */
export function suitFor(tier: Tier): Costume {
  let c = cache.get(tier);
  if (c === undefined) {
    c = {
      pal: { pants: S.white, pantsS: S.whiteS, shoe: S.boot },
      behind: f => { if (!f.back) pack(f, tier); },
      body: f => suitBody(f, tier),
      keepHead: inHelmet,
      head: f => helmet(f, tier === 4),
      hatLift: 3,
      spread: 3,
    };
    cache.set(tier, c);
  }
  return c;
}
