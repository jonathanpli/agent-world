import { CONFIG } from "../../../shared/config";
import type { ToolKind } from "../../../shared/types";
import { COMPACTION_MS, sidekickSlots } from "../../engine/actions";
import { ellipse, hash2, PixelGrid, rect } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { SPACE } from "./palette";
import { LOUNGE } from "./scenery";

/** Draws relative to the (rounded) spot: (x, y) offsets from the spot, as in modules.ts. */
type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
const penAt = (ctx: Ctx, s: Point): Pen => {
  const x0 = Math.round(s.x), y0 = Math.round(s.y);
  return (x, y, w, h, c) => rect(ctx, x0 + x, y0 + y, w, h, c);
};
const C = SPACE.console;

// A screen laid over the console's centre: 12x8 at (-6, -37), exactly a cadet console's screen, above the helmet.
const SCR = { x: -6, y: -37, w: 12, h: 8 } as const;

function screenOver(r: Pen, bg: string, frame: string = C.bodyL): Pen {
  r(SCR.x - 2, SCR.y - 2, SCR.w + 4, SCR.h + 4, SPACE.ink);
  r(SCR.x - 1, SCR.y - 1, SCR.w + 2, SCR.h + 2, frame);
  r(SCR.x, SCR.y, SCR.w, SCR.h, bg);
  return (x, y, w, h, c) => r(SCR.x + x, SCR.y + y, w, h, c);
}

/** A holo-panel: the screen glows cyan and lines of glyphs scroll up it, the newest one still being written. */
function edit(ctx: Ctx, r: Pen, frame: number): void {
  const H = SPACE.holo;
  ctx.globalAlpha = 0.3 + 0.1 * (frame % 2);
  r(SCR.x - 4, SCR.y - 4, SCR.w + 8, SCR.h + 8, H.glow);
  ctx.globalAlpha = 1;
  const s = screenOver(r, H.bg, H.glow);
  for (let row = 0; row < 4; row++) {
    const line = frame + row;                               // the bottom row is the newest line
    const newest = row === 3;
    for (let col = 0; col < 5; col++) {
      if (hash2(line, col) < 0.3) continue;
      if (newest && col > frame % 6) break;
      const w = hash2(col, line + 9) > 0.5 ? 2 : 1;
      s(1 + col * 2, 1 + row * 2, w, 1, newest ? H.glyphL : H.glyph);
    }
  }
}

/** The console lights chase round the screen frame while prompts scroll and a cursor blinks. */
function shell(r: Pen, frame: number): void {
  const T = SPACE.radar;
  const s = screenOver(r, T.bg, C.bodyD);
  // the frame ring, walked clockwise from the top-left corner
  const ring: [number, number][] = [];
  const x0 = SCR.x - 1, y0 = SCR.y - 1, w = SCR.w + 2, h = SCR.h + 2;
  for (let i = 0; i < w; i++) ring.push([x0 + i, y0]);
  for (let i = 1; i < h; i++) ring.push([x0 + w - 1, y0 + i]);
  for (let i = w - 2; i >= 0; i--) ring.push([x0 + i, y0 + h - 1]);
  for (let i = h - 2; i > 0; i--) ring.push([x0, y0 + i]);
  ring.forEach(([x, y], i) => {
    const k = (i - frame * 3 + ring.length * 8) % 6;
    if (k < 2) r(x, y, 1, 1, k === 0 ? SPACE.led.y : SPACE.led.g);
  });
  for (let row = 0; row < 3; row++) {
    s(1, 1 + row * 2, 1, 1, T.sweep);
    if (row < 2) s(3, 1 + row * 2, 2 + Math.floor(hash2(frame + row, 5) * 6), 1, T.ring);
  }
  if (frame % 4 < 2) s(3, 5, 2, 2, T.sweep);
}

/** A scanning beam sweeps down the panel and back, brightening what it has passed; it spills past the frame. */
function read(ctx: Ctx, r: Pen, frame: number): void {
  const H = SPACE.holo;
  const s = screenOver(r, C.screen);
  const period = (SCR.h - 1) * 2;
  const p = frame % period, by = p < SCR.h ? p : period - p;
  const down = p < SCR.h;
  for (let row = 0; row < SCR.h; row += 2) {
    const len = 3 + Math.floor(hash2(row, 4) * 7);
    const scanned = down ? row < by : row > by;
    s(1, row, len, 1, scanned ? H.glyphL : C.glare);
  }
  ctx.globalAlpha = 0.45;
  s(-4, by - 1, SCR.w + 8, 3, H.glow);
  ctx.globalAlpha = 1;
  s(-3, by, SCR.w + 6, 1, H.beam);
}

