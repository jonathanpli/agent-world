import { CONFIG } from "../../../shared/config";
import { drawText, fitText, FONT, textWidth } from "../../engine/font";
import { ellipse, hash2, PixelGrid, rect, shade } from "../../engine/pixels";
import type { Ctx, Place, Rect } from "../../engine/theme";
import { VIEW } from "../../engine/view";
import { SEA } from "./palette";

/** Off-duty divers swim in the open water right of the sites, on screen 0. */
export const LOUNGE: Rect = { x: 398, y: 80, w: 70, h: 166 };
/** Dive sites sit below the surface glare, left of the open water, on every screen. */
export const AREA: Rect = { x: 4, y: 38, w: 380, h: 228 };
export const PLACE = { label: 9, row0: 55, rowH: 48, maxW: 186, maxH: 108, gap: 8 } as const;
const SAND_Y = 254;

const wrap = (v: number, m: number): number => ((v % m) + m) % m;

function water(ctx: Ctx): void {
  const band = Math.ceil(VIEW.h / SEA.water.length);
  SEA.water.forEach((c, i) => rect(ctx, 0, i * band, VIEW.w, band, c));
  for (let i = 1; i < SEA.water.length; i++) for (let x = (i % 2) * 2; x < VIEW.w; x += 4) {
    rect(ctx, x, i * band - 1, 1, 1, SEA.water[i]!); rect(ctx, x + 1, i * band, 1, 1, SEA.water[i - 1]!);
  }
}

/** The surface seen from below: a bright rippling ceiling with glints. */
function surface(ctx: Ctx, t: number): void {
  rect(ctx, 0, 0, VIEW.w, 3, SEA.surface);
  for (let x = 0; x < VIEW.w; x += 2) {
    const d = Math.round(2 + Math.sin(x / 9 + t * 1.4) * 1.5 + Math.sin(x / 23 - t * 0.7));
    rect(ctx, x, 3, 2, d, SEA.surfaceD);
    if (hash2(Math.floor(x / 2), Math.floor(t * 3)) > 0.93) rect(ctx, x, 1, 2, 1, "#ffffff");
  }
}

/** Light shafts slanting down from the surface, swaying slowly. */
function shafts(ctx: Ctx, t: number, seed: number): void {
  ctx.fillStyle = SEA.shaft;
  for (let i = 0; i < 5; i++) {
    const x0 = 20 + i * 100 + hash2(seed, i) * 40 + Math.sin(t * 0.3 + i * 1.7) * 6;
    const w = 14 + hash2(i, seed) * 14;
    for (let y = 0; y < VIEW.h; y += 3) {
      ctx.globalAlpha = 0.09 * (1 - y / VIEW.h);
      ctx.fillRect(Math.round(x0 + y * 0.35), y, Math.round(w + y * 0.08), 3);
    }
  }
  ctx.globalAlpha = 1;
}

/** Far-off reef silhouettes and a slow drift of distant fish. */
function distance(ctx: Ctx, t: number, seed: number): void {
  for (let i = 0; i < 7; i++) {
    const x = hash2(seed, i + 20) * VIEW.w, rx = 30 + hash2(i, seed + 2) * 40, ry = 18 + hash2(seed + 4, i) * 22;
    ellipse(ctx, x, SAND_Y + 4, rx, ry, i % 2 === 0 ? SEA.far : SEA.farD);
  }
  for (let i = 0; i < 14; i++) {
    const y = 50 + hash2(seed + 9, i) * 170;
    const x = wrap(hash2(i, seed + 7) * VIEW.w + t * (4 + (i % 3) * 2), VIEW.w + 20) - 10;
    rect(ctx, x, y, 3, 1, SEA.far); rect(ctx, x - 1, y - 1, 1, 3, SEA.far);
  }
}

function kelp(ctx: Ctx, x: number, h: number, t: number, phase: number): void {
  for (let y = 0; y < h; y += 2) {
    const sway = Math.round(Math.sin(t * 0.9 + phase + y / 14) * (y / 16));
    rect(ctx, x + sway, SAND_Y - y, 2, 2, y % 8 < 4 ? SEA.kelp : SEA.kelpD);
    if (y % 10 === 4) rect(ctx, x + sway + (y % 20 === 4 ? 2 : -2), SAND_Y - y, 2, 1, SEA.kelpL);
  }
}

