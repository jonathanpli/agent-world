import { CONFIG } from "../../../shared/config";
import { drawText, fitText, FONT, textWidth } from "../../engine/font";
import { ellipse, hash2, rect, shade } from "../../engine/pixels";
import type { Ctx, Place, Rect } from "../../engine/theme";
import { VIEW } from "../../engine/view";
import { SPACE } from "./palette";

export const TRUSS_H = 36;
/** Off-duty astronauts float in front of the observation deck's window, on screen 0. */
export const LOUNGE: Rect = { x: 398, y: 80, w: 70, h: 166 };
/** Modules hang below the truss, left of the deck, on every screen. */
export const AREA: Rect = { x: 4, y: 38, w: 380, h: 228 };
export const PLACE = { label: 9, row0: 55, rowH: 48, maxW: 186, maxH: 108, gap: 8 } as const;
const DECK: Rect = { x: 390, y: 40, w: 86, h: 226 };

const wrap = (v: number, m: number): number => ((v % m) + m) % m;

function sky(ctx: Ctx): void {
  const band = Math.ceil(VIEW.h / SPACE.sky.length);
  SPACE.sky.forEach((c, i) => rect(ctx, 0, i * band, VIEW.w, band, c));
  // dithered seams between the bands
  for (let i = 1; i < SPACE.sky.length; i++) for (let x = (i % 2) * 2; x < VIEW.w; x += 4) rect(ctx, x, i * band - 1, 1, 1, SPACE.sky[i]!);
}

function nebula(ctx: Ctx, seed: number): void {
  for (let i = 0; i < 4; i++) {
    const c = SPACE.nebula[i % SPACE.nebula.length]!;
    const cx = 40 + hash2(seed, i) * 400, cy = 60 + hash2(i, seed + 3) * 150;
    ctx.globalAlpha = 0.12;
    ellipse(ctx, cx, cy, 70 + hash2(seed + i, 9) * 40, 26 + hash2(9, seed + i) * 20, c);
    ctx.globalAlpha = 0.1;
    ellipse(ctx, cx + 20, cy - 6, 40, 14, c);
  }
  ctx.globalAlpha = 1;
}

/** Three layers of stars drifting left at different speeds; a few twinkle. */
function stars(ctx: Ctx, t: number, seed: number, box: Rect = { x: 0, y: 0, w: VIEW.w, h: VIEW.h }, n = 120): void {
  for (let i = 0; i < n; i++) {
    const depth = 1 + (i % 3);
    const x = box.x + wrap(hash2(seed, i) * box.w - (t * CONFIG.client.space.starDriftPx * depth) / 3, box.w);
    const y = box.y + hash2(i, seed + 1) * box.h;
    const c = SPACE.stars[i % SPACE.stars.length]!;
    const tw = i % 7 === 0 ? Math.sin(t * 2 + i) : 1;
    if (tw < -0.3) continue;
    rect(ctx, x, y, 1, 1, c);
    if (depth === 3 && i % 5 === 0) {                          // a few bright ones get a cross
      ctx.globalAlpha = 0.5;
      rect(ctx, x - 1, y, 3, 1, c); rect(ctx, x, y - 1, 1, 3, c);
      ctx.globalAlpha = 1;
    }
  }
}

/** A blue planet's limb across the bottom, clouds drifting, the night side to the right. */
function planet(ctx: Ctx, t: number, cx: number, cy: number, r: number, x0: number, x1: number, y1: number): void {
  const P = SPACE.planet;
  for (let x = x0; x < x1; x++) {
    const dx = x - cx;
    if (Math.abs(dx) >= r) continue;
    const top = Math.round(cy - Math.sqrt(r * r - dx * dx));
    if (top >= y1) continue;
    ctx.globalAlpha = 0.35; rect(ctx, x, top - 3, 1, 2, P.atmo); ctx.globalAlpha = 1;
    rect(ctx, x, top - 1, 1, 1, P.atmo);
    for (let y = top; y < y1; y += 2) {
      const land = hash2(Math.floor((x + 400) / 9), Math.floor((y - top + x * 0.2) / 5)) > 0.72;
      const cloud = hash2(Math.floor((x + t * 1.5 + (y % 6) * 3) / 13), Math.floor(y / 2) + 50) > 0.84;
      let c: string = land ? (y % 4 === 0 ? P.landD : P.land) : y - top < 3 ? P.oceanL : P.ocean;
      if (cloud) c = P.cloud;
      if (dx > r * 0.45) c = shade(c, -Math.min(0.7, (dx - r * 0.45) / (r * 0.6)));
      rect(ctx, x, y, 1, 2, c);
    }
  }
}

