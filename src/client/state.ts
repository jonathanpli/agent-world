import { CONFIG } from "../shared/config";
import type { ShopState } from "../shared/shop";
import type { Character, Delta, Notice, Repo, Session, Settings, Snapshot, Tier } from "../shared/types";

/** The browser's mirror of the server's world, fed by the SSE snapshot and deltas. */
export type ClientState = {
  characters: Map<string, Character>; repos: Map<string, Repo>; sessions: Map<string, Session>;
  settings: Settings; shop: ShopState; demo: boolean; connected: boolean;
  notices: Notice[];                 // newest last, at most CONFIG.client.noticeMax
  notes: { at: number; text: string }[];   // client-only ticker lines (no toast, no attention), newest last, same cap
};

export function emptyState(): ClientState {
  return {
    characters: new Map(), repos: new Map(), sessions: new Map(),
    settings: { ...CONFIG.defaultSettings }, shop: { coins: 0, owned: [] }, demo: false, connected: false, notices: [], notes: [],
  };
}

/** Replaces characters, repos, sessions and settings wholesale; notices are kept. */
export function applySnapshot(s: ClientState, snap: Snapshot): void {
  s.characters = new Map(snap.characters.map(c => [c.id, c]));
  s.repos = new Map(snap.repos.map(r => [r.id, r]));
  s.sessions = new Map(snap.sessions.map(x => [x.key, x]));
  s.settings = snap.settings;
  s.shop = snap.shop;
  s.demo = snap.demo;
}

const thousands = (n: number): string => `${Math.round(n / 1000)}k`;

/**
 * The ticker line for a session whose compaction count went up, or null (no earlier reading, or no increase).
 * `who` and `repoName` are the names the client shows for the session. Token counts are included when the
 * new reading is lower than the old one.
 */
export function compactionText(old: Session | undefined, now: Session, who: string, repoName: string | null): string | null {
  const before = old?.context, after = now.context;
  if (before === null || before === undefined || after === null || after.compactions <= before.compactions) return null;
  const where = repoName === null ? "" : ` in ${repoName}`;
  const sized = after.tokens < before.tokens ? ` (${thousands(before.tokens)} → ${thousands(after.tokens)})` : "";
  return `${who} compacted context${where}${sized}`;
}

/** Applies a batch of deltas and returns the notices it carried. */
export function applyDeltas(s: ClientState, deltas: Delta[]): Notice[] {
  const notices: Notice[] = [];
  for (const d of deltas) {
    switch (d.type) {
      case "character": s.characters.set(d.character.id, d.character); break;
      case "repo": s.repos.set(d.repo.id, d.repo); break;
      case "session": {
        const who = d.session.characterId === null ? null : s.characters.get(d.session.characterId)?.name ?? null;
        const text = compactionText(s.sessions.get(d.session.key), d.session, who ?? unboundLabel(d.session), s.repos.get(d.session.repoId)?.name ?? null);
        if (text !== null) s.notes.push({ at: Date.now(), text });
        s.sessions.set(d.session.key, d.session);
        break;
      }
      case "session_removed": s.sessions.delete(d.key); break;
      case "settings": s.settings = d.settings; break;
      case "notice": notices.push(d.notice); s.notices.push(d.notice); break;
      case "credit": break;
      case "learned_limit": break;
      case "purchase": break;
      case "shop": s.shop = d.shop; break;
    }
  }
  const excess = s.notices.length - CONFIG.client.noticeMax;
  if (excess > 0) s.notices.splice(0, excess);
  const extra = s.notes.length - CONFIG.client.noticeMax;
  if (extra > 0) s.notes.splice(0, extra);
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
