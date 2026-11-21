import { CONFIG } from "../shared/config";
import type { Character, Delta, Notice, Repo, Session, Settings, Snapshot, Tier } from "../shared/types";

/** The browser's mirror of the server's world, fed by the SSE snapshot and deltas. */
export type ClientState = {
  characters: Map<string, Character>; repos: Map<string, Repo>; sessions: Map<string, Session>;
  settings: Settings; demo: boolean; connected: boolean;
  notices: Notice[];                 // newest last, at most CONFIG.client.noticeMax
};

export function emptyState(): ClientState {
  return {
    characters: new Map(), repos: new Map(), sessions: new Map(),
    settings: { ...CONFIG.defaultSettings }, demo: false, connected: false, notices: [],
  };
}

/** Replaces characters, repos, sessions and settings wholesale; notices are kept. */
export function applySnapshot(s: ClientState, snap: Snapshot): void {
  s.characters = new Map(snap.characters.map(c => [c.id, c]));
  s.repos = new Map(snap.repos.map(r => [r.id, r]));
  s.sessions = new Map(snap.sessions.map(x => [x.key, x]));
  s.settings = snap.settings;
  s.demo = snap.demo;
}

/** Applies a batch of deltas and returns the notices it carried. */
export function applyDeltas(s: ClientState, deltas: Delta[]): Notice[] {
  const notices: Notice[] = [];
  for (const d of deltas) {
    switch (d.type) {
      case "character": s.characters.set(d.character.id, d.character); break;
      case "repo": s.repos.set(d.repo.id, d.repo); break;
      case "session": s.sessions.set(d.session.key, d.session); break;
      case "session_removed": s.sessions.delete(d.key); break;
      case "settings": s.settings = d.settings; break;
      case "notice": notices.push(d.notice); s.notices.push(d.notice); break;
      case "credit": break;
    }
  }
  const excess = s.notices.length - CONFIG.client.noticeMax;
  if (excess > 0) s.notices.splice(0, excess);
  return notices;
}

/** Repos with at least one session, oldest first (ties by id) so places keep their positions. */
export function activeRepos(s: ClientState): Repo[] {
  const used = new Set([...s.sessions.values()].map(x => x.repoId));
  return [...s.repos.values()]
    .filter(r => used.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The label for a session with no character: "Arriving" while it waits for its tier (it joins the roster once that is
 * known), "Temp" for a contractor filling in because the roster is full.
 */
export function unboundLabel(s: Session): string {
  return s.tierKnown ? "Temp" : "Arriving";
}

/** The session's tier title, or null while it waits for its tier (an arrival has no seniority yet). */
export function tierTitleOf(s: Session, title: (t: Tier) => string): string | null {
  return s.tierKnown ? title(s.tier) : null;
}

export function sessionOf(s: ClientState, characterId: string): Session | undefined {
  for (const x of s.sessions.values()) if (x.characterId === characterId) return x;
  return undefined;
}
