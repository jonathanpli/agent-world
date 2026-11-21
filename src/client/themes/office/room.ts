import { fitText, drawText, FONT, textWidth } from "../../engine/font";
import { ellipse, hash2, rect, shade } from "../../engine/pixels";
import type { Ctx, Place, Rect } from "../../engine/theme";
import { VIEW } from "../../engine/view";
import { OFFICE } from "./palette";

export const WALL_H = 34;
/** Where off-duty characters wander on screen 0 (the rug in the break corner). */
export const LOUNGE: Rect = { x: 398, y: 80, w: 70, h: 166 };
/** Places live left of the break corner and below the wall, on every screen. */
export const AREA: Rect = { x: 4, y: 38, w: 380, h: 228 };
export const PLACE = { label: 9, row0: 55, rowH: 48, maxW: 186, maxH: 108, gap: 8 } as const;

const WINDOWS = [20, 120, 220, 320];
const WIN = { y: 4, w: 52, h: 18 };

function floor(ctx: Ctx): void {
  const plank = 8;
  for (let y = WALL_H, i = 0; y < VIEW.h; y += plank, i++) {
    rect(ctx, 0, y, VIEW.w, plank, OFFICE.floor[i % OFFICE.floor.length]!);
    rect(ctx, 0, y + plank - 1, VIEW.w, 1, OFFICE.seam);
    for (let x = (i * 29) % 56; x < VIEW.w; x += 56) rect(ctx, x, y, 1, plank - 1, OFFICE.seam);
  }
  rect(ctx, 0, WALL_H, VIEW.w, 2, OFFICE.floorShadow);
}

/** Pale light falling from each window onto the floor. */
function sunbeams(ctx: Ctx, xs: number[]): void {
  ctx.globalAlpha = 0.13;
  for (const wx of xs) for (let dy = 0; dy < 46; dy += 2) rect(ctx, wx + 4 + dy * 0.6, WALL_H + dy, WIN.w - 8, 2, OFFICE.sun);
  ctx.globalAlpha = 1;
}

function wall(ctx: Ctx): void {
  rect(ctx, 0, 0, VIEW.w, WALL_H, OFFICE.wall);
  for (let x = 6; x < VIEW.w; x += 12) rect(ctx, x, 0, 1, WALL_H - 10, OFFICE.wallS);
  rect(ctx, 0, WALL_H - 10, VIEW.w, 8, OFFICE.wainscot);
  rect(ctx, 0, WALL_H - 10, VIEW.w, 1, OFFICE.wainscotL);
  for (let x = 10; x < VIEW.w; x += 24) rect(ctx, x, WALL_H - 8, 1, 5, shade(OFFICE.wainscot, -0.12));
  rect(ctx, 0, WALL_H - 2, VIEW.w, 2, OFFICE.skirting);
}

function windowAt(ctx: Ctx, x: number, t: number, seed: number): void {
  const W = OFFICE.window;
  const { y, w, h } = WIN;
  rect(ctx, x - 2, y - 2, w + 4, h + 4, W.frame);
  const band = Math.ceil(h / W.sky.length);
  W.sky.forEach((c, i) => rect(ctx, x, y + i * band, w, Math.min(band, h - i * band), c));
  for (let bx = 0; bx < w; bx += 4) {
    const bh = 2 + Math.floor(hash2(seed, bx) * 7);
    rect(ctx, x + bx, y + h - bh, 4, bh, bx % 8 === 0 ? W.city : W.cityD);
  }
  for (let k = 0; k < 2; k++) {
    const span = w + 18;
    const cx = ((t * (2 + k) + hash2(seed, k + 9) * span) % span) - 9;
    const cy = y + 3 + k * 5;
    const parts: [number, number, number, number][] = [[0, 1, 9, 2], [2, 0, 4, 1]];
    for (const [dx, dy, pw, ph] of parts) {
      const x0 = Math.max(x, x + cx + dx), x1 = Math.min(x + w, x + cx + dx + pw);
      if (x1 > x0) rect(ctx, x0, cy + dy, x1 - x0, ph, W.cloud);
    }
  }
  rect(ctx, x + w / 2 - 1, y, 2, h, W.frame); rect(ctx, x, y + h / 2 - 1, w, 1, W.frameL);
  rect(ctx, x - 3, y + h + 1, w + 6, 2, W.sill);
}

