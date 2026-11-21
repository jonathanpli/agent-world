import { CONFIG } from "../../shared/config";
import type { CharState, Look } from "../../shared/types";
import { mix, PixelGrid, shade } from "./pixels";
import { drawHair, drawHat, drawAccessory } from "./spriteParts";
import type { Ctx, Point, Pose } from "./theme";

export const SPRITE = { w: 16, h: 24 } as const;
export const OUTLINE = "#2a1d2e";

/** Colours derived from a look; shared with the parts module. */
export type Pal = {
  skin: string; skinS: string; cheek: string; mouth: string; eye: string;
  body: string; bodyS: string; bodyL: string; hair: string; hairS: string; hairL: string;
  pants: string; pantsS: string; shoe: string;
};

/** Everything the parts need to place themselves: head top row, torso top row, view and facing. `spread` moves raised hands outward. */
export type Frame = { g: PixelGrid; p: Pal; hy: number; by: number; back: boolean; facing: 1 | -1; pose: Pose; step: number; frame: number; spread: number };

/**
 * A theme's costume over the base look. Every hook draws into the same grid as the body, so one outline wraps it all.
 * Body colour, skin and hair stay as they are; the hat is drawn over the costume's headgear.
 */
export type Costume = {
  pal?: Partial<Pick<Pal, "pants" | "pantsS" | "shoe">>;
  behind?(f: Frame): void;                          // first, behind the body
  body?(f: Frame): void;                            // over legs and torso, under resting arms and the head
  keepHead?(x: number, y: number, f: Frame): boolean;   // hair and accessory pixels where this is false are dropped
  head?(f: Frame): void;                            // over head, hair and accessory; under the hat
  hatLift?: number;                                 // rows to raise the hat, so it sits on a helmet
  spread?: number;                                  // px to move raised hands outward, clear of a helmet
};

function palette(look: Look): Pal {
  return {
    skin: look.skin, skinS: shade(look.skin, -0.14), cheek: mix(look.skin, "#ff6f7d", 0.35), mouth: mix(look.skin, "#5a1f2a", 0.6), eye: OUTLINE,
    body: look.body, bodyS: shade(look.body, -0.24), bodyL: shade(look.body, 0.2),
    hair: look.hairColor, hairS: shade(look.hairColor, -0.28), hairL: shade(look.hairColor, 0.22),
    pants: "#3d4366", pantsS: "#2e3352", shoe: "#3a2a26",
  };
}

/** The pose a theme should draw for a state; `frame` counts frames since the state began. */
export function poseFor(state: CharState, moving: boolean, frame: number): Pose {
  if (moving) return "walk";
  switch (state) {
    case "working": return "sit_type";
    case "needs_input": return "raise_hand";
    case "done": return frame < CONFIG.client.cheerS * CONFIG.client.animFps ? "cheer" : "lean";
    case "idle": return "lean";
    case "off_duty": return "stand";
  }
}

function head(f: Frame): void {
  const { g, p, hy, back, facing } = f;
  g.fill(5, hy, 10, hy, p.skin);
  g.fill(4, hy + 1, 11, hy + 6, p.skin);
  g.fill(5, hy + 7, 10, hy + 7, p.skinS);
  g.set(3, hy + 4, p.skin); g.set(12, hy + 4, p.skin);           // ears
  if (back) return;
  const d = f.pose === "walk" || f.pose === "stand" ? (facing > 0 ? 1 : -1) : 0;
  const ex = 6 + d;
  const blink = f.frame % 53 === 7;
  for (const x of [ex, ex + 3]) {
    g.set(x, hy + 4, p.eye);
    if (!blink) g.set(x, hy + 3, p.eye);
  }
  g.set(ex - 1, hy + 5, p.cheek); g.set(ex + 4, hy + 5, p.cheek);
  if (f.pose === "cheer") { g.fill(ex + 1, hy + 5, ex + 2, hy + 6, p.mouth); }
  else if (f.pose === "raise_hand") g.set(ex + 1 + (d > 0 ? 1 : 0), hy + 6, p.mouth);
  else g.fill(ex + 1, hy + 6, ex + 2, hy + 6, p.mouth);
}

