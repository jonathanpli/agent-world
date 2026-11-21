/** Forward-only schema migrations. MIGRATIONS[i] takes schema version i to i+1; the version lives in PRAGMA user_version. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE characters (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tier INTEGER NOT NULL, look TEXT NOT NULL, xp INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, retired INTEGER NOT NULL, stats TEXT NOT NULL
  );
  CREATE TABLE repos (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE character_repo (
    character_id TEXT NOT NULL, repo_id TEXT NOT NULL, xp INTEGER NOT NULL, PRIMARY KEY (character_id, repo_id)
  );
  CREATE TABLE achievements (
    character_id TEXT NOT NULL, achievement_id TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (character_id, achievement_id)
  );
  CREATE TABLE sessions (
    key TEXT PRIMARY KEY, source TEXT NOT NULL, session_id TEXT NOT NULL, character_id TEXT, temp_look TEXT,
    repo_id TEXT NOT NULL, state TEXT NOT NULL, state_since INTEGER NOT NULL, model TEXT, tier INTEGER NOT NULL,
    effort TEXT, started_at INTEGER NOT NULL, last_event_at INTEGER NOT NULL, task TEXT, last_summary TEXT,
    attention INTEGER NOT NULL, activity TEXT NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, source TEXT NOT NULL, session_id TEXT NOT NULL,
    repo_path TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE INDEX events_at ON events (at);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // Sessions that wait for their tier before joining the roster hold their XP until then. Older rows were all bound.
  `
  ALTER TABLE sessions ADD COLUMN tier_known INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE sessions ADD COLUMN pending_xp INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN pending_stats TEXT NOT NULL DEFAULT '{"tasks":0,"tools":0}';
  ALTER TABLE sessions ADD COLUMN grace_since INTEGER;
  `,
  // A session's context reading, running sidekicks and last tool, as one JSON object; older rows read as none of them.
  // (pending_stats and characters.stats are JSON already: counters a row lacks read as 0.)
  `
  ALTER TABLE sessions ADD COLUMN extras TEXT NOT NULL DEFAULT '{}';
  `,
];
