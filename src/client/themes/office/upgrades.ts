import { ellipse, rect, shade } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { OFFICE } from "./palette";
import { LOUNGE, WALL_H } from "./room";

/**
 * The office's shop upgrades. Places (carpets, desks, name plates) can fill x 8..380, y 42..262 on every screen and
 * are drawn over this, so everything here keeps to the wall gaps between the windows, the floor strip under the wall,
 * the margins either side of the lounge and the strip below it. Wall and floor pieces repeat on every screen; the
 * coffee machine and the arcade cabinet stand by the lounge, on screen 0 only.
 */
const ID = {
  plants: "office.desk-plants",
  coffee: "office.coffee-machine",
  art: "office.wall-art",
  arcade: "office.arcade-cabinet",
  tank: "office.fish-tank",
  skylight: "office.rooftop-skylight",
} as const;

const U = OFFICE.upgrades;
/** Centres of the wall gaps between the four windows (room.ts: windows at x 20, 120, 220, 320, 52 wide). */
const GAPS = [96, 196, 296] as const;
/** Where the floor meets the wall: planters stand here, above the highest name plate (y 42). */
const FLOOR_Y = WALL_H + 6;

/** A tall floor planter against the wall; three species so a row of them doesn't look stamped. */
function planter(ctx: Ctx, x: number, kind: number, t: number): void {
  const P = OFFICE.plant, b = FLOOR_Y;
  const pot = U.planter.pots[kind % U.planter.pots.length]!;
  ctx.globalAlpha = 0.25; ellipse(ctx, x, b, 6, 1, OFFICE.ink); ctx.globalAlpha = 1;
  const sway = Math.round(Math.sin(t * 1.3 + x) * 0.6);
  if (kind === 0) {                                              // leafy bush
    for (const [dx, dy, c] of [[-4, -12, P.leafD], [4, -12, P.leafD], [-2, -15, P.leaf], [3, -16, P.leaf], [0, -13, P.leafL], [-5, -9, P.leaf], [5, -9, P.leaf]] as const) {
      ellipse(ctx, x + dx + (dy < -13 ? sway : 0), b + dy, 2, 2, c);
    }
  } else if (kind === 1) {                                       // snake plant: upright blades
    for (const [dx, h] of [[-3, 6], [-1, 9], [1, 11], [3, 8], [5, 5]] as const) {
      rect(ctx, x + dx - 1, b - 8 - h, 2, h, OFFICE.ink);
      rect(ctx, x + dx - 1, b - 8 - h + 1, 1, h - 1, U.planter.snake);
      rect(ctx, x + dx, b - 8 - h + 1, 1, h - 1, U.planter.snakeL);
    }
    rect(ctx, x + 1 + sway, b - 20, 1, 1, U.planter.snakeL);
  } else {                                                       // potted ficus: a round crown on a thin trunk
    rect(ctx, x, b - 13, 1, 4, OFFICE.shadow);
    ellipse(ctx, x + sway, b - 15, 5, 3, OFFICE.ink);
    ellipse(ctx, x + sway, b - 15, 4, 2, P.leafD);
    ellipse(ctx, x - 1 + sway, b - 16, 2, 1, P.leaf);
    rect(ctx, x - 2 + sway, b - 17, 2, 1, P.leafL);
  }
  rect(ctx, x - 5, b - 9, 11, 9, OFFICE.ink);
  rect(ctx, x - 4, b - 8, 9, 7, pot);
  rect(ctx, x - 4, b - 8, 9, 1, shade(pot, 0.25));
  rect(ctx, x - 4, b - 3, 9, 2, shade(pot, -0.15));
  rect(ctx, x - 6, b - 10, 13, 2, OFFICE.ink); rect(ctx, x - 5, b - 10, 11, 1, shade(pot, 0.1));
}

