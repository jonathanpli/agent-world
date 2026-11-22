import { rect, shade } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { SPACE } from "./palette";
import { DECK_WINDOW, deckMullions, LOUNGE } from "./scenery";

/**
 * The station's shop upgrades. Modules (and their docking tubes and name bands) can fill x 8..380, y 33..262 on every
 * screen and are drawn over this, so nothing goes there. Screen 0 has the observation deck: the planter and the drink
 * dispenser hang on its left bulkhead (x 382..397, left of the lounge), the star chart hangs at the top of the window
 * above the lounge, the ringed planet is seen through the glass behind the floating astronauts, and the dome sits on the
 * truss over the deck. Later screens are open space round a docked shuttle, so only the small shuttle repeats there,
 * moored to the truss in the sky between two solar wings.
 */
const ID = {
  planter: "space.hydroponic-planter",
  dispenser: "space.drink-dispenser",
  chart: "space.star-chart-display",
  dome: "space.observation-dome",
  shuttle: "space.docked-shuttle",
  planet: "space.ringed-planet-in-the-window",
} as const;

const U = SPACE.upgrades;
const INK = SPACE.ink;
/** The bulkhead strip left of the lounge: past the modules (x < 380) and short of the lounge (x 398). */
const SIDE_X = 382, SIDE_W = 16;

/** A three-shelf hydroponic rack: greens (and tomatoes on the middle shelf) under pink grow lights. */
function planter(ctx: Ctx, t: number): void {
  const P = U.planter, x = SIDE_X, y = 92, w = SIDE_W, h = 88;
  rect(ctx, x, y, w, h, INK);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, P.frame);
  rect(ctx, x + 1, y + 1, 1, h - 2, P.frameL);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, P.back);
  for (let i = 0; i < 3; i++) {
    const top = y + 2 + i * 28;
    rect(ctx, x + 2, top, w - 4, 2, P.lamp);
    rect(ctx, x + 4 + ((Math.floor(t * 2) + i) % 3) * 3, top, 2, 1, P.lampL);        // a bright spot running along the lamp
    ctx.globalAlpha = 0.22 + 0.06 * Math.sin(t * 1.6 + i);
    rect(ctx, x + 2, top + 2, w - 4, 18, P.glow);
    ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const px = x + 3 + k * 4, sway = Math.round(Math.sin(t * 1.2 + k * 2 + i) * 0.6);
      rect(ctx, px, top + 15, 3, 7, P.leafD);
      rect(ctx, px - 1 + sway, top + 11, 2, 5, P.leaf); rect(ctx, px + 2 + sway, top + 10, 2, 5, P.leaf);
      rect(ctx, px + sway, top + 8, 2, 3, P.leafL);
      if (i === 1) rect(ctx, px + 1, top + 13, 2, 2, P.berry);
    }
    rect(ctx, x + 2, top + 22, w - 4, 3, P.tray);
    rect(ctx, x + 2, top + 22, w - 4, 1, P.water);
    rect(ctx, x + 1, top + 25, w - 2, 1, INK);
  }
}

/** A wall-mounted drink dispenser: a lit cup sign, three flavour buttons, a pouch filling under the nozzle. */
function dispenser(ctx: Ctx, t: number): void {
  const D = U.dispenser, x = SIDE_X, y = 194, w = SIDE_W, h = 42;
  rect(ctx, x, y, w, h, INK);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, D.body);
  rect(ctx, x + w - 3, y + 1, 2, h - 2, D.bodyS);
  rect(ctx, x + 2, y + 3, w - 4, 9, D.panel);                                         // the sign: a glowing cup
  rect(ctx, x + 5, y + 5, 5, 5, D.sign); rect(ctx, x + 10, y + 6, 2, 1, D.sign); rect(ctx, x + 11, y + 7, 1, 1, D.sign);
  rect(ctx, x + 6, y + 6, 3, 1, D.panel);
  D.drinks.forEach((c, i) => {
    rect(ctx, x + 2 + i * 4, y + 13, 4, 4, INK); rect(ctx, x + 3 + i * 4, y + 14, 2, 2, c);
  });
  const pick = Math.floor(t / 3) % D.drinks.length, drink = D.drinks[pick]!;
  rect(ctx, x + 2, y + 19, w - 4, 15, D.panel);                                      // the alcove
  rect(ctx, x + 6, y + 19, 3, 3, D.nozzle);
  const fill = Math.floor((t * 2) % 6);
  rect(ctx, x + 5, y + 25, 5, 7, D.pouch);
  rect(ctx, x + 6, y + 31 - fill, 3, fill, drink);
  rect(ctx, x + 5, y + 25, 5, 1, "#ffffff");
  if (fill < 5) rect(ctx, x + 7, y + 22 + (fill % 3), 1, 1, drink);                   // the stream
  rect(ctx, x + 2, y + 32, w - 4, 2, D.tray);
  for (let i = 0; i < 3; i++) rect(ctx, x + 3 + i * 4, y + 36, 2, 1, D.bodyS);       // vents
}