/** A dish on a mast above the console swings to and fro and pings; the screen shows the radar sweep. */
function web(ctx: Ctx, r: Pen, frame: number): void {
  const R = SPACE.radar, D = SPACE.dish;
  const s = screenOver(r, R.bg);
  const cx = 6, cy = 4;
  for (let d = 1; d <= 3; d++) { s(cx + d, cy, 1, 1, R.ring); s(cx - d - 1, cy, 1, 1, R.ring); }
  const a = frame * 0.7;
  for (let d = 1; d <= 3; d++) s(cx + Math.round(Math.cos(a) * d) - 1, cy + Math.round(Math.sin(a) * d * 0.9), 1, 1, R.sweep);
  if (frame % 6 < 3) s(cx + 2, cy - 2, 1, 1, R.blip);
  // the mast and the swinging dish
  const top = SCR.y - 2;
  r(-1, top - 4, 3, 4, SPACE.ink); r(0, top - 4, 1, 4, D.d);
  const swing = Math.sin(frame * 0.45) * 0.8;             // radians from straight up
  const ux = Math.sin(swing), uy = -Math.cos(swing);       // where the dish looks
  const px = -uy, py = ux;                                 // across the bowl
  const hx = 0.5, hy = top - 6;
  const at = (i: number, out: number): [number, number] => [Math.round(hx + px * i + ux * (out - i * i * 0.2)), Math.round(hy + py * i + uy * (out - i * i * 0.2))];
  const bowl: [number, number][] = [];
  for (let i = -4; i <= 4; i++) bowl.push(at(i, 0), at(i, -1));
  for (const [x, y] of bowl) r(x - 1, y - 1, 3, 3, SPACE.ink);
  for (let i = -4; i <= 4; i++) {
    const [ox, oy] = at(i, -1), [ix, iy] = at(i, 0);
    r(ox, oy, 1, 1, D.c); r(ix, iy, 1, 1, SPACE.hull.rivet);
  }
  const [fx, fy] = at(0, 3);
  r(fx - 1, fy - 1, 3, 3, SPACE.ink); r(fx, fy, 1, 1, frame % 2 === 0 ? "#ffffff" : SPACE.led.r);   // the feed horn
  // pings travel out from the dish along where it looks, widening as they go
  for (let n = 0; n < 2; n++) {
    const k = (frame + n * 4) % 8;
    if (k < 1) continue;
    const half = 2 + Math.floor(k / 2);
    ctx.globalAlpha = Math.max(0.25, 1 - k / 9);
    for (let i = -half; i <= half; i++) {
      const [x, y] = at(i * 0.9, 4 + k * 2 + i * i * 0.2 - Math.abs(i) * 0.5);
      r(x, y, 1, 1, Math.abs(i) <= 1 ? "#ffffff" : D.ping);
    }
  }
  ctx.globalAlpha = 1;
}

/** A whip antenna on the pack flashes, sending signal arcs across to the first drone slot. */
function delegate(ctx: Ctx, spot: Point, frame: number): void {
  const to = sidekickSlots(spot, 1).points[0] ?? { x: spot.x + 11, y: spot.y };
  const dir = to.x >= spot.x ? 1 : -1;
  const sx = Math.round(spot.x) - dir * 4, sy = Math.round(spot.y);
  const tip = { x: sx, y: sy - 36 };
  rect(ctx, sx - 1, sy - 36, 3, 12, SPACE.ink);
  rect(ctx, sx, sy - 35, 1, 10, SPACE.hull.l);
  const on = frame % 2 === 0;
  rect(ctx, tip.x - 1, tip.y - 2, 3, 3, SPACE.ink);
  rect(ctx, tip.x, tip.y - 1, 1, 1, on ? "#ffffff" : SPACE.led.r);
  if (on) { ctx.globalAlpha = 0.4; rect(ctx, tip.x - 2, tip.y - 3, 5, 5, SPACE.holo.glow); ctx.globalAlpha = 1; }
  const goal = { x: Math.round(to.x), y: Math.round(to.y) - 10 };
  for (let n = 0; n < 3; n++) {
    const k = ((frame + n * 3) % 9) / 9;
    const x = Math.round(tip.x + (goal.x - tip.x) * k), y = Math.round(tip.y + (goal.y - tip.y) * k - Math.sin(k * Math.PI) * 3);
    ctx.globalAlpha = 0.5 + 0.5 * (1 - k);
    rect(ctx, x - dir, y - 3, 1, 1, SPACE.holo.glow); rect(ctx, x, y - 2, 1, 1, SPACE.holo.glow);
    rect(ctx, x + dir, y - 1, 1, 3, "#ffffff");
    rect(ctx, x, y + 2, 1, 1, SPACE.holo.glow); rect(ctx, x - dir, y + 3, 1, 1, SPACE.holo.glow);
  }
  ctx.globalAlpha = 1;
  if (frame % 9 >= 6) {                                    // the drone lights up as a signal lands
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rect(ctx, goal.x + Math.round(Math.cos(a) * 6), goal.y + Math.round(Math.sin(a) * 5), 1, 1, "#ffffff");
    }
    ctx.globalAlpha = 1;
  }
}

