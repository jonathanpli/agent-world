import { describe, expect, test } from "vitest";
import { CHAT_ICONS, CHAT_TURN_S, createSocial, eligibleForChat, socialSpotsOf, speaker, type Chat } from "../../src/client/engine/social";
import { THEMES } from "../../src/client/engine/theme";
import { mulberry32 } from "../../src/shared/rng";

const SPOTS = [{ x: 40, y: 200 }, { x: 80, y: 210 }, { x: 120, y: 205 }];
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `a${i}`);

/** Steps a social at 10 Hz from 0 to `until` s; `eligibleAt(t)` gives who may chat. Records each chat's start and end. */
function run(until: number, eligibleAt: (t: number) => string[], seed = 1) {
  const social = createSocial();
  const rng = mulberry32(seed);
  const log: { chat: Chat; start: number; end: number | null }[] = [];
  const open = new Map<Chat, { chat: Chat; start: number; end: number | null }>();
  for (let i = 0; i <= until * 10; i++) {
    const t = i / 10;
    social.step(t, eligibleAt(t), rng, SPOTS);
    const now = new Set(social.chats());
    for (const [c, rec] of open) if (!now.has(c)) { rec.end = t; open.delete(c); }
    for (const c of now) if (!open.has(c)) { const rec = { chat: c, start: t, end: null }; open.set(c, rec); log.push(rec); }
    expect(social.chats().length).toBeLessThanOrEqual(2);
    const busy = social.chats().flatMap(c => [c.a, c.b]);
    expect(new Set(busy).size).toBe(busy.length);              // an actor is in at most one chat
  }
  return { social, log };
}

describe("chats", () => {
  test("never more than two at once, and an actor is in at most one", () => {
    const { log } = run(600, () => ids(8));
    expect(log.length).toBeGreaterThan(4);
  });

  test("a chat needs two distinct eligible actors", () => {
    expect(run(300, () => []).log).toHaveLength(0);
    expect(run(300, () => ["solo"]).log).toHaveLength(0);
    const { log } = run(300, () => ["x", "y"]);
    expect(log.length).toBeGreaterThan(0);
    for (const { chat } of log) {
      expect(chat.a).not.toBe(chat.b);
      expect(["x", "y"]).toContain(chat.a);
      expect(["x", "y"]).toContain(chat.b);
      expect(SPOTS).toContainEqual(chat.spot);
      expect(chat.icons[0]).not.toBe(chat.icons[1]);
      for (const i of chat.icons) expect(i >= 0 && i < CHAT_ICONS.length).toBe(true);
    }
  });

  test("a chat lasts 6–10 s, and the next attempt comes 20–60 s later", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { log } = run(900, () => ["x", "y"], seed);
      expect(log.length).toBeGreaterThan(5);
      expect(log[0]!.start).toBeGreaterThanOrEqual(20);         // the first attempt too
      expect(log[0]!.start).toBeLessThanOrEqual(60.1);
      for (const [i, rec] of log.entries()) {
        if (rec.end === null) continue;
        const length = rec.end - rec.start;
        expect(length).toBeGreaterThanOrEqual(6);
        expect(length).toBeLessThanOrEqual(10.1);
        const next = log[i + 1];
        if (next === undefined) continue;
        const gap = next.start - rec.end;
        expect(gap).toBeGreaterThanOrEqual(20);
        expect(gap).toBeLessThanOrEqual(60.1);
      }
    }
  });

  test("removing an actor from eligible ends its chat on the next step", () => {
    const social = createSocial();
    const rng = mulberry32(9);
    let t = 0;
    while (social.chats().length === 0 && t < 120) { t += 0.1; social.step(t, ["x", "y", "z"], rng, SPOTS); }
    const chat = social.chats()[0]!;
    expect(chat).toBeDefined();
    const stay = ["x", "y", "z"].filter(id => id !== chat.a);
    social.step(t + 0.1, stay, rng, SPOTS);
    expect(social.chats().some(c => c.a === chat.a || c.b === chat.a)).toBe(false);
    expect(social.targetFor(chat.a)).toBeNull();
    expect(social.targetFor(chat.b)).toBeNull();               // its partner breaks off too
  });

  test("targetFor gives the two talkers different points near the spot", () => {
    const social = createSocial();
    const rng = mulberry32(4);
    let t = 0;
    while (social.chats().length === 0 && t < 120) { t += 0.1; social.step(t, ["x", "y"], rng, SPOTS); }
    const chat = social.chats()[0]!;
    const pa = social.targetFor(chat.a)!, pb = social.targetFor(chat.b)!;
    expect(pa).not.toEqual(pb);
    for (const p of [pa, pb]) expect(Math.hypot(p.x - chat.spot.x, p.y - chat.spot.y)).toBeLessThanOrEqual(12);
    expect(social.targetFor("nobody")).toBeNull();
  });

  test("with no social spots it does nothing", () => {
    const social = createSocial();
    const rng = mulberry32(1);
    for (let t = 0; t < 200; t += 0.5) social.step(t, ["x", "y"], rng, []);
    expect(social.chats()).toHaveLength(0);
  });
});

