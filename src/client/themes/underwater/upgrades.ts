import { ellipse, PixelGrid, rect, shade } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { VIEW } from "../../engine/view";
import { SEA } from "./palette";
import { LOUNGE } from "./scenery";

/**
 * The reef's shop upgrades. Dive sites (and their name plates) can fill x 8..380, y 42..262 on every screen and are
 * drawn over this, and on screen 0 off-duty divers swim anywhere in the lounge (x 398..468, feet y 80..246, bodies up
 * to 24 px higher). So: the anemones line the strip of sand under the sites, the wreck lies in it with its mast up the
 * left margin, the jellyfish and the whale keep to the open water above the sites (y < 42), and on screen 0 the statue
 * stands in the gap between the sites and the lounge and the chest sits on the sand under the lounge's left end.
 */
const ID = {
  anemones: "underwater.sea-anemones",
  chest: "underwater.treasure-chest",
  statue: "underwater.sunken-statue",
  jellies: "underwater.glowing-jellyfish-swarm",
  wreck: "underwater.shipwreck",
  whale: "underwater.friendly-whale-that-passes-by",
} as const;

const U = SEA.upgrades;
const INK = SEA.ink;
/** The bottom of the lowest dive site: below it only sand, down to the bottom of the view. */
const SITES_BOTTOM = 262;

const wrap = (v: number, m: number): number => ((v % m) + m) % m;

/** Draws a grid with its local (0, 0) at (x, y), dropping whatever falls outside the view's columns. */
function blitClipped(ctx: Ctx, g: PixelGrid, x0: number, y0: number): void {
  const x = x0 - g.ox, y = y0 - g.oy;
  for (let gy = 0; gy < g.h; gy++) {
    let gx = 0;
    while (gx < g.w) {
      const c = g.px[gy * g.w + gx];
      if (c === null || c === undefined) { gx++; continue; }
      let end = gx + 1;
      while (end < g.w && g.px[gy * g.w + end] === c) end++;
      const a = Math.max(0, x + gx), b = Math.min(VIEW.w, x + end);
      if (b > a) rect(ctx, a, y + gy, b - a, 1, c);
      gx = end;
    }
  }
}

/** One anemone on the sand: a stubby column, an oral disc, and a crown of tentacles swaying with the swell. */
function anemone(ctx: Ctx, x: number, base: number, size: number, kind: number, t: number): void {
  const A = U.anemones[kind % U.anemones.length]!;
  rect(ctx, x - 3, base - 3, 7, 3, INK);
  rect(ctx, x - 2, base - 3, 5, 3, A.d);
  rect(ctx, x - 2, base - 3, 1, 3, A.c);
  rect(ctx, x - 3, base - 4, 7, 1, A.c);                                               // the oral disc
  for (const [i, dx] of [-4, -2, 0, 2, 4].entries()) {
    for (let j = 0; j < size; j++) {
      const k = (j + 1) / size;
      const sway = Math.round(Math.sin(t * 1.4 + x * 0.7 + i + j * 0.4) * 1.4 * k + dx * k * 0.35);
      rect(ctx, x + dx + sway, base - 5 - j, 1, 1, j === size - 1 ? A.l : i % 2 === 0 ? A.c : shade(A.c, 0.12));
    }
  }
}

/** A clownfish nosing in and out of an anemone's tentacles. */
function clownfish(ctx: Ctx, x: number, y: number, t: number): void {
  const dx = Math.round(Math.sin(t * 0.9 + x) * 4), dir = Math.cos(t * 0.9 + x) >= 0 ? 1 : -1;
  const fx = x + dx, fy = y + Math.round(Math.sin(t * 2.3) * 0.6);
  rect(ctx, fx - 3, fy - 1, 6, 4, INK);
  rect(ctx, fx - 2, fy, 4, 2, SEA.clown);
  rect(ctx, fx, fy, 1, 2, U.clownStripe);
  rect(ctx, fx - 3 * dir - (dir < 0 ? 0 : 1), fy - (Math.floor(t * 6) % 2), 1, 3, SEA.clown);  // the tail
  rect(ctx, fx + dir, fy, 1, 1, INK);
}

