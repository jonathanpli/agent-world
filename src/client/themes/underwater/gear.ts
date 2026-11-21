import { mix, shade } from "../../engine/pixels";
import type { Costume, Frame } from "../../engine/sprite";
import type { Look, Tier } from "../../../shared/types";
import { SEA } from "./palette";

const G = SEA.gear;

/** Tanks on the back: one at tier 2, twins from tier 3 (with gold bands at 4). Seen from the front they peek past the shoulders. */
function tanks(f: Frame, tier: Tier): void {
  if (tier === 1) return;
  const { g, by, back } = f;
  const [c, s] = G.tank[tier];
  const band = tier === 4 ? G.gold : s;
  const one = (x0: number, x1: number): void => {
    g.fill(x0, by - 2, x1, by + 6, c); g.fill(x1, by - 1, x1, by + 6, s);
    g.fill(x0, by + 1, x1, by + 1, band); g.fill(x0, by + 4, x1, by + 4, band);
    g.fill(x0 + (x1 > x0 ? 1 : 0), by - 3, x0 + (x1 > x0 ? 1 : 0), by - 3, G.reg);
  };
  if (back) {
    if (tier === 2) one(6, 9);
    else { one(4, 6); one(9, 11); g.fill(5, by - 3, 10, by - 3, G.reg); }
    return;
  }
  if (tier === 2) one(12, 13);
  else { one(2, 3); one(12, 13); }
}

/** Fins: each foot's lowest row is lengthened into a flipper with a pale tip. */
function fins(f: Frame, tier: Tier): void {
  const { g, by } = f;
  const [c, tip] = G.fins[tier];
  for (const [x0, x1] of [[2, 7], [8, 13]] as const) {
    let lo = -1, l = 99, r = -1;
    for (let y = by + 6; y <= by + 12; y++) for (let x = x0; x <= x1; x++) if (g.get(x, y) === c) { lo = Math.max(lo, y); l = Math.min(l, x); r = Math.max(r, x); }
    if (lo < 0) continue;
    g.fill(l - 1, lo + 1, r + 1, lo + 1, c);
    g.set(l - 1, lo + 1, tip); g.set(r + 1, lo + 1, tip);
  }
}

function body(f: Frame, tier: Tier, shorts: string): void {
  const { g, by, back } = f;
  if (tier === 1) g.fill(5, by + 6, 10, by + 7, shorts);              // a snorkeler's swim shorts over bare legs
  else {
    // buoyancy vest straps and waist belt
    for (const x of [5, 10]) g.fill(x, by, x, by + 4, G.bcd);
    g.fill(5, by + 4, 10, by + 4, G.bcd);
    if (!back) g.fill(7, by + 4, 8, by + 4, tier === 4 ? G.gold : G.buckle);
  }
  if (back) tanks(f, tier);
  fins(f, tier);
}

/** Mask over the eyes (gold-framed at tier 4), a snorkel at tier 1, a regulator and hose from tier 2. */
function mask(f: Frame, tier: Tier, lens: string): void {
  const { g, hy, back, facing, pose } = f;
  const frame = tier === 4 ? G.gold : G.frame;
  const side = facing > 0 ? 12 : 3;
  if (back) {
    g.fill(3, hy + 3, 12, hy + 3, frame);
    if (tier === 1) { g.fill(side, hy - 3, side, hy + 3, G.snorkel); g.set(side, hy - 4, G.snorkel); }
    else g.fill(7, hy + 6, 8, hy + 8, G.reg);
    return;
  }
  const d = pose === "walk" || pose === "stand" ? (facing > 0 ? 1 : -1) : 0;
  const ex = 6 + d;
  const eye = f.p.eye;
  g.fill(ex - 2, hy + 2, ex + 5, hy + 2, frame); g.fill(ex - 2, hy + 5, ex + 5, hy + 5, frame);
  g.fill(ex - 2, hy + 3, ex - 2, hy + 4, frame); g.fill(ex + 5, hy + 3, ex + 5, hy + 4, frame);
  for (let y = hy + 3; y <= hy + 4; y++) for (let x = ex - 1; x <= ex + 4; x++) if (g.get(x, y) !== eye) g.set(x, y, lens);
  g.set(ex - 1, hy + 3, G.lensL);
  g.set(ex + 1, hy + 5, lens); g.set(ex + 2, hy + 5, lens);               // the nose pocket
  if (tier === 1) {
    const sx = facing > 0 ? 13 : 2;
    g.fill(sx, hy - 3, sx, hy + 6, G.snorkel); g.set(sx, hy - 4, G.snorkel);
    g.fill(Math.min(sx, ex + 2), hy + 6, Math.max(sx, ex + 2), hy + 6, G.snorkel);
  } else {
    g.fill(ex + 1, hy + 6, ex + 2, hy + 6, G.reg); g.set(ex + 1, hy + 7, G.reg);
    g.set(ex + 3, hy + 7, G.reg); g.set(ex + 4, hy + 8, G.reg);           // the hose, down to the shoulder
  }
}

const cache = new Map<string, Costume>();

/** Mask, fins and tanks over the base look; the hair stays as it is and the hat goes on top. */
export function gearFor(tier: Tier, look: Look): Costume {
  const key = `${tier}${look.body}${look.skin}`;
  let c = cache.get(key);
  if (c === undefined) {
    const [fin] = G.fins[tier];
    c = {
      pal: tier === 1 ? { pants: look.skin, pantsS: shade(look.skin, -0.14), shoe: fin } : { pants: G.wetsuit, pantsS: G.wetsuitS, shoe: fin },
      behind: f => { if (!f.back) tanks(f, tier); },
      body: f => body(f, tier, shade(look.body, -0.35)),
      head: f => mask(f, tier, mix(look.skin, G.lens, 0.55)),                 // skin seen through the glass
    };
    cache.set(key, c);
  }
  return c;
}
