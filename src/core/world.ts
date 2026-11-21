import { CONFIG } from "../shared/config";
import { isValidLook } from "../shared/cosmetics";
import type { AgentEvent, Character, Delta, Look, Notice, Repo, Session, Settings, Snapshot, Tier } from "../shared/types";
import { pickCharacter } from "./assign";
import { earned, ACHIEVEMENTS } from "./achievements";
import { levelForXp } from "./levels";
import { randomLook, randomName } from "./names";

export type WorldInit = { characters: Character[]; repos: Repo[]; sessions: Session[]; settings: Settings };
export type WorldDeps = { rng: () => number; newId: () => string };
export type World = {
  apply(ev: AgentEvent): Delta[];      // ev.repoPath is already the resolved repo root
  tick(now: number): Delta[];
  ack(sessionKey: string): Delta[];
  updateCharacter(id: string, patch: { name?: string; look?: Look; retired?: boolean }): Delta[];  // throws Error on invalid patch
  updateSettings(patch: Partial<Settings>): Delta[];                                               // throws Error on invalid patch
  snapshot(now: number, demo: boolean): Snapshot;
};

const TEMP_NAME = "Temp";
/** How notices name a session that is still waiting for its tier (and so has no character yet). */
export const ARRIVAL_NAME = "A new arrival";
const clone = <T>(x: T): T => structuredClone(x);

