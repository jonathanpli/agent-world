import type { CharState, Tier } from "../../../shared/types";
import { ellipse, hash2, rect } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { bubble } from "./scenery";
import { SEA } from "./palette";

export type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
export const penAt = (ctx: Ctx, s: Point): Pen => (x, y, w, h, c) => rect(ctx, s.x + x, s.y + y, w, h, c);
type Coral = (typeof SEA.corals)[number];

/** A rounded boulder: dark rim, lit top, a few speckles. */
function boulder(ctx: Ctx, s: Point, x: number, y: number, rx: number, ry: number): void {
  ellipse(ctx, s.x + x, s.y + y, rx + 1, ry + 1, SEA.ink);
  ellipse(ctx, s.x + x, s.y + y, rx, ry, SEA.rock);
  ellipse(ctx, s.x + x - 1, s.y + y - Math.ceil(ry / 2), Math.max(1, rx - 2), Math.max(1, Math.floor(ry / 2)), SEA.rockL);
  rect(ctx, s.x + x - rx + 2, s.y + y + ry - 1, rx * 2 - 4, 1, SEA.rockD);
  for (let i = 0; i < rx; i += 3) rect(ctx, s.x + x - rx + 2 + i * 1.7, s.y + y + (i % 2), 1, 1, SEA.rockD);
}

function brain(ctx: Ctx, s: Point, x: number, y: number, rx: number, ry: number, c: Coral): void {
  ellipse(ctx, s.x + x, s.y + y, rx + 1, ry + 1, SEA.ink);
  ellipse(ctx, s.x + x, s.y + y, rx, ry, c.c);
  for (let i = -rx + 2; i < rx - 1; i += 3) rect(ctx, s.x + x + i, s.y + y - ry + 2 + (i % 2 === 0 ? 0 : 1), 1, ry * 2 - 3, c.d);
  rect(ctx, s.x + x - rx + 2, s.y + y - ry, rx, 1, c.l);
}

/** Staghorn coral: a few forking branches swaying a little. */
function staghorn(r: Pen, x: number, base: number, h: number, c: Coral, t: number): void {
  for (const [dx, hh, lean] of [[0, h, 0], [-4, h - 6, -1], [4, h - 4, 1], [-7, h - 12, -1], [7, h - 10, 1]] as const) {
    const sway = Math.round(Math.sin(t * 1.2 + dx) * 0.6);
    for (let y = 0; y < hh; y++) r(x + dx + Math.round((lean * y) / 6) + (y > hh / 2 ? sway : 0), base - y, 2, 1, y > hh - 2 ? c.l : c.c);
  }
}

function fan(r: Pen, x: number, base: number, t: number): void {
  const sway = Math.round(Math.sin(t * 0.8 + x) * 1);
  for (let y = 0; y < 14; y++) {
    const half = Math.round(Math.sin((y / 14) * Math.PI) * 6);
    for (let dx = -half; dx <= half; dx += 2) r(x + dx + (y > 7 ? sway : 0), base - y, 1, 1, (dx + y) % 4 === 0 ? SEA.fanL : SEA.fan);
  }
  r(x, base - 3, 1, 4, SEA.fan);
}

function anemone(r: Pen, x: number, base: number, t: number): void {
  for (let i = -4; i <= 4; i++) {
    const sway = Math.round(Math.sin(t * 2 + i) * 1);
    r(x + i + sway, base - 6 + Math.abs(i) / 2, 1, 6 - Math.abs(i) / 2, i % 2 === 0 ? SEA.anemone : SEA.anemoneL);
  }
  const cx = Math.round(Math.sin(t * 1.3 + x) * 4);                     // a clownfish nosing in and out
  r(x + cx - 2, base - 9, 4, 2, SEA.clown); r(x + cx - 1, base - 9, 1, 2, "#ffffff");
}

function tank(r: Pen, x: number, y: number, c: readonly [string, string]): void {
  r(x - 1, y - 1, 6, 15, SEA.ink);
  r(x, y + 1, 4, 12, c[0]); r(x + 3, y + 1, 1, 12, c[1]); r(x + 1, y, 2, 1, c[0]);
  r(x + 1, y - 3, 2, 3, SEA.gear.reg);
}

/** A diver propulsion vehicle, nose toward `facing`. */
export function scooter(r: Pen, x: number, y: number, facing: 1 | -1, t: number): void {
  const S = SEA.scooter;
  const n = x + facing * 6;                                                         // the nose end
  r(x - 6, y - 3, 12, 7, SEA.ink); r(n - (facing > 0 ? 0 : 1), y - 2, 2, 5, SEA.ink);
  r(x - 5, y - 2, 10, 5, S.c); r(x - 5, y + 2, 10, 1, S.d); r(x - 5, y - 2, 10, 1, "#fff09a");
  r(n - (facing > 0 ? 1 : 0), y - 1, 1, 3, S.c); r(n + (facing > 0 ? 0 : -1) + facing, y, 1, 1, S.light);
  r(x - 2, y - 4, 4, 1, S.prop);                                                    // the handle
  const tail = x - facing * 7, p = Math.floor(t * 12) % 2;
  r(tail - (facing > 0 ? 1 : 0), y - 1, 2, 3, S.d);
  r(tail - facing * 2, y - 3 + p, 1, 7 - 2 * p, S.prop);
}

