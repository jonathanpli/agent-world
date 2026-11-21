import type { CharState, Tier } from "../../../shared/types";
import { hash2, rect } from "../../engine/pixels";
import type { Ctx, Point } from "../../engine/theme";
import { OFFICE } from "./palette";

type Wood = { top: string; topL: string; front: string; frontS: string; leg: string };
const WOOD: Record<Tier, Wood> = OFFICE.wood;
const W: Record<Tier, number> = { 1: 24, 2: 30, 3: 36, 4: 40 };

/** Draws relative to the spot: (x, y) offsets from the seat. */
type Pen = (x: number, y: number, w: number, h: number, c: string) => void;
const penAt = (ctx: Ctx, s: Point): Pen => (x, y, w, h, c) => rect(ctx, s.x + x, s.y + y, w, h, c);

function desk(r: Pen, w: number, wood: Wood): void {
  const x = -w / 2;
  r(x - 1, -31, w + 2, 17, OFFICE.ink);
  r(x, -30, w, 8, wood.top);
  r(x, -30, w, 1, wood.topL);
  r(x, -22, w, 7, wood.front);
  r(x, -16, w, 1, wood.frontS);
  r(x, -15, 2, 4, wood.leg); r(x + w - 2, -15, 2, 4, wood.leg);
  r(x - 1, -11, 4, 1, OFFICE.shadow); r(x + w - 3, -11, 4, 1, OFFICE.shadow);
}

function screen(ctx: Ctx, x: number, y: number, w: number, h: number, state: CharState | null, t: number, seed: number): void {
  const r = (dx: number, dy: number, ww: number, hh: number, c: string): void => rect(ctx, x + dx, y + dy, ww, hh, c);
  const S = OFFICE.screen;
  const iw = w - 2, ih = h - 2;
  switch (state) {
    case "working": {
      r(1, 1, iw, ih, S.code);
      const tick = Math.floor(t * OFFICE.codeScrollHz);
      for (let row = 0; row * 2 < ih; row++) {
        const n = tick + row;
        const indent = Math.floor(hash2(seed, n) * 3);
        const len = Math.max(1, Math.floor(hash2(n, seed + 7) * (iw - indent)));
        const c = S.syntax[Math.floor(hash2(seed + n, 3) * S.syntax.length)]!;
        r(1 + indent, 1 + row * 2, len, 1, c);
      }
      if (Math.floor(t * 2) % 2 === 0) r(1 + Math.min(iw - 1, 2 + (tick % 4)), ih - (ih % 2 === 0 ? 1 : 0), 1, 1, S.cursor);
      if (hash2(seed, Math.floor(t * 12)) > 0.8) { ctx.globalAlpha = 0.18; r(1, 1, iw, ih, "#ffffff"); ctx.globalAlpha = 1; }
      break;
    }
    case "needs_input": {
      r(1, 1, iw, ih, S.alertBg);
      r(2, 2, iw - 2, ih - 2, S.dialog);
      r(2, 2, iw - 2, 1, S.alert);
      if (Math.floor(t * 3) % 2 === 0) r(Math.floor(w / 2) - 1, ih - 1, 3, 1, S.alert);
      break;
    }
    case "done": {
      r(1, 1, iw, ih, S.doneBg);
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
      for (const [dx, dy] of [[-3, 0], [-2, 1], [-1, 2], [0, 1], [1, 0], [2, -1], [3, -2]] as const) r(cx + dx, cy + dy, 1, 1, S.check);
      break;
    }
    case "idle": {
      r(1, 1, iw, ih, S.idleBg);
      const px = Math.floor(Math.abs(((t * 3 + seed) % (2 * (iw - 1))) - (iw - 1)));
      const py = Math.floor(Math.abs(((t * 2 + seed * 3) % (2 * (ih - 1))) - (ih - 1)));
      r(1 + px, 1 + py, 1, 1, S.saver);
      break;
    }
    default:
      r(1, 1, iw, ih, S.off);
      r(iw - 2, 2, 1, 1, S.glare); r(iw - 1, 1, 1, 1, S.glare);
  }
}

function monitor(ctx: Ctx, s: Point, x: number, y: number, w: number, h: number, state: CharState | null, t: number, seed: number, stand = true): void {
  const r = penAt(ctx, s);
  r(x - 1, y - 1, w + 2, h + 2, OFFICE.ink);
  r(x, y, w, h, OFFICE.monitor);
  screen(ctx, s.x + x, s.y + y, w, h, state, t, seed);
  if (!stand) return;
  const mid = x + Math.floor(w / 2);
  r(mid - 1, y + h, 2, -30 - (y + h) + 2, OFFICE.stand);
  r(mid - 3, -29, 6, 1, OFFICE.stand);
  if (state !== null && state !== "off_duty") {
    ctx.globalAlpha = 0.16;
    r(x, -28, w, 3, OFFICE.screen.glow);
    ctx.globalAlpha = 1;
  }
}