export function createWorld(init: WorldInit, deps: WorldDeps): World {
  const characters = new Map(init.characters.map(c => [c.id, clone(c)]));
  const repos = new Map(init.repos.map(r => [r.id, clone(r)]));
  const sessions = new Map(init.sessions.map(s => [s.key, clone(s)]));
  let settings: Settings = clone(init.settings);
  /** `${sessionKey}|${noticeKind}` → time of the last notice emitted. Private, never in snapshots. */
  const lastNoticeAt = new Map<string, number>();
  /** sessionKey → current tool-XP minute window. Private, never in snapshots. */
  const toolWindow = new Map<string, { start: number; earned: number }>();

  const characterDelta = (c: Character): Delta => ({ type: "character", character: clone(c) });
  const sessionDelta = (s: Session): Delta => ({ type: "session", session: clone(s) });

  function repoFor(path: string, at: number, out: Delta[]): Repo {
    for (const r of repos.values()) if (r.path === path) return r;
    const name = path.split("/").filter(Boolean).pop() ?? path;
    const repo: Repo = { id: deps.newId(), path, name, createdAt: at };
    repos.set(repo.id, repo);
    out.push({ type: "repo", repo: clone(repo) });
    return repo;
  }

  function boundIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of sessions.values()) if (s.characterId !== null) ids.add(s.characterId);
    return ids;
  }

  /** Binds `session` to a character of its tier, creating one or falling back to a temp. */
  function assign(session: Session, at: number, out: Delta[]): void {
    let c = pickCharacter([...characters.values()], boundIds(), session.tier, session.repoId);
    if (c === null) {
      const active = [...characters.values()].filter(x => !x.retired).length;
      if (active < settings.rosterCap) {
        const taken = new Set([...characters.values()].map(x => x.name));
        c = {
          id: deps.newId(), name: randomName(deps.rng, taken), tier: session.tier, look: randomLook(deps.rng),
          xp: 0, createdAt: at, lastActiveAt: at, retired: false, repoXp: {},
          stats: { tasks: 0, tools: 0 }, achievements: {},
        };
        characters.set(c.id, c);
        out.push(characterDelta(c));
      }
    }
    if (c === null) {
      session.characterId = null;
      session.tempLook = session.tempLook ?? randomLook(deps.rng);
    } else {
      session.characterId = c.id;
      session.tempLook = null;
    }
  }

  /** A session whose first event has no tier is not bound yet: it arrives with a temp look and holds its XP. */
  function createSession(ev: AgentEvent, key: string, repo: Repo, out: Delta[]): Session {
    const session: Session = {
      key, source: ev.source, sessionId: ev.sessionId, characterId: null, tempLook: null,
      repoId: repo.id, state: "idle", stateSince: ev.at, model: ev.model ?? null, tier: ev.tier ?? CONFIG.defaultTier,
      effort: ev.effort ?? null, tierKnown: ev.tier !== undefined, pendingXp: 0, pendingStats: { tasks: 0, tools: 0 },
      startedAt: ev.at, lastEventAt: ev.at, task: null, lastSummary: null, attention: false, activity: [],
    };
    sessions.set(key, session);
    if (session.tierKnown) assign(session, ev.at, out);
    else session.tempLook = randomLook(deps.rng);
    return session;
  }

  /** Ends the wait for a tier: binds the session at `tier`. The held XP is credited by the next `settle`, or dropped for a temp. */
  function bindArrival(s: Session, tier: Tier, at: number, out: Delta[]): void {
    s.tierKnown = true;
    s.tier = tier;
    assign(s, at, out);
    if (s.characterId === null) { s.pendingXp = 0; s.pendingStats = { tasks: 0, tools: 0 }; }
  }

  /**
   * Ends a session (SessionEnd or stale). One still waiting for its tier is bound at the default tier and credited
   * first, so nothing it earned is lost.
   */
  function endSession(s: Session, at: number, out: Delta[]): void {
    if (!s.tierKnown) {
      bindArrival(s, s.tier, at, out);
      const c = s.characterId === null ? undefined : characters.get(s.characterId);
      out.push(...settle(s, at, false));
      if (c !== undefined) out.push(characterDelta(c));
    }
    out.push(removeSession(s.key));
  }

  function setState(s: Session, state: Session["state"], at: number): void {
    if (s.state !== state) { s.state = state; s.stateSince = at; }
  }

  function notice(s: Session, kind: "needs_input" | "done", at: number, repo: Repo): Delta[] {
    const throttleKey = `${s.key}|${kind}`;
    const last = lastNoticeAt.get(throttleKey);
    if (last !== undefined && at - last < CONFIG.noticeThrottleMs) return [];
    lastNoticeAt.set(throttleKey, at);
    const c = s.characterId === null ? undefined : characters.get(s.characterId);
    const name = c?.name ?? (s.tierKnown ? TEMP_NAME : ARRIVAL_NAME);
    const text = kind === "needs_input" ? `${name} needs you in ${repo.name}` : `${name} finished a task in ${repo.name}`;
    const n: Notice = { id: deps.newId(), at, kind, sessionKey: s.key, characterId: c?.id ?? null, characterName: name, repoName: repo.name, text };
    return [{ type: "notice", notice: n }];
  }

  function removeSession(key: string): Delta {
    sessions.delete(key);
    lastNoticeAt.delete(`${key}|needs_input`);
    lastNoticeAt.delete(`${key}|done`);
    toolWindow.delete(key);
    return { type: "session_removed", key };
  }

  /**
   * Adds what `ev` earns to the session's held XP and stats, then settles them. A session still waiting for its tier
   * holds what it earns; a temp earns nothing. Returns notices only; apply emits the character delta.
   */
  function award(session: Session, ev: AgentEvent): Delta[] {
    if (session.tierKnown && session.characterId === null) return [];
    if (ev.kind === "tool") {
      session.pendingStats.tools++;
      let w = toolWindow.get(session.key);
      if (w === undefined || ev.at - w.start >= CONFIG.toolWindowMs) { w = { start: ev.at, earned: 0 }; toolWindow.set(session.key, w); }
      const gain = Math.min(CONFIG.xp.tool, CONFIG.xp.toolCapPerMinute - w.earned);
      w.earned += gain;
      session.pendingXp += gain;
    } else if (ev.kind === "prompt") session.pendingXp += CONFIG.xp.prompt;
    else if (ev.kind === "task_done") { session.pendingXp += CONFIG.xp.taskDone; session.pendingStats.tasks++; }
    return settle(session, ev.at, ev.kind === "task_done");
  }

  /**
   * Credits the session's held XP and stats to its character with level-ups and achievements, through the one path
   * every award takes. Held while the tier is unknown; dropped for a temp. Returns notices only.
   */
  function settle(session: Session, at: number, finishedTask: boolean): Delta[] {
    if (!session.tierKnown) return [];
    const gain = session.pendingXp, stats = session.pendingStats;
    if (gain === 0 && stats.tasks === 0 && stats.tools === 0) return [];
    session.pendingXp = 0;
    session.pendingStats = { tasks: 0, tools: 0 };
    const c = session.characterId === null ? undefined : characters.get(session.characterId);
    if (c === undefined) return [];
    c.stats.tools += stats.tools;
    c.stats.tasks += stats.tasks;

    const levelBefore = levelForXp(c.xp);
    c.xp += gain;
    c.repoXp[session.repoId] = (c.repoXp[session.repoId] ?? 0) + gain;
    c.lastActiveAt = at;

    const repoName = repos.get(session.repoId)?.name ?? null;
    const out: Delta[] = [];
    const push = (kind: "level_up" | "achievement", text: string): void => {
      out.push({ type: "notice", notice: { id: deps.newId(), at, kind, sessionKey: session.key, characterId: c.id, characterName: c.name, repoName, text } });
    };
    const levelAfter = levelForXp(c.xp);
    if (levelAfter > levelBefore) push("level_up", `${c.name} reached level ${levelAfter}`);
    for (const id of earned(c, { at, session, levelBefore, finishedTask })) {
      c.achievements[id] = at;
      push("achievement", `${c.name} earned ${ACHIEVEMENTS.find(a => a.id === id)!.title}`);
    }
    return out;
  }

  function apply(ev: AgentEvent): Delta[] {
    const key = `${ev.source}:${ev.sessionId}`;
    let s = sessions.get(key);
    if (ev.kind === "session_end") {
      if (s === undefined) return [];
      const out: Delta[] = [];
      if (!s.tierKnown && ev.tier !== undefined) s.tier = ev.tier;
      endSession(s, ev.at, out);
      return out;
    }

    const out: Delta[] = [];
    const repo = repoFor(ev.repoPath, ev.at, out);
    if (s === undefined) s = createSession(ev, key, repo, out);

    s.repoId = repo.id;
    s.lastEventAt = ev.at;
    if (ev.effort !== undefined) s.effort = ev.effort;
    if (ev.model !== undefined) s.model = ev.model;
    const tier: Tier = ev.tier ?? s.tier;
    if (!s.tierKnown) {
      if (ev.tier !== undefined || ev.at - s.startedAt > CONFIG.modelGraceMs) bindArrival(s, tier, ev.at, out);
    } else if (tier !== s.tier) {
      s.tier = tier;
      s.characterId = null;          // release before assigning, so the old character is free again
      assign(s, ev.at, out);
    }

    const notices: Delta[] = [];
    switch (ev.kind) {
      case "session_start": setState(s, "idle", ev.at); break;
      case "prompt": setState(s, "working", ev.at); s.attention = false; s.task = ev.detail?.text ?? null; break;
      case "tool": setState(s, "working", ev.at); s.attention = false; break;
      case "needs_input": setState(s, "needs_input", ev.at); s.attention = true; notices.push(...notice(s, "needs_input", ev.at, repo)); break;
      case "task_done":
        setState(s, "done", ev.at); s.attention = true;
        if (ev.detail?.summary !== undefined) s.lastSummary = ev.detail.summary;
        notices.push(...notice(s, "done", ev.at, repo));
        break;
      case "model_change": break;
    }
    if (ev.kind !== "session_start") {
      const text = ev.detail?.summary ?? ev.detail?.text ?? ev.detail?.reason ?? ev.kind;
      s.activity.push({ at: ev.at, kind: ev.kind, text });
      if (s.activity.length > CONFIG.activityMax) s.activity.splice(0, s.activity.length - CONFIG.activityMax);
    }

    const c = s.characterId === null ? undefined : characters.get(s.characterId);
    if (c !== undefined) c.lastActiveAt = ev.at;
    out.push(...award(s, ev));
    if (c !== undefined) out.push(characterDelta(c));
    out.push(sessionDelta(s), ...notices);
    return out;
  }

  function tick(now: number): Delta[] {
    const out: Delta[] = [];
    for (const s of [...sessions.values()]) {
      if (now - s.lastEventAt >= CONFIG.sessionStaleMs) endSession(s, now, out);
      else if (s.state === "done" && now - s.stateSince >= CONFIG.doneToIdleMs) {
        setState(s, "idle", s.stateSince + CONFIG.doneToIdleMs);
        out.push(sessionDelta(s));
      }
    }
    return out;
  }

  function ack(sessionKey: string): Delta[] {
    const s = sessions.get(sessionKey);
    if (s === undefined) return [];
    s.attention = false;
    return [sessionDelta(s)];
  }

  function updateCharacter(id: string, patch: { name?: string; look?: Look; retired?: boolean }): Delta[] {
    const c = characters.get(id);
    if (c === undefined) throw new Error(`unknown character ${id}`);
    let name: string | undefined;
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string") throw new Error("name must be a string");
      name = patch.name.trim();
      if (name.length < 1 || name.length > CONFIG.nameMax) throw new Error(`name must be 1 to ${CONFIG.nameMax} characters`);
    }
    if (patch.look !== undefined && !isValidLook(patch.look, levelForXp(c.xp))) throw new Error("invalid look");
    if (patch.retired !== undefined && typeof patch.retired !== "boolean") throw new Error("retired must be a boolean");
    if (name !== undefined) c.name = name;
    if (patch.look !== undefined) c.look = clone(patch.look);
    if (patch.retired !== undefined) c.retired = patch.retired;
    const out: Delta[] = [characterDelta(c)];
    if (c.retired) {
      // hand each live session over as a model change would: release, then the normal assignment (no XP moves)
      for (const s of sessions.values()) {
        if (s.characterId !== c.id) continue;
        s.characterId = null;
        assign(s, s.lastEventAt, out);
        out.push(sessionDelta(s));
      }
    }
    return out;
  }

  function updateSettings(patch: Partial<Settings>): Delta[] {
    const next: Settings = { ...settings };
    if (patch.rosterCap !== undefined) {
      if (!Number.isInteger(patch.rosterCap) || patch.rosterCap < 1 || patch.rosterCap > CONFIG.rosterCapMax) {
        throw new Error(`rosterCap must be an integer from 1 to ${CONFIG.rosterCapMax}`);
      }
      next.rosterCap = patch.rosterCap;
    }
    if (patch.theme !== undefined) {
      if (typeof patch.theme !== "string" || patch.theme.length === 0) throw new Error("theme must be a non-empty string");
      next.theme = patch.theme;
    }
    for (const k of ["notifyNeedsInput", "notifyDone", "sound"] as const) {
      if (patch[k] === undefined) continue;
      if (typeof patch[k] !== "boolean") throw new Error(`${k} must be a boolean`);
      next[k] = patch[k];
    }
    settings = next;
    return [{ type: "settings", settings: clone(settings) }];
  }

  function snapshot(now: number, demo: boolean): Snapshot {
    return clone({
      serverTime: now, demo,
      characters: [...characters.values()], repos: [...repos.values()], sessions: [...sessions.values()], settings,
    });
  }

  return { apply, tick, ack, updateCharacter, updateSettings, snapshot };
}