function miniSub(ctx: Ctx, r: Pen, s: Point, state: CharState | null, t: number): void {
  const U = SEA.sub;
  const bob = Math.round(Math.sin(t * 1.1 + s.x) * 1);
  const y = -34 + bob;
  ellipse(ctx, s.x, s.y + y, 17, 8, SEA.ink);
  ellipse(ctx, s.x, s.y + y, 16, 7, U.c);
  r(-14, y + 3, 28, 3, U.d); r(-12, y - 6, 20, 1, U.l);
  r(-5, y - 12, 10, 6, SEA.ink); r(-4, y - 11, 8, 5, U.c); r(-1, y - 14, 1, 3, U.prop);
  for (const wx of [-8, 0, 8]) { ellipse(ctx, s.x + wx, s.y + y, 3, 3, SEA.ink); ellipse(ctx, s.x + wx, s.y + y, 2, 2, U.window); r(wx - 1, y - 1, 1, 1, "#ffffff"); }
  const p = Math.floor(t * 10) % 2;
  r(-19, y - 3 + p, 2, 5 - p, U.prop); r(-17, y - 6, 3, 3, U.fin); r(-17, y + 4, 3, 3, U.fin);
  r(16, y - 1, 2, 2, state !== null && state !== "off_duty" ? U.light : U.prop);
  if (state === "working") {
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 12; i++) r(18 + i, y - 1 - Math.floor(i / 3), 1, 3 + Math.floor((i * 2) / 3), U.light);
    ctx.globalAlpha = 1;
  }
}

/** Signal buoy: an orange marker sausage on a line, light flashing on top. */
function buoy(ctx: Ctx, r: Pen, t: number): void {
  const B = SEA.buoy;
  const sway = Math.round(Math.sin(t * 1.6) * 1);
  for (let y = -8; y > -30; y -= 2) r(-13 + (y < -20 ? sway : 0), y, 1, 2, B.line);
  r(-15 + sway, -46, 5, 18, SEA.ink);
  r(-14 + sway, -45, 3, 16, B.c); r(-14 + sway, -45, 1, 16, B.l);
  const on = Math.floor(t * 4) % 2 === 0;
  r(-13 + sway, -48, 1, 2, on ? B.light : SEA.ink);
  if (on) { ctx.globalAlpha = 0.35; r(-16 + sway, -50, 7, 5, B.light); ctx.globalAlpha = 1; }
}

/** The chest at a finished site: lid up, gold heaped inside, a glint going round. */
function chest(r: Pen, t: number): void {
  const C = SEA.chest;
  r(7, -9, 13, 10, SEA.ink);
  r(8, -8, 11, 8, C.c); r(8, -5, 11, 1, C.band); r(13, -5, 1, 3, C.band);
  r(8, -16, 11, 7, SEA.ink); r(9, -15, 9, 5, C.d); r(9, -15, 9, 1, C.band);  // the lid, open
  r(9, -10, 9, 2, C.gold); r(10, -11, 6, 1, C.gold); r(12, -12, 2, 1, C.goldL); r(15, -10, 1, 1, C.gem);
  const g = Math.floor(t * 5) % 6;
  if (g < 3) { r(9 + g * 3, -12, 1, 1, "#ffffff"); r(8 + g * 3, -11, 3, 1, C.goldL); }
}

/** The dive gear and reef at a work spot, scaled to the occupant's tier; an empty spot is a bare rock. */
export function drawWorkSpot(ctx: Ctx, s: Point, tier: Tier | null, state: CharState | null, t: number): void {
  const r = penAt(ctx, s);
  const c = SEA.corals[Math.floor(hash2(s.x, s.y) * SEA.corals.length)]!;
  switch (tier) {
    case null:
      boulder(ctx, s, 0, -16, 7, 5);
      break;
    case 1:
      fan(r, -6, -20, t);
      boulder(ctx, s, 0, -16, 9, 6);
      brain(ctx, s, 5, -22, 3, 2, c);
      r(-6, -15, 3, 1, SEA.star); r(-5, -16, 1, 3, SEA.star);
      break;
    case 2:
      tank(r, -17, -28, SEA.gear.tank[2]);
      staghorn(r, -4, -21, 22, c, t);
      boulder(ctx, s, 0, -16, 12, 6);
      brain(ctx, s, 7, -22, 5, 4, SEA.corals[(SEA.corals.indexOf(c) + 1) % SEA.corals.length]!);
      break;
    case 3:
      // a rock arch with an anemone under it and the scooter parked alongside
      boulder(ctx, s, -11, -24, 5, 12); boulder(ctx, s, 11, -24, 5, 12);
      boulder(ctx, s, 0, -38, 14, 6);
      staghorn(r, -6, -43, 6, c, t); brain(ctx, s, 7, -44, 3, 2, SEA.corals[(SEA.corals.indexOf(c) + 2) % SEA.corals.length]!);
      boulder(ctx, s, 0, -15, 10, 4);
      anemone(r, 0, -18, t);
      scooter(r, 15, -28, -1, t);
      break;
    case 4:
      boulder(ctx, s, 0, -15, 14, 5);
      brain(ctx, s, -10, -20, 5, 4, c);
      miniSub(ctx, r, s, state, t);
      break;
  }
  if (state === "needs_input") buoy(ctx, r, t);
  if (state === "done") chest(r, t);
  if (state === "working" && tier !== null) {                                        // a little fish darts round the site
    const k = Math.sin(t * 2.4 + s.x);
    r(Math.round(k * 12), -30 + Math.round(Math.cos(t * 1.7) * 3), 3, 2, SEA.fish[2]);
    bubble(ctx, s.x + 12, s.y - 40 - ((t * 9) % 12), 1);
  }
}