function giant(ctx: Ctx, cx: number, cy: number, r: number): void {
  const G = SPACE.giant;
  ctx.globalAlpha = 0.9;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    const c = G.bands[Math.floor((dy + r) / 9) % G.bands.length]!;
    rect(ctx, cx - half, cy + dy, half * 2, 1, c);
    rect(ctx, cx + Math.round(half * 0.4), cy + dy, Math.round(half * 0.6), 1, shade(c, -0.35));
  }
  ctx.globalAlpha = 1;
  for (let a = 0; a < 360; a += 1) {
    const th = (a * Math.PI) / 180;
    const x = cx + Math.cos(th) * r * 1.8, y = cy + Math.sin(th) * r * 0.35;
    if (Math.sin(th) < 0 && Math.abs(Math.cos(th)) < 0.55) continue;   // behind the planet
    rect(ctx, x, y, 1, 1, a % 3 === 0 ? G.ringD : G.ring);
  }
}

function moon(ctx: Ctx, x: number, y: number, r: number): void {
  const M = SPACE.moon;
  ellipse(ctx, x, y, r, r, M.c);
  ellipse(ctx, x + Math.round(r / 3), y + Math.round(r / 4), Math.round(r * 0.7), Math.round(r * 0.8), M.d);
  ellipse(ctx, x - 2, y - 2, 2, 1, M.crater); ellipse(ctx, x + 3, y + 3, 1, 1, M.crater);
}

/** The station's main truss along the top, with solar wings and blinking nav lights. */
function truss(ctx: Ctx, t: number, seed: number): void {
  const S = SPACE.solar, T = SPACE.truss;
  for (let i = 0; i < 4; i++) {
    const wx = 14 + i * 120 + (seed % 2) * 20;
    rect(ctx, wx + 21, 20, 2, 5, T.d);
    rect(ctx, wx - 1, 1, 46, 20, S.frame);
    rect(ctx, wx, 2, 44, 18, S.cell);
    for (let cx = 0; cx < 44; cx += 4) for (let cy = 0; cy < 18; cy += 3) {
      if ((cx + cy) % 8 === 0) rect(ctx, wx + cx + 1, 2 + cy + 1, 2, 1, S.cellL);
    }
    for (let cx = 4; cx < 44; cx += 4) rect(ctx, wx + cx, 2, 1, 18, S.grid);
    rect(ctx, wx, 11, 44, 1, S.frame);
    const glint = Math.floor(wrap(t * 9 + i * 20, 90));
    if (glint < 44) { ctx.globalAlpha = 0.5; rect(ctx, wx + glint, 2, 2, 18, S.glint); ctx.globalAlpha = 1; }
  }
  rect(ctx, 0, 24, VIEW.w, 10, SPACE.ink);
  rect(ctx, 0, 25, VIEW.w, 2, T.l);
  rect(ctx, 0, 31, VIEW.w, 2, T.d);
  for (let x = 0; x < VIEW.w; x += 12) {
    rect(ctx, x, 27, 2, 4, T.c);
    for (let k = 0; k < 4; k++) rect(ctx, x + 2 + k * 2 + 1, 27 + k, 2, 1, T.c);
  }
  for (const [x, c] of [[6, SPACE.led.r], [238, SPACE.led.g], [470, SPACE.led.r]] as const) {
    if (Math.floor(t * 1.5 + x) % 2 === 0) { rect(ctx, x - 1, 22, 3, 3, c); ctx.globalAlpha = 0.3; rect(ctx, x - 2, 21, 5, 5, c); ctx.globalAlpha = 1; }
    else rect(ctx, x, 23, 1, 1, shade(c, -0.5));
  }
}

function hullBox(ctx: Ctx, r: Rect, wall: string): void {
  const H = SPACE.hull;
  rect(ctx, r.x + 1, r.y - 1, r.w - 2, r.h + 2, SPACE.ink); rect(ctx, r.x - 1, r.y + 1, r.w + 2, r.h - 2, SPACE.ink);
  rect(ctx, r.x, r.y, r.w, r.h, H.d);
  rect(ctx, r.x + 1, r.y + 1, r.w - 2, 1, H.l);
  rect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, wall);
}