function plant(ctx: Ctx, x: number, y: number, size: number): void {
  const P = OFFICE.plant;
  rect(ctx, x - 4, y - 7, 9, 8, OFFICE.ink); rect(ctx, x - 3, y - 7, 7, 7, P.pot); rect(ctx, x - 3, y - 7, 7, 1, shade(P.pot, 0.2));
  for (let i = 0; i < size; i++) {
    const a = (i / size) * Math.PI - Math.PI;
    const lx = x + Math.round(Math.cos(a) * 5), ly = y - 9 + Math.round(Math.sin(a) * 6);
    ellipse(ctx, lx, ly, 2, 2, i % 2 === 0 ? P.leaf : P.leafD);
  }
  ellipse(ctx, x, y - 14, 2, 3, P.leafL);
}

function loungeDecor(ctx: Ctx, t: number): void {
  const L = OFFICE.lounge;
  // rug under the wandering area
  rect(ctx, LOUNGE.x - 5, LOUNGE.y - 7, LOUNGE.w + 10, LOUNGE.h + 14, L.rugD);
  rect(ctx, LOUNGE.x - 4, LOUNGE.y - 6, LOUNGE.w + 8, LOUNGE.h + 12, L.rug);
  rect(ctx, LOUNGE.x - 1, LOUNGE.y - 3, LOUNGE.w + 2, 1, L.rugL); rect(ctx, LOUNGE.x - 1, LOUNGE.y + LOUNGE.h + 2, LOUNGE.w + 2, 1, L.rugL);
  for (let y = LOUNGE.y + 4; y < LOUNGE.y + LOUNGE.h; y += 12) for (let x = LOUNGE.x + 4 + ((y / 12) % 2) * 6; x < LOUNGE.x + LOUNGE.w - 2; x += 12) {
    rect(ctx, x, y, 2, 2, L.rugL);
  }
  // poster and clock on the wall
  rect(ctx, 396, 4, 18, 16, OFFICE.ink);
  L.poster.forEach((c, i) => rect(ctx, 397, 5 + i * 5, 16, 5, c));
  ellipse(ctx, 404, 10, 3, 2, "#fff3c4");
  ellipse(ctx, 466, 12, 6, 6, OFFICE.ink); ellipse(ctx, 466, 12, 5, 5, L.clock);
  const m = t / 10, hr = t / 120;
  rect(ctx, 466 + Math.round(Math.cos(m) * 3), 12 + Math.round(Math.sin(m) * 3), 1, 1, OFFICE.ink);
  rect(ctx, 466 + Math.round(Math.cos(m) * 2), 12 + Math.round(Math.sin(m) * 2), 1, 1, OFFICE.ink);
  rect(ctx, 466 + Math.round(Math.cos(hr) * 2), 12 + Math.round(Math.sin(hr) * 2), 1, 1, L.red);
  rect(ctx, 466, 12, 1, 1, OFFICE.ink);
  // counter with the coffee machine
  rect(ctx, 389, 25, 40, 26, OFFICE.ink);
  rect(ctx, 390, 26, 38, 5, L.counterTop);
  rect(ctx, 390, 31, 38, 19, L.counter);
  rect(ctx, 409, 32, 1, 17, L.counterD); rect(ctx, 400, 39, 4, 1, L.counterD); rect(ctx, 415, 39, 4, 1, L.counterD);
  rect(ctx, 389, 51, 40, 2, OFFICE.floorShadow);
  rect(ctx, 393, 8, 14, 19, OFFICE.ink);
  rect(ctx, 394, 9, 12, 17, L.machine); rect(ctx, 394, 9, 12, 2, L.machineL);
  rect(ctx, 396, 12, 8, 3, L.metal); rect(ctx, 397, 13, 2, 1, Math.floor(t * 2) % 2 === 0 ? L.green : L.machine);
  rect(ctx, 399, 17, 2, 2, L.metal);
  rect(ctx, 398, 22, 4, 4, L.cup); rect(ctx, 398, 22, 4, 1, L.coffee);
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < 3; i++) {
    const sy = 20 - ((t * 6 + i * 3) % 9);
    rect(ctx, 399 + Math.round(Math.sin(t * 3 + i) * 1), sy, 1, 1, L.steam);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) { rect(ctx, 412 + i * 5, 22, 4, 4, OFFICE.ink); rect(ctx, 413 + i * 5, 23, 2, 3, OFFICE.confetti[i]!); }
  // water cooler
  rect(ctx, 431, 9, 10, 42, OFFICE.ink);
  rect(ctx, 432, 10, 8, 13, L.cooler); rect(ctx, 433, 11, 2, 9, "#ffffff");
  rect(ctx, 432, 23, 8, 27, L.metal); rect(ctx, 434, 28, 4, 2, L.coolerD); rect(ctx, 432, 23, 8, 1, L.coolerD);
  // sofa against the wall
  rect(ctx, 443, 29, 35, 27, OFFICE.ink);
  rect(ctx, 444, 30, 33, 11, L.sofa); rect(ctx, 444, 30, 33, 2, L.sofaL);
  rect(ctx, 444, 41, 33, 9, L.sofaL); rect(ctx, 460, 41, 1, 9, L.sofa);
  rect(ctx, 444, 50, 33, 5, L.sofaD);
  rect(ctx, 443, 36, 4, 19, L.sofaD); rect(ctx, 474, 36, 4, 19, L.sofaD);
  rect(ctx, 443, 56, 35, 2, OFFICE.floorShadow);
  plant(ctx, 389, 262, 7);
  plant(ctx, 474, 264, 6);
}