/** Anemones dotted along the sand under the dive sites (and, past the lounge, where there's more room). */
function anemones(ctx: Ctx, t: number, screen: number): void {
  const bed: [number, number][] = [[166, 3], [178, 4], [214, 4], [226, 3], [238, 4], [276, 4], [290, 3], [330, 4], [343, 3], [366, 4]];
  bed.forEach(([x, s], i) => anemone(ctx, x, VIEW.h, s, i, t));
  if (screen === 0) {                                                                // the corner past the clam
    anemone(ctx, 472, 266, 7, 0, t);
    clownfish(ctx, 472, 256, t);
  } else {                                                                           // the sand under the old bow
    for (const [x, s, k] of [[404, 6, 2], [432, 7, 0], [462, 5, 1]] as const) anemone(ctx, x, VIEW.h - 1, s, k, t);
    clownfish(ctx, 432, VIEW.h - 13, t);
  }
}

/** A heap of gold in an open chest on the sand, a few coins spilled round it and a glint running over the hoard. */
function chest(ctx: Ctx, t: number): void {
  const C = SEA.chest, x = 400, base = 265;
  ctx.globalAlpha = 0.3; ellipse(ctx, x + 8, base, 11, 2, INK); ctx.globalAlpha = 1;
  // the lid, thrown back
  rect(ctx, x, base - 17, 17, 7, INK);
  rect(ctx, x + 1, base - 16, 15, 5, C.d);
  rect(ctx, x + 1, base - 16, 15, 1, C.band);
  rect(ctx, x + 4, base - 16, 1, 5, C.band); rect(ctx, x + 12, base - 16, 1, 5, C.band);
  // the box
  rect(ctx, x, base - 10, 17, 10, INK);
  rect(ctx, x + 1, base - 9, 15, 8, C.c);
  rect(ctx, x + 1, base - 9, 15, 1, shade(C.c, 0.2));
  rect(ctx, x + 1, base - 5, 15, 1, C.band);
  rect(ctx, x + 4, base - 9, 1, 8, C.band); rect(ctx, x + 12, base - 9, 1, 8, C.band);
  rect(ctx, x + 7, base - 7, 3, 4, C.band); rect(ctx, x + 8, base - 6, 1, 2, INK);     // the lock
  // the gold, heaped over the rim
  rect(ctx, x + 1, base - 11, 15, 2, C.gold);
  rect(ctx, x + 3, base - 12, 11, 1, C.gold); rect(ctx, x + 6, base - 13, 5, 1, C.gold);
  rect(ctx, x + 5, base - 12, 2, 1, C.goldL); rect(ctx, x + 9, base - 11, 1, 1, C.gem); rect(ctx, x + 12, base - 11, 1, 1, "#5ad0ff");
  for (const [cx, cy] of [[-3, -2], [-2, -1], [18, -1], [20, -2], [19, 0]] as const) {   // spilled coins
    rect(ctx, x + cx, base + cy, 2, 1, C.gold); rect(ctx, x + cx, base + cy, 1, 1, C.goldL);
  }
  const g = Math.floor(t * 4) % 8;                                                    // a glint sliding over the gold
  if (g < 5) { rect(ctx, x + 3 + g * 2, base - 13 + (g % 2), 1, 1, "#ffffff"); rect(ctx, x + 2 + g * 2, base - 12 + (g % 2), 3, 1, C.goldL); }
}

