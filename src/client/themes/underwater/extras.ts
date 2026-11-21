import { CONFIG } from "../../../shared/config";
import type { ToolKind } from "../../../shared/types";
import { COMPACTION_MS, sidekickSlots } from "../../engine/actions";
import { ellipse, hash2, PixelGrid, rect } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { SEA } from "./palette";
import { bubble, CORAL_HEAD } from "./scenery";

/** Draws relative to the (rounded) spot: (x, y) offsets from the spot, as in sites.ts. */
type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
const penAt = (ctx: Ctx, s: Point): Pen => {
  const x0 = Math.round(s.x), y0 = Math.round(s.y);
  return (x, y, w, h, c) => rect(ctx, x0 + x, y0 + y, w, h, c);
};

/** A 1px ring of `n` dots round (cx, cy), squashed vertically by `squash`. */
function ring(r: Pen, cx: number, cy: number, rad: number, n: number, c: string, squash = 1): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    r(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad * squash), 1, 1, c);
  }
}

/** The scenery's bubble, drawn with a Pen. */
function bubbleAt(r: Pen, x: number, y: number, size: 1 | 2): void {
  if (size === 1) { r(x, y, 1, 1, SEA.bubble); return; }
  r(x - 1, y, 1, 1, SEA.bubble); r(x + 1, y, 1, 1, SEA.bubble); r(x, y + 1, 1, 1, SEA.bubble);
  r(x, y - 1, 1, 1, SEA.bubbleL);
}

// The slate held up over the diver's head: 12x9 of writing surface at (-6, -38).
const SLATE = { x: -6, y: -38, w: 12, h: 9 } as const;

/** Writing on a slate: pencil lines appear row by row, the pencil (on its cord) moving along the newest one. */
function edit(r: Pen, frame: number): void {
  const S = SEA.slate;
  r(SLATE.x - 2, SLATE.y - 2, SLATE.w + 4, SLATE.h + 4, SEA.ink);
  r(SLATE.x - 1, SLATE.y - 1, SLATE.w + 2, SLATE.h + 2, S.rim);
  r(SLATE.x - 1, SLATE.y + SLATE.h, SLATE.w + 2, 1, S.rimD);
  r(SLATE.x, SLATE.y, SLATE.w, SLATE.h, S.c);
  r(SLATE.x + SLATE.w - 2, SLATE.y - 1, 1, 1, S.c);                                 // the cord's eyelet
  const page = Math.floor(frame / 20), p = frame % 20;
  const row = Math.min(3, Math.floor(p / 5)), col = p % 5;
  let pen = { x: SLATE.x + 1, y: SLATE.y + 1 };
  for (let i = 0; i <= row; i++) {
    const words = 2 + Math.floor(hash2(page, i) * 2);
    let x = SLATE.x + 1;
    for (let w = 0; w < words; w++) {
      const len = 2 + Math.floor(hash2(i + w, page + 3) * 2);
      const shown = i < row ? len : Math.max(0, Math.min(len, col * 2 - (x - SLATE.x - 1)));
      if (shown > 0) r(x, SLATE.y + 1 + i * 2, shown, 1, S.lead);
      if (i === row && shown > 0) pen = { x: x + shown, y: SLATE.y + 1 + i * 2 };
      x += len + 1;
      if (x > SLATE.x + SLATE.w - 2) break;
    }
  }
  // the pencil, writing: tip at the end of the newest line, body slanting up and right, its cord looping to the eyelet
  const jot = frame % 2;
  const tx = pen.x, ty = pen.y - jot;
  for (let i = 0; i < 6; i++) r(tx + 1 + Math.floor(i / 2), ty - 6 + i, 1, 1, S.cord);
  r(tx + 1, ty - 5, 3, 5, SEA.ink);
  r(tx + 2, ty - 4, 1, 3, S.pencil);
  r(tx + 1, ty - 1, 1, 1, S.lead);
  r(tx, ty, 1, 1, S.lead);
}

