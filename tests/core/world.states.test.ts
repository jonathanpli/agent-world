import { test, expect } from "vitest";
import { CONFIG } from "../../src/shared/config";
import type { Delta, Look } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const sess = (w: World) => w.snapshot(0, false).sessions;
const chars = (w: World) => w.snapshot(0, false).characters;
const repos = (w: World) => w.snapshot(0, false).repos;

test("session_start creates a tier-matched character and an idle session", () => {
  const w = newWorld(); w.apply(ev("session_start", { tier: 3, model: "claude-opus-5-5" }));
  expect(chars(w)).toHaveLength(1); expect(chars(w)[0].tier).toBe(3);
  expect(sess(w)[0]).toMatchObject({ key: "t:s1", state: "idle", tier: 3, characterId: chars(w)[0].id, attention: false });
});

test("state machine", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  w.apply(ev("prompt", { detail: { text: "fix it" } })); expect(sess(w)[0]).toMatchObject({ state: "working", task: "fix it" });
  w.apply(ev("needs_input")); expect(sess(w)[0]).toMatchObject({ state: "needs_input", attention: true });
  w.apply(ev("tool")); expect(sess(w)[0]).toMatchObject({ state: "working", attention: false });
  w.apply(ev("task_done", { at: 2000 })); expect(sess(w)[0]).toMatchObject({ state: "done", attention: true });
  w.tick(2000 + 299_999); expect(sess(w)[0].state).toBe("done");
  w.tick(2000 + 300_000); expect(sess(w)[0]).toMatchObject({ state: "idle", attention: true });
  w.ack("t:s1"); expect(sess(w)[0].attention).toBe(false);
});

test("a waiting session is not timed out before 12 hours", () => {
  const w = newWorld(); w.apply(ev("needs_input", { at: 0 }));
  w.tick(43_199_999); expect(sess(w)).toHaveLength(1);
  expect(w.tick(43_200_000)).toContainEqual({ type: "session_removed", key: "t:s1" }); expect(sess(w)).toHaveLength(0);
});

test("second session reuses the freed character; same repo history wins", () => {
  const w = newWorld();
  w.apply(ev("session_start")); const first = sess(w)[0].characterId;
  w.apply(ev("session_end"));
  w.apply(ev("session_start", { sessionId: "s2" }));
  expect(sess(w)).toHaveLength(1);
  expect(sess(w)[0]).toMatchObject({ sessionId: "s2", characterId: first });
  expect(chars(w)).toHaveLength(1);
});

test("concurrent sessions get different characters", () => {
  const w = newWorld();
  w.apply(ev("session_start")); w.apply(ev("session_start", { sessionId: "s2" }));
  expect(chars(w)).toHaveLength(2);
  const [a, b] = sess(w);
  expect(a.characterId).not.toBeNull(); expect(b.characterId).not.toBeNull();
  expect(a.characterId).not.toBe(b.characterId);
});

test("tier change hands the session over", () => {
  const w = newWorld(); w.apply(ev("session_start", { tier: 2 })); const first = sess(w)[0].characterId;
  w.apply(ev("model_change", { tier: 3, model: "claude-opus-5-5" }));
  expect(sess(w)[0].characterId).not.toBe(first); expect(sess(w)[0].tier).toBe(3);
  expect(sess(w)[0].model).toBe("claude-opus-5-5");
  expect(chars(w).find(c => c.id === sess(w)[0].characterId)!.tier).toBe(3);
  w.apply(ev("session_start", { sessionId: "s2", tier: 2 })); expect(sess(w).find(s => s.sessionId === "s2")!.characterId).toBe(first);
});

test("roster cap produces temps", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  w.apply(ev("session_start")); w.apply(ev("session_start", { sessionId: "s2" }));
  const s2 = sess(w).find(s => s.sessionId === "s2")!;
  expect(s2.characterId).toBeNull(); expect(s2.tempLook).not.toBeNull(); expect(chars(w)).toHaveLength(1);
});

test("unknown and ended sessions (Review Focus 3)", () => {
  const w = newWorld();
  expect(w.apply(ev("session_end", { sessionId: "ghost" }))).toEqual([]); expect(sess(w)).toHaveLength(0);
  w.apply(ev("session_start")); w.apply(ev("session_end"));
  w.apply(ev("tool")); expect(sess(w)).toHaveLength(1); expect(sess(w)[0].state).toBe("working");   // revived via normal assignment
  expect(chars(w)).toHaveLength(1);
});