function keyboard(r: Pen): void {
  r(-5, -25, 10, 2, OFFICE.keys); r(-5, -23, 10, 1, OFFICE.keysS); r(7, -24, 2, 2, OFFICE.keys);
}

/** The chair at a spot; the back is also drawn over a seated, typing character. */
export function chair(ctx: Ctx, s: Point, tier: Tier | null, backOnly = false): void {
  const r = penAt(ctx, s);
  const C = tier === 4 ? OFFICE.chairBoss : OFFICE.chair;
  if (!backOnly) {
    r(-1, -2, 2, 3, OFFICE.stand);
    r(-4, 1, 8, 1, OFFICE.stand); r(-5, 1, 1, 1, OFFICE.ink); r(4, 1, 1, 1, OFFICE.ink); r(-1, 1, 2, 1, OFFICE.ink);
    r(-6, -4, 12, 4, OFFICE.ink); r(-5, -4, 10, 3, C.seat); r(-5, -4, 10, 1, C.backL);
  }
  r(-4, -9, 8, 6, OFFICE.ink); r(-5, -8, 10, 4, OFFICE.ink);
  r(-4, -8, 8, 4, C.back);
  r(-3, -8, 6, 1, C.backL);
  if (tier === 4) { r(-2, -6, 1, 1, OFFICE.brass); r(1, -6, 1, 1, OFFICE.brass); }
}

function plant(r: Pen, x: number, y: number): void {
  const P = OFFICE.plant;
  r(x, y, 5, 4, OFFICE.ink); r(x + 1, y, 3, 3, P.pot);
  r(x, y - 3, 1, 2, P.leaf); r(x + 1, y - 5, 1, 5, P.leafD); r(x + 2, y - 6, 1, 6, P.leaf);
  r(x + 3, y - 4, 1, 4, P.leafL); r(x + 4, y - 2, 1, 1, P.leaf);
}

/** Desk, screens and chair at a work spot, scaled to the occupant's tier. An empty spot is a plain junior desk, screen off. */
export function drawWorkSpot(ctx: Ctx, s: Point, tier: Tier | null, state: CharState | null, t: number): void {
  const r = penAt(ctx, s);
  const seed = Math.floor(s.x * 7 + s.y * 13);
  const k: Tier = tier ?? 1;
  const w = W[k];
  switch (k) {
    case 1:
      desk(r, w, WOOD[1]);
      monitor(ctx, s, -6, -40, 12, 9, state, t, seed);
      if (tier !== null) { r(7, -30, 3, 3, OFFICE.ink); r(8, -29, 1, 2, OFFICE.mugBlue); r(8, -31, 1, 1, OFFICE.pencil); }
      break;
    case 2:
      desk(r, w, WOOD[2]);
      monitor(ctx, s, -13, -40, 12, 9, state, t, seed);
      monitor(ctx, s, 1, -40, 12, 9, state, t, seed + 1);
      r(6, -20, 6, 1, WOOD[2].frontS);
      break;
    case 3:
      desk(r, w, WOOD[3]);
      monitor(ctx, s, -17, -39, 10, 8, state, t, seed + 2);
      monitor(ctx, s, 7, -39, 10, 8, state, t, seed + 3);
      monitor(ctx, s, -6, -42, 12, 11, state, t, seed);
      plant(r, -17, -27);
      r(9, -20, 6, 1, WOOD[3].frontS); r(-15, -20, 6, 1, WOOD[3].frontS);
      break;
    case 4: {
      // whiteboard on the left, a 2x2 monitor wall on the right, an L-shaped corner desk
      const B = OFFICE.board;
      r(-20, -45, 17, 14, OFFICE.ink); r(-19, -44, 15, 12, B.face);
      r(-18, -42, 6, 1, B.blue); r(-18, -40, 9, 1, B.ink); r(-18, -38, 4, 1, B.red);
      r(-12, -37, 2, 4, B.green); r(-9, -35, 2, 2, B.blue); r(-15, -36, 2, 3, B.red);
      r(-19, -32, 15, 1, B.tray); r(-18, -31, 1, 1, B.red); r(-16, -31, 1, 1, B.blue);
      for (const [mx, my] of [[-2, -46], [8, -46], [-2, -38], [8, -38]] as const) monitor(ctx, s, mx, my, 9, 7, state, t, seed + mx * 3 + my, false);
      r(6, -31, 2, 2, OFFICE.stand);
      desk(r, w, WOOD[4]);
      r(-w / 2, -16, w, 1, OFFICE.brass);
      r(13, -23, 8, 14, OFFICE.ink); r(14, -22, 6, 9, WOOD[4].top); r(14, -13, 6, 3, WOOD[4].front); r(14, -10, 6, 1, OFFICE.brass);
      r(-3, -20, 6, 2, OFFICE.brass);
      break;
    }
  }
  if (tier !== null) keyboard(r);
  chair(ctx, s, tier);
}