function seabed(ctx: Ctx, t: number, seed: number): void {
  rect(ctx, 0, SAND_Y, VIEW.w, VIEW.h - SAND_Y, SEA.sand);
  rect(ctx, 0, SAND_Y, VIEW.w, 1, SEA.sandL);
  for (let y = SAND_Y + 4; y < VIEW.h; y += 4) for (let x = (y % 8) * 2; x < VIEW.w; x += 12) rect(ctx, x, y, 5, 1, SEA.sandD);
  for (let i = 0; i < 10; i++) {
    const x = hash2(seed, i + 40) * VIEW.w;
    ellipse(ctx, x, SAND_Y + 2, 4 + hash2(i, seed) * 5, 3, i % 3 === 0 ? SEA.rockL : SEA.rock);
  }
  for (const [x, h, ph] of [[1, 60, 0], [386, 110, 1], [391, 80, 2.5]] as const) kelp(ctx, x, h, t, ph + seed);
}

/** Bubbles rising from vents in the sand, wobbling as they go. */
function bubbles(ctx: Ctx, t: number, seed: number, box: Rect = { x: 0, y: 0, w: VIEW.w, h: SAND_Y }, n = 18): void {
  for (let i = 0; i < n; i++) {
    const speed = CONFIG.client.underwater.bubbleRisePx * (0.7 + hash2(i, seed) * 0.6);
    const y = box.y + box.h - wrap(t * speed + hash2(seed, i) * box.h, box.h);
    const x = box.x + hash2(i, seed + 5) * box.w + Math.sin(t * 2 + i) * 1.5;
    bubble(ctx, x, y, i % 4 === 0 ? 2 : 1);
  }
}

/** A bubble: a single pixel, or a little ring with a glint. */
export function bubble(ctx: Ctx, x: number, y: number, size: 1 | 2): void {
  if (size === 1) { rect(ctx, x, y, 1, 1, SEA.bubble); return; }
  rect(ctx, x - 1, y, 1, 1, SEA.bubble); rect(ctx, x + 1, y, 1, 1, SEA.bubble); rect(ctx, x, y + 1, 1, 1, SEA.bubble);
  rect(ctx, x, y - 1, 1, 1, SEA.bubbleL);
}

/** The open water on screen 0: kelp forest edges, a sunken anchor, a giant clam. */
function openWater(ctx: Ctx, t: number): void {
  rect(ctx, 392, SAND_Y - 6, 84, 8, SEA.sandL); ellipse(ctx, 434, SAND_Y, 44, 6, SEA.sand);
  for (let i = 0; i < 4; i++) kelp(ctx, 395 + i * 23 + (i % 2) * 6, 40 + (i % 3) * 30, t, i * 1.3);
  kelp(ctx, 474, 150, t, 0.4);
  // anchor, half buried and tilted
  const A = SEA.anchor;
  for (let i = 0; i < 26; i++) rect(ctx, 424 + Math.round(i * 0.3), SAND_Y - 4 - i, 2, 1, i < 2 ? A : SEA.anchorL);
  rect(ctx, 428, SAND_Y - 33, 7, 5, A); rect(ctx, 430, SAND_Y - 32, 3, 3, SEA.water[4]!);
  rect(ctx, 418, SAND_Y - 6, 14, 2, A); rect(ctx, 416, SAND_Y - 9, 2, 4, A); rect(ctx, 432, SAND_Y - 9, 2, 4, A);
  rect(ctx, 421, SAND_Y - 24, 12, 2, A);
  // giant clam
  ellipse(ctx, 456, SAND_Y - 2, 9, 4, "#7a6aa8"); ellipse(ctx, 456, SAND_Y - 4, 7, 2, "#b0a0e0");
  const open = Math.sin(t * 0.6) > 0.4;
  if (open) { rect(ctx, 454, SAND_Y - 5, 4, 2, "#ffffff"); rect(ctx, 455, SAND_Y - 5, 1, 1, "#fff6d8"); }
}

/** Screens past the first have the bow of an old wreck where the open water would be. */
function bow(ctx: Ctx, t: number): void {
  const W = SEA.wood;
  const g = new PixelGrid(96, 220);
  for (let y = 0; y < 200; y++) {
    const half = Math.min(40, 8 + y * 0.5);
    for (let x = Math.round(48 - half); x < Math.round(48 + half); x++) g.set(x, y + 20, (y + 20) % 8 === 0 ? W.d : x > 48 + half - 8 ? W.d : W.c);
  }
  for (const [px, py] of [[36, 90], [58, 120], [40, 160]] as const) { g.fill(px - 3, py - 3, px + 3, py + 3, W.brass); g.fill(px - 2, py - 2, px + 2, py + 2, W.glass); }
  for (let i = 0; i < 40; i++) g.set(Math.floor(hash2(i, 3) * 70) + 13, Math.floor(hash2(5, i) * 180) + 40, W.barnacle);
  for (let y = 4; y < 22; y++) g.set(48, y, W.d);                                   // bowsprit stub
  g.outline(SEA.ink);
  g.blit(ctx, 388, SAND_Y - 220 + 6);
  rect(ctx, 388, SAND_Y - 2, 96, 4, SEA.sand);
  kelp(ctx, 400, 50, t, 1); kelp(ctx, 470, 70, t, 2);
}