function torso(f: Frame): void {
  const { g, p, by, back } = f;
  g.fill(5, by, 10, by + 5, p.body);
  g.fill(5, by + 5, 10, by + 5, p.bodyS);
  if (back) { g.fill(7, by + 1, 8, by + 4, p.bodyS); return; }    // a seam down the back
  g.fill(6, by + 1, 6, by + 3, p.bodyL);
  g.fill(7, by, 8, by, p.skinS);                                   // collar
}

function legs(f: Frame): void {
  const { g, p, by, pose, step } = f;
  if (pose === "sit_type") { g.fill(5, by + 6, 10, by + 7, p.pants); return; }
  if (pose === "lean") {
    g.fill(5, by + 6, 10, by + 7, p.pants);
    g.fill(5, by + 7, 10, by + 7, p.pantsS);
    g.fill(4, by + 8, 6, by + 9, p.shoe); g.fill(9, by + 8, 11, by + 9, p.shoe);
    return;
  }
  g.fill(5, by + 6, 10, by + 6, p.pants);
  const lift = pose === "walk" ? [step === 0 ? 1 : 0, step === 1 ? 1 : 0] : [0, 0];
  const legX = [[5, 6], [9, 10]] as const;
  const shoeX = [[4, 6], [9, 11]] as const;
  for (let i = 0; i < 2; i++) {
    const l = lift[i]!;
    g.fill(legX[i]![0], by + 7, legX[i]![1], by + 9 - l, i === 0 ? p.pants : p.pantsS);
    g.fill(shoeX[i]![0], by + 10 - l, shoeX[i]![1], by + 11 - l, p.shoe);
  }
}

function arms(f: Frame): void {
  const { g, p, by, pose, step, facing } = f;
  const sleeve = (x: number, y0: number, y1: number): void => g.fill(x, y0, x, y1, p.body);
  switch (pose) {
    case "stand":
    case "walk": {
      const swing = pose === "walk" ? (step === 0 ? [-1, 1] : [1, -1]) : [0, 0];
      for (const [i, x] of [4, 11].entries()) {
        sleeve(x, by, by + 2);
        g.fill(x, by + 3, x, by + 3 + (swing[i]! > 0 ? 1 : 0), p.skin);
      }
      return;
    }
    case "sit_type": {
      const up = f.frame % 2;
      for (const [i, x] of [4, 11].entries()) {
        const lift = i === up ? 1 : 0;
        sleeve(x, by, by + 1);
        g.fill(i === 0 ? 3 : 12, by + 1 - lift, i === 0 ? 3 : 12, by + 2 - lift, p.body);
      }
      return;
    }
    case "raise_hand": {
      const side = facing > 0 ? 11 : 4;
      const other = facing > 0 ? 4 : 11;
      const out = facing > 0 ? 12 + f.spread : 3 - f.spread;
      sleeve(other, by, by + 2); g.set(other, by + 3, p.skin);
      g.fill(Math.min(side, out), by, Math.max(side, out), by, p.body);
      g.fill(out, by - 5, out, by, p.body);
      const wave = step === 0 ? 0 : facing;
      g.fill(out + wave, by - 7, out + wave, by - 6, p.skin);
      return;
    }
    case "cheer": {
      const pump = step;
      for (const [i, out] of [-1, 1].entries()) {
        const lift = i === pump ? 1 : 0;
        const sx = i === 0 ? 4 : 11;
        const o = f.spread * out;
        g.set(sx, by, p.body);
        if (o !== 0) g.fill(Math.min(sx, sx + out + o), by, Math.max(sx, sx + out + o), by, p.body);
        g.fill(sx + out + o, by - 3 - lift, sx + out + o, by - 1, p.body);
        g.fill(sx + 2 * out + o, by - 4 - lift, sx + 2 * out + o, by - 3 - lift, p.body);
        g.fill(sx + 2 * out + o, by - 6 - lift, sx + 2 * out + o, by - 5 - lift, p.skin);
      }
      return;
    }
    case "lean":
      for (const [i, x] of [3, 12].entries()) {
        g.set(i === 0 ? 4 : 11, by, p.body);
        g.fill(x, by - 3, x, by - 1, p.body);
        g.set(i === 0 ? 2 : 13, by - 4, p.body);
      }
      return;
  }
}

