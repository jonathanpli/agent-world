import { expect, test, vi } from "vitest";
import { actorAt, computeLayout, safeLayout, stepActors, syncActors, type Actor } from "../../src/client/engine/actors";
import { THEMES, VIEW, type Rect, type Theme } from "../../src/client/engine/theme";
import { applySnapshot, emptyState, type ClientState } from "../../src/client/state";
import { office } from "../../src/client/themes/office";
import { mulberry32 } from "../../src/shared/rng";
import type { Repo, Session } from "../../src/shared/types";
import { char, repo, session, snap } from "../helpers/clientFixtures";

const repos = (n: number): Repo[] => Array.from({ length: n }, (_, i) => repo(`r${i}`, i));
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: { x: number; y: number }, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function stateWith(sessions: Session[], characters = sessions.flatMap(s => (s.characterId ? [char(s.characterId)] : []))): ClientState {
  const s = emptyState();
  const repoIds = [...new Set(sessions.map(x => x.repoId))];
  applySnapshot(s, snap({ characters, repos: repoIds.map((id, i) => repo(id, i)), sessions }));
  return s;
}

for (const theme of THEMES) test(`${theme.id}: places never overlap and stay on their screen for 1..20 repos (Review Focus 5)`, () => {
  for (let n = 1; n <= 20; n++) {
    const L = computeLayout(theme, repos(n));
    expect(L.screens).toBe(Math.ceil(n / 6));
    expect(L.places.size).toBe(n);
    const entries = [...L.places.values()];
    for (const [i, a] of entries.entries()) {
      const r = a.place.rect;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(VIEW.w);
      expect(r.y + r.h).toBeLessThanOrEqual(VIEW.h);
      expect(a.place.spots).toHaveLength(6);
      for (const p of a.place.spots) expect(inside(p, r)).toBe(true);
      if (a.screen === 0) expect(intersects(r, theme.lounge)).toBe(false);
      for (const b of entries.slice(i + 1)) if (a.screen === b.screen) expect(intersects(r, b.place.rect)).toBe(false);
    }
    const perScreen = new Map<number, number>();
    for (const e of entries) perScreen.set(e.screen, (perScreen.get(e.screen) ?? 0) + 1);
    for (const count of perScreen.values()) expect(count).toBeLessThanOrEqual(6);
  }
});

test("each session gets its own spot; overflow stands in a row", () => {
  const sessions = Array.from({ length: 9 }, (_, i) => session(`k${i}`, `c${i}`, "r0", { startedAt: 100 - i }));
  const s = stateWith(sessions);
  const L = computeLayout(office, [...s.repos.values()]);
  const actors = new Map<string, Actor>();
  syncActors(actors, s, office, L, 0, mulberry32(1));
  expect(actors.size).toBe(9);
  const targets = [...actors.values()].map(a => `${a.target.x},${a.target.y}`);
  expect(new Set(targets).size).toBe(9);
  const place = L.places.get("r0")!.place;
  // rank by startedAt: c8 started first, so it takes spot 0
  for (let rank = 0; rank < 6; rank++) expect(actors.get(`c${8 - rank}`)!.target).toEqual(place.spots[rank]);
  const overflow = [2, 1, 0].map(i => actors.get(`c${i}`)!.target);
  for (const p of overflow) expect(p.y).toBe(place.rect.y + place.rect.h);
  expect(overflow[1]!.x - overflow[0]!.x).toBe(14);
  expect(overflow[2]!.x - overflow[1]!.x).toBe(14);
});

test("a place on a later screen is offset by whole screens", () => {
  const sessions = Array.from({ length: 7 }, (_, i) => session(`k${i}`, `c${i}`, `r${i}`));
  const s = stateWith(sessions);
  const L = computeLayout(office, [...s.repos.values()].sort((a, b) => a.createdAt - b.createdAt));
  const actors = new Map<string, Actor>();
  syncActors(actors, s, office, L, 0, mulberry32(1));
  const last = L.places.get("r6")!;
  expect(last.screen).toBe(1);
  expect(actors.get("c6")!.target).toEqual({ x: last.place.spots[0]!.x + VIEW.w, y: last.place.spots[0]!.y });
});

test("temps are keyed by session and removed when their session ends", () => {
  const s = stateWith([session("t1", null, "r0")]);
  const actors = new Map<string, Actor>();
  syncActors(actors, s, office, computeLayout(office, [...s.repos.values()]), 0, mulberry32(1));
  expect([...actors.keys()]).toEqual(["t1"]);
  s.sessions.delete("t1");
  syncActors(actors, s, office, computeLayout(office, []), 1, mulberry32(1));
  expect(actors.size).toBe(0);
});

