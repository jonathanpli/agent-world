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