export function drawBackdrop(ctx: Ctx, t: number, screenIndex: number): void {
  water(ctx);
  shafts(ctx, t, screenIndex);
  distance(ctx, t, screenIndex + 1);
  seabed(ctx, t, screenIndex);
  surface(ctx, t);
  bubbles(ctx, t, screenIndex + 11);
  if (screenIndex === 0) openWater(ctx, t); else bow(ctx, t);
}

const hashName = (name: string): number => {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};

/** A reef wall with coral dotted over it and sand ledges under each row. */
function reef(ctx: Ctx, place: Place, h: number): void {
  const r = place.rect;
  const wall = SEA.reefWalls[h % SEA.reefWalls.length]!;
  rect(ctx, r.x + 1, r.y, r.w - 2, r.h, SEA.ink); rect(ctx, r.x, r.y + 1, r.w, r.h - 2, SEA.ink);
  rect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, wall);
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); ctx.clip();
  for (let i = 0; i < 14; i++) {                                                     // the rock's lumps, lit from above
    const cx = r.x + hash2(h + 1, i) * r.w, cy = r.y + PLACE.label + hash2(i, h + 2) * (r.h - PLACE.label);
    const rx = 8 + hash2(i, h) * 14, ry = 5 + hash2(h, i + 5) * 8;
    ellipse(ctx, cx, cy + 1, rx, ry, shade(wall, -0.1));
    ellipse(ctx, cx, cy, rx - 1, ry - 1, i % 3 === 0 ? shade(wall, 0.06) : wall);
    rect(ctx, cx - rx / 2, cy - ry + 1, rx * 0.8, 1, shade(wall, 0.14));
  }
  ctx.restore();
  for (const [row, sy] of [place.spots[0]!.y, place.spots[3]!.y].entries()) {
    rect(ctx, r.x + 1, sy - 2, r.w - 2, 5, SEA.sandD);
    rect(ctx, r.x + 1, sy - 2, r.w - 2, 1, SEA.sandL);
    for (let x = r.x + 4; x < r.x + r.w - 4; x += 7) rect(ctx, x, sy, 3, 1, SEA.sand);
    // coral tufts and sea grass on the ledge, in the gaps between spots
    for (let i = 0; i < 4; i++) {
      const gx = Math.round(r.x + (r.w * i) / 3 + (i === 0 ? 4 : i === 3 ? -6 : 0));
      const c = SEA.corals[(h + i + row) % SEA.corals.length]!;
      if ((h + i + row) % 2 === 0) { rect(ctx, gx - 1, sy - 5, 3, 3, c.c); rect(ctx, gx - 2, sy - 4, 1, 1, c.c); rect(ctx, gx, sy - 6, 1, 1, c.l); }
      else for (const dx of [-1, 1, 2]) rect(ctx, gx + dx, sy - 4 - (dx & 1) * 2, 1, 3 + (dx & 1) * 2, SEA.kelpL);
    }
  }
}