test("repo follows the event", () => {
  const w = newWorld();
  w.apply(ev("tool")); w.apply(ev("tool", { repoPath: "/r/b" }));
  expect(repos(w)).toHaveLength(2);
  const b = repos(w).find(r => r.path === "/r/b")!;
  expect(b.name).toBe("b");
  expect(sess(w)[0].repoId).toBe(b.id);
});

test("activity keeps the last 20 lines", () => {
  const w = newWorld();
  for (let i = 1; i <= 25; i++) w.apply(ev("tool", { at: 1000 + i, detail: { summary: `step ${i}` } }));
  const activity = sess(w)[0].activity;
  expect(activity).toHaveLength(20);
  expect(activity[0].text).toBe("step 6");
  expect(activity[19]).toEqual({ at: 1025, kind: "tool", text: "step 25" });
});

test("notices are throttled per session and kind", () => {
  const w = newWorld(); const n = (d: Delta[]) => d.filter(x => x.type === "notice" && (x.notice.kind === "needs_input" || x.notice.kind === "done")).length;   // ignore xp-driven level_up/achievement notices
  expect(n(w.apply(ev("needs_input", { at: 0 })))).toBe(1);
  expect(n(w.apply(ev("needs_input", { at: 9_999 })))).toBe(0);
  expect(n(w.apply(ev("task_done", { at: 9_999 })))).toBe(1);     // different kind
  expect(n(w.apply(ev("needs_input", { at: 10_000 })))).toBe(1);
});

test("notice text names the character and repo", () => {
  const w = newWorld();
  const d = w.apply(ev("needs_input", { at: 0 }));
  const name = chars(w)[0].name;
  expect(d).toContainEqual({ type: "notice", notice: expect.objectContaining({ kind: "needs_input", sessionKey: "t:s1", characterName: name, repoName: "a", text: `${name} needs you in a` }) });
  const done = w.apply(ev("task_done", { at: 0 }));
  expect(done).toContainEqual({ type: "notice", notice: expect.objectContaining({ kind: "done", text: `${name} finished a task in a` }) });
});

test("updateCharacter validates", () => {
  const w = newWorld();
  w.apply(ev("session_start")); const id = chars(w)[0].id;
  const d = w.updateCharacter(id, { name: "  Ada  " });
  expect(chars(w)[0].name).toBe("Ada");
  expect(d).toEqual([{ type: "character", character: chars(w)[0] }]);
  expect(() => w.updateCharacter(id, { name: "" })).toThrow(Error);
  expect(() => w.updateCharacter(id, { name: "x".repeat(25) })).toThrow(Error);
  const locked: Look = { ...chars(w)[0].look, hat: "cap" };
  expect(() => w.updateCharacter(id, { look: locked })).toThrow(Error);
  expect(chars(w)[0].look.hat).toBeNull();
  w.apply(ev("session_end"));
  w.updateCharacter(id, { retired: true });
  w.apply(ev("session_start", { sessionId: "s2" }));
  expect(chars(w)).toHaveLength(2);
  expect(sess(w)[0].characterId).not.toBe(id);
});

test("updateSettings validates", () => {
  const w = newWorld();
  expect(() => w.updateSettings({ rosterCap: 0 })).toThrow(Error);
  expect(() => w.updateSettings({ rosterCap: 51 })).toThrow(Error);
  expect(() => w.updateSettings({ rosterCap: 1.5 })).toThrow(Error);
  expect(() => w.updateSettings({ theme: "" })).toThrow(Error);
  expect(() => w.updateSettings({ sound: "yes" as unknown as boolean })).toThrow(Error);
  expect(w.snapshot(0, false).settings).toEqual(CONFIG.defaultSettings);
  const d = w.updateSettings({ rosterCap: 50, theme: "space", sound: true });
  expect(d).toEqual([{ type: "settings", settings: { ...CONFIG.defaultSettings, rosterCap: 50, theme: "space", sound: true } }]);
  expect(w.snapshot(0, false).settings).toEqual(d[0].type === "settings" ? d[0].settings : null);
});
