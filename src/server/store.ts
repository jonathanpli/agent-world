import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { CONFIG } from "../shared/config";
import type { AgentEvent, Character, Delta, Recap, Repo, Session, Settings, UsageTotals } from "../shared/types";
import type { WorldInit } from "../core/world";
import { MIGRATIONS } from "./migrations";
import { buildRecap, localDay, TEMP_ID } from "./recap";
import type { UsageCursor } from "./usageReader";

export type Store = {
  load(): WorldInit;                    // settings default to CONFIG.defaultSettings when absent; learned limits to {}
  persist(deltas: Delta[]): void;       // one transaction; `notice` deltas are not stored, `credit` deltas add to the daily recap
  logEvent(ev: AgentEvent): void;
  pruneEvents(olderThan: number): void;
  eventCount(): number;
  recap(day: string, today: string): Recap;
  /** Server-only session data by session key: the transcript usage cursor and terminal identifiers (null when absent or malformed). */
  loadServerState(): Map<string, { cursor: UsageCursor | null; terminal: unknown | null }>;
  saveCursor(key: string, cursor: UsageCursor): void;
  saveTerminal(key: string, terminal: unknown | null): void;   // both rows go when the session is removed
  close(): void;
};

type Row = Record<string, SQLInputValue>;

/** Counters a row stored before they existed reads as 0. */
const NO_STATS = { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 };
const NO_PENDING = { ...NO_STATS, failures: 0 };
/** Token totals a row stored before they existed read as 0. */
const noUsage = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 });
const usageOf = (u: Partial<UsageTotals> | undefined): UsageTotals => ({ ...noUsage(), ...u });
/** The settings-table key that holds the learned context limits; not a setting, so never part of `Settings`. */
const LEARNED_LIMITS_KEY = "learnedLimits";
type Extras = Pick<Session, "context" | "sidekicks" | "lastTool" | "usage" | "pendingUsage" | "moments">;
type CharacterExtras = Pick<Character, "usage">;