/** A valve wheel above the head, turning on its manifold; bubbles stream from the pipe as it opens. */
function shell(r: Pen, frame: number): void {
  const V = SEA.valve;
  const cx = 0, cy = -37, py = -30;
  // the manifold: a pipe across with flanged ends and the valve body in the middle
  r(-11, py - 2, 23, 5, SEA.ink);
  r(-10, py - 1, 21, 3, V.pipe); r(-10, py - 1, 21, 1, V.pipeL); r(-10, py + 1, 21, 1, V.pipeD);
  for (const fx of [-11, 10]) { r(fx, py - 3, 2, 7, SEA.ink); r(fx, py - 2, 1, 5, V.pipeL); }
  r(-2, py - 5, 5, 4, SEA.ink); r(-1, py - 4, 3, 3, V.pipe);                        // the stem up to the wheel
  // the wheel: an outlined rim, four spokes turning, a brass hub
  for (const [rad, c] of [[6, SEA.ink], [5, V.wheel]] as const) ring(r, cx, cy, rad, 40, c);
  ring(r, cx, cy, 4, 24, SEA.ink);
  ring(r, cx, cy, 5, 12, V.wheelL);
  const a0 = frame * 0.42;
  for (let s = 0; s < 4; s++) {
    const a = a0 + (s * Math.PI) / 2;
    for (let d = 1; d <= 4; d++) r(cx + Math.round(Math.cos(a) * d), cy + Math.round(Math.sin(a) * d), 1, 1, d === 4 ? V.wheelL : V.wheel);
  }
  r(cx - 1, cy - 1, 3, 3, SEA.ink); r(cx, cy, 1, 1, V.hub);
  // bubbles rush out of the right-hand end once it's open
  const open = Math.min(1, frame / 6);
  for (let i = 0; i < 6; i++) {
    const k = (frame * 1.4 + i * 3) % 14;
    if (k > 4 + open * 10) continue;
    const x = 12 + Math.round(k * 0.7), y = py - Math.round(k * 0.9) + Math.round(Math.sin(k + i));
    bubbleAt(r, x, y, i % 2 === 0 ? 2 : 1);
  }
}

/** A dive torch sweeping its bright beam across the reef above, the lit patch showing what it reads. */
function read(ctx: Ctx, r: Pen, frame: number): void {
  const hx = 5, hy = -12;
  const a = -Math.PI / 2 + Math.sin(frame * 0.4) * 1.1;                               // radians: 0 points right, -pi/2 up
  const ux = Math.cos(a), uy = Math.sin(a);
  for (let i = 3; i < 22; i++) {
    const half = Math.round(i * 0.3);
    ctx.globalAlpha = 0.75 * (1 - i / 28);
    for (let j = -half; j <= half; j++) r(Math.round(hx + ux * i - uy * j), Math.round(hy + uy * i + ux * j), 1, 1, j === 0 ? "#ffffff" : SEA.gear.beam);
  }
  const px = Math.round(hx + ux * 23), py = Math.round(hy + uy * 23);
  ctx.globalAlpha = 0.55;
  r(px - 4, py - 2, 9, 5, SEA.gear.beam); r(px - 3, py - 3, 7, 7, SEA.gear.beam);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) r(px - 2, py - 1 + i * 2 - 1, 2 + Math.floor(hash2(frame >> 1, i) * 4), 1, SEA.slate.lead);
  // the torch itself, in the hand
  r(hx - 1, hy - 1, 3, 4, SEA.ink); r(hx, hy, 1, 2, SEA.gear.torch);
  r(hx + Math.round(ux), hy + Math.round(uy), 1, 1, "#ffffff");
}

/** A sonar puck over the head sends rings out that widen and fade; an echo blinks where one has bounced. */
function web(ctx: Ctx, r: Pen, frame: number): void {
  const S = SEA.sonar;
  const cx = 0, cy = -35;
  for (let n = 0; n < 3; n++) {
    const k = (frame + n * 4) % 12;
    if (k < 1) continue;
    const rad = 2 + k * 1.6;
    ctx.globalAlpha = Math.max(0.45, 1 - k / 16);
    ring((x, y, w, h, c) => r(x, y + 1, w, h, c), cx, cy, rad, 10 + k * 4, SEA.ink, 0.75);    // a dark edge so rings read on the sub
    ring(r, cx, cy, rad, 10 + k * 4, k < 4 ? "#ffffff" : S.ring, 0.75);
  }
  ctx.globalAlpha = 1;
  const ex = 13, ey = -42;                                                             // something out there answers
  if ((frame % 12) >= 7) {
    r(ex - 1, ey - 1, 3, 3, SEA.ink); r(ex, ey, 1, 1, S.echo);
    if (frame % 2 === 0) ring(r, ex, ey, 3, 8, S.echo);
  }
  r(cx - 3, cy - 2, 7, 5, SEA.ink);
  r(cx - 2, cy - 1, 5, 3, S.puck);
  r(cx, cy - 1, 1, 1, frame % 4 < 2 ? S.lamp : "#ffffff");
}