test("eligibleForChat truth table", () => {
  expect(eligibleForChat("working", false, false)).toBe(false);
  expect(eligibleForChat("needs_input", false, false)).toBe(false);
  expect(eligibleForChat("needs_input", true, false)).toBe(false);
  expect(eligibleForChat("done", true, false)).toBe(false);
  expect(eligibleForChat("idle", true, false)).toBe(false);
  expect(eligibleForChat("done", false, false)).toBe(true);
  expect(eligibleForChat("idle", false, false)).toBe(true);
  expect(eligibleForChat("off_duty", false, false)).toBe(true);
  for (const s of ["off_duty", "idle", "done"] as const) expect(eligibleForChat(s, false, true)).toBe(false);
});

test("reacting is true for 1.5 s, then false", () => {
  const social = createSocial();
  social.react(["x", "y"], 10);
  for (const t of [10, 10.5, 11.4, 11.49]) { expect(social.reacting("x", t)).toBe(true); expect(social.reacting("y", t)).toBe(true); }
  expect(social.reacting("x", 11.5)).toBe(false);
  expect(social.reacting("x", 13)).toBe(false);
  expect(social.reacting("z", 10.5)).toBe(false);
  social.react(["x"], 20);                                     // a new reaction restarts the clock
  expect(social.reacting("x", 21)).toBe(true);
});

test("the two talkers take turns with the bubble, each with its own icon", () => {
  const chat: Chat = { a: "x", b: "y", spot: { x: 0, y: 0 }, until: 100, icons: [2, 4] };
  expect(speaker(chat, 0)).toEqual({ id: "x", icon: 2 });
  expect(speaker(chat, CHAT_TURN_S + 0.01)).toEqual({ id: "y", icon: 4 });
  expect(speaker(chat, 2 * CHAT_TURN_S + 0.01)).toEqual({ id: "x", icon: 2 });
});

describe("socialSpotsOf", () => {
  const lounge = { x: 10, y: 20, w: 40, h: 30 };
  test("every built-in theme lists spots inside its lounge", () => {
    for (const theme of THEMES) {
      const spots = socialSpotsOf(theme);
      expect(spots.length).toBeGreaterThan(0);
      for (const p of spots) {
        expect(p.x >= theme.lounge.x && p.x <= theme.lounge.x + theme.lounge.w).toBe(true);
        expect(p.y >= theme.lounge.y && p.y <= theme.lounge.y + theme.lounge.h).toBe(true);
      }
    }
  });
  test("without spots (or with broken ones), the lounge centre", () => {
    expect(socialSpotsOf({ lounge })).toEqual([{ x: 30, y: 35 }]);
    expect(socialSpotsOf({ lounge, socialSpots: [] })).toEqual([{ x: 30, y: 35 }]);
    expect(socialSpotsOf({ lounge, socialSpots: [null as never, { x: NaN, y: 1 }] })).toEqual([{ x: 30, y: 35 }]);
  });
  test("a theme whose spots throw gives none, and never throws", () => {
    const bad = { lounge, get socialSpots(): never { throw new Error("boom"); } };
    expect(socialSpotsOf(bad)).toEqual([]);
  });
});
