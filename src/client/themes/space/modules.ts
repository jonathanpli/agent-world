import { CONFIG } from "../../../shared/config";
import type { CharState, Tier } from "../../../shared/types";
import { hash2, rect } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { SPACE } from "./palette";

type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
const penAt = (ctx: Ctx, s: Point): Pen => (x, y, w, h, c) => rect(ctx, s.x + x, s.y + y, w, h, c);
const C = SPACE.console;

/** Console size per tier: half width, top row. Every console ends at y -18 relative to the spot. */
const SIZE: Record<Tier, { hw: number; top: number }> = { 1: { hw: 8, top: -40 }, 2: { hw: 12, top: -42 }, 3: { hw: 15, top: -44 }, 4: { hw: 18, top: -45 } };
const BOTTOM = -18;

function screen(r: Pen, x: number, y: number, w: number, h: number, state: CharState | null, t: number, seed: number): void {
  r(x - 1, y - 1, w + 2, h + 2, SPACE.ink);
  switch (state) {
    case "working": {
      r(x, y, w, h, C.screen);
      const tick = Math.floor(t * 4);
      for (let row = 0; row * 2 < h - 1; row++) {
        const len = 1 + Math.floor(hash2(seed + tick, row) * (w - 2));
        r(x + 1, y + 1 + row * 2, len, 1, C.data[(row + seed) % C.data.length]!);
      }
      break;
    }
    case "needs_input": {
      const on = Math.floor(t * 3) % 2 === 0;
      r(x, y, w, h, on ? C.alert : C.alertBg);
      const cx = x + Math.floor(w / 2);
      if (h >= 5) { r(cx, y + 1, 1, h - 4, on ? "#ffffff" : C.alert); r(cx, y + h - 2, 1, 1, on ? "#ffffff" : C.alert); }
      break;
    }
    case "done": {
      r(x, y, w, h, C.okBg);
      const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2);
      for (const [dx, dy] of [[-2, 0], [-1, 1], [0, 2], [1, 1], [2, 0], [3, -1]] as const) r(cx + dx - 1, cy + dy - 1, 1, 1, C.ok);
      break;
    }
    case "idle": {
      r(x, y, w, h, C.screen);
      const px = Math.floor(Math.abs(((t * 3 + seed) % (2 * (w - 1))) - (w - 1)));
      r(x + px, y + Math.floor(h / 2) + Math.round(Math.sin(t + seed)), 1, 1, C.idle);
      break;
    }
    default:
      r(x, y, w, h, C.off);
      r(x + w - 2, y + 1, 1, 1, C.glare);
  }
}

function beacon(ctx: Ctx, r: Pen, s: Point, x: number, y: number, on: boolean, t: number): void {
  const B = SPACE.beacon;
  r(x - 2, y + 2, 5, 1, C.bodyD);
  if (!on) { r(x - 1, y, 3, 2, B.off); return; }
  const flash = Math.floor(t * 4) % 2 === 0;
  r(x - 1, y - 1, 3, 3, flash ? B.on : B.off);
  r(x, y - 1, 1, 1, flash ? B.hot : B.on);
  if (!flash) return;
  ctx.globalAlpha = 0.25;
  r(x - 4, y - 3, 9, 7, B.glow);
  ctx.globalAlpha = 0.5;
  const sweep = Math.floor(t * 8) % 4;               // a rotating beam
  const dirs: [number, number][] = [[-1, 0], [-1, -1], [1, -1], [1, 0]];
  const [dx, dy] = dirs[sweep]!;
  for (let i = 2; i < 8; i++) rect(ctx, s.x + x + dx * i, s.y + y + dy * Math.floor(i / 2), 1, 1, B.glow);
  ctx.globalAlpha = 1;
}

/** The junction box at hand height, right of the console: cover shut, or swung open with wires and sparks while working. */
function junction(ctx: Ctx, r: Pen, s: Point, state: CharState | null, t: number): void {
  r(6, -25, 9, 10, SPACE.ink);
  r(7, -24, 7, 8, C.body);
  if (state !== "working") { r(8, -23, 5, 6, C.bodyL); r(12, -21, 1, 2, SPACE.hull.rivet); return; }
  r(8, -23, 5, 6, C.bodyD);
  C.wire.forEach((c, i) => r(8 + i * 2, -23 + (i % 2), 1, 5, c));
  r(15, -24, 2, 8, C.bodyL);                               // the cover, hanging open
  const n = Math.floor(t * CONFIG.client.space.sparkHz);
  for (let i = 0; i < 5; i++) {
    if (hash2(n, i) < 0.35) continue;
    const a = hash2(i, n + 3) * Math.PI * 2, d = 1 + Math.floor(hash2(n + 7, i) * 4);
    rect(ctx, s.x + 10 + Math.round(Math.cos(a) * d), s.y - 19 + Math.round(Math.sin(a) * d), 1, 1, SPACE.spark[(i + n) % SPACE.spark.length]!);
  }
  if (n % 3 === 0) { ctx.globalAlpha = 0.35; r(7, -23, 7, 7, "#ffffff"); ctx.globalAlpha = 1; }
}