/** Two dots joined by a 1-px line. */
function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, c: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) rect(ctx, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1, 1, c);
}

/** A star map hung from the deck sign over the top of the window: an orbit, a constellation, "you are here". */
function starChart(ctx: Ctx, t: number): void {
  const C = U.chart, x = 400, y = 56, w = 66, h = 23;                                 // bottom at 79: the lounge starts at 80
  rect(ctx, x + 8, y - 4, 1, 4, C.frame); rect(ctx, x + w - 9, y - 4, 1, 4, C.frame);
  rect(ctx, x, y, w, h, INK);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, C.frame);
  const sx = x + 2, sy = y + 2, sw = w - 4, sh = h - 4;
  rect(ctx, sx, sy, sw, sh, C.bg);
  for (let gx = sx + 7; gx < sx + sw; gx += 8) rect(ctx, gx, sy, 1, sh, C.grid);
  for (let gy = sy + 5; gy < sy + sh; gy += 6) rect(ctx, sx, gy, sw, 1, C.grid);
  // a little system on the left: a sun, an orbit, a planet going round
  const ox = sx + 15, oy = sy + 9;
  for (let a = 0; a < 360; a += 15) {
    const th = (a * Math.PI) / 180;
    rect(ctx, ox + Math.cos(th) * 11, oy + Math.sin(th) * 5, 1, 1, C.orbit);
  }
  rect(ctx, ox - 1, oy - 1, 3, 3, C.here); rect(ctx, ox, oy, 1, 1, "#ffffff");
  const p = t * 0.6;
  rect(ctx, ox + Math.cos(p) * 11 - 1, oy + Math.sin(p) * 5 - 1, 2, 2, C.line);
  // a constellation on the right
  const pts = [[38, 3], [44, 6], [51, 4], [57, 8], [54, 14], [46, 15], [40, 11]] as const;
  for (let i = 0; i < pts.length - 1; i++) line(ctx, sx + pts[i]![0], sy + pts[i]![1], sx + pts[i + 1]![0], sy + pts[i + 1]![1], C.line);
  line(ctx, sx + pts[1][0], sy + pts[1][1], sx + pts[6][0], sy + pts[6][1], C.line);
  for (const [px, py] of pts) { rect(ctx, sx + px, sy + py, 1, 1, C.star); }
  for (const [px, py] of [pts[0], pts[3], pts[5]]) { rect(ctx, sx + px - 1, sy + py, 3, 1, C.starB); rect(ctx, sx + px, sy + py - 1, 1, 3, C.starB); }
  for (const [px, py] of [[30, 2], [33, 14], [5, 15], [26, 9], [61, 2], [61, 15]] as const) rect(ctx, sx + px, sy + py, 1, 1, C.starB);
  if (Math.floor(t * 2) % 2 === 0) {                                                 // "you are here", blinking
    const hx = sx + 30, hy = sy + 8;
    rect(ctx, hx - 1, hy - 2, 3, 1, C.here); rect(ctx, hx - 1, hy + 2, 3, 1, C.here);
    rect(ctx, hx - 2, hy - 1, 1, 3, C.here); rect(ctx, hx + 2, hy - 1, 1, 3, C.here);
  }
  rect(ctx, sx + 30, sy + 8, 1, 1, C.star);
  ctx.globalAlpha = 0.25;                                                           // a scan line rolling down
  rect(ctx, sx, sy + Math.floor((t * 8) % sh), sw, 1, C.line);
  ctx.globalAlpha = 1;
}

