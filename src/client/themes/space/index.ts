import type { CharState, Effort, Look, Tier } from "../../../shared/types";
import { placeOnGrid } from "../../engine/grid";
import { ellipse, rect, shade } from "../../engine/pixels";
import { drawBase, poseFor } from "../../engine/sprite";
import type { Ctx, Particle, Place, Point, Theme } from "../../engine/theme";
import { drawWorkSpot } from "./modules";
import { SPACE } from "./palette";
import { AREA, drawBackdrop, drawComet, drawPlace, LOUNGE, PLACE } from "./scenery";
import { suitFor } from "./suit";

const S = SPACE.suit;

const placeFor = (index: number, count: number): Place => placeOnGrid(AREA, PLACE, index, count);

function aura(ctx: Ctx, at: Point, effort: Effort, frame: number): void {
  const c = effort === "max" ? SPACE.aura.max : SPACE.aura.xhigh;
  const pulse = Math.sin(frame / 4);
  ctx.globalAlpha = 0.16 + 0.08 * pulse;
  ellipse(ctx, at.x, at.y - 12, 13, 16, c);
  ctx.globalAlpha = 0.2 + 0.08 * pulse;
  ellipse(ctx, at.x, at.y - 12, 10, 13, c);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4; i++) {
    const a = frame / 5 + (i * Math.PI) / 2;
    rect(ctx, at.x + Math.round(Math.cos(a) * 12), at.y - 12 + Math.round(Math.sin(a) * 15), 1, 1, "#ffffff");
  }
}

/** Flames under the pack: a short puff to steer, or a roaring overclocked burn at max effort. */
function thrust(ctx: Ctx, at: Point, frame: number, power: number): void {
  for (const x of [-6, 4]) {
    for (let i = 0; i < power; i++) {
      const flicker = (frame + i + x) % 3 === 0 ? 1 : 0;
      rect(ctx, at.x + x + (i > 1 ? 1 : 0) - flicker, at.y - 3 + i * 2, 2 - (i > 2 ? 1 : 0), 2, S.flame[Math.min(S.flame.length - 1, Math.floor(i / 2))]!);
    }
  }
}

function puff(ctx: Ctx, at: Point, facing: 1 | -1, frame: number): void {
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < 3; i++) {
    const k = (frame + i * 3) % 9;
    rect(ctx, at.x - facing * (9 + k), at.y - 14 + ((i * 5) % 3) - 1, k < 4 ? 2 : 1, 1, S.puff);
  }
  ctx.globalAlpha = 1;
}

/** A safety line from the console to the waist, sagging a little. */
function tether(ctx: Ctx, at: Point, frame: number): void {
  const x0 = at.x - 11, y0 = at.y - 20, x1 = at.x - 3, y1 = at.y - 11;
  const sag = 3 + Math.sin(frame / 8);
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    rect(ctx, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * sag, 1, 1, i % 4 === 0 ? SPACE.hazard.y : S.rimS);
  }
}

function wrench(ctx: Ctx, at: Point, frame: number): void {
  const lift = frame % 2;
  const x = at.x + 5, y = at.y - 10 - lift;
  for (let i = 0; i < 4; i++) rect(ctx, x + i, y - i, 1, 1, SPACE.hull.l);
  rect(ctx, x + 3, y - 5, 2, 1, SPACE.hull.c); rect(ctx, x + 4, y - 4, 1, 1, SPACE.hull.c);
}

/** The flag goes in when the job is done, in the astronaut's own colour. */
function flag(ctx: Ctx, at: Point, body: string, frame: number): void {
  const drop = Math.max(0, 8 - frame) * 2;
  const x = at.x + 11, top = at.y - 30 - drop;
  rect(ctx, x - 1, top - 1, 3, 31, SPACE.ink);
  rect(ctx, x, top, 1, 30, S.rim);
  rect(ctx, x - 1, top - 2, 3, 2, S.gold);
  const wave = (frame >> 2) % 2;
  for (let col = 0; col < 9; col++) {
    const dy = col > 2 ? ((col + wave) % 3 === 0 ? 1 : 0) : 0;
    rect(ctx, x + 1 + col, top + 1 + dy - 1, 1, 8, SPACE.ink);
    rect(ctx, x + 1 + col, top + 1 + dy, 1, 6, body);
    rect(ctx, x + 1 + col, top + 3 + dy, 1, 2, shade(body, 0.35));
  }
  rect(ctx, x + 4, top + 3 + wave, 2, 2, "#ffffff");
}

