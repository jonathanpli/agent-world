import { CONFIG } from "../../../shared/config";
import type { ToolKind } from "../../../shared/types";
import { COMPACTION_MS, sidekickSlots } from "../../engine/actions";
import { ellipse, hash2, PixelGrid, rect } from "../../engine/pixels";
import { OUTLINE } from "../../engine/sprite";
import type { Ctx, Point } from "../../engine/theme";
import { OFFICE } from "./palette";
import { LOUNGE } from "./room";

/** Draws relative to the (rounded) spot: (x, y) offsets from the seat, as in desks.ts. */
type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
const penAt = (ctx: Ctx, s: Point): Pen => {
  const x0 = Math.round(s.x), y0 = Math.round(s.y);
  return (x, y, w, h, c) => rect(ctx, x0 + x, y0 + y, w, h, c);
};

// A screen laid over the desk's main monitor: content is 12x8 at (-6, -40), so it covers a junior's monitor whole.
const SCR = { x: -6, y: -40, w: 12, h: 8 } as const;

function screenOver(r: Pen, bg: string): Pen {
  r(SCR.x - 2, SCR.y - 2, SCR.w + 4, SCR.h + 4, OFFICE.ink);
  r(SCR.x - 1, SCR.y - 1, SCR.w + 2, SCR.h + 2, OFFICE.monitor);
  r(SCR.x, SCR.y, SCR.w, SCR.h, bg);
  return (x, y, w, h, c) => r(SCR.x + x, SCR.y + y, w, h, c);
}

/** Pages filling with lines on screen, a fresh page every 8 frames; keys flash under fast fingers. */
function edit(r: Pen, frame: number): void {
  const s = screenOver(r, OFFICE.screen.code);
  const P = OFFICE.paper;
  const page = Math.floor(frame / 8), sub = frame % 8;
  s(2, 0, 8, 8, P.sheet);
  s(9, 0, 1, 8, P.edge);
  for (let i = 0; i < 3; i++) {
    const full = 2 + Math.floor(hash2(page, i) * 5);
    const len = Math.min(full, Math.max(0, sub * 2 - i * 4));
    if (len > 0) s(3, 1 + i * 2, len, 1, P.line);
  }
  for (let i = 0; i < 3; i++) r(-5 + Math.floor(hash2(frame, i) * 10), -25, 1, 1, "#ffffff");
}

/** The monitor turns terminal green: prompts scroll up and the cursor blinks. */
function shell(r: Pen, frame: number): void {
  const T = OFFICE.term;
  const s = screenOver(r, T.bg);
  for (let row = 0; row < 3; row++) {
    const n = frame + row;
    s(1, 1 + row * 2, 1, 1, T.text);
    if (row < 2) s(3, 1 + row * 2, 2 + Math.floor(hash2(n, 5) * 6), 1, T.textD);
  }
  if (frame % 4 < 2) s(3, 5, 2, 2, T.text);
}

/** An open folder on the desk, a page flipping right to left. */
function read(r: Pen, frame: number): void {
  const P = OFFICE.paper;
  r(-10, -32, 20, 10, OFFICE.ink);
  r(-9, -31, 18, 8, P.folder);
  r(-9, -24, 18, 1, P.folderD);
  r(-8, -30, 7, 6, P.sheet); r(1, -30, 7, 6, P.sheet);
  r(-1, -31, 2, 8, P.folderD);
  for (let i = 0; i < 2; i++) { r(-7, -29 + i * 2, 5, 1, P.line); r(2, -29 + i * 2, 5, 1, P.line); }
  switch (frame % 4) {
    case 1: r(1, -33, 6, 1, OFFICE.ink); r(1, -32, 6, 5, P.sheet); r(1, -32, 1, 5, P.edge); break;      // lifting off the right
    case 2: r(-1, -38, 2, 10, OFFICE.ink); r(0, -37, 1, 8, P.sheet); break;                              // upright
    case 3: r(-7, -33, 6, 1, OFFICE.ink); r(-7, -32, 6, 5, P.sheet); r(-2, -32, 1, 5, P.edge); break;    // landing on the left
  }
}

/** A turning globe on the monitor, with a ping circling it. */
function web(r: Pen, frame: number): void {
  const W = OFFICE.web;
  const s = screenOver(r, W.sky);
  const half = [2, 3, 4, 4, 4, 3, 2];
  const cx = 6, top = 0;
  half.forEach((hw, row) => {
    for (let x = cx - hw; x < cx + hw; x++) {
      const land = hash2(row >> 1, (((x - cx + frame) % 6) + 6) % 6) > 0.55;
      s(x, top + row, 1, 1, land ? W.land : W.sea);
    }
  });
  s(cx - 1, top + 1, 1, 1, W.ring);
  const a = frame * 0.8;
  s(cx + Math.round(Math.cos(a) * 5) - 1, top + 3 + Math.round(Math.sin(a) * 3), 1, 1, OFFICE.ink);
}

