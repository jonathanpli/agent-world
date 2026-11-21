import { CONFIG } from "../../../shared/config";
import { drawText } from "../../engine/font";
import { PixelGrid } from "../../engine/pixels";
import { OUTLINE } from "../../engine/sprite";
import type { Ctx, Point } from "../../engine/theme";
import { OFFICE } from "./palette";

type Rest = "sit" | "sleep";
type Leg = { to: Point; rest: Rest; restS: number };

/** The office cat's daily round on screen 0: sofa nap, the coffee counter, the rug, a stroll along the wall. */
const ROUND: Leg[] = [
  { to: { x: 458, y: 46 }, rest: "sleep", restS: 12 },
  { to: { x: 452, y: 68 }, rest: "sit", restS: 0 },
  { to: { x: 412, y: 62 }, rest: "sit", restS: 5 },
  { to: { x: 391, y: 66 }, rest: "sit", restS: 0 },
  { to: { x: 391, y: 39 }, rest: "sit", restS: 0 },
  { to: { x: 250, y: 39 }, rest: "sit", restS: 4 },
  { to: { x: 120, y: 39 }, rest: "sit", restS: 3 },
  { to: { x: 391, y: 39 }, rest: "sit", restS: 0 },
  { to: { x: 391, y: 70 }, rest: "sit", restS: 0 },
  { to: { x: 430, y: 160 }, rest: "sit", restS: 6 },
  { to: { x: 445, y: 230 }, rest: "sit", restS: 4 },
];

type Seg = { from: Point; to: Point; walkS: number; rest: Rest; restS: number; start: number };
const SEGS: Seg[] = [];
let total = 0;
ROUND.forEach((leg, i) => {
  const from = ROUND[(i + ROUND.length - 1) % ROUND.length]!.to;
  const walkS = Math.hypot(leg.to.x - from.x, leg.to.y - from.y) / CONFIG.client.catSpeed;
  SEGS.push({ from, to: leg.to, walkS, rest: leg.rest, restS: leg.restS, start: total });
  total += walkS + leg.restS;
});

type CatPose = { at: Point; facing: 1 | -1; pose: "walk" | Rest; step: number };

export function catAt(t: number): CatPose {
  const tm = ((t % total) + total) % total;
  let seg = SEGS[0]!;
  for (const s of SEGS) if (s.start <= tm) seg = s;
  const into = tm - seg.start;
  const dx = seg.to.x - seg.from.x;
  const facing: 1 | -1 = dx < 0 ? -1 : 1;
  if (into < seg.walkS) {
    const k = into / seg.walkS;
    return { at: { x: seg.from.x + dx * k, y: seg.from.y + (seg.to.y - seg.from.y) * k }, facing, pose: "walk", step: Math.floor(t * 6) % 2 };
  }
  return { at: seg.to, facing, pose: seg.rest, step: Math.floor(t * 2) % 2 };
}

export function drawCat(ctx: Ctx, t: number): void {
  const { at, facing, pose, step } = catAt(t);
  const C = OFFICE.cat;
  const g = new PixelGrid(22, 18, 11, 15);
  const p = (x: number, y: number, c: string): void => g.set(facing > 0 ? x : -x, y, c);
  const box = (x0: number, y0: number, x1: number, y1: number, c: string): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p(x, y, c);
  };
  if (pose === "walk") {
    box(-5, -6, 3, -3, C.fur); box(-4, -3, 2, -3, C.belly);
    for (const x of [-3, 0]) p(x, -6, C.stripe);
    box(3, -8, 6, -4, C.fur); p(3, -9, C.fur); p(6, -9, C.fur); p(5, -6, C.eye); p(7, -5, C.nose);
    const legs = step === 0 ? [-5, -2, 0, 3] : [-4, -3, 1, 2];
    for (const x of legs) box(x, -2, x, -1, C.fur);
    const sway = Math.round(Math.sin(t * 5));
    box(-7, -9 + sway, -7, -6, C.fur); p(-6, -6, C.fur); p(-7, -10 + sway, C.stripe);
  } else if (pose === "sit") {
    box(-4, -6, 1, -1, C.fur); box(1, -8, 3, -1, C.fur); box(2, -5, 3, -2, C.belly);
    p(-2, -5, C.stripe); p(-3, -3, C.stripe);
    box(1, -12, 5, -8, C.fur); p(1, -13, C.fur); p(5, -13, C.fur);
    p(step === 0 ? 4 : 3, -10, C.eye); p(6, -9, C.nose);
    box(-7, -1, -2, -1, C.fur); p(-7, -2, C.stripe);
  } else {
    box(-5, -4, 5, -1, C.fur); box(-4, -5, 4, -5, C.fur);
    for (const x of [-3, 0, 3]) p(x, -5, C.stripe);
    box(3, -4, 6, -1, C.fur); p(4, -5, C.fur); p(6, -5, C.fur); p(5, -2, C.stripe);
    box(-6, -1, 2, -1, C.stripe);
  }
  g.outline(OUTLINE);
  g.blit(ctx, at.x, at.y);
  if (pose === "sleep") {
    const rise = (t * 3) % 8;
    ctx.globalAlpha = Math.max(0, 1 - rise / 8);
    drawText(ctx, "z", at.x + 4 * facing + rise / 2, at.y - 12 - rise, OFFICE.label);
    ctx.globalAlpha = 1;
  }
}