/** The observation deck: a tall window onto the stars and the planet below, a bench and the station garden. */
function deck(ctx: Ctx, t: number): void {
  const D = SPACE.deck;
  hullBox(ctx, DECK, D.frameD);
  const win: Rect = { x: DECK.x + 5, y: DECK.y + 14, w: DECK.w - 10, h: DECK.h - 30 };
  rect(ctx, win.x, win.y, win.w, win.h, D.glass);
  ctx.save();
  ctx.beginPath(); ctx.rect(win.x, win.y, win.w, win.h); ctx.clip();
  stars(ctx, t, 77, win, 60);
  moon(ctx, win.x + 18, win.y + 26, 6);
  planet(ctx, t, win.x + win.w * 0.7, win.y + win.h + 70, 120, win.x, win.x + win.w, win.y + win.h);
  ctx.restore();
  // mullions and frame
  rect(ctx, win.x + Math.floor(win.w / 2), win.y, 2, win.h, D.frame);
  for (const fy of [0.33, 0.66]) rect(ctx, win.x, win.y + Math.round(win.h * fy), win.w, 2, D.frame);
  rect(ctx, win.x - 1, win.y - 1, win.w + 2, 1, D.frame); rect(ctx, win.x - 1, win.y + win.h, win.w + 2, 1, D.frame);
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 3; i++) rect(ctx, win.x + 6 + i * 26, win.y + 4, 3, win.h - 8, "#ffffff");   // glass sheen
  ctx.globalAlpha = 1;
  // sign
  rect(ctx, DECK.x + 2, DECK.y + 2, DECK.w - 4, 10, SPACE.band);
  const label = "OBS DECK";
  drawText(ctx, label, Math.round(DECK.x + (DECK.w - textWidth(label)) / 2), DECK.y + 3, SPACE.label);
  // bench and garden trays along the floor
  const fy = DECK.y + DECK.h - 16;
  rect(ctx, DECK.x + 2, fy, DECK.w - 4, 14, D.frameD);
  rect(ctx, DECK.x + 24, fy + 2, 38, 5, D.benchL); rect(ctx, DECK.x + 24, fy + 7, 38, 3, D.bench);
  for (const gx of [DECK.x + 4, DECK.x + DECK.w - 20]) {
    rect(ctx, gx, fy + 6, 16, 6, D.tray);
    for (let i = 0; i < 5; i++) {
      const sway = Math.round(Math.sin(t * 1.2 + i + gx) * 1);
      rect(ctx, gx + 2 + i * 3 + sway, fy + 1 - (i % 2) * 2, 2, 6 + (i % 2) * 2, i % 2 === 0 ? D.leaf : D.leafL);
    }
  }
}

/** Screens past the first have a shuttle docked where the deck would be. */
function shuttle(ctx: Ctx, t: number): void {
  const S = SPACE.shuttle;
  const cx = 433;
  rect(ctx, cx - 8, 34, 16, 10, SPACE.hull.d); rect(ctx, cx - 6, 36, 12, 6, SPACE.hull.c);
  rect(ctx, cx - 13, 52, 26, 130, SPACE.ink);
  rect(ctx, cx - 12, 53, 24, 128, S.c); rect(ctx, cx + 4, 53, 8, 128, S.s);
  ellipse(ctx, cx, 54, 12, 9, S.nose);
  rect(ctx, cx - 12, 54, 24, 6, S.nose);
  rect(ctx, cx - 5, 64, 10, 5, S.window); rect(ctx, cx - 5, 64, 3, 1, "#ffffff");
  rect(ctx, cx - 12, 90, 24, 3, S.stripe);
  rect(ctx, cx - 30, 150, 60, 4, SPACE.ink);
  for (let i = 0; i < 18; i++) { rect(ctx, cx - 13 - i, 132 + i * 1.2, i, 2, S.s); rect(ctx, cx + 13, 132 + i * 1.2, i, 2, S.s); }
  rect(ctx, cx - 10, 181, 20, 6, SPACE.hull.dd);
  for (const ex of [-6, 2]) {
    rect(ctx, cx + ex, 187, 4, 3, SPACE.hull.d);
    if (Math.floor(t * 6) % 3 !== 0) { ctx.globalAlpha = 0.6; rect(ctx, cx + ex + 1, 190, 2, 2 + Math.floor(t * 6) % 3, S.flame); ctx.globalAlpha = 1; }
  }
}

