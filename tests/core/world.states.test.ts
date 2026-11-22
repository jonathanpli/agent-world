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
  w.apply(ev("tool", { at: 9_999 }));                               // back at work, so needs_input asks again
  expect(n(w.apply(ev("needs_input", { at: 10_000 })))).toBe(1);
});

test("notice text names the character and repo", () => {
  const w = newWorld();
  const d = w.apply(ev("needs_input", { at: 0, tier: 2 }));
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

test("retiring a character with a live session hands the session to a free tier-matched character", () => {
  const w = newWorld();
  w.apply(ev("session_start", { tier: 3 }));
  w.apply(ev("session_start", { sessionId: "s2", tier: 3 }));
  w.apply(ev("session_end", { sessionId: "s2" }));          // the second character is now free
  const [a, b] = chars(w);
  const bound = sess(w)[0]!.characterId;
  const free = bound === a.id ? b : a;
  const xpBefore = chars(w).map(c => [c.id, c.xp]);
  const d = w.updateCharacter(bound!, { retired: true });
  const s = sess(w)[0]!;
  expect(s.characterId).toBe(free.id);
  expect(sess(w).some(x => x.characterId === bound)).toBe(false);
  expect(d).toContainEqual({ type: "character", character: expect.objectContaining({ id: bound, retired: true }) });
  expect(d).toContainEqual({ type: "session", session: s });
  expect(chars(w).map(c => [c.id, c.xp])).toEqual(xpBefore);   // no XP moves
});

test("retiring with a live session and no free character creates a new one under the cap", () => {
  const w = newWorld();
  w.apply(ev("session_start", { tier: 2 }));
  const first = chars(w)[0].id;
  const d = w.updateCharacter(first, { retired: true });
  const s = sess(w)[0]!;
  expect(s.characterId).not.toBeNull();
  expect(s.characterId).not.toBe(first);
  const made = chars(w).find(c => c.id === s.characterId)!;
  expect(made).toMatchObject({ tier: 2, retired: false, xp: 0 });
  expect(d).toContainEqual({ type: "character", character: made });
  expect(d).toContainEqual({ type: "session", session: s });

});

test("retiring when the cap is full makes the session a temp", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 2 } });
  w.apply(ev("session_start", { tier: 1 }));
  w.apply(ev("session_start", { sessionId: "s2", tier: 2 }));    // two active characters fill the cap
  const target = sess(w).find(x => x.sessionId === "s1")!.characterId!;
  w.updateSettings({ rosterCap: 1 });
  const d = w.updateCharacter(target, { retired: true });
  const s = sess(w).find(x => x.sessionId === "s1")!;
  expect(s.characterId).toBeNull();
  expect(s.tempLook).not.toBeNull();
  expect(d).toContainEqual({ type: "session", session: s });
  expect(chars(w).filter(c => !c.retired)).toHaveLength(1);
});

const kindNotices = (d: Delta[]) => d.flatMap(x => (x.type === "notice" && (x.notice.kind === "needs_input" || x.notice.kind === "done") ? [x.notice.kind] : []));

test("needs_input after Stop (idle_prompt) is an activity line only: stays done, one notice, ack sticks", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 }));
  const notices = kindNotices(w.apply(ev("task_done", { at: 2000 })));
  w.ack("t:s1");
  const before = sess(w)[0]!;
  const d = w.apply(ev("needs_input", { at: 62_000, inputKind: "idle", detail: { reason: "Claude is waiting for your input" } }));
  notices.push(...kindNotices(d));
  expect(notices).toEqual(["done"]);
  const s = sess(w)[0]!;
  expect(s).toMatchObject({ state: "done", stateSince: before.stateSince, attention: false });
  expect(s.activity.at(-1)).toEqual({ at: 62_000, kind: "needs_input", text: "Claude is waiting for your input" });
  w.tick(2000 + CONFIG.doneToIdleMs); expect(sess(w)[0]!.state).toBe("idle");    // the done → idle rule still fires
});

test("an idle-type needs_input while idle stays idle with no notice and no attention", () => {
  const w = newWorld(); w.apply(ev("session_start"));
  const d = w.apply(ev("needs_input", { at: 5000, inputKind: "idle" }));
  expect(kindNotices(d)).toEqual([]);
  expect(sess(w)[0]).toMatchObject({ state: "idle", attention: false });
  expect(sess(w)[0]!.activity.at(-1)?.kind).toBe("needs_input");
});