/** One 16x12 picture: a landscape, a primary-colour abstract, or a portrait of the office cat. */
function picture(ctx: Ctx, x: number, y: number, kind: number): void {
  const A = U.art, C = OFFICE.cat;
  const r = (dx: number, dy: number, w: number, h: number, c: string): void => rect(ctx, x + dx, y + dy, w, h, c);
  if (kind === 0) {
    r(0, 0, 16, 12, A.sky);
    ellipse(ctx, x + 12, y + 3, 2, 1, A.sun);
    r(0, 7, 6, 3, A.hillD); r(1, 6, 4, 1, A.hillD); r(2, 5, 2, 1, A.hillD);          // two hills, kept inside the frame
    r(6, 8, 10, 2, A.hill); r(8, 7, 7, 1, A.hill); r(10, 6, 4, 1, A.hill);
    r(0, 10, 16, 2, A.lake); r(2, 10, 4, 1, A.sky);
    r(8, 8, 2, 1, A.path); r(7, 9, 2, 1, A.path);
  } else if (kind === 1) {
    r(0, 0, 16, 12, A.canvas);
    r(0, 0, 6, 7, A.red); r(10, 7, 6, 5, A.blue); r(12, 0, 4, 4, A.yellow);
    r(6, 0, 1, 12, OFFICE.ink); r(0, 7, 16, 1, OFFICE.ink); r(11, 0, 1, 7, OFFICE.ink); r(11, 4, 5, 1, OFFICE.ink); r(9, 8, 1, 4, OFFICE.ink);
  } else {
    r(0, 0, 16, 12, A.teal);
    r(4, 4, 8, 6, C.fur); r(4, 2, 2, 2, C.fur); r(10, 2, 2, 2, C.fur);
    r(5, 3, 1, 1, C.nose); r(10, 3, 1, 1, C.nose);
    r(7, 4, 2, 1, C.stripe);
    r(5, 6, 1, 1, C.eye); r(10, 6, 1, 1, C.eye); r(7, 7, 2, 1, C.nose);
    r(6, 8, 4, 1, C.belly);
    r(2, 10, 12, 2, C.stripe);
  }
}

function frame(ctx: Ctx, cx: number, kind: number): void {
  const x = cx - 10, y = 3;
  rect(ctx, x + 1, y + 16, 19, 1, OFFICE.wallS);                 // shadow on the wall
  rect(ctx, x, y, 20, 16, OFFICE.ink);
  rect(ctx, x + 1, y + 1, 18, 14, U.frame);
  rect(ctx, x + 1, y + 1, 18, 1, U.frameL); rect(ctx, x + 1, y + 1, 1, 14, U.frameL);
  picture(ctx, x + 2, y + 2, kind);
}