/** Generic work: three status lights blinking in turn on the screen. */
function other(r: Pen, frame: number): void {
  const s = screenOver(r, C.screen);
  const lit = Math.floor(frame / 2) % 3;
  for (let i = 0; i < 3; i++) s(1 + i * 4, 3, 2, 2, i === lit ? C.data[i]! : C.glare);
}

/** A red console flash: the panel strobes red with a warning mark, a red wash pulses over it, and sparks fly. */
function failed(ctx: Ctx, r: Pen, frame: number): void {
  const on = frame % 4 < 2;
  if (on) { ctx.globalAlpha = 0.35; r(SCR.x - 5, SCR.y - 5, SCR.w + 10, SCR.h + 10, C.alert); ctx.globalAlpha = 1; }
  const s = screenOver(r, on ? C.alert : C.alertBg, on ? C.alert : C.bodyD);
  const mark = on ? "#ffffff" : C.alert;
  s(5, 1, 2, 4, mark); s(5, 6, 2, 1, mark);
  for (let i = 0; i < 6; i++) {
    const p = (frame + i * 2) % 6;
    const side = i % 2 === 0 ? -1 : 1;
    const ox = side < 0 ? SCR.x - 2 : SCR.x + SCR.w + 1, oy = SCR.y - 2;
    const vx = side * (1 + (i % 3) * 0.6);
    r(Math.round(ox + vx * p), Math.round(oy - 2 * p + 0.35 * p * p), 1, 1, SPACE.spark[i % SPACE.spark.length]!);
  }
}

/** The space station's look for a tool at a spot (an astronaut's console or a drone's slot); a failure flashes red instead. */
export function drawAction(ctx: Ctx, spot: Point, kind: ToolKind, isFailed: boolean, frame: number): void {
  const r = penAt(ctx, spot);
  const f = Math.max(0, Math.floor(frame));
  if (isFailed) return failed(ctx, r, f);
  switch (kind) {
    case "edit": return edit(ctx, r, f);
    case "shell": return shell(r, f);
    case "read": return read(ctx, r, f);
    case "web": return web(ctx, r, f);
    case "delegate": return delegate(ctx, spot, f);
    case "other": return other(r, f);
  }
}

/** A small hovering drone, steel with a cyan visor (the admiral's own is gold); busy, its eye sweeps and its jets burn. */
export function drawSidekick(ctx: Ctx, at: Point, frame: number, busy: boolean, t: number): void {
  const B = SPACE.bot;
  const x = Math.round(at.x), floor = Math.round(at.y);
  const bob = busy ? (frame % 2 === 0 ? 0 : -1) : Math.round(Math.sin(t * 2.4 + at.x * 0.37) * 1.5);
  const jiggle = busy ? ((frame >> 1) % 2 === 0 ? 0 : 1) : 0;
  const top = floor - 15 + bob;
  ctx.globalAlpha = 0.2;
  ellipse(ctx, x, floor - 1, 3, 1, SPACE.ink);
  ctx.globalAlpha = 1;
  // jets under the hull
  const flame = busy ? 3 : 1 + (frame % 2);
  for (const jx of [-2, 2]) for (let i = 0; i < flame; i++) rect(ctx, x + jx + jiggle, top + 9 + i, 1, 1, SPACE.suit.flame[Math.min(2, i)]!);
  const g = new PixelGrid(11, 11, 1, 1);
  g.set(4, 1, B.s);                                         // the antenna
  g.fill(2, 2, 6, 2, B.c);
  g.fill(1, 3, 7, 3, B.c);
  g.fill(0, 4, 8, 5, B.c);
  g.fill(1, 4, 7, 4, B.visor);
  g.fill(0, 6, 8, 6, B.s);
  g.fill(1, 7, 7, 7, B.d);
  g.set(2, 8, B.d); g.set(6, 8, B.d);                        // jet nozzles
  g.set(2, 3, "#ffffff");                                    // a glint on the dome
  const sweep = busy ? [1, 3, 5, 7, 5, 3][frame % 6]! : 3 + Math.round(Math.sin(t * 0.8 + at.x));
  const blink = !busy && Math.floor(t * 2 + at.x) % 9 === 0;
  if (!blink) { g.set(sweep, 4, busy ? B.busy : B.eye); g.set(sweep + 1, 4, busy ? B.busy : B.eye); }
  g.outline(SPACE.ink);
  const led = busy ? (frame % 2 === 0 ? B.busy : "#ffffff") : Math.floor(t * 1.5 + at.x) % 2 === 0 ? B.led : B.s;
  g.set(4, 0, led);
  g.blit(ctx, x - 4 + jiggle, top);
  if (frame < 3) {
    ctx.globalAlpha = 0.85 - frame * 0.25;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rad = 5 + frame * 2;
      rect(ctx, Math.round(x + Math.cos(a) * rad) - 1, Math.round(top + 4 + Math.sin(a) * rad * 0.8) - 1, 2, 2, B.puff);
    }
    ctx.globalAlpha = 1;
  }
}

