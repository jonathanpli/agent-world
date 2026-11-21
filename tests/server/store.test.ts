import { chmodSync, mkdtempSync, statSync } from "node:fs";
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
  const deltas = [...w.apply(ev("session_start")), ...w.apply(ev("tool")), ...w.apply(ev("needs_input"))];
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

test("context settings persist; rows saved before them load with the defaults", () => {
  const store = openStore(":memory:");
  store.persist(newWorld().updateSettings({ contextWarnPct: 90, contextLimitOverride: 400_000, notifyContext: false }));
  expect(store.load().settings).toMatchObject({ contextWarnPct: 90, contextLimitOverride: 400_000, notifyContext: false });
  store.persist(newWorld().updateSettings({ contextLimitOverride: null }));
  expect(store.load().settings.contextLimitOverride).toBeNull();
  store.close();

  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  const db = new DatabaseSync(path);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  for (const k of ["theme", "notifyNeedsInput", "notifyDone", "sound", "rosterCap"] as const) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(k, JSON.stringify({ ...CONFIG.defaultSettings, theme: "space" }[k]));
  }
  db.close();
  const old = openStore(path);
  expect(old.load().settings).toEqual({ ...CONFIG.defaultSettings, theme: "space" });
  old.close();
});

test("a session's context, sidekicks and last tool round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  let store = openStore(path); const w = createWorld(store.load(), deps());
  const sub = (kind: "sub_start" | "sub_end", agentId: string, at: number) => ev(kind, { at, detail: { agentId, agentType: "Explore" } });
  for (const e of [
    ev("session_start", { at: 1000, model: "claude-opus-5-5" }), ev("prompt", { at: 2000, detail: { text: "go" } }),
    sub("sub_start", "a1", 3000), sub("sub_start", "a2", 3500), sub("sub_start", "a3", 3600), sub("sub_end", "a3", 3700),
    ev("tool", { at: 4000, failed: true, detail: { tool: "Bash", toolKind: "shell" } }),
    ev("context", { at: 5000, contextTokens: 50_000, boundaries: [{ uuid: "u1", trigger: "manual", preTokens: 90_000, postTokens: 20_000 }] }),
    ev("context", { at: 6000, contextTokens: 30_000, boundaries: [{ uuid: "u1", trigger: "manual", preTokens: 90_000, postTokens: 20_000 },
      { uuid: "u2", trigger: "auto", preTokens: 150_000, postTokens: 25_000 }] }),
  ]) store.persist(w.apply(e));
  const before = w.snapshot(0, false);
  expect(before.sessions[0]!.sidekicks).toHaveLength(2);
  expect(before.sessions[0]!.lastTool).toMatchObject({ kind: "shell", failed: true });
  expect(before.sessions[0]!.context).toMatchObject({ tokens: 30_000, compactions: 1, seen: ["u1", "u2"] });
  store.close();
  store = openStore(path);
  const init = store.load();
  store.close();
  expect(createWorld(init, deps()).snapshot(0, false)).toEqual(before);
  expect(init.learnedLimits).toEqual({ "claude-opus-5-5": 150_000 });
});

test("sessions saved before the extras migration load with no context, sidekicks or last tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  const db = new DatabaseSync(path);
  db.exec(MIGRATIONS[0]!); db.exec(MIGRATIONS[1]!); db.exec("PRAGMA user_version = 2");
  db.exec(`INSERT INTO sessions (key, source, session_id, character_id, temp_look, repo_id, state, state_since, model, tier, effort,
    started_at, last_event_at, task, last_summary, attention, activity) VALUES ('t:s1', 't', 's1', 'c1', NULL, 'r1', 'idle', 0, NULL, 3, NULL, 0, 0, NULL, NULL, 0, '[]')`);
  db.close();
  const store = openStore(path);
  const loaded = store.load().sessions[0]!;
  expect(loaded).toMatchObject({ key: "t:s1", context: null, sidekicks: [], lastTool: null });
  expect(loaded.pendingStats).toEqual({ tasks: 0, tools: 0, compactions: 0, sidekicks: 0, failures: 0 });
  store.close();
});

test("learned_limit deltas round-trip and keep the maximum per model; they are not settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  let store = openStore(path);
  expect(store.load().learnedLimits).toEqual({});
  store.persist([{ type: "learned_limit", model: "m", limit: 180_000 }, { type: "learned_limit", model: "n", limit: 150_000 }]);
  store.persist([{ type: "learned_limit", model: "m", limit: 170_000 }]);
  store.close();
  store = openStore(path);
  const init = store.load();
  expect(init.learnedLimits).toEqual({ m: 180_000, n: 150_000 });
  expect(init.settings).toEqual(CONFIG.defaultSettings);
  store.persist(createWorld(init, deps()).updateSettings({ theme: "space" }));
  expect(store.load().learnedLimits).toEqual({ m: 180_000, n: 150_000 });
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
  expect(before.sessions[0]).toMatchObject({ tierKnown: false, graceSince: 2000, pendingXp: CONFIG.xp.prompt + CONFIG.xp.tool, pendingStats: { tasks: 0, tools: 1 } });
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
  const loaded = store.load().sessions[0]!;
  expect(loaded).toMatchObject({ key: "t:s1", tier: 3, tierKnown: true, pendingXp: 0, graceSince: null, sidekicks: [], lastTool: null });
  expect(loaded.pendingStats).toEqual({ tasks: 0, tools: 0, compactions: 0, sidekicks: 0, failures: 0 });
  store.close();
});