/** A chrome espresso machine on a little wooden cart, left of the lounge rug; steam curls from the cup. */
function coffeeMachine(ctx: Ctx, t: number): void {
  const E = U.espresso, L = OFFICE.lounge;
  const x = 384, b = 122;                                        // 14 wide: 384..397, the lounge starts at 398
  ctx.globalAlpha = 0.25; rect(ctx, x, b, 14, 2, OFFICE.ink); ctx.globalAlpha = 1;
  // the cart
  rect(ctx, x, b - 18, 14, 18, OFFICE.ink);
  rect(ctx, x + 1, b - 17, 12, 2, shade(E.cart, 0.2));
  rect(ctx, x + 1, b - 15, 12, 12, E.cart);
  rect(ctx, x + 2, b - 12, 10, 1, E.cartD);
  rect(ctx, x + 2, b - 11, 4, 4, OFFICE.ink); rect(ctx, x + 3, b - 10, 2, 3, OFFICE.mugBlue);                  // spare mugs
  rect(ctx, x + 8, b - 11, 4, 4, OFFICE.ink); rect(ctx, x + 9, b - 10, 2, 3, E.accent);
  rect(ctx, x + 2, b - 6, 10, 1, E.cartD);
  rect(ctx, x + 1, b - 3, 2, 3, E.cartD); rect(ctx, x + 11, b - 3, 2, 3, E.cartD);
  // the machine: a red two-group espresso machine, cups warming on top, two cups filling under the spouts
  const m = b - 38;
  rect(ctx, x, m, 14, 21, OFFICE.ink);
  rect(ctx, x + 1, m + 1, 12, 2, E.chromeD);
  for (let i = 0; i < 3; i++) rect(ctx, x + 2 + i * 4, m, 2, 2, L.cup);
  rect(ctx, x + 1, m + 3, 12, 7, E.accent);
  rect(ctx, x + 1, m + 3, 12, 1, shade(E.accent, 0.3)); rect(ctx, x + 1, m + 9, 12, 1, shade(E.accent, -0.25));
  rect(ctx, x + 2, m + 5, 3, 3, E.chromeL); rect(ctx, x + 3, m + 6, 1, 1, OFFICE.ink);                  // pressure gauge
  rect(ctx, x + 7, m + 5, 5, 1, E.chromeL); rect(ctx, x + 7, m + 7, 5, 1, E.chromeL);
  rect(ctx, x + 11, m + 7, 1, 1, Math.floor(t * 2) % 2 === 0 ? L.green : E.chromeL);                    // ready light
  rect(ctx, x + 1, m + 10, 12, 9, E.top);
  rect(ctx, x + 1, m + 10, 1, 9, E.chrome); rect(ctx, x + 12, m + 10, 1, 9, E.chrome);
  for (const gx of [x + 3, x + 8]) {
    rect(ctx, gx, m + 10, 3, 2, E.chrome); rect(ctx, gx + 1, m + 12, 1, 1, E.chromeD);                   // group head and spout
    rect(ctx, gx, m + 15, 3, 3, L.cup); rect(ctx, gx, m + 15, 3, 1, L.coffee);                             // the cup
  }
  rect(ctx, x + 1, m + 18, 12, 1, E.chromeL);                                                              // drip tray
  ctx.globalAlpha = 0.85;                                                                                  // steam off the top
  for (let i = 0; i < 4; i++) {
    const rise = (t * 4 + i * 2.5) % 10;
    const big = rise < 5 ? 2 : 1;
    rect(ctx, x + 6 + (i % 2) * 3 + Math.round(Math.sin(t * 2 + i) * 1.2), m - 2 - rise, big, big, L.steam);
  }
  ctx.globalAlpha = 1;
}

/** A retro arcade cabinet right of the lounge rug: flashing marquee, a tiny shooter playing itself. */
function arcadeCabinet(ctx: Ctx, t: number): void {
  const A = U.arcade;
  const x = 469, y = 164, w = 11, h = 32;                        // 469..479: right of the lounge (ends 468), to the screen edge
  ctx.globalAlpha = 0.25; rect(ctx, x - 1, y + h, w + 1, 2, OFFICE.ink); ctx.globalAlpha = 1;
  rect(ctx, x, y, w, h, OFFICE.ink);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, A.body);
  rect(ctx, x + 1, y + 1, 1, h - 2, A.bodyL);
  const flash = Math.floor(t * 3);
  for (let i = 0; i < 3; i++) rect(ctx, x + 2 + i * 3 - (i === 0 ? 1 : 0), y + 1, i === 0 ? 4 : 3, 3, A.marquee[(flash + i) % 3]!);
  rect(ctx, x + 1, y + 4, w - 2, 1, OFFICE.ink);
  // the screen: aliens marching, a ship sliding under them, a shot going up
  const sx = x + 2, sy = y + 6, sw = 7, sh = 7;
  rect(ctx, sx - 1, sy - 1, sw + 2, sh + 2, OFFICE.ink);
  rect(ctx, sx, sy, sw, sh, A.screen);
  const step = Math.floor(t * 2) % 4, march = step < 2 ? step : 4 - step;
  for (let i = 0; i < 3; i++) rect(ctx, sx + march + i * 2, sy + 1, 1, 1, A.alien);
  const ship = Math.floor(t * 3) % 10, shipX = ship < 5 ? ship : 9 - ship;
  rect(ctx, sx + shipX, sy + sh - 1, 3, 1, A.ship); rect(ctx, sx + shipX + 1, sy + sh - 2, 1, 1, A.ship);
  const shot = Math.floor(t * 8) % 5;
  if (shot < 4) rect(ctx, sx + shipX + 1, sy + sh - 3 - shot, 1, 1, A.shot);
  ctx.globalAlpha = 0.15; rect(ctx, sx, sy, sw, 1, "#ffffff"); ctx.globalAlpha = 1;
  // control panel, coin door, kick plate
  rect(ctx, x + 1, y + 15, w - 2, 3, A.bodyD);
  rect(ctx, x + 3, y + 14, 1, 2, OFFICE.ink); rect(ctx, x + 3, y + 13, 1, 1, A.stick);
  rect(ctx, x + 6, y + 16, 1, 1, A.buttons[0]!); rect(ctx, x + 8, y + 16, 1, 1, A.buttons[1]!);
  rect(ctx, x + 4, y + 21, 3, 5, OFFICE.ink); rect(ctx, x + 5, y + 22, 1, 2, A.coin);
  rect(ctx, x + 1, y + h - 3, w - 2, 2, A.bodyD);
}

