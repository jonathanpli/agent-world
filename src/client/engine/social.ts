import type { CharState } from "../../shared/types";
import type { Point, Theme } from "./theme";

/** Seconds between an actor's chat attempts, how long a chat lasts, the most at once, and how long a reaction plays. */
export const CHAT_EVERY_S: readonly [number, number] = [20, 60];
export const CHAT_LASTS_S: readonly [number, number] = [6, 10];
export const CHATS_MAX = 2;
export const REACTION_S = 1.5;
/** A pair that has not both arrived this long after the chat began is dropped, freeing its slot. */
export const CHAT_ARRIVE_S = 30;
/** Each talker stands this many px either side of the chat's spot; the talkers take turns of this many seconds. */
const CHAT_HALF_GAP = 7;
export const CHAT_TURN_S = 1.2;

/** 5x5 speech-bubble icons ("#" is ink): code brackets, coffee, bug, star, question mark. */
export const CHAT_ICONS: readonly (readonly string[])[] = [
  [".#.#.", "#...#", "#...#", "#...#", ".#.#."],
  ["####.", "#..##", "#..##", "####.", ".##.."],
  ["#.#.#", ".###.", "#####", ".###.", "#.#.#"],
  ["..#..", ".###.", "#####", ".#.#.", "#...#"],
  [".###.", "#...#", "..##.", ".....", "..#.."],
];

/**
 * Two actors talking at `spot` until `until` (engine seconds); `icons` index CHAT_ICONS, one per talker. The talking
 * time (`lasts` s) counts from when both have arrived: until then `until` is Infinity, and a pair still apart
 * CHAT_ARRIVE_S after `createdAt` is dropped.
 */
export type Chat = { a: string; b: string; spot: Point; until: number; icons: [number, number]; createdAt: number; lasts: number };
export type Social = {
  step(t: number, eligible: string[], rng: () => number, spots: Point[]): void;   // t in seconds
  chats(): readonly Chat[];
  targetFor(actorId: string): Point | null;       // where a chatting actor should stand; null = not chatting
  react(actorIds: string[], t: number): void;     // start a 1.5 s reaction
  reacting(actorId: string, t: number): boolean;
  /** Both talkers of `chat` stand at their points: the first call starts its talking time. */
  arrived(chat: Chat, t: number): void;
};

/** How a character reacts to a neighbour finishing: never while it needs you, a glance while working, else a cheer. */
export function reactionFor(state: CharState): "none" | "glance" | "cheer" {
  return state === "needs_input" ? "none" : state === "working" ? "glance" : "cheer";
}

/** Off duty, or idle/done without attention; never the selected character. */
export function eligibleForChat(state: CharState, attention: boolean, selected: boolean): boolean {
  if (selected) return false;
  return state === "off_duty" || ((state === "idle" || state === "done") && !attention);
}

/** Who holds the speech bubble at `t`, and its icon (an index into CHAT_ICONS): the two take turns. */
export function speaker(chat: Chat, t: number): { id: string; icon: number } {
  return Math.floor(t / CHAT_TURN_S) % 2 === 0 ? { id: chat.a, icon: chat.icons[0] } : { id: chat.b, icon: chat.icons[1] };
}