/** An old sea king in weathered stone on a plinth, trident raised, mossy and cracked, a starfish on the plinth. */
function statue(ctx: Ctx, t: number): void {
  const S = U.statue, ox = 382, top = 194;
  const g = new PixelGrid(16, 64);
  const px = (x: number, y: number, c: string): void => g.set(x, y, c);
  const box = (x0: number, y0: number, x1: number, y1: number, c: string): void => g.fill(x0, y0, x1, y1, c);
  // plinth (rows 54..61), sunk into the sand
  box(1, 54, 13, 61, S.c); box(1, 54, 13, 54, S.l); box(1, 61, 13, 61, S.d); box(12, 55, 13, 61, S.d);
  box(2, 57, 12, 57, S.d);
  // the trident, held up in the right hand: shaft, crossbar, three prongs
  box(12, 4, 12, 50, S.d); box(13, 4, 13, 50, S.c);
  box(10, 4, 14, 5, S.c); box(10, 0, 10, 4, S.c); box(12, 0, 13, 3, S.l); box(14, 0, 14, 4, S.c);
  // robe, wider at the hem, folds down it
  for (let y = 30; y <= 53; y++) {
    const half = 3 + Math.floor((y - 30) / 12);
    box(6 - half, y, 6 + half, y, S.c);
    px(6 - half, y, S.l);
  }
  for (const fx of [4, 7, 9]) box(fx, 38, fx, 53, S.d);
  // torso and arms: the left hanging, the right up to the trident
  box(3, 20, 9, 30, S.c); box(3, 20, 4, 30, S.l); box(4, 26, 9, 26, S.d);              // a belt
  box(1, 21, 2, 31, S.c); box(1, 32, 2, 33, S.l);                                       // left arm and hand
  box(10, 19, 11, 22, S.c); box(11, 14, 11, 19, S.c); box(11, 13, 12, 15, S.l);         // right arm, raised
  // head with a crown and a long beard
  box(4, 11, 8, 18, S.c); box(4, 11, 4, 16, S.l);
  px(5, 14, S.d); px(7, 14, S.d);                                                       // eyes
  box(4, 17, 8, 21, S.l); box(5, 22, 7, 23, S.l); px(6, 24, S.l);                       // beard
  box(4, 9, 8, 10, S.gold); px(4, 7, S.gold); px(4, 8, S.gold); px(6, 6, S.gold); px(6, 7, S.gold); px(6, 8, S.gold); px(8, 7, S.gold); px(8, 8, S.gold);
  // age: a crack across the chest, moss on the shoulders and the hem
  px(5, 23, S.crack); px(6, 24, S.crack); px(7, 25, S.crack); px(7, 27, S.crack); px(8, 28, S.crack);
  for (const [mx, my] of [[3, 20], [4, 20], [9, 20], [2, 50], [3, 52], [10, 52], [11, 53], [9, 51], [1, 53], [2, 53]] as const) px(mx, my, S.moss);
  g.outline(INK);
  blitClipped(ctx, g, ox, top);
  const st = top + 57;                                                                  // a starfish on the plinth
  rect(ctx, ox + 5, st, 3, 1, SEA.star); rect(ctx, ox + 6, st - 1, 1, 3, SEA.star); rect(ctx, ox + 4, st + 1, 1, 1, SEA.star); rect(ctx, ox + 8, st + 1, 1, 1, SEA.star);
  if (Math.floor(t * 0.5) % 5 === 0) rect(ctx, ox + 6, top + 9, 1, 1, "#ffffff");      // a glint on the crown now and then
}

/** A jellyfish: a domed bell that pulses, trailing tentacles, wrapped in a soft glow. */
function jelly(ctx: Ctx, x: number, y: number, kind: number, t: number): void {
  const J = U.jellies[kind % U.jellies.length]!;
  const pulse = (Math.sin(t * 2.2 + kind * 1.9) + 1) / 2;                              // 0 open .. 1 squeezed
  const squeeze = pulse > 0.6 ? 1 : 0;
  ctx.globalAlpha = 0.16 + 0.1 * pulse;
  ellipse(ctx, x, y + 4, 8, 7, J.glow);
  ctx.globalAlpha = 0.24 + 0.1 * pulse;
  ellipse(ctx, x, y + 2, 5, 4, J.glow);
  ctx.globalAlpha = 1;
  const w0 = 3, w1 = 7 - squeeze * 2, w2 = 9 - squeeze * 2;
  rect(ctx, x - (w0 >> 1), y, w0, 1, J.l);
  rect(ctx, x - (w1 >> 1), y + 1, w1, 1, J.bell); rect(ctx, x - (w1 >> 1) + 1, y + 1, 2, 1, J.l);
  rect(ctx, x - (w2 >> 1), y + 2, w2, 2, J.bell); rect(ctx, x - (w2 >> 1) + 1, y + 2, 1, 1, J.l);
  rect(ctx, x - (w2 >> 1), y + 4, w2, 1, J.rim);
  const len = 4 + squeeze * 2;
  for (const [i, dx] of [-3, -1, 1, 3].entries()) {
    for (let j = 0; j < len; j++) {
      const wave = Math.round(Math.sin(t * 2 + j * 0.8 + i * 1.3) * (j / len) * 1.2);
      rect(ctx, x + dx - squeeze * Math.sign(dx) + wave, y + 5 + j, 1, 1, j % 2 === 0 ? J.rim : J.bell);
    }
  }
}

/** A loose swarm drifting in the open water above the right-hand sites and the lounge (or the wreck's bow). */
function jellies(ctx: Ctx, t: number, screen: number): void {
  const swarm = [[300, 16, 1], [326, 24, 0], [352, 12, 2], [378, 22, 1], [404, 14, 0], [428, 25, 2], [450, 12, 1], [464, 24, 0]] as const;
  swarm.forEach(([bx, by, k], i) => {
    const ph = i * 1.7 + screen * 0.9;
    const x = Math.round(bx + Math.sin(t * 0.21 + ph) * 5), y = Math.round(by + Math.sin(t * 0.47 + ph) * 2);
    jelly(ctx, x, y, k, t + i);
  });
}