function workroomDecor(ctx: Ctx): void {
  const S = OFFICE.shelf;
  rect(ctx, 403, 6, 38, 46, OFFICE.ink);
  rect(ctx, 404, 7, 36, 44, S.wood);
  for (let row = 0; row < 3; row++) {
    const y = 9 + row * 14;
    rect(ctx, 405, y, 34, 12, S.woodD);
    for (let bx = 0, i = 0; bx < 32; i++) {
      const bw = 2 + Math.floor(hash2(row, i) * 3), bh = 8 + Math.floor(hash2(i, row + 5) * 4);
      rect(ctx, 406 + bx, y + 12 - bh, bw, bh, S.books[(row * 3 + i) % S.books.length]!);
      bx += bw + 1;
    }
  }
  rect(ctx, 403, 52, 38, 2, OFFICE.floorShadow);
  const P = OFFICE.printer;
  rect(ctx, 449, 33, 24, 18, OFFICE.ink);
  rect(ctx, 450, 34, 22, 16, P.body); rect(ctx, 450, 44, 22, 6, P.bodyD);
  rect(ctx, 454, 30, 14, 5, OFFICE.ink); rect(ctx, 455, 31, 12, 4, P.paper);
  rect(ctx, 468, 37, 2, 1, P.light);
  plant(ctx, 474, 264, 6);
}

export function drawBackdrop(ctx: Ctx, t: number, screenIndex: number): void {
  floor(ctx);
  const xs = screenIndex === 0 ? WINDOWS : [...WINDOWS, 420];
  sunbeams(ctx, xs);
  wall(ctx);
  xs.forEach((x, i) => windowAt(ctx, x, t, screenIndex * 10 + i));
  if (screenIndex === 0) loungeDecor(ctx, t); else workroomDecor(ctx);
}

const carpetFor = (name: string): string => {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return OFFICE.carpets[Math.abs(h) % OFFICE.carpets.length]!;
};

/** A team carpet with the repo's name on a band along the top. */
export function drawPlace(ctx: Ctx, place: Place, repoName: string, _t: number): void {
  const { x, y, w, h } = place.rect;
  const c = carpetFor(repoName);
  rect(ctx, x + 1, y, w - 2, h, shade(c, -0.2));
  rect(ctx, x, y + 1, w, h - 2, shade(c, -0.2));
  rect(ctx, x + 1, y + 1, w - 2, h - 2, c);
  for (let py = y + PLACE.label + 3; py < y + h - 2; py += 6) for (let px = x + 3 + ((py - y) % 12 === 0 ? 3 : 0); px < x + w - 2; px += 6) {
    rect(ctx, px, py, 1, 1, shade(c, -0.07));
  }
  rect(ctx, x + 1, y + 1, w - 2, PLACE.label, shade(c, -0.32));
  const text = fitText(repoName, w - 14);
  const tw = textWidth(text) + 6;
  const tx = Math.round(x + (w - tw) / 2);
  rect(ctx, tx, y + 3, 4, 4, OFFICE.brass); rect(ctx, tx, y + 3, 2, 1, shade(OFFICE.brass, 0.3));
  drawText(ctx, text, tx + 6, y + 1 + Math.floor((PLACE.label - FONT.capH) / 2), OFFICE.label);
}
