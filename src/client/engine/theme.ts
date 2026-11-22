import type { CharState, Effort, Look, Tier, ToolKind } from "../../shared/types";
import { office } from "../themes/office";
import { space } from "../themes/space";
import { underwater } from "../themes/underwater";

export { VIEW } from "./view";

export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Place = { rect: Rect; spots: Point[] };   // exactly 6 spots
export type Pose = "stand" | "walk" | "sit_type" | "raise_hand" | "cheer" | "lean";
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; gravity?: number };
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
  // Optional extras; the engine draws its own plain DEFAULTS (engine/extras.ts) for any a theme leaves out.
  // `frame` counts animation frames since that thing started, as for drawCharacter.
  /** The main agent's tool action at its work spot (a sidekick's own tool only makes it busy); `failed` for a failed tool. */
  drawAction?(ctx: Ctx, spot: Point, kind: ToolKind, failed: boolean, frame: number): void;
  /** One sidekick standing at `at`; `busy` while one of its own tools plays. */
  drawSidekick?(ctx: Ctx, at: Point, frame: number, busy: boolean, t: number): void;
  /** The context gauge at a work spot: fill step 0..3 (quarters), `hot` at or above the owner's warn threshold. */
  drawContextGauge?(ctx: Ctx, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void;
  /** The short moment after a compaction, at the work spot. */
  drawCompaction?(ctx: Ctx, spot: Point, frame: number): void;
  /** Where idle characters meet to chat, inside `lounge`; without them, the lounge centre. */
  socialSpots?: Point[];
  /** This world's owned shop upgrades (ids from ownedFor), drawn on each visible screen after the backdrop and before the places. */
  drawUpgrades?(ctx: Ctx, owned: ReadonlySet<string>, t: number, screenIndex: number): void;
  /** Upgrade id → an extra social spot, inside `lounge`, while that upgrade is owned. */
  upgradeSocialSpots?: Record<string, Point>;
};

/** The owned upgrade ids that belong to theme `themeId` (ids are `${theme}.${slug}`). Never throws. */
export function ownedFor(themeId: string, owned: string[]): ReadonlySet<string> {
  const prefix = `${themeId}.`;
  return new Set(Array.isArray(owned) ? owned.filter(id => typeof id === "string" && id.startsWith(prefix)) : []);
}

export const THEMES: Theme[] = [office, space, underwater];

export function getTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? office;
}

const reported = new Set<string>();

function attempt(t: Theme, fn: (t: Theme) => void, ctx: Ctx | undefined): boolean {
  ctx?.save();
  try {
    fn(t);
    return true;
  } catch (e) {
    if (!reported.has(t.id)) { reported.add(t.id); console.error(`agent-world: theme "${t.id}" failed to draw`, e); }
    return false;
  } finally {
    ctx?.restore();
  }
}

/**
 * Runs fn(theme); if it throws, logs once per theme id and runs fn(fallback) instead. Never throws.
 * With `ctx`, each attempt runs between save() and restore(), so a throw mid-draw cannot leak canvas state.
 */
export function safeDraw(theme: Theme, fallback: Theme, fn: (t: Theme) => void, ctx?: Ctx): void {
  if (attempt(theme, fn, ctx) || fallback === theme) return;
  attempt(fallback, fn, ctx);
}