/** The wreck of an old galleon lying in the sand under the dive sites, its stern and broken mast up the left margin. */
function wreck(ctx: Ctx, t: number): void {
  const W = SEA.wood, R = U.wreck, y0 = SITES_BOTTOM;
  // the mast, snapped off, with a yard and a torn sail; everything up here keeps to the 8 px left of the sites
  rect(ctx, 2, 180, 5, 50, INK);
  rect(ctx, 3, 182, 3, 48, W.c); rect(ctx, 3, 182, 1, 48, W.l);
  rect(ctx, 3, 180, 1, 2, W.c); rect(ctx, 5, 179, 1, 3, W.d);                            // the jagged break
  rect(ctx, 0, 191, 8, 3, INK); rect(ctx, 0, 192, 8, 1, W.d);                            // the yard
  const sway = Math.round(Math.sin(t * 0.8) * 0.6);
  for (let y = 194; y < 214; y++) {                                                      // the sail, ragged at the foot
    const ragged = (y - 194) > 12 + ((y * 7) % 5);
    for (const x of [0, 1, 6, 7]) if (!ragged || x % 3 === 0) rect(ctx, Math.min(7, Math.max(0, x + (y > 204 ? sway : 0))), y, 1, 1, (x + y) % 5 === 0 ? R.sailD : R.sail);
  }
  // the stern castle: planks, two lit windows, a lantern still glowing
  rect(ctx, 0, 230, 8, y0 - 230, INK);
  rect(ctx, 0, 231, 7, y0 - 231, W.c);
  for (let y = 234; y < y0; y += 4) rect(ctx, 0, y, 7, 1, W.d);
  rect(ctx, 0, 231, 7, 1, W.l);
  const flicker = 0.75 + 0.25 * Math.sin(t * 5) * Math.sin(t * 1.3);
  for (const wy of [238, 248]) { rect(ctx, 1, wy, 5, 5, W.brass); rect(ctx, 2, wy + 1, 3, 3, R.lamp); rect(ctx, 3, wy + 1, 1, 3, W.brass); }
  ctx.globalAlpha = 0.3 * flicker; ellipse(ctx, 4, 225, 4, 4, R.lamp); ctx.globalAlpha = 1;
  rect(ctx, 6, 221, 1, 9, INK); rect(ctx, 4, 221, 3, 1, INK);                           // the lantern on its bracket
  rect(ctx, 3, 223, 3, 4, INK); rect(ctx, 4, 224, 1, 2, R.lamp);
  // the hull, keeled over and half buried, bow to the right: rail, a gilt wale, gun ports, a stove-in gap
  const len = 150;
  for (let x = 0; x < len; x++) {
    const top = y0 + (x > len - 12 ? Math.round((x - (len - 12)) / 2.5) : 0);
    rect(ctx, x, top, 1, VIEW.h - top, x === len - 1 ? INK : W.c);
    rect(ctx, x, top, 1, 1, INK);
    if (top + 1 < VIEW.h) rect(ctx, x, top + 1, 1, 1, W.l);
  }
  rect(ctx, 0, y0 + 3, len - 8, 1, W.brass);
  rect(ctx, 0, y0 + 7, len - 6, 1, W.d);
  for (let x = 12; x < len - 14; x += 16) {
    if (x > 60 && x < 92) continue;
    rect(ctx, x, y0 + 4, 5, 4, INK); rect(ctx, x + 1, y0 + 5, 3, 2, R.hole);
  }
  rect(ctx, 64, y0 + 1, 24, VIEW.h - y0 - 1, R.hole);                                     // the stove-in planks, ribs showing
  for (let x = 66; x < 88; x += 5) rect(ctx, x, y0 + 1, 2, VIEW.h - y0 - 1, W.l);
  rect(ctx, 63, y0, 2, 3, W.c); rect(ctx, 87, y0, 2, 2, W.c);
  for (const [x, h] of [[30, 4], [104, 5], [126, 3]] as const) {                          // weed draped over the gunwale
    for (let j = 0; j < h; j++) rect(ctx, x + Math.round(Math.sin(t + x + j) * 0.6), y0 + 1 + j, 1, 1, R.weed);
  }
  for (const [x, y] of [[20, 6], [47, 5], [99, 6], [118, 5], [138, 4]] as const) rect(ctx, x, y0 + y, 2, 1, W.barnacle);
  rect(ctx, len, y0 + 5, 10, 2, INK); rect(ctx, len, y0 + 5, 9, 1, W.l);                  // the bowsprit stub
}