const parseJson = (text: unknown): unknown => {
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
};
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
/** A stored cursor, or null when it is missing or not one. */
function asCursor(v: unknown): UsageCursor | null {
  if (typeof v !== "object" || v === null) return null;
  const { offset, ids } = v as Record<string, unknown>;
  return isCount(offset) && Array.isArray(ids) && ids.every(i => typeof i === "string") ? { offset, ids } : null;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function openStore(path: string): Store {
  if (path !== ":memory:") {
    // the database holds prompt text: a directory this process creates is private, and so is a new database file
    const created = mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (created !== undefined) chmodSync(dirname(path), 0o700);     // the umask filters mkdir's mode; make it exact
    closeSync(openSync(path, "a", 0o600));                           // creates the file 0600 when missing; keeps an existing one
  }
  const db = new DatabaseSync(path);
  migrate(db);

  // Upserts (not INSERT OR REPLACE) keep a row's rowid, so load order stays the order rows were first created.
  const upsertCharacter = db.prepare(`
    INSERT INTO characters (id, name, tier, look, xp, created_at, last_active_at, retired, stats, extras)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier, look = excluded.look, xp = excluded.xp,
      created_at = excluded.created_at, last_active_at = excluded.last_active_at, retired = excluded.retired, stats = excluded.stats,
      extras = excluded.extras`);
  const clearCharacterRepo = db.prepare("DELETE FROM character_repo WHERE character_id = ?");
  const insertCharacterRepo = db.prepare("INSERT INTO character_repo (character_id, repo_id, xp) VALUES (?, ?, ?)");
  const clearAchievements = db.prepare("DELETE FROM achievements WHERE character_id = ?");
  const insertAchievement = db.prepare("INSERT INTO achievements (character_id, achievement_id, earned_at) VALUES (?, ?, ?)");
  const upsertRepo = db.prepare(`
    INSERT INTO repos (id, path, name, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET path = excluded.path, name = excluded.name, created_at = excluded.created_at`);
  const upsertSession = db.prepare(`
    INSERT INTO sessions (key, source, session_id, character_id, temp_look, repo_id, state, state_since, model, tier, effort,
      started_at, last_event_at, task, last_summary, attention, activity, tier_known, pending_xp, pending_stats, grace_since, extras)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET source = excluded.source, session_id = excluded.session_id, character_id = excluded.character_id,
      temp_look = excluded.temp_look, repo_id = excluded.repo_id, state = excluded.state, state_since = excluded.state_since,
      model = excluded.model, tier = excluded.tier, effort = excluded.effort, started_at = excluded.started_at,
      last_event_at = excluded.last_event_at, task = excluded.task, last_summary = excluded.last_summary,
      attention = excluded.attention, activity = excluded.activity, tier_known = excluded.tier_known,
      pending_xp = excluded.pending_xp, pending_stats = excluded.pending_stats, grace_since = excluded.grace_since,
      extras = excluded.extras`);
  const upsertDaily = db.prepare(`
    INSERT INTO daily (day, character_id, repo_id, tasks, tools, failures, xp, levels, compactions, sidekicks,
      commits, prs_opened, prs_merged, test_runs, test_fails, input, output, cache_read, cache_write, cache_write_1h, cost_micros)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, character_id, repo_id) DO UPDATE SET tasks = tasks + excluded.tasks, tools = tools + excluded.tools,
      failures = failures + excluded.failures, xp = xp + excluded.xp, levels = levels + excluded.levels,
      compactions = compactions + excluded.compactions, sidekicks = sidekicks + excluded.sidekicks,
      commits = commits + excluded.commits, prs_opened = prs_opened + excluded.prs_opened, prs_merged = prs_merged + excluded.prs_merged,
      test_runs = test_runs + excluded.test_runs, test_fails = test_fails + excluded.test_fails,
      input = input + excluded.input, output = output + excluded.output, cache_read = cache_read + excluded.cache_read,
      cache_write = cache_write + excluded.cache_write, cache_write_1h = cache_write_1h + excluded.cache_write_1h,
      cost_micros = cost_micros + excluded.cost_micros`);
  const deleteSession = db.prepare("DELETE FROM sessions WHERE key = ?");
  const deleteServerState = db.prepare("DELETE FROM session_server WHERE key = ?");
  const upsertCursor = db.prepare(`
    INSERT INTO session_server (key, cursor) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET cursor = excluded.cursor`);
  const upsertTerminal = db.prepare(`
    INSERT INTO session_server (key, terminal) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET terminal = excluded.terminal`);
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const insertEvent = db.prepare("INSERT INTO events (at, source, session_id, repo_path, kind, payload) VALUES (?, ?, ?, ?, ?, ?)");
  const deleteEventsBefore = db.prepare("DELETE FROM events WHERE at < ?");
  const countEvents = db.prepare("SELECT COUNT(*) AS n FROM events");

  function saveCharacter(c: Character): void {
    upsertCharacter.run(c.id, c.name, c.tier, JSON.stringify(c.look), c.xp, c.createdAt, c.lastActiveAt, c.retired ? 1 : 0, JSON.stringify(c.stats),
      JSON.stringify({ usage: c.usage } satisfies CharacterExtras));
    clearCharacterRepo.run(c.id);
    for (const [repoId, xp] of Object.entries(c.repoXp)) insertCharacterRepo.run(c.id, repoId, xp);
    clearAchievements.run(c.id);
    for (const [id, at] of Object.entries(c.achievements)) insertAchievement.run(c.id, id, at);
  }

  function saveSession(s: Session): void {
    upsertSession.run(
      s.key, s.source, s.sessionId, s.characterId, s.tempLook === null ? null : JSON.stringify(s.tempLook), s.repoId, s.state, s.stateSince,
      s.model, s.tier, s.effort, s.startedAt, s.lastEventAt, s.task, s.lastSummary, s.attention ? 1 : 0, JSON.stringify(s.activity),
      s.tierKnown ? 1 : 0, s.pendingXp, JSON.stringify(s.pendingStats), s.graceSince,
      JSON.stringify({
        context: s.context, sidekicks: s.sidekicks, lastTool: s.lastTool, usage: s.usage, pendingUsage: s.pendingUsage, moments: s.moments,
      } satisfies Extras),
    );
  }

  function saveSettings(settings: Settings): void {
    for (const [k, v] of Object.entries(settings)) upsertSetting.run(k, JSON.stringify(v));
  }

  function learnedLimits(): Record<string, number> {
    const row = getSetting.get(LEARNED_LIMITS_KEY) as { value: string } | undefined;
    if (row === undefined) return {};
    let parsed: unknown;
    try { parsed = JSON.parse(row.value); } catch { return {}; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // keep only the valid entries; a malformed value is dropped, never thrown on
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>;
  }

  /** Saves the latest learned limit for the model, replacing the stored one (lower or higher). */
  function saveLearnedLimit(model: string, limit: number): void {
    const limits = learnedLimits();
    if (limits[model] === limit) return;
    limits[model] = limit;
    upsertSetting.run(LEARNED_LIMITS_KEY, JSON.stringify(limits));
  }

  function load(): WorldInit {
    const repoXp = new Map<string, Record<string, number>>();
    for (const r of db.prepare("SELECT * FROM character_repo").all() as Row[]) {
      const id = r.character_id as string;
      const m = repoXp.get(id) ?? {};
      m[r.repo_id as string] = r.xp as number;
      repoXp.set(id, m);
    }
    const achievements = new Map<string, Record<string, number>>();
    for (const r of db.prepare("SELECT * FROM achievements").all() as Row[]) {
      const id = r.character_id as string;
      const m = achievements.get(id) ?? {};
      m[r.achievement_id as string] = r.earned_at as number;
      achievements.set(id, m);
    }
    const characters = (db.prepare("SELECT * FROM characters ORDER BY rowid").all() as Row[]).map((r): Character => {
      const extras: Partial<CharacterExtras> = JSON.parse(r.extras as string);
      return {
        id: r.id as string, name: r.name as string, tier: r.tier as Character["tier"], look: JSON.parse(r.look as string),
        xp: r.xp as number, createdAt: r.created_at as number, lastActiveAt: r.last_active_at as number, retired: r.retired === 1,
        repoXp: repoXp.get(r.id as string) ?? {}, stats: { ...NO_STATS, ...JSON.parse(r.stats as string) }, achievements: achievements.get(r.id as string) ?? {},
        usage: usageOf(extras.usage),
      };
    });
    const repos = (db.prepare("SELECT * FROM repos ORDER BY rowid").all() as Row[]).map((r): Repo => ({
      id: r.id as string, path: r.path as string, name: r.name as string, createdAt: r.created_at as number,
    }));
    const sessions = (db.prepare("SELECT * FROM sessions ORDER BY rowid").all() as Row[]).map((r): Session => {
      const extras: Partial<Extras> = JSON.parse(r.extras as string);
      return {
        key: r.key as string, source: r.source as string, sessionId: r.session_id as string,
        characterId: r.character_id as string | null, tempLook: r.temp_look === null ? null : JSON.parse(r.temp_look as string),
        repoId: r.repo_id as string, state: r.state as Session["state"], stateSince: r.state_since as number,
        model: r.model as string | null, tier: r.tier as Session["tier"], effort: r.effort as Session["effort"],
        tierKnown: r.tier_known === 1, pendingXp: r.pending_xp as number, pendingStats: { ...NO_PENDING, ...JSON.parse(r.pending_stats as string) },
        graceSince: r.grace_since as number | null,
        startedAt: r.started_at as number, lastEventAt: r.last_event_at as number, task: r.task as string | null,
        lastSummary: r.last_summary as string | null, attention: r.attention === 1, activity: JSON.parse(r.activity as string),
        context: extras.context ?? null, sidekicks: extras.sidekicks ?? [], lastTool: extras.lastTool ?? null,
        usage: usageOf(extras.usage), pendingUsage: usageOf(extras.pendingUsage), moments: extras.moments ?? {},
      };
    });
    const settings: Record<string, unknown> = { ...CONFIG.defaultSettings };
    for (const r of db.prepare("SELECT key, value FROM settings").all() as Row[]) {
      if (r.key !== LEARNED_LIMITS_KEY) settings[r.key as string] = JSON.parse(r.value as string);
    }
    return { characters, repos, sessions, settings: settings as Settings, learnedLimits: learnedLimits() };
  }

  function persist(deltas: Delta[]): void {
    db.exec("BEGIN");
    try {
      for (const d of deltas) {
        switch (d.type) {
          case "character": saveCharacter(d.character); break;
          case "repo": upsertRepo.run(d.repo.id, d.repo.path, d.repo.name, d.repo.createdAt); break;
          case "session": saveSession(d.session); break;
          case "session_removed": deleteSession.run(d.key); deleteServerState.run(d.key); break;
          case "settings": saveSettings(d.settings); break;
          case "notice": break;
          case "credit": {
            const u = d.usage;
            upsertDaily.run(localDay(d.at), d.characterId ?? TEMP_ID, d.repoId, d.tasks, d.tools, d.failures, d.xp, d.levels, d.compactions, d.sidekicks,
              d.commits, d.prsOpened, d.prsMerged, d.testRuns, d.testFails, u.input, u.output, u.cacheRead, u.cacheWrite, u.cacheWrite1h, u.costMicros);
            break;
          }
          case "learned_limit": saveLearnedLimit(d.model, d.limit); break;
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function loadServerState(): Map<string, { cursor: UsageCursor | null; terminal: unknown | null }> {
    const out = new Map<string, { cursor: UsageCursor | null; terminal: unknown | null }>();
    for (const r of db.prepare("SELECT key, cursor, terminal FROM session_server ORDER BY rowid").all() as Row[]) {
      out.set(r.key as string, { cursor: asCursor(parseJson(r.cursor)), terminal: parseJson(r.terminal) });
    }
    return out;
  }

  return {
    load,
    persist,
    loadServerState,
    saveCursor: (key, cursor) => { upsertCursor.run(key, JSON.stringify(cursor)); },
    saveTerminal: (key, terminal) => { upsertTerminal.run(key, terminal === null ? null : JSON.stringify(terminal)); },
    logEvent: ev => { insertEvent.run(ev.at, ev.source, ev.sessionId, ev.repoPath, ev.kind, JSON.stringify(ev)); },
    pruneEvents: olderThan => { deleteEventsBefore.run(olderThan); },
    recap: (day, today) => buildRecap(db, day, today),
    eventCount: () => (countEvents.get() as { n: number }).n,
    close: () => db.close(),
  };
}
