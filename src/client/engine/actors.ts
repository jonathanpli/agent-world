import { CONFIG } from "../../shared/config";
import type { Repo, Session } from "../../shared/types";
import type { ClientState } from "../state";
import { SPRITE } from "./sprite";
import type { Place, Point, Rect, Theme } from "./theme";
import { VIEW } from "./view";

export type Actor = {
  id: string;                        // characterId, or session key for temps
  pos: Point; target: Point; facing: 1 | -1; moving: boolean;
  wanderAt: number;                  // when an off-duty actor picks its next lounge target (seconds, engine time)
};
export type Layout = { screens: number; places: Map<string, { screen: number; place: Place }> };   // places by repoId

const PER_SCREEN = 6;

/** Six repos per screen, in the given order; screen n's places are later drawn offset by n * VIEW.w. */
export function computeLayout(theme: Theme, repos: Repo[]): Layout {
  const places = new Map<string, { screen: number; place: Place }>();
  repos.forEach((r, i) => {
    const screen = Math.floor(i / PER_SCREEN);
    const count = Math.min(PER_SCREEN, repos.length - screen * PER_SCREEN);
    places.set(r.id, { screen, place: theme.placeFor(i % PER_SCREEN, count) });
  });
  return { screens: Math.max(1, Math.ceil(repos.length / PER_SCREEN)), places };
}

const inRect = (p: Point, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function loungePoint(lounge: Rect, rng: () => number): Point {
  return { x: Math.round(lounge.x + rng() * lounge.w), y: Math.round(lounge.y + rng() * lounge.h) };
}

function wanderDelay(rng: () => number): number {
  const [lo, hi] = CONFIG.client.wanderS;
  return lo + rng() * (hi - lo);
}

/** Each repo's sessions in rank order (by startedAt, then key): rank i works at spot i. */
export function sessionsByRepo(state: ClientState): Map<string, Session[]> {
  const byRepo = new Map<string, Session[]>();
  for (const s of state.sessions.values()) {
    const list = byRepo.get(s.repoId) ?? [];
    list.push(s);
    byRepo.set(s.repoId, list);
  }
  for (const list of byRepo.values()) list.sort((a, b) => a.startedAt - b.startedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return byRepo;
}

/** Where a session's actor works: its spot by rank in the repo, or a row along the place's bottom edge past six. */
function sessionTargets(state: ClientState, layout: Layout): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [repoId, list] of sessionsByRepo(state)) {
    const where = layout.places.get(repoId);
    if (where === undefined) continue;
    const { place, screen } = where;
    const dx = screen * VIEW.w;
    list.forEach((s, rank) => {
      const spot = place.spots[rank];
      const p = spot !== undefined
        ? spot
        : { x: place.rect.x + CONFIG.client.overflowSpacing / 2 + (rank - place.spots.length) * CONFIG.client.overflowSpacing, y: place.rect.y + place.rect.h };
      out.set(s.characterId ?? s.key, { x: p.x + dx, y: p.y });
    });
  }
  return out;
}

/** Brings the actor set in line with the state: one actor per live session and per non-retired character. */
export function syncActors(actors: Map<string, Actor>, state: ClientState, theme: Theme, layout: Layout, t: number, rng: () => number): void {
  const working = sessionTargets(state, layout);
  const live = new Set<string>();
  const spawn = (id: string): Actor => {
    let a = actors.get(id);
    if (a === undefined) {
      a = { id, pos: centre(theme.lounge), target: centre(theme.lounge), facing: 1, moving: false, wanderAt: -Infinity };
      actors.set(id, a);
    }
    live.add(id);
    return a;
  };
  for (const [id, target] of working) {
    const c = state.characters.get(id);
    if (c?.retired === true) continue;
    spawn(id).target = target;
  }
  for (const c of state.characters.values()) {
    if (c.retired || working.has(c.id)) continue;
    const a = spawn(c.id);
    if (t >= a.wanderAt || !inRect(a.target, theme.lounge)) {
      a.target = loungePoint(theme.lounge, rng);
      a.wanderAt = t + wanderDelay(rng);
    }
  }
  for (const id of actors.keys()) if (!live.has(id)) actors.delete(id);
}

/** Moves every actor toward its target at the theme's locomotion speed. `t` is engine time in seconds. */
export function stepActors(actors: Map<string, Actor>, dtSeconds: number, movement: Theme["movement"], _t: number): void {
  const step = CONFIG.client.speed[movement] * dtSeconds;
  for (const a of actors.values()) {
    const dx = a.target.x - a.pos.x, dy = a.target.y - a.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= Math.max(step, CONFIG.client.arrivePx)) {
      a.pos = { ...a.target };
      a.moving = false;
      continue;
    }
    a.pos = { x: a.pos.x + (dx / dist) * step, y: a.pos.y + (dy / dist) * step };
    if (Math.abs(dx) > CONFIG.client.arrivePx / 2) a.facing = dx > 0 ? 1 : -1;
    a.moving = true;
  }
}

/** The topmost actor (lowest on screen, so drawn last) whose sprite box contains `p`. */
export function actorAt(actors: Map<string, Actor>, p: Point): string | null {
  let best: Actor | null = null;
  for (const a of actors.values()) {
    const inside = p.x >= a.pos.x - SPRITE.w / 2 && p.x < a.pos.x + SPRITE.w / 2 && p.y >= a.pos.y - SPRITE.h && p.y <= a.pos.y;
    if (inside && (best === null || a.pos.y >= best.pos.y)) best = a;
  }
  return best?.id ?? null;
}