// A gloved fist with the index finger out (pointing right before flipping); "o" glove, "s" its shade.
const HAND = [".oo......", "ooooooooo", "ooossssss", "ooooo....", "sssss...."];

/** A signal to the fish: a big bubble over the head holds a pointing glove; little bubbles trail across to the fish. */
function delegate(ctx: Ctx, spot: Point, frame: number): void {
  const G = SEA.signal;
  const to = sidekickSlots(spot, 1).points[0] ?? { x: spot.x + 11, y: spot.y };
  const dir = to.x >= spot.x ? 1 : -1;
  const cx = Math.round(spot.x) + dir * 3, cy = Math.round(spot.y) - 37;
  ellipse(ctx, cx, cy, 9, 7, SEA.ink);
  ellipse(ctx, cx, cy, 8, 6, SEA.bubble);
  rect(ctx, cx - dir * 4, cy - 4, 2, 1, "#ffffff");                                     // the bubble's glint
  // the glove: a fist with the index finger out toward the fish, jabbing on the beat
  const jab = frame % 4 < 2 ? 0 : 1;
  const gx = cx - dir * 3 + dir * jab, gy = cy - 1;
  const hand = new PixelGrid(11, 7, 1, 1);
  HAND.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== ".") hand.set(dir > 0 ? x : 8 - x, y, row[x] === "o" ? G.glove : G.gloveS); });
  hand.outline(SEA.ink);
  hand.blit(ctx, dir > 0 ? gx - 1 : gx - 7, gy - 2);
  const goal = { x: Math.round(to.x), y: Math.round(to.y) - 14 };
  const sx = cx + dir * 8, sy = cy;
  for (let n = 0; n < 3; n++) {
    const k = ((frame + n * 3) % 9) / 9;
    const x = Math.round(sx + (goal.x - sx) * k), y = Math.round(sy + (goal.y - sy) * k - Math.sin(k * Math.PI) * 4);
    bubble(ctx, x, y, n === 0 ? 2 : 1);
  }
  if (frame % 9 >= 6) {
    ctx.globalAlpha = 0.7;
    ring((x, y, w, h, c) => rect(ctx, goal.x + x, goal.y + y, w, h, c), 0, 0, 6, 10, G.trail, 0.7);
    ctx.globalAlpha = 1;
  }
}

/** Anything else: the diver blows bubble rings that rise and widen over the head. */
function other(r: Pen, frame: number): void {
  for (let n = 0; n < 2; n++) {
    const k = (frame + n * 5) % 10;
    const rx = 2 + k * 0.35, y = -28 - k * 1.4;
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([Math.round(Math.cos(a) * rx * 1.6), Math.round(y + Math.sin(a) * rx * 0.6)]);
    }
    for (const [x, yy] of pts) r(x - 1, yy - 1, 3, 3, SEA.ink);
    for (const [x, yy] of pts) r(x, yy, 1, 1, yy < y ? "#ffffff" : SEA.bubble);
  }
}

/** A failed tool: a burst of murky bubbles boils out round the head, and a cloud of silt spreads behind them. */
function failed(ctx: Ctx, r: Pen, frame: number): void {
  const M = SEA.murk;
  const k = (frame % 10) / 10;
  ctx.globalAlpha = 0.5 * (1 - k * 0.6);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.7;
    const d = 3 + k * 8;
    r(Math.round(Math.cos(a) * d) - 4, -22 + Math.round(Math.sin(a) * d * 0.8) - 3, 8, 6, M.silt);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 12; i++) {
    const u = ((frame + i * 1.7) % 10) / 10;
    const a = -Math.PI / 2 + (hash2(i, 7) - 0.5) * 2.6;
    const d = 4 + u * 16;
    const x = Math.round(Math.cos(a) * d * 1.1), y = -20 + Math.round(Math.sin(a) * d - u * 6);
    const big = i % 3 === 0;
    if (big) {
      r(x - 1, y - 3, 3, 7, SEA.ink); r(x - 3, y - 1, 7, 3, SEA.ink); r(x - 2, y - 2, 5, 5, SEA.ink);
      r(x - 1, y - 2, 3, 5, M.c); r(x - 2, y - 1, 5, 3, M.c); r(x - 1, y - 1, 1, 1, M.l); r(x + 1, y + 1, 1, 1, M.d);
    } else {
      r(x, y - 2, 1, 5, SEA.ink); r(x - 2, y, 5, 1, SEA.ink); r(x - 1, y - 1, 3, 3, SEA.ink);
      r(x - 1, y, 3, 1, M.c); r(x, y - 1, 1, 3, M.c); r(x, y - 1, 1, 1, M.l);
    }
  }
}