/** A glass dome on the truss over the deck, a telescope inside, joined to the deck below by a short tube. */
function dome(ctx: Ctx, t: number): void {
  const D = U.dome, H = SPACE.hull;
  const cx = 441, base = 23, rx = 25, ry = 20;
  rect(ctx, cx - 7, 33, 14, 7, INK);                                                 // the tube down to the deck roof
  rect(ctx, cx - 6, 33, 12, 7, H.c); rect(ctx, cx - 6, 33, 2, 7, H.l);
  const halfAt = (r: number, k: number): number => Math.round(r * Math.sqrt(Math.max(0, 1 - k * k)));
  for (let y = base - ry - 1; y < base; y++) {                                       // ink outline, then the glass
    const half = halfAt(rx + 1, (base - y) / (ry + 1));
    rect(ctx, cx - half, y, half * 2, 1, INK);
  }
  for (let y = base - ry; y < base; y++) {
    const k = (base - y) / ry, half = halfAt(rx, k);
    rect(ctx, cx - half, y, half * 2, 1, k > 0.55 ? D.glassL : D.glass);
  }
  for (const [dx, dy, i] of [[-14, 8, 0], [-6, 13, 1], [9, 15, 2], [16, 7, 3], [3, 6, 4], [-18, 4, 5]] as const) {
    if (Math.sin(t * 2 + i * 1.7) > -0.4) rect(ctx, cx + dx, base - dy, 1, 1, SPACE.stars[i % SPACE.stars.length]!);
  }
  // the telescope on its tripod, sweeping slowly
  const tilt = Math.sin(t * 0.3) * 0.25;
  for (let i = 0; i < 9; i++) rect(ctx, cx - 3 + i, base - 6 - Math.round(i * (0.7 + tilt)), 2, 2, i < 7 ? D.scope : D.scopeD);
  rect(ctx, cx - 1, base - 5, 2, 3, D.scopeD); rect(ctx, cx - 4, base - 2, 1, 2, D.scopeD); rect(ctx, cx + 3, base - 2, 1, 2, D.scopeD);
  // ribs: three meridians and one ring of latitude
  for (let y = base - ry + 2; y < base; y++) {
    const half = halfAt(rx, (base - y) / ry);
    for (const m of [-0.55, 0, 0.55]) rect(ctx, cx + Math.round(half * m), y, 1, 1, D.ribD);
  }
  const lat = base - Math.round(ry * 0.55), latHalf = halfAt(rx, 0.55);
  rect(ctx, cx - latHalf, lat, latHalf * 2, 1, D.ribD);
  for (let a = 200; a <= 255; a += 5) {                                              // the shine on the glass
    const th = (a * Math.PI) / 180;
    rect(ctx, cx + Math.cos(th) * (rx - 4), base + Math.sin(th) * (ry - 4), 1, 1, D.shine);
  }
  // the base ring on the truss
  rect(ctx, cx - rx - 2, base - 1, rx * 2 + 4, 4, INK);
  rect(ctx, cx - rx - 1, base, rx * 2 + 2, 2, D.rib);
  for (let bx = cx - rx + 2; bx < cx + rx; bx += 6) rect(ctx, bx, base, 1, 1, H.rivet);
}

/** A small shuttle moored to the top of the truss in the gap between the third and fourth solar wings. */
function shuttle(ctx: Ctx, t: number, screenIndex: number): void {
  const S = U.shuttle, H = SPACE.hull;
  const c = 336 + (((screenIndex % 2) + 2) % 2) * 20;                                // scenery.ts shifts the wings 20 px on odd screens
  rect(ctx, c - 4, 16, 8, 8, INK);                                                   // the docking arm down to the truss
  rect(ctx, c - 3, 16, 6, 8, H.c); rect(ctx, c - 3, 16, 1, 8, H.l);
  rect(ctx, c - 6, 21, 12, 3, H.d);
  // tail fin
  rect(ctx, c - 25, 1, 7, 7, INK); rect(ctx, c - 24, 2, 3, 5, S.wing); rect(ctx, c - 21, 4, 2, 3, S.wing);
  rect(ctx, c - 18, 3, 2, 4, INK);
  // engines
  rect(ctx, c - 30, 8, 5, 9, INK); rect(ctx, c - 29, 9, 4, 3, S.wing); rect(ctx, c - 29, 13, 4, 3, S.wing);
  // the body
  rect(ctx, c - 26, 6, 51, 13, INK);
  rect(ctx, c - 25, 7, 49, 11, S.hull);
  rect(ctx, c - 25, 14, 49, 4, S.hullS);
  rect(ctx, c - 25, 12, 49, 2, S.stripe);
  // the nose cone
  for (const [dx, y0, h] of [[25, 7, 11], [27, 8, 9], [29, 10, 5], [31, 11, 3]] as const) rect(ctx, c + dx - 1, y0 - 1, 3, h + 2, INK);
  for (const [dx, y0, h] of [[24, 7, 11], [26, 8, 9], [28, 10, 5], [30, 11, 3]] as const) rect(ctx, c + dx, y0, 2, h, S.nose);
  // cockpit and portholes
  rect(ctx, c + 16, 8, 7, 3, INK); rect(ctx, c + 17, 8, 5, 2, S.window); rect(ctx, c + 17, 8, 2, 1, "#ffffff");
  for (const px of [-16, -10, -4]) { rect(ctx, px + c, 8, 4, 4, INK); rect(ctx, px + c + 1, 9, 2, 2, S.window); }
  // a swept wing along the lower hull
  for (let i = 0; i < 4; i++) rect(ctx, c - 14 + i * 2, 15 + (i > 1 ? 1 : 0), 16 - i * 3, 1, shade(S.wing, -0.1 * i));
  // nav lights: red on the fin, green on the nose, a white strobe on top
  const blink = Math.floor(t * 1.5) % 2 === 0;
  rect(ctx, c - 24, 1, 2, 1, blink ? SPACE.led.r : shade(SPACE.led.r, -0.5));
  rect(ctx, c + 30, 10, 1, 1, blink ? shade(SPACE.led.g, -0.5) : SPACE.led.g);
  if (Math.floor(t * 4) % 6 === 0) rect(ctx, c + 4, 5, 2, 1, "#ffffff");
  // the engines idle with a faint glow while docked
  ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t * 9);
  rect(ctx, c - 33, 9, 3, 3, S.flame[1]); rect(ctx, c - 33, 13, 3, 3, S.flame[1]);
  rect(ctx, c - 32, 10, 2, 1, S.flame[0]); rect(ctx, c - 32, 14, 2, 1, S.flame[0]);
  ctx.globalAlpha = 1;
}