/** A sheet handed across toward the first sidekick slot, arcing over, then held there. */
function delegate(ctx: Ctx, spot: Point, frame: number): void {
  const to = sidekickSlots(spot, 1).points[0] ?? { x: spot.x + 11, y: spot.y };
  const k = Math.min(1, frame / 10);
  const x = Math.round(spot.x + (to.x - spot.x) * k), y = Math.round(spot.y - 16 + (to.y - 8 - (spot.y - 16)) * k - Math.sin(k * Math.PI) * 7);
  const P = OFFICE.paper;
  if (k < 1) {
    const dir = to.x >= spot.x ? -1 : 1;
    ctx.globalAlpha = 0.7;
    for (let i = 1; i <= 2; i++) rect(ctx, x + dir * (3 + i * 2), y - 1 + i, 2, 1, "#ffffff");
    ctx.globalAlpha = 1;
  }
  rect(ctx, x - 3, y - 4, 7, 8, OFFICE.ink);
  rect(ctx, x - 2, y - 3, 5, 6, P.sheet);
  rect(ctx, x - 1, y - 2, 3, 1, P.line); rect(ctx, x - 1, y, 3, 1, P.line);
}

/** Generic work: three dots lighting in turn on the monitor. */
function other(r: Pen, frame: number): void {
  const s = screenOver(r, OFFICE.screen.code);
  const lit = Math.floor(frame / 2) % 3;
  for (let i = 0; i < 3; i++) s(1 + i * 4, 3, 2, 2, i === lit ? "#ffffff" : OFFICE.screen.glare);
}

/** A red, flashing monitor throwing sparks from its corners, and shake marks either side of the head. */
function failed(r: Pen, frame: number): void {
  const F = OFFICE.fail;
  const s = screenOver(r, frame % 4 < 2 ? F.flash : F.bg);
  s(5, 1, 2, 4, F.mark); s(5, 6, 2, 1, F.mark);
  for (let i = 0; i < 6; i++) {
    const p = (frame + i * 2) % 6;
    const side = i % 2 === 0 ? -1 : 1;
    const ox = side < 0 ? SCR.x - 2 : SCR.x + SCR.w + 1, oy = SCR.y - 2;
    const vx = side * (1 + (i % 3) * 0.6);
    r(Math.round(ox + vx * p), Math.round(oy - 2.4 * p + 0.45 * p * p), 1, 1, F.spark[i % F.spark.length]!);
  }
  const left = frame % 2 === 0;
  const hx = left ? -7 : 6, dx = left ? -1 : 1;
  r(hx, -17, 1, 3, OFFICE.ink); r(hx + dx, -16, 1, 1, OFFICE.ink);
  r(hx + dx * 2, -18, 1, 5, OFFICE.ink);
}

/** The office's look for a tool at a spot (an actor's desk or a sidekick's slot); a failure draws sparks instead. */
export function drawAction(ctx: Ctx, spot: Point, kind: ToolKind, isFailed: boolean, frame: number): void {
  const r = penAt(ctx, spot);
  const f = Math.max(0, Math.floor(frame));
  if (isFailed) return failed(r, f);
  switch (kind) {
    case "edit": return edit(r, f);
    case "shell": return shell(r, f);
    case "read": return read(r, f);
    case "web": return web(r, f);
    case "delegate": return delegate(ctx, spot, f);
    case "other": return other(r, f);
  }
}

/** A half-height intern with a lanyard and badge; busy, it taps away at a clipboard. It pops in with a puff. */
export function drawSidekick(ctx: Ctx, at: Point, frame: number, busy: boolean, t: number): void {
  const I = OFFICE.intern;
  ctx.globalAlpha = 0.25;
  ellipse(ctx, at.x, at.y, 3, 1, OFFICE.ink);
  ctx.globalAlpha = 1;
  const g = new PixelGrid(14, 14, 1, 1);
  g.fill(2, 0, 6, 0, I.hair); g.fill(1, 1, 7, 1, I.hair);
  g.fill(1, 2, 7, 4, I.skin); g.set(1, 2, I.hair); g.set(7, 2, I.hair);
  g.fill(2, 4, 6, 4, I.skin);
  g.set(3, 3, OUTLINE); g.set(5, 3, OUTLINE);
  g.fill(1, 5, 7, 8, I.shirt); g.fill(1, 8, 7, 8, I.shirtS);
  for (const [x, y] of [[2, 5], [6, 5], [3, 6], [5, 6], [4, 6]] as const) g.set(x, y, I.lanyard);
  g.fill(3, 7, 5, 8, I.badge);
  g.fill(2, 9, 3, 10, I.pants); g.fill(5, 9, 6, 10, I.pants);
  g.fill(2, 11, 3, 11, OFFICE.ink); g.fill(5, 11, 6, 11, OFFICE.ink);
  g.fill(0, 6, 0, 7, I.shirtS); g.set(0, 8, I.skin);
  if (busy) {
    g.fill(8, 4, 11, 9, I.board); g.fill(9, 5, 10, 8, I.badge);
    g.fill(9, 4, 10, 4, OFFICE.bin.bodyL);
    if (frame % 2 === 0) g.set(9, 6 + ((frame >> 1) % 2) * 2, OFFICE.paper.line);
    g.set(7, 6, I.shirtS); g.set(frame % 2 === 0 ? 8 : 9, frame % 2 === 0 ? 7 : 6, I.skin);   // the tapping hand
  } else {
    g.fill(8, 6, 8, 7, I.shirtS); g.set(8, 8, I.skin);
  }
  g.outline(OUTLINE);
  const bob = busy ? (frame % 2 === 0 ? 0 : -1) : Math.round(Math.sin(t * 3 + at.x * 0.37) * 0.6);
  g.blit(ctx, Math.round(at.x) - 4, Math.round(at.y) - 12 + bob);
  if (frame < 3) {
    ctx.globalAlpha = 0.85 - frame * 0.25;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rad = 5 + frame * 2;
      rect(ctx, Math.round(at.x + Math.cos(a) * rad) - 1, Math.round(at.y - 6 + Math.sin(a) * rad * 0.8) - 1, 2, 2, I.puff);
    }
    ctx.globalAlpha = 1;
  }
}