/** The oxygen tank: an 8x20 grid at (-19, -21) from the spot, standing on the grating left of the console's foot. */
const TANK = { x: -19, y: -21 } as const;

function tank(full: boolean): PixelGrid {
  const T = SPACE.tank;
  const g = new PixelGrid(8, 20, 1, 1);
  g.fill(1, 0, 4, 0, T.valve);                              // the valve wheel
  g.fill(2, 1, 3, 1, T.valve);
  g.fill(1, 2, 4, 2, full ? T.body : T.spent);
  g.fill(0, 3, 5, 17, full ? T.body : T.spent);
  g.fill(5, 3, 5, 17, T.bodyS);
  g.fill(0, 4, 0, 16, full ? T.bodyL : T.bodyS);
  g.fill(0, 17, 5, 17, T.bodyS);
  return g;
}

/** An oxygen tank whose readout drains a bar for each quarter of context used; hot, it blinks red with a warning lamp. */
export function drawContextGauge(ctx: Ctx, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void {
  const T = SPACE.tank;
  const alarm = hot && Math.floor(t / 0.6) % 2 === 0;
  const g = tank(true);
  g.fill(1, 4, 4, 16, T.window);                            // the readout window
  const bars = 4 - step;                                    // what is left
  for (let i = 0; i < 4; i++) {
    const y = 14 - i * 3;
    const c = i < bars ? (hot ? (alarm ? T.hot : T.empty) : T.o2[bars - 1]!) : T.empty;
    g.fill(2, y, 3, y + 1, c);
  }
  if (hot) g.set(5, 1, alarm ? T.hot : T.valve);            // the warning lamp by the valve
  g.outline(alarm ? T.hot : SPACE.ink);
  g.blit(ctx, Math.round(spot.x) + TANK.x, Math.round(spot.y) + TANK.y);
}

/** The compaction moment: the spent tank floats away tumbling, the valve vents a puff, and the fresh one clicks in. */
export function drawCompaction(ctx: Ctx, spot: Point, frame: number): void {
  const T = SPACE.tank;
  const life = (COMPACTION_MS / 1000) * CONFIG.client.animFps;
  const k = Math.min(1, Math.max(0, frame / life));
  const x0 = Math.round(spot.x) + TANK.x, y0 = Math.round(spot.y) + TANK.y;
  const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
  if (k < 0.7) {                                            // the spent tank, drifting up and away, turning as it goes
    const u = k / 0.7;
    const g = tank(false);
    g.outline(SPACE.ink);
    const turn = Math.floor(frame / 3) % 4;
    const shown = turn === 1 ? g.turned(true) : turn === 3 ? g.turned(false) : g;
    ctx.globalAlpha = 1 - u * 0.6;
    shown.blit(ctx, x0 - Math.round(u * 16), y0 - 4 - Math.round(u * 18));
  }
  // the vent puff out of the valve: grey-edged clouds billowing up and out, so they read against a pale wall
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const u = k * 1.5 - i * 0.07;
    if (u <= 0 || u >= 1) continue;
    const a = -Math.PI / 2 + (i - 4) * 0.3;
    const d = 2 + u * 14;
    puffs.push([Math.round(x0 + 3 + Math.cos(a) * d), Math.round(y0 + Math.sin(a) * d * 0.8), u < 0.4 ? 4 : u < 0.75 ? 3 : 2]);
  }
  ctx.globalAlpha = 0.6 * fade;
  for (const [x, y, n] of puffs) rect(ctx, x - 1, y - 1, n + 2, n + 2, T.spent);
  ctx.globalAlpha = 0.95 * fade;
  for (const [x, y, n] of puffs) rect(ctx, x, y, n, n, T.vent);
  // the click: a glint on the fresh tank once the old one is clear
  if (k > 0.45 && k < 0.8) {
    ctx.globalAlpha = fade;
    const cx = x0 + 3, cy = y0 + 6;
    rect(ctx, cx, cy - 3, 1, 7, "#ffffff"); rect(ctx, cx - 3, cy, 7, 1, "#ffffff");
  }
  ctx.globalAlpha = 1;
}

/** Where idle astronauts meet: floating in front of the observation deck's viewport window. */
export const socialSpots: Point[] = [
  { x: LOUNGE.x + 21, y: LOUNGE.y + 90 },
  { x: LOUNGE.x + 47, y: LOUNGE.y + 90 },
];