/** The side of a sunken ship: planks, portholes, barnacles and deck boards under each row. */
function wreck(ctx: Ctx, place: Place, h: number): void {
  const r = place.rect;
  const W = SEA.wood;
  rect(ctx, r.x + 1, r.y, r.w - 2, r.h, SEA.ink); rect(ctx, r.x, r.y + 1, r.w, r.h - 2, SEA.ink);
  rect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, W.c);
  for (let py = r.y + PLACE.label + 6, i = 0; py < r.y + r.h - 2; py += 6, i++) {    // long planks, butt joints staggered
    rect(ctx, r.x + 1, py, r.w - 2, 1, W.d);
    rect(ctx, r.x + 1, py - 5, r.w - 2, 1, i % 2 === 0 ? W.l : W.c);
    for (let px = r.x + 1 + ((i * 37 + h) % 70); px < r.x + r.w - 2; px += 70) rect(ctx, px, py - 5, 1, 5, W.d);
  }
  for (let px = r.x + 14; px < r.x + r.w - 6; px += 44) {                           // ribs and a porthole between them
    rect(ctx, px, r.y + PLACE.label + 1, 3, r.h - PLACE.label - 2, W.d); rect(ctx, px, r.y + PLACE.label + 1, 1, r.h - PLACE.label - 2, W.l);
    for (let py = r.y + PLACE.label + 6; py < r.y + r.h - 4; py += 12) rect(ctx, px + 1, py, 1, 1, W.brass);
  }
  for (let i = 0; i < 6; i++) {                                                      // rust streaks and barnacles
    const x = r.x + 6 + hash2(h, i + 3) * (r.w - 12);
    ctx.globalAlpha = 0.5; rect(ctx, x, r.y + PLACE.label + 2, 2, 10 + hash2(i, h) * 20, W.rust); ctx.globalAlpha = 1;
    rect(ctx, r.x + 3 + hash2(i, h + 9) * (r.w - 6), r.y + 14 + hash2(h + 2, i) * (r.h - 20), 2, 1, W.barnacle);
  }
  for (const sy of [place.spots[0]!.y, place.spots[3]!.y]) {
    rect(ctx, r.x + 1, sy - 2, r.w - 2, 5, W.l);
    rect(ctx, r.x + 1, sy + 2, r.w - 2, 1, W.d);
    for (let x = r.x + 6; x < r.x + r.w - 2; x += 12) rect(ctx, x, sy - 2, 1, 4, W.d);
  }
}

/** A dive site: a reef wall or a wreck, picked by the repo's name, with its name on a plank strung between two floats. */
export function drawPlace(ctx: Ctx, place: Place, repoName: string, t: number): void {
  const h = hashName(repoName);
  if (h % 2 === 0) reef(ctx, place, h); else wreck(ctx, place, h);
  const r = place.rect;
  rect(ctx, r.x + 1, r.y + 1, r.w - 2, PLACE.label, SEA.band);
  rect(ctx, r.x + 1, r.y + 1, r.w - 2, 1, SEA.bandL);
  const bob = Math.round(Math.sin(t * 1.5 + r.x) * 0.6);
  for (const fx of [r.x + 5, r.x + r.w - 6]) { ellipse(ctx, fx, r.y + 5 + bob, 3, 2, SEA.float); rect(ctx, fx - 1, r.y + 4 + bob, 1, 1, SEA.floatL); }
  const text = fitText(repoName, r.w - 22);
  const tx = Math.round(r.x + (r.w - textWidth(text)) / 2);
  drawText(ctx, text, tx, r.y + 1 + Math.floor((PLACE.label - FONT.capH) / 2), SEA.label);
}

/** A school of fish circling the open water and a sea turtle on its slow round, on screen 0. */
export function drawAmbient(ctx: Ctx, t: number): void {
  const { schoolS, turtleSpeed } = CONFIG.client.underwater;
  const a = (t / schoolS) * Math.PI * 2;
  for (let i = 0; i < 9; i++) {
    const p = a - i * 0.09;
    const x = 433 + Math.cos(p) * 30 + Math.sin(i * 2.1) * 4, y = 140 + Math.sin(p * 2) * 50 + Math.cos(i * 1.3) * 4;
    const dir = -Math.sin(p) >= 0 ? 1 : -1;
    const c = SEA.fish[i % 2 === 0 ? 0 : 3]!;
    rect(ctx, x - 2, y, 4, 2, c); rect(ctx, x - 2 - dir * 2, y - (Math.floor(t * 6 + i) % 2), 1, 3, c);
    rect(ctx, x + dir, y, 1, 1, SEA.ink);
  }
  // the turtle swims a long loop through the open water
  const span = 150, k = wrap(t * turtleSpeed, span * 2);
  const up = k < span;
  const ty = up ? 230 - k : 80 + (k - span), tx = 433 + Math.sin(k / 25) * 22;
  const T = SEA.turtle;
  const flap = Math.floor(t * 3) % 2;
  const d = up ? -1 : 1;
  ellipse(ctx, tx, ty, 6, 5, SEA.ink);
  ellipse(ctx, tx, ty, 5, 4, T.shell); ellipse(ctx, tx, ty, 3, 2, T.shellL);
  rect(ctx, tx - 1, ty + d * 6, 3, 3, T.skin); rect(ctx, tx, ty + d * 7 + (d > 0 ? 1 : 0), 1, 1, SEA.ink);
  for (const sx of [-1, 1]) {
    rect(ctx, tx + sx * (6 + flap), ty + d * 2 - 1, 2 + flap, 2, T.skin);
    rect(ctx, tx + sx * 5, ty - d * 4, 2, 2, T.skinD);
  }
}