test("needs_input while working still asks for the user", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 }));
  const d = w.apply(ev("needs_input", { at: 1200 }));
  expect(kindNotices(d)).toEqual(["needs_input"]);
  expect(sess(w)[0]).toMatchObject({ state: "needs_input", attention: true });
});

test("session_start for an existing session (compact, resume) leaves its state alone", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 })); w.apply(ev("tool", { at: 1200 }));
  w.apply(ev("session_start", { at: 1300, model: "claude-sonnet-5-5" }));
  expect(sess(w)[0]).toMatchObject({ state: "working", stateSince: 1100, lastEventAt: 1300, model: "claude-sonnet-5-5" });
});

test("end dismisses a live session through the normal end path", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 }));
  expect(w.end("t:missing", 2000)).toEqual([]);
  expect(w.end("t:s1", 2000)).toContainEqual({ type: "session_removed", key: "t:s1" });
  expect(sess(w)).toHaveLength(0);
});

test("ending an arriving session that earned XP binds it at the default tier and credits it first", () => {
  const w = newWorld();
  w.apply(ev("session_start", { tier: undefined })); w.apply(ev("prompt", { at: 1100 }));
  expect(sess(w)[0]!.tierKnown).toBe(false);
  const d = w.end("t:s1", 2000);
  expect(chars(w)).toHaveLength(1);
  expect(chars(w)[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt });
  expect(d.at(-2)).toEqual({ type: "session_removed", key: "t:s1" });
  expect(d.at(-1)).toEqual({ type: "shop", shop: { coins: CONFIG.xp.prompt, owned: [] } });   // the wallet follows the XP
});

test("a blocking Stop hook: Stop, tool, repeat Stop, idle prompt → done, one done notice, task XP once", () => {
  const w = newWorld(); w.apply(ev("session_start", { at: 0 })); w.apply(ev("prompt", { at: 100 }));
  const all: Delta[] = [];
  all.push(...w.apply(ev("task_done", { at: 1000 })));
  const xpAfterFirst = chars(w)[0]!.xp;
  w.ack("t:s1");
  all.push(...w.apply(ev("tool", { at: 2000 })));
  expect(sess(w)[0]!.state).toBe("working");
  all.push(...w.apply(ev("task_done", { at: 3000, repeat: true, detail: { summary: "Now the tests pass." } })));
  expect(sess(w)[0]).toMatchObject({ state: "done", stateSince: 3000, lastSummary: "Now the tests pass." });
  all.push(...w.apply(ev("needs_input", { at: 63_000, inputKind: "idle" })));
  expect(kindNotices(all)).toEqual(["done"]);
  const c = chars(w)[0]!;
  expect(c.xp).toBe(xpAfterFirst + CONFIG.xp.tool);            // the repeat Stop adds nothing
  expect(xpAfterFirst).toBe(CONFIG.xp.prompt + CONFIG.xp.taskDone);
  expect(c.stats.tasks).toBe(1);
  expect(sess(w)[0]).toMatchObject({ state: "done", attention: false });
});

test("a repeat Stop leaves attention as it is", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 }));
  w.apply(ev("task_done", { at: 2000 }));                       // attention raised, not acked
  w.apply(ev("task_done", { at: 3000, repeat: true }));
  expect(sess(w)[0]!.attention).toBe(true);
});

test("a blocking needs_input while done asks for the user", () => {
  const w = newWorld(); w.apply(ev("session_start")); w.apply(ev("prompt", { at: 1100 })); w.apply(ev("task_done", { at: 2000 }));
  w.ack("t:s1");
  const d = w.apply(ev("needs_input", { at: 2500, inputKind: "blocking" }));
  expect(kindNotices(d)).toEqual(["needs_input"]);
  expect(sess(w)[0]).toMatchObject({ state: "needs_input", attention: true });
});

test("a blocking (or unspecified) needs_input while idle asks for the user", () => {
  for (const inputKind of ["blocking", undefined] as const) {
    const w = newWorld(); w.apply(ev("session_start"));
    const d = w.apply(ev("needs_input", { at: 5000, ...(inputKind && { inputKind }) }));
    expect(kindNotices(d)).toEqual(["needs_input"]);
    expect(sess(w)[0]).toMatchObject({ state: "needs_input", attention: true });
  }
});
