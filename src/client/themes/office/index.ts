import type { CharState, Effort, Look, Tier } from "../../../shared/types";
import { placeOnGrid } from "../../engine/grid";
import { ellipse, rect } from "../../engine/pixels";
import { drawBase, poseFor } from "../../engine/sprite";
import type { Ctx, Particle, Place, Point, Theme } from "../../engine/theme";
import { drawCat } from "./cat";
import { chair, drawWorkSpot } from "./desks";
import { drawAction, drawCompaction, drawContextGauge, drawSidekick, socialSpots } from "./extras";
import { OFFICE } from "./palette";
import { AREA, drawBackdrop, drawPlace, LOUNGE, PLACE } from "./room";
import { drawUpgrades, upgradeSocialSpots } from "./upgrades";

/** Places on a grid sized to the count, the last row centred; each has two rows of three desks. */
const placeFor = (index: number, count: number): Place => placeOnGrid(AREA, PLACE, index, count);

function aura(ctx: Ctx, at: Point, effort: Effort, frame: number): void {
  const c = effort === "max" ? OFFICE.aura.max : OFFICE.aura.xhigh;
  const pulse = Math.sin(frame / 4);
  ctx.globalAlpha = 0.18 + 0.08 * pulse;
  ellipse(ctx, at.x, at.y - 12, 12, 15, c);
  ctx.globalAlpha = 0.22 + 0.08 * pulse;
  ellipse(ctx, at.x, at.y - 12, 9, 12, c);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) {
    const a = frame / 6 + (i * Math.PI * 2) / 3;
    rect(ctx, at.x + Math.round(Math.cos(a) * 11), at.y - 12 + Math.round(Math.sin(a) * 14), 1, 1, "#ffffff");
  }
}

function coffeeStack(ctx: Ctx, at: Point, frame: number): void {
  const L = OFFICE.lounge;
  const x = at.x - 13, y = at.y - 26;
  for (let i = 0; i < 3; i++) {
    rect(ctx, x - 1, y - i * 3 - 1, 6, 4, OFFICE.ink);
    rect(ctx, x, y - i * 3, 4, 3, L.cup);
    rect(ctx, x, y - i * 3 + 2, 4, 1, "#d9d4c6");
  }
  rect(ctx, x, y - 6, 4, 1, L.coffee);
  ctx.globalAlpha = 0.8;
  const s = frame % 6;
  rect(ctx, x + 1 + (s > 2 ? 1 : 0), y - 8 - (s % 3), 1, 1, L.steam);
  ctx.globalAlpha = 1;
}

function mug(ctx: Ctx, at: Point, facing: 1 | -1, frame: number): void {
  const L = OFFICE.lounge;
  const x = facing > 0 ? at.x + 3 : at.x - 7;
  rect(ctx, x - 1, at.y - 12, 5, 5, OFFICE.ink);
  rect(ctx, x, at.y - 11, 3, 3, L.cup);
  rect(ctx, x, at.y - 11, 3, 1, L.coffee);
  if (frame % 16 < 8) { ctx.globalAlpha = 0.7; rect(ctx, x + 1, at.y - 14 - ((frame >> 1) % 2), 1, 1, L.steam); ctx.globalAlpha = 1; }
}

function drawCharacter(ctx: Ctx, at: Point, look: Look, tier: Tier, state: CharState, effort: Effort, frame: number, facing: 1 | -1, moving: boolean): void {
  const pose = poseFor(state, moving, frame);
  const focused = !moving && state === "working" && (effort === "xhigh" || effort === "max");
  if (focused) aura(ctx, at, effort, frame);
  if (pose !== "sit_type" && pose !== "lean") {
    ctx.globalAlpha = 0.25;
    ellipse(ctx, at.x, at.y, 5, 1, OFFICE.ink);
    ctx.globalAlpha = 1;
  }
  drawBase(ctx, at, look, pose, frame, facing);
  if (pose === "sit_type") chair(ctx, at, tier, true);
  if (pose === "stand" && state === "off_duty") mug(ctx, at, facing, frame);
  if (focused && effort === "max") coffeeStack(ctx, at, frame);
}

function celebrate(at: Point, rng: () => number): Particle[] {
  return Array.from({ length: 40 }, () => ({
    x: at.x + (rng() - 0.5) * 8, y: at.y - 22,
    vx: (rng() - 0.5) * 110, vy: -50 - rng() * 70,
    life: 1.2 + rng() * 0.9, size: rng() < 0.3 ? 2 : 1,
    color: OFFICE.confetti[Math.floor(rng() * OFFICE.confetti.length)]!,
  }));
}

function levelUp(at: Point, rng: () => number): Particle[] {
  const n = 28;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const speed = 30 + rng() * 25;
    return {
      x: at.x, y: at.y - 14, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 45,
      life: 0.9 + rng() * 0.6, size: rng() < 0.25 ? 2 : 1,
      color: OFFICE.sparkle[Math.floor(rng() * OFFICE.sparkle.length)]!,
    };
  });
}

export const office: Theme = {
  id: "office",
  name: "Office",
  movement: "walk",
  tierTitles: { 1: "Junior", 2: "Engineer", 3: "Senior", 4: "Principal" },
  lounge: LOUNGE,
  placeFor,
  drawBackdrop,
  drawPlace,
  drawWorkSpot,
  drawCharacter,
  effects: { celebrate, levelUp },
  drawAmbient: drawCat,
  drawAction,
  drawSidekick,
  drawContextGauge,
  drawCompaction,
  socialSpots,
  drawUpgrades,
  upgradeSocialSpots,
};