const GRID = { w: 26, h: 36, ox: 5, oy: 10 } as const;

export type BaseOpts = { costume?: Costume; back?: boolean };

/** Composes the character (outlined) into a grid; `jump` is how far the pose lifts it this frame. */
export function composeBase(look: Look, pose: Pose, frame: number, facing: 1 | -1, opts: BaseOpts = {}): { g: PixelGrid; jump: number } {
  const g = new PixelGrid(GRID.w, GRID.h, GRID.ox, GRID.oy);
  const fr = Math.max(0, Math.floor(frame));
  const c = opts.costume;
  const back = opts.back ?? pose === "sit_type";
  const hy = pose === "sit_type" || pose === "lean" ? 6 : 4;
  const f: Frame = { g, p: { ...palette(look), ...c?.pal }, hy, by: hy + 8, back, facing, pose, step: (fr >> 1) & 1, frame: fr, spread: c?.spread ?? 0 };
  c?.behind?.(f);
  if (look.accessory === "cape" && !back) drawAccessory(f, "cape");
  legs(f);
  torso(f);
  if (look.accessory === "cape" && back) drawAccessory(f, "cape");
  c?.body?.(f);
  if (pose !== "raise_hand" && pose !== "cheer") arms(f);
  const before = c?.keepHead === undefined ? null : [...g.px];
  head(f);
  drawHair(f, look.hairStyle);
  if (look.accessory !== null && look.accessory !== "cape") drawAccessory(f, look.accessory);
  if (before !== null) {
    for (let y = -GRID.oy; y < GRID.h - GRID.oy; y++) for (let x = -GRID.ox; x < GRID.w - GRID.ox; x++) {
      const i = (y + GRID.oy) * GRID.w + x + GRID.ox;
      if (g.px[i] !== before[i] && !c!.keepHead!(x, y, f)) g.px[i] = before[i]!;
    }
  }
  c?.head?.(f);
  if (look.hat !== null) drawHat({ ...f, hy: hy - (c?.hatLift ?? 0) }, look.hat);
  if (pose === "raise_hand" || pose === "cheer") arms(f);
  g.outline(OUTLINE);
  const jump = pose === "cheer" && f.step === 1 ? -2 : pose === "walk" && f.step === 1 ? -1 : 0;
  return { g, jump };
}

/** Draws the base character with its feet centre at `at`. `facing` 1 looks right. */
export function drawBase(ctx: Ctx, at: Point, look: Look, pose: Pose, frame: number, facing: 1 | -1, opts: BaseOpts = {}): void {
  const { g, jump } = composeBase(look, pose, frame, facing, opts);
  g.blit(ctx, at.x - SPRITE.w / 2, at.y - SPRITE.h + jump);
}

/** Draws the character turned a quarter (head toward `facing`), centred on `centre`: a swimmer seen from above and behind. */
export function drawBaseTurned(ctx: Ctx, centre: Point, look: Look, pose: Pose, frame: number, facing: 1 | -1, opts: BaseOpts = {}): void {
  const { g } = composeBase(look, pose, frame, facing, opts);
  const r = g.turned(facing > 0);
  // the sprite's middle, (SPRITE.w / 2, SPRITE.h / 2) local, after the quarter turn
  const mx = GRID.ox + SPRITE.w / 2, my = GRID.oy + SPRITE.h / 2;
  const [cx, cy] = facing > 0 ? [GRID.h - 1 - my, mx] : [my, GRID.w - 1 - mx];
  r.blit(ctx, Math.round(centre.x - cx), Math.round(centre.y - cy));
}