/** The underwater look for a tool at a spot (a diver's site or a fish's slot); a failure boils up murky bubbles instead. */
export function drawAction(ctx: Ctx, spot: Point, kind: ToolKind, isFailed: boolean, frame: number): void {
  const r = penAt(ctx, spot);
  const f = Math.max(0, Math.floor(frame));
  if (isFailed) return failed(ctx, r, f);
  switch (kind) {
    case "edit": return edit(r, f);
    case "shell": return shell(r, f);
    case "read": return read(ctx, r, f);
    case "web": return web(ctx, r, f);
    case "delegate": return delegate(ctx, spot, f);
    case "other": return other(r, f);
  }
}

/** A pilot fish: silver-blue with dark bands, nosing about at head height; busy, it darts to and fro trailing bubbles. */
export function drawSidekick(ctx: Ctx, at: Point, frame: number, busy: boolean, t: number): void {
  const P = SEA.pilot;
  const x0 = Math.round(at.x), floor = Math.round(at.y);
  const lane = Math.round(at.x) % 2 === 0 ? 0 : 5;                                    // neighbours swim at staggered heights
  let dx: number, facing: 1 | -1;
  if (busy) {
    const leg = Math.floor(frame / 2) % 2;
    dx = leg === 0 ? 2 : -2; facing = leg === 0 ? 1 : -1;
  } else {
    const ph = t * 0.9 + at.x * 0.37;
    dx = Math.round(Math.sin(ph) * 2); facing = Math.cos(ph) >= 0 ? 1 : -1;
  }
  const bob = Math.round(Math.sin(t * 2.1 + at.x) * (busy ? 0.5 : 1));
  const y = floor - 16 - lane + bob;
  const g = new PixelGrid(12, 8, 1, 1);
  const set = (x: number, yy: number, c: string): void => g.set(facing > 0 ? x : 9 - x, yy, c);
  const wag = (busy ? frame : Math.floor(t * 4 + at.x)) % 2;
  // nose to the right before flipping: the forked tail at x 0..1, the body 2..9
  for (let x = 3; x <= 7; x++) { set(x, 1, P.s); set(x, 4, P.belly); }
  for (let x = 2; x <= 9; x++) { set(x, 2, P.c); set(x, 3, P.c); }
  set(5, 0, P.s);                                                                       // the dorsal fin
  for (const bx of [4, 6]) for (let yy = 1; yy <= 4; yy++) set(bx, yy, P.band);         // a pilot fish's dark bands
  set(1, 2, P.fin); set(1, 3, P.fin);
  set(0, 1 + wag, P.fin); set(0, 4 - wag, P.fin);                                       // the tail, flicking
  set(8, 2, busy ? P.busy : P.eye);
  g.outline(SEA.ink);
  g.blit(ctx, x0 - 5 + dx, y - 2);
  if (busy) {                                                                            // a wake of bubbles behind
    for (let i = 0; i < 3; i++) bubble(ctx, x0 + dx - facing * (7 + i * 3), y + 1 - (i + frame) % 3, i === 0 ? 2 : 1);
  }
  if (frame < 3) {                                                                       // arriving in a puff of bubbles
    ctx.globalAlpha = 0.9 - frame * 0.25;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rad = 4 + frame * 2;
      bubble(ctx, Math.round(x0 + Math.cos(a) * rad), Math.round(y + 1 + Math.sin(a) * rad * 0.8), i % 2 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }
}

/** The tank the gauge is on: a 9x22 grid at (-21, -23) from the spot, standing on the ledge left of the diver. */
const TANK = { x: -21, y: -23 } as const;
const DIAL = { x: 4, y: 9 } as const;                                                    // the dial's centre in the grid

function tank(): PixelGrid {
  const A = SEA.air;
  const g = new PixelGrid(9, 22, 1, 1);
  g.fill(3, 0, 5, 0, A.valve); g.fill(4, 1, 4, 2, A.valve); g.fill(2, 1, 2, 1, A.valve);   // valve and knob
  g.fill(2, 3, 6, 3, A.tank);
  g.fill(1, 4, 7, 21, A.tank);
  g.fill(7, 4, 7, 21, A.tankS); g.fill(1, 21, 7, 21, A.tankS);
  g.fill(2, 5, 2, 19, A.tankL);
  g.fill(1, 16, 7, 16, A.tankS);                                                         // a band
  return g;
}

/**
 * An air gauge on the tank: a round dial whose coloured arc runs from red (empty) round to green (full), one segment
 * for each quarter of context left, the needle at its end; hot, the dial's rim and the last segment blink red.
 */
export function drawContextGauge(ctx: Ctx, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void {
  const A = SEA.air;
  const alarm = hot && Math.floor(t / 0.6) % 2 === 0;
  const left = 4 - step;                                                                 // segments still lit
  const g = tank();
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > 4.6) continue;
    let c: string;
    if (d > 3.5) c = alarm ? A.hot : A.rim;
    else if (d < 1.5) c = A.face;
    else {
      const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
      const s = (((225 - deg) % 360) + 360) % 360;                                         // 0 at bottom-left, clockwise to 270
      if (s > 270) c = A.face;
      else {
        const seg = Math.min(3, Math.floor(s / 67.5));
        c = seg < left ? (hot && seg === left - 1 && alarm ? "#ffffff" : A.segs[seg]!) : A.off;
      }
    }
    g.set(DIAL.x + dx, DIAL.y + dy, c);
  }
  const deg = 225 - (left - 0.5) * 67.5;                                                 // the needle points into the last lit segment
  const ux = Math.cos((deg * Math.PI) / 180), uy = -Math.sin((deg * Math.PI) / 180);
  for (let d = 0; d <= 3; d++) g.set(DIAL.x + Math.round(ux * d), DIAL.y + Math.round(uy * d), A.needle);
  g.outline(alarm ? A.hot : SEA.ink);
  g.blit(ctx, Math.round(spot.x) + TANK.x, Math.round(spot.y) + TANK.y);
}