export function drawBackdrop(ctx: Ctx, t: number, screenIndex: number): void {
  sky(ctx);
  nebula(ctx, screenIndex + 3);
  stars(ctx, t, screenIndex * 31 + 5);
  if (screenIndex % 2 === 0) {
    moon(ctx, 300, 70, 9);
    planet(ctx, t, 160, 700, 478, 0, VIEW.w, VIEW.h);
  } else giant(ctx, 120, 220, 46);
  truss(ctx, t, screenIndex);
  if (screenIndex === 0) deck(ctx, t); else shuttle(ctx, t);
}

/** Every so often a comet streaks across the open space on screen 0, behind the modules. */
export function drawComet(ctx: Ctx, t: number): void {
  const { cometEveryS, cometS } = CONFIG.client.space;
  const n = Math.floor(t / cometEveryS);
  const k = (t - n * cometEveryS) / cometS;
  if (k < 0 || k > 1) return;
  const x0 = 30 + hash2(n, 1) * 160, y0 = 42 + hash2(2, n) * 40;
  const x = x0 + k * 320, y = y0 + k * 90;
  const C = SPACE.comet;
  for (let i = 18; i > 0; i--) {
    ctx.globalAlpha = Math.max(0, 0.8 - i / 22);
    rect(ctx, x - i * 1.8, y - i * 0.5, 2, 1, C.tail[Math.min(C.tail.length - 1, Math.floor(i / 6))]!);
  }
  ctx.globalAlpha = 1;
  rect(ctx, x - 1, y - 1, 3, 2, C.head); rect(ctx, x, y - 2, 1, 4, C.tail[0]);
}

const tintFor = (name: string): string => {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return SPACE.walls[Math.abs(h) % SPACE.walls.length]!;
};

/** A station module seen in cutaway: steel hull, lit wall panels, a deck grating under each row, the repo's name on the band. */
export function drawPlace(ctx: Ctx, place: Place, repoName: string, t: number): void {
  const r = place.rect;
  const H = SPACE.hull;
  const wall = tintFor(repoName);
  if (r.y > TRUSS_H && r.y < AREA.y + AREA.h / 2) {                    // the top row docks to the truss with a tube
    const cx = Math.round(r.x + r.w / 2);
    rect(ctx, cx - 6, TRUSS_H - 3, 12, r.y - TRUSS_H + 4, SPACE.ink);
    rect(ctx, cx - 5, TRUSS_H - 3, 10, r.y - TRUSS_H + 4, H.c); rect(ctx, cx - 5, TRUSS_H - 3, 2, r.y - TRUSS_H + 4, H.l);
  }
  hullBox(ctx, r, wall);
  for (let px = r.x + 2 + 20; px < r.x + r.w - 4; px += 20) rect(ctx, px, r.y + PLACE.label + 2, 1, r.h - PLACE.label - 4, shade(wall, -0.08));
  for (let px = r.x + 8; px < r.x + r.w - 6; px += 20) for (let py = r.y + PLACE.label + 6; py < r.y + r.h - 6; py += 24) {
    rect(ctx, px, py, 3, 1, shade(wall, -0.14)); rect(ctx, px, py + 2, 3, 1, shade(wall, -0.14));
  }
  rect(ctx, r.x + 2, r.y + r.h - 4, r.w - 4, 2, shade(wall, -0.2));
  // a deck grating under each row of spots
  for (const sy of [place.spots[0]!.y, place.spots[3]!.y]) {
    rect(ctx, r.x + 2, sy - 1, r.w - 4, 4, SPACE.grate);
    for (let gx = r.x + 3; gx < r.x + r.w - 3; gx += 3) rect(ctx, gx, sy, 1, 2, SPACE.grateL);
    rect(ctx, r.x + 2, sy - 1, r.w - 4, 1, SPACE.grateL);
  }
  // rivets along the hull
  for (let px = r.x + 4; px < r.x + r.w - 3; px += 8) { rect(ctx, px, r.y + r.h - 2, 1, 1, H.rivet); }
  // name band
  rect(ctx, r.x + 2, r.y + 2, r.w - 4, PLACE.label - 1, SPACE.band);
  const text = fitText(repoName, r.w - 16);
  const tw = textWidth(text) + 6;
  const tx = Math.round(r.x + (r.w - tw) / 2);
  const led = Math.floor(t * 1.2 + r.x) % 3 === 0 ? SPACE.led.y : SPACE.led.g;
  rect(ctx, tx, r.y + 4, 3, 3, led);
  drawText(ctx, text, tx + 6, r.y + 2 + Math.floor((PLACE.label - FONT.capH) / 2), SPACE.label);
}