/** A long low fish tank below the lounge rug (and along the same floor edge on later screens). */
function fishTank(ctx: Ctx, t: number): void {
  const T = U.tank;
  const x = 400, y = 254, w = 66, h = 16;                        // below the rug (ends y 253), between the two plants
  rect(ctx, x, y, w, h, OFFICE.ink);
  rect(ctx, x + 1, y + 1, w - 2, 9, T.water);
  rect(ctx, x + 1, y + 1, w - 2, 1, T.waterL);
  rect(ctx, x + 1, y + 6, w - 2, 4, T.waterD);
  rect(ctx, x + 1, y + 9, w - 2, 2, T.gravel);
  for (let gx = x + 2; gx < x + w - 2; gx += 4) rect(ctx, gx, y + 10, 1, 1, T.gravelD);
  for (const [wx, wh] of [[x + 7, 6], [x + 9, 4], [x + 52, 7], [x + 55, 5]] as const) {
    for (let k = 0; k < wh; k++) rect(ctx, wx + Math.round(Math.sin(t * 1.5 + k * 0.8 + wx) * 0.7), y + 9 - k, 1, 1, k % 2 === 0 ? T.weed : T.weedD);
  }
  rect(ctx, x + 30, y + 7, 6, 3, OFFICE.ink); rect(ctx, x + 31, y + 8, 4, 2, T.gravelD);   // a castle-ish rock
  rect(ctx, x + 32, y + 5, 2, 2, OFFICE.ink);
  const inner = w - 8;
  T.fish.forEach((c, i) => {
    const speed = 4 + i * 1.5, span = inner * 2;
    const p = ((t * speed + i * 23) % span + span) % span;
    const dir = p < inner ? 1 : -1;
    const fx = Math.round(x + 3 + (dir > 0 ? p : span - p));
    const fy = Math.round(y + 3 + i * 2 + Math.sin(t * 1.7 + i * 2));
    rect(ctx, fx, fy, 3, 2, c);
    rect(ctx, fx - dir, fy, 1, 2, shade(c, -0.25));               // tail behind
    rect(ctx, dir > 0 ? fx + 2 : fx, fy, 1, 1, OFFICE.ink);       // eye in front
  });
  ctx.globalAlpha = 0.8;
  for (let k = 0; k < 3; k++) {
    const rise = (t * 3 + k * 2.7) % 8;
    rect(ctx, x + 57 + (k % 2), Math.round(y + 9 - rise), 1, 1, T.bubble);
  }
  ctx.globalAlpha = 0.35; rect(ctx, x + 3, y + 2, 1, 3, "#ffffff"); rect(ctx, x + 4, y + 2, 1, 1, "#ffffff"); ctx.globalAlpha = 1;
  rect(ctx, x + 1, y + 11, w - 2, 3, T.stand);
  rect(ctx, x + 1, y + 11, w - 2, 1, T.standL);
  rect(ctx, x + 3, y + 14, 3, 2, T.stand); rect(ctx, x + w - 6, y + 14, 3, 2, T.stand);
}

