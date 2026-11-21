import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Delta, EventKind } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ARRIVAL_NAME } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;

/** An event that carries no tier, like a real Claude Code SessionStart or UserPromptSubmit. */
function bare(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  const e = ev(kind, over);
  if (!("tier" in over)) delete e.tier;
  return e;
}

const characterDeltas = (ds: Delta[]) => ds.flatMap(d => (d.type === "character" ? [d.character] : []));
const noticesOf = (ds: Delta[], kind: string) => ds.flatMap(d => (d.type === "notice" && d.notice.kind === kind ? [d.notice] : []));

test("(a) session_start and prompt with no tier: no character, session unbound, unknown, XP held", () => {
  const w = newWorld();
  const ds = [...w.apply(bare("session_start", { at: 1000 })), ...w.apply(bare("prompt", { at: 2000, detail: { text: "hi" } }))];
  expect(characterDeltas(ds)).toEqual([]);
  expect(chars(w)).toEqual([]);
  const [s] = sess(w);
  expect(s).toMatchObject({ characterId: null, tierKnown: false, pendingXp: CONFIG.xp.prompt, pendingStats: { tasks: 0, tools: 0 }, state: "working" });
  expect(s!.tempLook).not.toBeNull();
});

test("(b) the first tier binds one character of that tier and credits the held XP and stats", () => {
  const w = newWorld();
  const ds = [
    ...w.apply(bare("session_start", { at: 1000 })),
    ...w.apply(bare("prompt", { at: 2000 })),
    ...w.apply(bare("tool", { at: 4000, tier: 3, model: "claude-opus-5-5" })),
  ];
  const all = characterDeltas(ds);
  expect(new Set(all.map(c => c.id)).size).toBe(1);
  expect(all.every(c => c.tier === 3)).toBe(true);      // no tier-2 character was ever created
  expect(chars(w)).toHaveLength(1);
  const [c] = chars(w); const [s] = sess(w);
  expect(c).toMatchObject({ tier: 3, xp: CONFIG.xp.prompt + CONFIG.xp.tool, stats: { tasks: 0, tools: 1 } });
  expect(c!.repoXp[s!.repoId]).toBe(CONFIG.xp.prompt + CONFIG.xp.tool);
  expect(s).toMatchObject({ characterId: c!.id, tier: 3, tierKnown: true, pendingXp: 0, pendingStats: { tasks: 0, tools: 0 }, tempLook: null });
});

test("(c) an event after the grace period binds at the default tier and credits", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  w.apply(bare("tool", { at: 2000 + CONFIG.modelGraceMs }));             // exactly at the limit: still waiting
  expect(chars(w)).toEqual([]);
  expect(sess(w)[0]).toMatchObject({ tierKnown: false, pendingXp: CONFIG.xp.prompt + CONFIG.xp.tool });
  const ds = w.apply(bare("tool", { at: 2001 + CONFIG.modelGraceMs }));
  expect(characterDeltas(ds).every(c => c.tier === CONFIG.defaultTier)).toBe(true);
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt + 2 * CONFIG.xp.tool, stats: { tasks: 0, tools: 2 } });
  expect(sess(w)[0]).toMatchObject({ tierKnown: true, tier: CONFIG.defaultTier, characterId: chars(w)[0]!.id, pendingXp: 0 });
});

test("(d) a session that ends while unknown is bound at the default tier, credited, then ended", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  const ds = w.apply(bare("session_end", { at: 3000 }));
  const ci = ds.findIndex(d => d.type === "character");
  const ri = ds.findIndex(d => d.type === "session_removed");
  expect(ci).toBeGreaterThanOrEqual(0);
  expect(ri).toBeGreaterThan(ci);
  expect(characterDeltas(ds).at(-1)).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt });
  expect(sess(w)).toEqual([]);
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]!.xp).toBe(CONFIG.xp.prompt);
});

test("a session that goes stale while unknown is bound, credited, then removed", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  const ds = w.tick(2000 + CONFIG.sessionStaleMs);
  expect(ds.findIndex(d => d.type === "session_removed")).toBeGreaterThan(ds.findIndex(d => d.type === "character"));
  expect(sess(w)).toEqual([]);
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt });
});

test("(e) level-ups and achievements fire at credit time when held XP crosses a threshold", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 0 }));
  const held: Delta[] = [];
  for (let i = 1; i <= 7; i++) held.push(...w.apply(bare("task_done", { at: 1000 * i })));   // 175 xp >= 152, inside the grace period
  expect(noticesOf(held, "level_up")).toEqual([]);
  expect(noticesOf(held, "achievement")).toEqual([]);
  expect(sess(w)[0]).toMatchObject({ tierKnown: false, pendingXp: 7 * CONFIG.xp.taskDone, pendingStats: { tasks: 7, tools: 0 } });
  const ds = w.apply(bare("tool", { at: 9000, tier: 1 }));
  const [c] = chars(w);
  expect(c).toMatchObject({ tier: 1, xp: 7 * CONFIG.xp.taskDone + CONFIG.xp.tool, stats: { tasks: 7, tools: 1 } });
  expect(noticesOf(ds, "level_up").map(n => n.text)).toEqual([`${c!.name} reached level 2`]);
  expect(noticesOf(ds, "achievement").map(n => n.text)).toEqual([`${c!.name} earned First Task`]);
  expect(c!.achievements.first_task).toBe(9000);
  expect(characterDeltas(ds).at(-1)).toEqual(c);
});