function pouch(ctx: Ctx, at: Point, facing: 1 | -1): void {
  const x = facing > 0 ? at.x + 5 : at.x - 8;
  rect(ctx, x - 1, at.y - 13, 5, 6, SPACE.ink);
  rect(ctx, x, at.y - 12, 3, 4, S.pouchDrink); rect(ctx, x, at.y - 12, 3, 1, "#ffffff");
  rect(ctx, x + 1, at.y - 15, 1, 3, S.straw);
}

/** The admiral's gold drone circles the helmet; `front` draws the half of the orbit nearer the viewer. */
function drone(ctx: Ctx, at: Point, frame: number, front: boolean): void {
  const a = frame / 7;
  if (Math.sin(a) > 0 !== front) return;
  const D = SPACE.drone;
  const x = Math.round(at.x + Math.cos(a) * 13), y = Math.round(at.y - 27 + Math.sin(a) * 3);
  rect(ctx, x - 3, y - 2, 7, 5, SPACE.ink);
  rect(ctx, x - 2, y - 1, 5, 3, D.c); rect(ctx, x - 2, y + 1, 5, 1, D.d);
  rect(ctx, x + (Math.cos(a) > 0 ? -1 : 1), y, 1, 1, D.eye);
  rect(ctx, x - 3 + (frame % 2) * 2, y - 3, 3, 1, D.rotor);
}

function drawCharacter(ctx: Ctx, at: Point, look: Look, tier: Tier, state: CharState, effort: Effort, frame: number, facing: 1 | -1, moving: boolean): void {
  const pose = moving ? "stand" : poseFor(state, false, frame);    // nobody walks in zero g: they drift, feet together
  const focused = !moving && state === "working" && (effort === "xhigh" || effort === "max");
  const overclocked = focused && effort === "max";
  if (focused) aura(ctx, at, effort, frame);
  if (tier === 4) drone(ctx, at, frame, false);
  if (state === "idle" && !moving) tether(ctx, at, frame);
  if (moving) { puff(ctx, at, facing, frame); if (tier === 3) thrust(ctx, at, frame, 2); }
  if (overclocked) thrust(ctx, at, frame, 5);
  const shake = overclocked ? ((frame % 2) * 2 - 1) : 0;
  drawBase(ctx, { x: at.x + shake, y: at.y }, look, pose, frame, facing, { costume: suitFor(tier) });
  if (pose === "sit_type") wrench(ctx, at, frame);
  if (state === "done" && !moving) flag(ctx, at, look.body, frame);
  if (state === "off_duty" && !moving && pose === "stand") pouch(ctx, at, facing);
  if (tier === 4) drone(ctx, at, frame, true);
}

/** Fireworks in zero g: they burst and drift without falling. */
function celebrate(at: Point, rng: () => number): Particle[] {
  return Array.from({ length: 44 }, () => {
    const a = rng() * Math.PI * 2, v = 25 + rng() * 55;
    return {
      x: at.x, y: at.y - 26, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 0,
      life: 1 + rng() * 1, size: rng() < 0.3 ? 2 : 1,
      color: SPACE.confetti[Math.floor(rng() * SPACE.confetti.length)]!,
    };
  });
}

function levelUp(at: Point, rng: () => number): Particle[] {
  const n = 32;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const v = 34 + rng() * 10;
    return {
      x: at.x, y: at.y - 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, gravity: 0,
      life: 0.8 + rng() * 0.5, size: i % 4 === 0 ? 2 : 1,
      color: SPACE.sparkle[Math.floor(rng() * SPACE.sparkle.length)]!,
    };
  });
}

export const space: Theme = {
  id: "space",
  name: "Space",
  movement: "float",
  tierTitles: { 1: "Cadet", 2: "Specialist", 3: "Commander", 4: "Admiral" },
  lounge: LOUNGE,
  placeFor,
  drawBackdrop,
  drawPlace,
  drawWorkSpot,
  drawCharacter,
  effects: { celebrate, levelUp },
  drawAmbient: drawComet,
};