/** The compaction moment: the valve blasts out a burst of bubbles that billow up and away, then a fresh glint on the dial. */
export function drawCompaction(ctx: Ctx, spot: Point, frame: number): void {
  const life = (COMPACTION_MS / 1000) * CONFIG.client.animFps;
  const k = Math.min(1, Math.max(0, frame / life));
  const vx = Math.round(spot.x) + TANK.x + 5, vy = Math.round(spot.y) + TANK.y;           // the valve
  const fade = k > 0.75 ? (1 - k) / 0.25 : 1;
  if (k < 0.3) {                                                                          // the first gush
    ctx.globalAlpha = 0.6 * (1 - k / 0.3);
    ellipse(ctx, vx, vy - 3, 3 + k * 12, 2 + k * 8, SEA.bubbleL);
  }
  for (let i = 0; i < 26; i++) {
    const u = k * 1.4 - hash2(i, 3) * 0.4;
    if (u <= 0 || u >= 1) continue;
    const a = -Math.PI / 2 + (hash2(7, i) - 0.5) * 2.2;
    const d = 3 + u * (14 + hash2(i, 11) * 12);
    const x = Math.round(vx + Math.cos(a) * d * 1.2 + Math.sin(u * 9 + i) * 1.5), y = Math.round(vy + Math.sin(a) * d - u * 10);
    ctx.globalAlpha = 0.95 * fade;
    if (i % 4 === 0) {                                                                    // big ones, ringed so they read on pale water
      ellipse(ctx, x, y, 3, 3, SEA.ink); ellipse(ctx, x, y, 2, 2, SEA.bubble); rect(ctx, x - 1, y - 1, 1, 1, SEA.bubbleL);
    } else bubble(ctx, x, y, i % 2 === 0 ? 2 : 1);
  }
  if (k > 0.5 && k < 0.85) {                                                              // the dial reads full again
    ctx.globalAlpha = fade;
    const cx = Math.round(spot.x) + TANK.x + DIAL.x, cy = Math.round(spot.y) + TANK.y + DIAL.y;
    rect(ctx, cx, cy - 6, 1, 13, "#ffffff"); rect(ctx, cx - 6, cy, 13, 1, "#ffffff");
  }
  ctx.globalAlpha = 1;
}

/** Where idle divers meet: either side of the coral head in the open water. */
export const socialSpots: Point[] = [
  { x: CORAL_HEAD.x - 15, y: CORAL_HEAD.y - 16 },
  { x: CORAL_HEAD.x + 15, y: CORAL_HEAD.y - 16 },
];
