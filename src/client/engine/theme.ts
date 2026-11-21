import type { CharState, Effort, Look, Tier } from "../../shared/types";
import { office } from "../themes/office";

export { VIEW } from "./view";

export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Place = { rect: Rect; spots: Point[] };   // exactly 6 spots
export type Pose = "stand" | "walk" | "sit_type" | "raise_hand" | "cheer" | "lean";
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
export type Ctx = CanvasRenderingContext2D;

export type Theme = {
  id: string; name: string; movement: "walk" | "float" | "swim";
  tierTitles: Record<Tier, string>;
  lounge: Rect;                                                            // on screen 0
  placeFor(indexOnScreen: number, countOnScreen: number): Place;           // countOnScreen is 1..6; coordinates within one VIEW
  drawBackdrop(ctx: Ctx, t: number, screenIndex: number): void;
  drawPlace(ctx: Ctx, place: Place, repoName: string, t: number): void;
  drawWorkSpot(ctx: Ctx, spot: Point, tier: Tier | null, state: CharState | null, t: number): void;   // null = empty spot
  /** `frame` counts animation frames since the character entered `state`. */
  drawCharacter(ctx: Ctx, at: Point, look: Look, tier: Tier, state: CharState, effort: Effort, frame: number, facing: 1 | -1, moving: boolean): void;
  effects: { celebrate(at: Point, rng: () => number): Particle[]; levelUp(at: Point, rng: () => number): Particle[] };
  drawAmbient?(ctx: Ctx, t: number): void;
};

export const THEMES: Theme[] = [office];

export function getTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? office;
}

const reported = new Set<string>();

/** Runs fn(theme); if it throws, logs once per theme id and runs fn(fallback) instead. Never throws. */
export function safeDraw(theme: Theme, fallback: Theme, fn: (t: Theme) => void): void {
  try {
    fn(theme);
    return;
  } catch (e) {
    if (!reported.has(theme.id)) { reported.add(theme.id); console.error(`agent-world: theme "${theme.id}" failed to draw`, e); }
  }
  if (fallback === theme) return;
  try { fn(fallback); } catch (e) {
    if (!reported.has(fallback.id)) { reported.add(fallback.id); console.error(`agent-world: theme "${fallback.id}" failed to draw`, e); }
  }
}