test("held XP is dropped when the session binds to a temp (roster full)", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start", { sessionId: "full", tier: 2 }));
  const before = chars(w)[0]!;
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("prompt", { at: 2000 }));
  w.apply(bare("tool", { at: 3000, tier: 2 }));
  expect(chars(w)).toEqual([before]);
  expect(sess(w).find(s => s.sessionId === "s1")).toMatchObject({ characterId: null, tierKnown: true, pendingXp: 0, pendingStats: { tasks: 0, tools: 0 } });
});

test("notices for an unknown session name it as a new arrival", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  const [n] = noticesOf(w.apply(bare("needs_input", { at: 2000 })), "needs_input");
  expect(n).toMatchObject({ characterId: null, characterName: ARRIVAL_NAME, text: `${ARRIVAL_NAME} needs you in a` });
  expect(sess(w)[0]).toMatchObject({ state: "needs_input", attention: true, tierKnown: false });
});

test("(f) a tier on the first event binds at once with nothing held", () => {
  const w = newWorld();
  const first = w.apply(ev("session_start", { at: 1000, tier: 3 }));
  expect(new Set(characterDeltas(first).map(c => c.id)).size).toBe(1);
  expect(sess(w)[0]).toMatchObject({ tierKnown: true, pendingXp: 0, characterId: chars(w)[0]!.id });
  const d = w.apply(ev("prompt", { at: 2000, tier: 3 }));
  expect(characterDeltas(d).map(c => c.xp)).toEqual([CONFIG.xp.prompt]);
  expect(sess(w)[0]!.pendingXp).toBe(0);
});

test("a later tier change still hands over, with nothing held", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 1000 }));
  w.apply(bare("tool", { at: 2000, tier: 2 }));
  const first = sess(w)[0]!.characterId;
  w.apply(bare("model_change", { at: 3000, tier: 3 }));
  expect(chars(w)).toHaveLength(2);
  expect(sess(w)[0]!.characterId).not.toBe(first);
  expect(chars(w).find(c => c.id === first)!.xp).toBe(CONFIG.xp.tool);
});

test("fix 1 (1): a first prompt long after session_start does not end the wait; its first tier binds one character", () => {
  const w = newWorld();
  const ds = [
    ...w.apply(bare("session_start", { at: 0 })),
    ...w.apply(bare("prompt", { at: 20_000 })),            // the terminal sat open for 20 s
  ];
  expect(characterDeltas(ds)).toEqual([]);
  expect(chars(w)).toEqual([]);
  expect(sess(w)[0]).toMatchObject({ tierKnown: false, graceSince: 20_000, pendingXp: CONFIG.xp.prompt });
  ds.push(...w.apply(bare("tool", { at: 23_000, tier: 3 })));
  expect(new Set(characterDeltas(ds).map(c => c.id)).size).toBe(1);
  expect(characterDeltas(ds).every(c => c.tier === 3)).toBe(true);
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: 3, xp: CONFIG.xp.prompt + CONFIG.xp.tool });
});

test("fix 1 (2): an untiered event more than the grace period after the first prompt binds at the default tier", () => {
  const w = newWorld();
  w.apply(bare("prompt", { at: 5_000 }));
  w.apply(bare("needs_input", { at: 5_000 + CONFIG.modelGraceMs }));   // not strictly after: still waiting
  expect(chars(w)).toEqual([]);
  w.apply(bare("tool", { at: 21_000 }));
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt + CONFIG.xp.tool });
  expect(sess(w)[0]).toMatchObject({ tierKnown: true, tier: CONFIG.defaultTier });
});

test("fix 1 (2b): a second prompt after the grace period binds; the first prompt sets the clock only once", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 0 }));
  w.apply(bare("prompt", { at: 1_000 }));
  w.apply(bare("prompt", { at: 1_001 + CONFIG.modelGraceMs }));
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]!.xp).toBe(2 * CONFIG.xp.prompt);
});

test("fix 1 (3): before any prompt there is no grace expiry", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 0 }));
  w.apply(bare("needs_input", { at: 60_000 }));
  expect(chars(w)).toEqual([]);
  expect(sess(w)[0]).toMatchObject({ tierKnown: false, graceSince: null, characterId: null, state: "needs_input" });
});

test("fix 1 (4): a session first seen mid-way starts the grace clock at its first event", () => {
  const w = newWorld();
  w.apply(bare("tool", { at: 0 }));
  expect(sess(w)[0]).toMatchObject({ tierKnown: false, graceSince: 0 });
  w.apply(bare("tool", { at: 16_000 }));
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: 2 * CONFIG.xp.tool, stats: { tasks: 0, tools: 2 } });
});

test("fix 1: an arrival that ends having earned nothing is removed without a character", () => {
  const w = newWorld();
  w.apply(bare("session_start", { at: 0 }));
  const ds = w.apply(bare("session_end", { at: 3_000 }));
  expect(ds).toEqual([{ type: "session_removed", key: "t:s1" }]);
  expect(chars(w)).toEqual([]);
  w.apply(bare("session_start", { sessionId: "s2", at: 0 }));
  w.apply(bare("needs_input", { sessionId: "s2", at: 1_000 }));
  const stale = w.tick(1_000 + CONFIG.sessionStaleMs);
  expect(stale).toEqual([{ type: "session_removed", key: "t:s2" }]);
  expect(chars(w)).toEqual([]);
  expect(sess(w)).toEqual([]);
});