test("off-duty characters head for the lounge; retired ones are removed", () => {
  const s = stateWith([session("k1", "busy", "r0")], [char("busy"), char("free"), char("gone", { retired: true })]);
  const actors = new Map<string, Actor>();
  const L = computeLayout(office, [...s.repos.values()]);
  syncActors(actors, s, office, L, 0, mulberry32(1));
  expect([...actors.keys()].sort()).toEqual(["busy", "free"]);
  const free = actors.get("free")!;
  const centre = { x: office.lounge.x + office.lounge.w / 2, y: office.lounge.y + office.lounge.h / 2 };
  expect(free.pos).toEqual(centre);                             // spawns at the lounge centre
  expect(inside(free.target, office.lounge)).toBe(true);
  expect(free.wanderAt).toBeGreaterThanOrEqual(4);
  expect(free.wanderAt).toBeLessThanOrEqual(10);
  const first = { ...free.target };
  syncActors(actors, s, office, L, 1, mulberry32(2));          // before wanderAt: keeps its target
  expect(free.target).toEqual(first);
  syncActors(actors, s, office, L, 11, mulberry32(3));         // after: re-picks, still in the lounge
  expect(free.target).not.toEqual(first);
  expect(inside(free.target, office.lounge)).toBe(true);
  expect(free.wanderAt).toBeGreaterThanOrEqual(15);
  // the session ends: "busy" goes off duty and heads for the lounge; retiring "free" removes it
  s.sessions.delete("k1");
  s.characters.set("free", char("free", { retired: true }));
  syncActors(actors, s, office, computeLayout(office, []), 12, mulberry32(4));
  expect([...actors.keys()]).toEqual(["busy"]);
  expect(inside(actors.get("busy")!.target, office.lounge)).toBe(true);
});

test("actors reach their target and stop", () => {
  for (const movement of ["walk", "float", "swim"] as const) {
    const a: Actor = { id: "a", pos: { x: 10, y: 10 }, target: { x: 400, y: 250 }, facing: -1, moving: false, wanderAt: 0 };
    const actors = new Map([["a", a]]);
    stepActors(actors, 0.016, movement, 0);
    expect(a.moving).toBe(true);
    expect(a.facing).toBe(1);
    for (let t = 0; t < 30; t += 0.016) stepActors(actors, 0.016, movement, t);
    expect(Math.hypot(a.pos.x - 400, a.pos.y - 250)).toBeLessThanOrEqual(1);
    expect(a.moving).toBe(false);
  }
});

test("walking speed is 40 px/s", () => {
  const a: Actor = { id: "a", pos: { x: 0, y: 0 }, target: { x: 200, y: 0 }, facing: 1, moving: false, wanderAt: 0 };
  stepActors(new Map([["a", a]]), 1, "walk", 0);
  expect(a.pos.x).toBeCloseTo(40);
});

test("actorAt hits the sprite box", () => {
  const a: Actor = { id: "a", pos: { x: 100, y: 100 }, target: { x: 100, y: 100 }, facing: 1, moving: false, wanderAt: 0 };
  const b: Actor = { id: "b", pos: { x: 104, y: 110 }, target: { x: 104, y: 110 }, facing: 1, moving: false, wanderAt: 0 };
  const actors = new Map([["a", a]]);
  expect(actorAt(actors, { x: 100, y: 90 })).toBe("a");
  expect(actorAt(actors, { x: 130, y: 90 })).toBeNull();
  expect(actorAt(actors, { x: 100, y: 101 })).toBeNull();
  actors.set("b", b);
  expect(actorAt(actors, { x: 102, y: 95 })).toBe("b");       // b is lower on screen, so drawn on top
});

test("safeLayout falls back when the theme's placeFor throws, and nothing escapes", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const broken: Theme = { ...office, id: "broken-layout", lounge: { x: -999, y: -999, w: 1, h: 1 }, placeFor: () => { throw new Error("boom"); } };
  const rs = repos(8);
  let result: ReturnType<typeof safeLayout> | undefined;
  expect(() => { result = safeLayout(broken, office, rs); }).not.toThrow();
  expect(result!.theme).toBe(office);
  expect(result!.layout).toEqual(computeLayout(office, rs));
  expect(errors).toHaveBeenCalledTimes(1);
  // off-duty actors use the fallback's lounge, not the broken theme's
  const s = stateWith([], [char("free")]);
  const actors = new Map<string, Actor>();
  syncActors(actors, s, result!.theme, result!.layout, 0, mulberry32(1));
  expect(inside(actors.get("free")!.target, office.lounge)).toBe(true);
  // the working theme is used as is
  expect(safeLayout(office, office, rs).theme).toBe(office);
  errors.mockRestore();
});

test("safeLayout survives both themes throwing with an empty one-screen layout", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const broken: Theme = { ...office, id: "broken-both", placeFor: () => { throw new Error("boom"); } };
  const r = safeLayout(broken, broken, repos(3));
  expect(r.layout.screens).toBe(1);
  expect(r.layout.places.size).toBe(0);
  errors.mockRestore();
});