/** A skylight along the top of the break corner: glass panes, slanting shafts of light and a sunny patch on the floor. */
function skylight(ctx: Ctx, t: number): void {
  const S = U.skylight;
  const x0 = 386, w0 = 92;
  rect(ctx, x0, 0, w0, 4, OFFICE.ink);
  for (let i = 0; i < 8; i++) rect(ctx, x0 + 1 + i * 11, 0, 10, 3, S.glass[i % 2]!);
  const glint = Math.floor(t * 4) % 40;
  if (glint < 8) rect(ctx, x0 + 1 + glint * 11, 0, 2, 1, "#ffffff");
  const patch = { x: 406, y: 126, w: 50, h: 30 };
  const shimmer = 0.04 * Math.sin(t * 0.8);
  ctx.globalAlpha = 0.12 + shimmer / 2;                          // the shafts, widening on the way down
  for (let y = 4; y < patch.y; y += 2) {
    const k = (y - 4) / (patch.y - 4);
    const left = Math.round(x0 + 6 + (patch.x - x0 - 6) * k);
    const right = Math.round(x0 + w0 - 6 + (patch.x + patch.w + 9 - (x0 + w0 - 6)) * k);
    rect(ctx, left, y, Math.round((right - left) / 2) - 1, 2, S.light);
    rect(ctx, left + Math.round((right - left) / 2) + 1, y, Math.round((right - left) / 2) - 1, 2, S.light);
  }
  ctx.globalAlpha = 0.3 + shimmer;                               // the patch: four panes, slanted like the shafts
  for (let dy = 0; dy < patch.h; dy += 2) {
    if (dy === 14) continue;
    const sx = patch.x + Math.round(dy * 0.3);
    rect(ctx, sx, patch.y + dy, 24, 2, S.light);
    rect(ctx, sx + 26, patch.y + dy, 24, 2, S.light);
  }
  ctx.globalAlpha = 0.4;                                         // dust drifting in the light
  for (let i = 0; i < 9; i++) {
    const fall = (t * (2 + (i % 3)) + i * 13) % (patch.y - 8);
    const k = fall / (patch.y - 4);
    const mx = Math.round(x0 + 12 + i * 8 + (patch.x - x0 - 4) * k * 0.5 + Math.sin(t + i) * 2);
    rect(ctx, mx, Math.round(6 + fall), 1, 1, S.mote);
  }
  ctx.globalAlpha = 1;
}

export function drawUpgrades(ctx: Ctx, owned: ReadonlySet<string>, time: number, screenIndex: number): void {
  const t = Number.isFinite(time) ? time : 0;
  const lounge = screenIndex === 0;
  const variant = (i: number): number => (((i + screenIndex) % 3) + 3) % 3;   // the pieces in each gap vary by screen
  if (owned.has(ID.art)) GAPS.forEach((cx, i) => frame(ctx, cx, variant(i)));
  if (owned.has(ID.plants)) GAPS.forEach((cx, i) => planter(ctx, cx, variant(i), t));
  if (owned.has(ID.tank)) fishTank(ctx, t);
  if (lounge && owned.has(ID.coffee)) coffeeMachine(ctx, t);
  if (lounge && owned.has(ID.arcade)) arcadeCabinet(ctx, t);
  if (owned.has(ID.skylight)) skylight(ctx, t);
  ctx.globalAlpha = 1;
}

/** The coffee machine's chat spot: on the rug just right of the cart. */
export const upgradeSocialSpots: Record<string, Point> = {
  [ID.coffee]: { x: LOUNGE.x + 6, y: 118 },
};
