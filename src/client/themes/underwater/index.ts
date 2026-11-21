import type { CharState, Effort, Look, Tier } from "../../../shared/types";
import { placeOnGrid } from "../../engine/grid";
import { ellipse, rect } from "../../engine/pixels";
import { drawBase, drawBaseTurned, poseFor } from "../../engine/sprite";
import type { Ctx, Particle, Place, Point, Theme } from "../../engine/theme";
import { gearFor } from "./gear";
import { SEA } from "./palette";
import { AREA, bubble, drawAmbient, drawBackdrop, drawPlace, LOUNGE, PLACE } from "./scenery";
import { drawWorkSpot, penAt, scooter } from "./sites";

const placeFor = (index: number, count: number): Place => placeOnGrid(AREA, PLACE, index, count);

function shimmer(ctx: Ctx, at: Point, effort: Effort, frame: number): void {
  const c = effort === "max" ? SEA.aura.max : SEA.aura.xhigh;
  const pulse = Math.sin(frame / 4);
  ctx.globalAlpha = 0.14 + 0.06 * pulse;
  ellipse(ctx, at.x, at.y - 12, 13, 16, c);
  ctx.globalAlpha = 0.18 + 0.06 * pulse;
  ellipse(ctx, at.x, at.y - 12, 9, 12, c);
  ctx.globalAlpha = 1;
}

/** Breath bubbles: a short train rising from the regulator (or the snorkel's tip). */
function breath(ctx: Ctx, from: Point, frame: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (frame * 0.9 + i * 7) % 21;
    bubble(ctx, from.x + Math.round(Math.sin(k / 3 + i)), from.y - k, k > 9 ? 2 : 1);
  }
}

/** Max effort: a storm of bubbles whirling round the diver. */
function storm(ctx: Ctx, at: Point, frame: number, front: boolean): void {
  for (let i = 0; i < 18; i++) {
    const a = frame / 4 + (i * Math.PI * 2) / 18;
    if (Math.sin(a) > 0 !== front) continue;
    const r = 11 + Math.sin(frame / 6 + i) * 3;
    const rise = (frame * 1.5 + i * 5) % 14;
    bubble(ctx, at.x + Math.round(Math.cos(a) * r), at.y - 12 + Math.round(Math.sin(a) * 6 - rise), i % 3 === 0 ? 2 : 1);
  }
}

/** A dive torch in the right hand, its beam reaching up to the reef in front. */
/** A dive torch in the right hand, its beam reaching up and out to the reef, clear of the diver's head. */
function torch(ctx: Ctx, at: Point, frame: number): void {
  const lift = frame % 2;
  const x = at.x + 5, y = at.y - 11 - lift;
  for (let i = 2; i < 20; i++) {
    const cx = x + i * 0.55, half = Math.round(i * 0.28);
    ctx.globalAlpha = 0.5 * (1 - i / 24);
    rect(ctx, Math.round(cx) - half, y - i, half * 2 + 1, 1, SEA.gear.beam);
  }
  ctx.globalAlpha = 0.3;
  ellipse(ctx, x + 11, y - 20, 5, 3, SEA.gear.beam);
  ctx.globalAlpha = 1;
  rect(ctx, x - 1, y - 1, 3, 4, SEA.ink); rect(ctx, x, y, 1, 2, SEA.gear.torch); rect(ctx, x, y - 1, 1, 1, SEA.gear.beam);
}

function drawCharacter(ctx: Ctx, at: Point, look: Look, tier: Tier, state: CharState, effort: Effort, frame: number, facing: 1 | -1, moving: boolean): void {
  const gear = gearFor(tier, look);
  if (moving) {
    // swimming: stretched out flat, fins kicking, a tech diver towed by a scooter
    const c = { x: at.x, y: at.y - 9 };
    if (tier >= 3) scooter(penAt(ctx, c), facing * 17, 0, facing, frame / 8);
    drawBaseTurned(ctx, c, look, "walk", frame, facing, { costume: gear, back: true });
    breath(ctx, { x: c.x + facing * 9, y: c.y - 6 }, frame);
    return;
  }
  const pose = poseFor(state, false, frame);
  const focused = state === "working" && (effort === "xhigh" || effort === "max");
  if (focused) shimmer(ctx, at, effort, frame);
  if (focused && effort === "max") storm(ctx, at, frame, false);
  drawBase(ctx, at, look, pose, frame, facing, { costume: gear });
  if (pose === "sit_type") torch(ctx, at, frame);
  if (focused && effort === "max") storm(ctx, at, frame, true);
  const seated = pose === "sit_type" || pose === "lean";
  const top = at.y - 24 + (seated ? 2 : 0);
  breath(ctx, tier === 1 ? { x: at.x + (facing > 0 ? 5 : -6), y: top - 4 } : { x: at.x + (pose === "sit_type" ? 0 : facing), y: top + 6 }, frame);
}

/** Bubbles rise and gold coins sink. */
function celebrate(at: Point, rng: () => number): Particle[] {
  return Array.from({ length: 40 }, (_, i) => {
    const coin = i % 3 === 0;
    return {
      x: at.x + (rng() - 0.5) * 10, y: at.y - 22,
      vx: (rng() - 0.5) * (coin ? 70 : 40), vy: coin ? -40 - rng() * 30 : -10 - rng() * 30, gravity: coin ? 0.45 : -0.3,
      life: 1.3 + rng() * 0.9, size: coin || rng() < 0.3 ? 2 : 1,
      color: coin ? SEA.coins[Math.floor(rng() * SEA.coins.length)]! : rng() < 0.5 ? SEA.bubble : SEA.bubbleL,
    };
  });
}

function levelUp(at: Point, rng: () => number): Particle[] {
  const n = 28;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const v = 26 + rng() * 14;
    return {
      x: at.x, y: at.y - 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, gravity: -0.2,
      life: 0.9 + rng() * 0.6, size: i % 4 === 0 ? 2 : 1,
      color: SEA.sparkle[Math.floor(rng() * SEA.sparkle.length)]!,
    };
  });
}

export const underwater: Theme = {
  id: "underwater",
  name: "Underwater",
  movement: "swim",
  tierTitles: { 1: "Snorkeler", 2: "Diver", 3: "Tech Diver", 4: "Master Diver" },
  lounge: LOUNGE,
  placeFor,
  drawBackdrop,
  drawPlace,
  drawWorkSpot,
  drawCharacter,
  effects: { celebrate, levelUp },
  drawAmbient,
};