function rackLeds(r: Pen, x: number, top: number, t: number, seed: number): void {
  for (let i = 0; i < 4; i++) {
    const on = hash2(seed + i, Math.floor(t * 3)) > 0.4;
    r(x, top + 4 + i * 4, 2, 2, on ? [SPACE.led.g, SPACE.led.b, SPACE.led.y][i % 3]! : C.bodyD);
  }
}

/** A wall console sized to the occupant's tier, its screens showing the state; an empty spot is a dark junior console. */
export function drawWorkSpot(ctx: Ctx, s: Point, tier: Tier | null, state: CharState | null, t: number): void {
  const r = penAt(ctx, s);
  const k: Tier = tier ?? 1;
  const { hw, top } = SIZE[k];
  const seed = Math.floor(s.x * 7 + s.y * 13);
  const gold = k === 4;
  // the console body
  r(-hw - 1, top - 1, hw * 2 + 2, BOTTOM - top + 2, SPACE.ink);
  r(-hw, top, hw * 2, BOTTOM - top, C.body);
  r(-hw, top, hw * 2, 1, gold ? SPACE.suit.gold : C.bodyL);
  r(-hw, BOTTOM - 3, hw * 2, 3, C.bodyD);
  for (let x = -hw; x < hw; x += 4) r(x, BOTTOM - 3, 2, 3, SPACE.hazard.y);    // hazard stripe along the foot
  switch (k) {
    case 1:
      screen(r, -6, top + 3, 12, 8, state, t, seed);
      for (const x of [-5, -2, 1, 4]) r(x, top + 14, 2, 2, x === 1 && state !== null ? SPACE.led.g : C.bodyL);
      break;
    case 2:
      screen(r, -10, top + 3, 9, 8, state, t, seed);
      screen(r, 1, top + 3, 9, 8, state, t, seed + 1);
      r(-10, top + 14, 20, 3, C.bodyD);
      // tool rack: an open-jawed wrench and a screwdriver
      r(-10, top + 15, 1, 2, SPACE.hull.l); r(-8, top + 15, 1, 2, SPACE.hull.l); r(-10, top + 17, 3, 1, SPACE.hull.l); r(-9, top + 18, 1, 3, SPACE.hull.l);
      r(-5, top + 15, 1, 3, SPACE.hazard.y); r(-5, top + 18, 1, 3, SPACE.hull.l);
      r(5, top + 15, 3, 3, SPACE.suit.stripe);
      break;
    case 3:
      screen(r, -13, top + 4, 7, 7, state, t, seed + 2);
      screen(r, -5, top + 2, 10, 10, state, t, seed);
      screen(r, 6, top + 4, 7, 7, state, t, seed + 3);
      r(-13, top + 15, 26, 6, C.bodyD);
      rackLeds(r, -11, top + 13, t, seed);
      rackLeds(r, 9, top + 13, t, seed + 5);
      for (let x = -6; x <= 4; x += 2) r(x, top + 17, 1, 1, C.bodyL);
      break;
    case 4: {
      // a 2x2 screen wall, a holo table between and gold trim
      screen(r, -16, top + 3, 9, 7, state, t, seed + 1);
      screen(r, -16, top + 12, 9, 7, state, t, seed + 2);
      screen(r, 7, top + 3, 9, 7, state, t, seed + 3);
      screen(r, 7, top + 12, 9, 7, state, t, seed + 4);
      r(-5, top + 3, 10, 16, C.bodyD);
      const on = state !== null && state !== "off_duty";
      if (on) {
        const a = t * 1.5;
        for (let dy = -4; dy <= 4; dy++) {
          const half = Math.round(Math.sqrt(16 - Math.min(16, dy * dy)) * 0.9);
          for (let dx = -half; dx <= half; dx++) {
            const lit = Math.sin(dx * 0.9 + a) + Math.cos(dy * 1.2) > 0.6;
            if (lit || Math.abs(dx) === half) rect(ctx, s.x + dx, s.y + top + 9 + dy, 1, 1, lit ? C.holo : C.holoD);
          }
        }
      }
      r(-4, top + 15, 8, 2, SPACE.suit.gold);
      r(-hw, BOTTOM - 4, hw * 2, 1, SPACE.suit.gold);
      break;
    }
  }
  beacon(ctx, r, s, hw - 4, top - 2, state === "needs_input", t);
  junction(ctx, r, s, state, t);
  // foot loops on the grating
  r(-5, -2, 3, 1, SPACE.grateL); r(2, -2, 3, 1, SPACE.grateL);
  if (state === "needs_input" && Math.floor(t * 4) % 2 === 0) {
    ctx.globalAlpha = 0.12;
    r(-hw - 3, top - 3, hw * 2 + 6, BOTTOM - top + 6, SPACE.beacon.on);
    ctx.globalAlpha = 1;
  }
}