const STACK = { x: -13, w: 8, base: -24, heights: [3, 5, 8, 11] } as const;

/** A paper stack at the left of the desk, taller with each quarter of context used; hot, it blinks red with a sticky note. */
export function drawContextGauge(ctx: Ctx, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void {
  const r = penAt(ctx, spot);
  const P = OFFICE.paper;
  const h = STACK.heights[step], top = STACK.base - h + 1;
  const alarm = hot && Math.floor(t / 0.6) % 2 === 0;
  r(STACK.x - 1, top - 1, STACK.w + 2, h + 2, alarm ? P.note : OFFICE.ink);
  for (let i = 0; i < h; i++) r(STACK.x, STACK.base - i, STACK.w, 1, i % 2 === 1 ? P.edge : alarm ? P.hot : P.sheet);
  r(STACK.x + 1, top, STACK.w - 3, 1, P.line);
  if (alarm) { r(STACK.x + STACK.w - 3, top - 3, 4, 3, OFFICE.ink); r(STACK.x + STACK.w - 2, top - 2, 2, 2, P.note); }
}

/** The compaction moment: the stack's sheets fly one by one into a bin by the desk, which then fades away. */
export function drawCompaction(ctx: Ctx, spot: Point, frame: number): void {
  const r = penAt(ctx, spot);
  const life = (COMPACTION_MS / 1000) * CONFIG.client.animFps;
  const k = Math.min(1, Math.max(0, frame / life));
  const B = OFFICE.bin, P = OFFICE.paper;
  const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
  ctx.globalAlpha = fade;
  const lid = k > 0.4 && k < 0.65 ? -1 : 0;
  r(-22, -9, 9, 10, OFFICE.ink);
  r(-21, -8, 7, 8, B.body);
  r(-19, -7, 1, 6, B.bodyL); r(-17, -7, 1, 6, B.bodyL);
  r(-23, -10 + lid, 11, 2, OFFICE.ink); r(-22, -10 + lid, 9, 1, B.rim);
  if (k < 0.45) {                                                    // the sweep across the desk
    const u = k / 0.45;
    ctx.globalAlpha = 0.8 * fade;
    for (let i = 0; i < 3; i++) r(Math.round(-4 - u * 8), -30 + i * 2, 4 - i, 1, "#ffffff");
    ctx.globalAlpha = fade;
  }
  for (let i = 0; i < 6; i++) {
    const u = (k - 0.05 - i * 0.07) / 0.35;
    if (u < 0 || u >= 1) continue;
    const x = Math.round(-9 + (-17 + 9) * u), y = Math.round(-26 - i + (-9 + 26 + i) * u - Math.sin(u * Math.PI) * 8);
    const wide = (frame + i) % 2 === 0;
    r(x - 2, y - 2, wide ? 5 : 4, wide ? 4 : 5, OFFICE.ink);
    r(x - 1, y - 1, wide ? 3 : 2, wide ? 2 : 3, P.sheet);
  }
  if (k > 0.45 && k < 0.75) {                                        // dust off the rim as they land
    ctx.globalAlpha = 0.7 * fade;
    for (let i = 0; i < 4; i++) r(-22 + i * 3, -12 - (frame % 3) - (i % 2), 1, 1, "#ffffff");
  }
  ctx.globalAlpha = 1;
}

/** Where idle characters meet: in front of the water cooler and the sofa, at the top of the lounge rug. */
export const socialSpots: Point[] = [
  { x: 436, y: LOUNGE.y + 4 },
  { x: 460, y: LOUNGE.y + 4 },
];