/** The whale: 72 x 26, facing right, flukes beating; built fresh each frame so the flukes can move. */
function whaleSprite(t: number): PixelGrid {
  const H = U.whale, g = new PixelGrid(74, 28, 1, 1), cy = 11;
  const thick = (u: number): number => u < 0.6 ? 2 + 7 * Math.sin((u / 0.6) * (Math.PI / 2)) : u < 0.84 ? 9 : 9 * Math.sqrt(Math.max(0, 1 - ((u - 0.84) / 0.16) ** 2));
  for (let x = 12; x < 72; x++) {
    const u = (x - 12) / 59, f = thick(u), up = Math.round(f * 0.9), down = Math.round(f);
    for (let y = cy - up; y <= cy + down; y++) {
      const belly = y > cy + Math.round(f * 0.25) && u > 0.45;
      g.set(x, y, belly ? ((y - cy) % 2 === 0 ? H.groove : H.belly) : y < cy - up + 2 ? H.l : y > cy + down - 2 ? H.d : H.c);
    }
  }
  const beat = Math.round(Math.sin(t * 1.3) * 3);
  for (let x = 0; x < 13; x++) {                                                        // the flukes
    const spread = Math.round((12 - x) * 0.55);
    for (let y = cy - 1 - spread; y <= cy + 1 + spread; y++) {
      if (x < 6 && Math.abs(y - cy) < (6 - x) * 0.7) continue;                             // the notch between the lobes
      g.set(x, y + Math.round(beat * (12 - x) / 12), H.d);
    }
  }
  for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) g.set(48 - i + j, cy + 8 + i - j, H.d); // the flipper, swept back
  for (let x = 58; x < 70; x++) g.set(x, cy + 3 + (x > 66 ? -1 : 0), H.d);              // the mouth, a little smile at the end
  g.set(62, cy - 1, "#ffffff"); g.set(63, cy - 1, Math.floor(t * 0.7) % 7 === 0 ? H.c : INK); // the eye, blinking now and then
  for (const [sx, sy] of [[66, cy - 6], [69, cy - 4], [64, cy - 7], [56, cy - 7]] as const) g.set(sx, sy, H.spot);
  g.outline(INK);
  return g;
}

/** The whale's timing: one pass per `period` seconds on each screen at `speed` px/s, first entering screen 0 at `start`. */
const WHALE = { period: 120, speed: 14, start: 8, width: 74 } as const;

/** The whale swims left to right, reaching each screen as it leaves the one before, so it seems to cross the world. */
function whale(ctx: Ctx, t: number, screen: number): void {
  const k = wrap(t - WHALE.start - screen * (VIEW.w / WHALE.speed), WHALE.period);
  const x = Math.round(k * WHALE.speed) - WHALE.width;
  if (x >= VIEW.w) return;
  const y = 12 + Math.round(Math.sin(k * 0.35));
  blitClipped(ctx, whaleSprite(t), x, y);
  if (wrap(k, 9) < 3 && x + 66 >= 0 && x + 66 < VIEW.w) {                                  // a burst of bubbles from the blowhole
    for (let i = 0; i < 4; i++) {
      const rise = (wrap(k, 9) * 4 + i * 2) % 6;
      const bx = x + 64 + i - (i % 2) * 3;
      if (bx >= 0 && bx < VIEW.w) rect(ctx, bx, y + 2 - rise, 1, 1, i % 2 ? SEA.bubbleL : SEA.bubble);
    }
  }
}

export function drawUpgrades(ctx: Ctx, owned: ReadonlySet<string>, time: number, screenIndex: number): void {
  const t = Number.isFinite(time) ? time : 0;
  const screen = Number.isFinite(screenIndex) ? Math.trunc(screenIndex) : 0;
  if (owned.has(ID.whale)) whale(ctx, t, screen);
  if (owned.has(ID.jellies)) jellies(ctx, t, screen);
  if (owned.has(ID.wreck)) wreck(ctx, t);
  if (owned.has(ID.anemones)) anemones(ctx, t, screen);
  if (screen === 0) {
    if (owned.has(ID.statue)) statue(ctx, t);
    if (owned.has(ID.chest)) chest(ctx, t);
  }
  ctx.globalAlpha = 1;
}

/** The chest's gathering spot: hovering just over the open lid, at the bottom of the lounge's left end. */
export const upgradeSocialSpots: Record<string, Point> = {
  [ID.chest]: { x: LOUNGE.x + 10, y: LOUNGE.y + LOUNGE.h - 2 },
};