/** A row of a disc from x0 to x1, clipped to the window glass. */
function glassRow(ctx: Ctx, x0: number, x1: number, y: number, c: string): void {
  const W = DECK_WINDOW;
  const a = Math.max(W.x, Math.round(x0)), b = Math.min(W.x + W.w, Math.round(x1));
  if (b > a && y >= W.y && y < W.y + W.h) rect(ctx, a, y, b - a, 1, c);
}

function ringPoints(ctx: Ctx, cx: number, cy: number, r: number, front: boolean): void {
  const R = U.ringed, W = DECK_WINDOW;
  const radii = [[r + 7, R.ringD], [r + 9, R.ring], [r + 10, R.ringL], [r + 12, R.ring], [r + 14, R.ringD]] as const;
  for (const [rr, c] of radii) {
    for (let a = 0; a < 360; a += 2) {
      const th = (a * Math.PI) / 180, s = Math.sin(th);
      if (s >= 0 !== front) continue;
      const x = Math.round(cx + Math.cos(th) * rr), y = Math.round(cy + s * rr * 0.26 - Math.cos(th) * rr * 0.12);
      if (x >= W.x && x < W.x + W.w && y >= W.y && y < W.y + W.h) rect(ctx, x, y, 1, 1, c);
    }
  }
}

/** A banded pink giant with a wide ring, seen through the deck window; the mullions stay in front of it. */
function ringedPlanet(ctx: Ctx, t: number): void {
  const R = U.ringed;
  const cx = 438, cy = 106, r = 17;                                                 // above the heads at the social spots (y 170)
  ringPoints(ctx, cx, cy, r, false);
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    if (half <= 0) continue;
    const band = R.bands[Math.min(R.bands.length - 1, Math.floor(((dy + r) / (2 * r + 1)) * R.bands.length))]!;
    const term = cx + Math.round(half * 0.3);                                        // the night side to the right
    glassRow(ctx, cx - half, term, cy + dy, dy < -r + 4 ? shade(band, 0.15) : band);
    glassRow(ctx, term, cx + half, cy + dy, shade(band, -0.45));
  }
  glassRow(ctx, cx - 9, cx + 6, cy + 3, shade(R.bands[1], -0.15));                    // the ring's shadow on the disc
  ringPoints(ctx, cx, cy, r, true);
  const g = ((t * 0.5) % 1) * Math.PI;                                               // a glint travelling round the front of the ring
  const gx = Math.round(cx + Math.cos(g) * (r + 10)), gy = Math.round(cy + Math.sin(g) * (r + 10) * 0.26 - Math.cos(g) * (r + 10) * 0.12);
  const W = DECK_WINDOW;
  if (gx - 1 >= W.x && gx + 2 <= W.x + W.w) {
    rect(ctx, gx - 1, gy, 3, 1, R.glint); rect(ctx, gx, gy - 1, 1, 3, R.glint);
  }
  deckMullions(ctx);
}

export function drawUpgrades(ctx: Ctx, owned: ReadonlySet<string>, time: number, screenIndex: number): void {
  const t = Number.isFinite(time) ? time : 0;
  if (screenIndex === 0) {
    if (owned.has(ID.planet)) ringedPlanet(ctx, t);
    if (owned.has(ID.chart)) starChart(ctx, t);
    if (owned.has(ID.dome)) dome(ctx, t);
    if (owned.has(ID.planter)) planter(ctx, t);
    if (owned.has(ID.dispenser)) dispenser(ctx, t);
  }
  if (owned.has(ID.shuttle)) shuttle(ctx, t, Number.isFinite(screenIndex) ? Math.trunc(screenIndex) : 0);
  ctx.globalAlpha = 1;
}

/** The dispenser's chat spot: floating just right of it, at the lounge's left edge. */
export const upgradeSocialSpots: Record<string, Point> = {
  [ID.dispenser]: { x: LOUNGE.x + 8, y: 236 },
};