test("characters stored before the compaction and sidekick counters load them as 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  let store = openStore(path); const w = createWorld(store.load(), deps());
  store.persist(w.apply(ev("session_start")));
  store.close();
  const db = new DatabaseSync(path);
  db.exec(`UPDATE characters SET stats = '{"tasks":3,"tools":7}'`);
  db.close();
  store = openStore(path);
  expect(store.load().characters[0]!.stats).toEqual({ tasks: 3, tools: 7, compactions: 0, sidekicks: 0 });
  store.close();
});

test("persist ignores credit deltas", () => {
  const store = openStore(":memory:");
  const credit = { type: "credit" as const, at: 0, characterId: null, repoId: "r", tasks: 1, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0 };
  expect(() => store.persist([credit])).not.toThrow();
  expect(store.load()).toMatchObject({ characters: [], repos: [], sessions: [] });
  store.close();
});

test("a data directory the store creates is private (0700) and so is the database file (0600)", () => {
  const root = mkdtempSync(join(tmpdir(), "aw-perm-"));
  const path = join(root, "home", "w.db");
  openStore(path).close();
  expect(statSync(join(root, "home")).mode & 0o777).toBe(0o700);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("an existing data directory keeps its mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-perm-"));
  chmodSync(dir, 0o755);
  openStore(join(dir, "w.db")).close();
  expect(statSync(dir).mode & 0o777).toBe(0o755);
});

test("a malformed learnedLimits value loads as {} (or its valid entries) and a new limit can still be saved", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  const store = openStore(path);
  const db = new DatabaseSync(path);
  const set = (v: string) => db.prepare("INSERT INTO settings (key, value) VALUES ('learnedLimits', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
  for (const v of ["[1,2]", "null", "7", '"x"', "{not json"]) { set(v); expect(store.load().learnedLimits).toEqual({}); }
  set('{"m":150000,"bad":"x","worse":null}');
  expect(store.load().learnedLimits).toEqual({ m: 150_000 });
  set("[1]");
  store.persist([{ type: "learned_limit", model: "n", limit: 200_000 }]);
  expect(store.load().learnedLimits).toEqual({ n: 200_000 });
  db.close(); store.close();
});

test("a version-3 database opens, gives an empty recap, and records credits afterwards", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-")); const path = join(dir, "w.db");
  const db = new DatabaseSync(path);
  for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
  db.exec("PRAGMA user_version = 3");
  db.exec(`INSERT INTO characters (id, name, tier, look, xp, created_at, last_active_at, retired, stats)
    VALUES ('c1', 'Ada', 3, '{}', 10, 0, 0, 0, '{"tasks":1,"tools":2}')`);
  db.exec(`INSERT INTO sessions (key, source, session_id, character_id, temp_look, repo_id, state, state_since, model, tier, effort,
    started_at, last_event_at, task, last_summary, attention, activity) VALUES ('t:s1', 't', 's1', 'c1', NULL, 'r1', 'idle', 0, NULL, 3, NULL, 0, 0, NULL, NULL, 0, '[]')`);
  db.close();
  const store = openStore(path);
  expect(store.load()).toMatchObject({ characters: [{ id: "c1" }], sessions: [{ key: "t:s1" }] });
  const zero = { tasks: 0, tools: 0, failures: 0, xp: 0, levels: 0, compactions: 0, sidekicks: 0 };
  expect(store.recap("2026-06-10", "2026-06-10")).toEqual(
    { day: "2026-06-10", today: "2026-06-10", totals: zero, characters: [], repos: [], mvpCharacterId: null, streak: 0, prevDay: null, nextDay: null });
  const at = new Date(2026, 5, 10, 12).getTime();
  store.persist([{ type: "credit", at, characterId: "c1", repoId: "r1", ...zero, tasks: 1, xp: 7 }]);
  const r = store.recap("2026-06-10", "2026-06-10");
  expect(r.totals).toMatchObject({ tasks: 1, xp: 7 });
  expect(r.characters).toMatchObject([{ characterId: "c1", name: "Ada", xp: 7 }]);
  expect(r.streak).toBe(1);
  store.close();
});
