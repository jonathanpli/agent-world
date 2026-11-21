import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import { createWorld } from "../../src/core/world";
import { MIGRATIONS } from "../../src/server/migrations";
import { openStore } from "../../src/server/store";
import { deps, ev, newWorld } from "../helpers/events";

test("round trip through a real world (Review Focus 4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "sub", "w.db");
  let store = openStore(path); const w = createWorld(store.load(), deps());
  for (const e of [ev("session_start", { tier: 3 }), ev("prompt", { detail: { text: "x" } }), ev("tool"), ev("needs_input"),
                   ev("session_start", { sessionId: "s2" }), ev("task_done", { sessionId: "s2" })]) store.persist(w.apply(e));
  const before = w.snapshot(0, false);
  expect(before.characters.length).toBeGreaterThan(0);
  expect(before.sessions.length).toBe(2);
  expect(before.sessions.some(s => s.attention)).toBe(true);
  expect(before.sessions.some(s => s.activity.length > 0)).toBe(true);
  store.close();
  store = openStore(path); const after = createWorld(store.load(), deps()).snapshot(0, false);
  store.close();
  expect(after).toEqual(before);
});

test("round trip preserves temp looks, nulls and retired flag", () => {
  const store = openStore(":memory:");
  const w = newWorld({ settings: { ...CONFIG.defaultSettings, rosterCap: 1 } });
  for (const e of [ev("session_start"), ev("session_start", { sessionId: "s2" }), ev("tool", { sessionId: "s2" })]) store.persist(w.apply(e));
  const before = w.snapshot(0, false);
  expect(before.sessions.some(s => s.characterId === null && s.tempLook !== null)).toBe(true);
  const retire = w.updateCharacter(before.characters[0]!.id, { retired: true });
  store.persist(retire);
  const after = createWorld(store.load(), deps()).snapshot(0, false);
  expect(after.characters[0]!.retired).toBe(true);
  expect(after.sessions).toEqual(w.snapshot(0, false).sessions);
  store.close();
});

test("session_removed deletes the row", () => {
  const store = openStore(":memory:"); const w = newWorld();
  store.persist(w.apply(ev("session_start")));
  expect(store.load().sessions).toHaveLength(1);
  store.persist(w.apply(ev("session_end")));
  expect(store.load().sessions).toEqual([]);
  store.close();
});

test("notice deltas are not stored", () => {
  const store = openStore(":memory:"); const w = newWorld();
  const deltas = [...w.apply(ev("session_start")), ...w.apply(ev("needs_input"))];
  expect(deltas.some(d => d.type === "notice")).toBe(true);
  expect(() => store.persist(deltas)).not.toThrow();
  store.close();
});

test("settings default then persist", () => {
  const store = openStore(":memory:");
  expect(store.load().settings).toEqual(CONFIG.defaultSettings);
  const w = newWorld();
  store.persist(w.updateSettings({ theme: "space", sound: true }));
  expect(store.load().settings).toEqual({ ...CONFIG.defaultSettings, theme: "space", sound: true });
  store.close();
});

test("events log and prune", () => {
  const store = openStore(":memory:");
  store.logEvent(ev("tool", { at: 1000, detail: { tool: "Bash" } }));
  store.logEvent(ev("tool", { at: 5000 }));
  expect(store.eventCount()).toBe(2);
  store.pruneEvents(3000);
  expect(store.eventCount()).toBe(1);
  store.close();
});

test("migrations are forward-only and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  openStore(path).close();
  expect(() => openStore(path).close()).not.toThrow();
  const db = new DatabaseSync(path);
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  db.close();
  expect(row.user_version).toBe(MIGRATIONS.length);
});

test("retiring a character with a live session persists the handover", () => {
  const store = openStore(":memory:");
  const w = newWorld();
  store.persist(w.apply(ev("session_start")));
  const id = w.snapshot(0, false).characters[0]!.id;
  store.persist(w.updateCharacter(id, { retired: true }));
  const after = createWorld(store.load(), deps()).snapshot(0, false);
  expect(after.sessions).toEqual(w.snapshot(0, false).sessions);
  expect(after.characters).toEqual(w.snapshot(0, false).characters);
  expect(after.sessions[0]!.characterId).not.toBe(id);
  expect(after.sessions[0]!.characterId).not.toBeNull();
  store.close();
});

test("an unknown-tier session with held XP survives a restart and is credited afterwards", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  let store = openStore(path); const w = createWorld(store.load(), deps());
  const noTier = (e: ReturnType<typeof ev>) => { delete e.tier; return e; };
  for (const e of [ev("session_start", { at: 1000 }), ev("prompt", { at: 2000 }), ev("tool", { at: 3000 })]) store.persist(w.apply(noTier(e)));
  const before = w.snapshot(0, false);
  expect(before.characters).toEqual([]);
  expect(before.sessions[0]).toMatchObject({ tierKnown: false, pendingXp: CONFIG.xp.prompt + CONFIG.xp.tool, pendingStats: { tasks: 0, tools: 1 } });
  store.close();
  store = openStore(path); const w2 = createWorld(store.load(), deps());
  expect(w2.snapshot(0, false)).toEqual(before);
  store.persist(w2.apply(ev("task_done", { at: 4000, tier: 3 })));
  store.close();
  store = openStore(path); const after = store.load();
  store.close();
  expect(after.characters).toHaveLength(1);
  expect(after.characters[0]).toMatchObject({
    tier: 3, xp: CONFIG.xp.prompt + CONFIG.xp.tool + CONFIG.xp.taskDone, stats: { tasks: 1, tools: 1 },
  });
  expect(after.characters[0]!.achievements.first_task).toBe(4000);
  expect(after.sessions[0]).toMatchObject({ tierKnown: true, pendingXp: 0, pendingStats: { tasks: 0, tools: 0 }, characterId: after.characters[0]!.id });
});

test("sessions saved before the arriving migration load as known with nothing held", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  const db = new DatabaseSync(path);
  db.exec(MIGRATIONS[0]!); db.exec("PRAGMA user_version = 1");
  db.exec(`INSERT INTO sessions (key, source, session_id, character_id, temp_look, repo_id, state, state_since, model, tier, effort,
    started_at, last_event_at, task, last_summary, attention, activity) VALUES ('t:s1', 't', 's1', 'c1', NULL, 'r1', 'idle', 0, NULL, 3, NULL, 0, 0, NULL, NULL, 0, '[]')`);
  db.close();
  const store = openStore(path);
  expect(store.load().sessions[0]).toMatchObject({ key: "t:s1", tier: 3, tierKnown: true, pendingXp: 0, pendingStats: { tasks: 0, tools: 0 } });
  store.close();
});