/** The theme's social spots (the valid ones), or the lounge centre without any. Never throws. */
export function socialSpotsOf(theme: Pick<Theme, "lounge" | "socialSpots">): Point[] {
  try {
    const listed = Array.isArray(theme.socialSpots) ? theme.socialSpots : [];
    const ok = listed.filter((p): p is Point => typeof p?.x === "number" && typeof p?.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (ok.length > 0) return ok;
    const l = theme.lounge;
    return [{ x: Math.round(l.x + l.w / 2), y: Math.round(l.y + l.h / 2) }];
  } catch {
    return [];
  }
}

/**
 * socialSpotsOf(theme), plus the extra spot of each owned upgrade that has one, keeping only finite points inside
 * the lounge (edges included). `owned` must be this theme's own ids (ownedFor). Never throws.
 */
export function socialSpotsWith(theme: Pick<Theme, "lounge" | "socialSpots" | "upgradeSocialSpots">, owned: ReadonlySet<string>): Point[] {
  const spots = socialSpotsOf(theme);
  try {
    const listed = theme.upgradeSocialSpots;
    if (listed === null || typeof listed !== "object") return spots;
    const l = theme.lounge;
    for (const id of owned) {
      if (!Object.hasOwn(listed, id)) continue;
      const p: unknown = listed[id];
      if (p === null || typeof p !== "object") continue;
      const { x, y } = p as { x: unknown; y: unknown };
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) spots.push({ x, y });
    }
    return spots;
  } catch {
    return socialSpotsOf(theme);
  }
}

const between =(range: readonly [number, number], rng: () => number): number => range[0] + rng() * (range[1] - range[0]);

export function createSocial(): Social {
  let chats: Chat[] = [];
  const nextTry = new Map<string, number>();     // by actor id: when it next tries to start a chat
  const reactions = new Map<string, number>();   // by actor id: when its reaction ends

  const inChat = (id: string): Chat | undefined => chats.find(c => c.a === id || c.b === id);

  return {
    step(t, eligible, rng, spots) {
      const ok = new Set(eligible);
      // a chat ends when it runs out or either talker stops being eligible; both then wait for their next attempt
      chats = chats.filter(c => {
        const waiting = c.until === Infinity && t - c.createdAt >= CHAT_ARRIVE_S;
        if (t < c.until && !waiting && ok.has(c.a) && ok.has(c.b)) return true;
        for (const id of [c.a, c.b]) if (ok.has(id)) nextTry.set(id, t + between(CHAT_EVERY_S, rng));
        return false;
      });
      for (const id of nextTry.keys()) if (!ok.has(id)) nextTry.delete(id);
      for (const id of eligible) {
        if (inChat(id) !== undefined) continue;
        const at = nextTry.get(id);
        if (at === undefined) { nextTry.set(id, t + between(CHAT_EVERY_S, rng)); continue; }
        if (t < at) continue;
        const free = eligible.filter(o => o !== id && inChat(o) === undefined);
        if (chats.length >= CHATS_MAX || free.length === 0 || spots.length === 0) {
          nextTry.set(id, t + between(CHAT_EVERY_S, rng));
          continue;
        }
        const partner = free[Math.floor(rng() * free.length)]!;
        const open = spots.filter(s => !chats.some(c => c.spot.x === s.x && c.spot.y === s.y));
        const pool = open.length > 0 ? open : spots;
        const spot = pool[Math.floor(rng() * pool.length)]!;
        const first = Math.floor(rng() * CHAT_ICONS.length);
        const second = (first + 1 + Math.floor(rng() * (CHAT_ICONS.length - 1))) % CHAT_ICONS.length;
        chats.push({ a: id, b: partner, spot, until: Infinity, createdAt: t, lasts: between(CHAT_LASTS_S, rng), icons: [first, second] });
      }
    },
    chats: () => chats,
    targetFor(actorId) {
      const c = inChat(actorId);
      if (c === undefined) return null;
      const dx = c.a === actorId ? -CHAT_HALF_GAP : CHAT_HALF_GAP;
      return { x: Math.round(c.spot.x + dx), y: Math.round(c.spot.y) };
    },
    arrived(chat, t) {
      if (chat.until === Infinity && chats.includes(chat)) chat.until = t + chat.lasts;
    },
    react(actorIds, t) {
      for (const id of actorIds) reactions.set(id, t + REACTION_S);
    },
    reacting(actorId, t) {
      const until = reactions.get(actorId);
      if (until === undefined) return false;
      if (t < until) return true;
      reactions.delete(actorId);
      return false;
    },
  };
}
