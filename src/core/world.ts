import { CONFIG } from "../shared/config";
import { isValidLook } from "../shared/cosmetics";
import { formatTokens } from "../shared/format";
import { costMicros } from "../shared/prices";
import { ShopError, UPGRADES, type ShopState } from "../shared/shop";
import type {
  AgentEvent, Character, ContextInfo, Delta, Look, MomentKind, MomentStats, Notice, NoticeKind, Repo, Session, Settings, Snapshot, Tier, ToolKind,
  UsageTotals,
} from "../shared/types";
import { pickCharacter } from "./assign";
import { earned, ACHIEVEMENTS } from "./achievements";
import { levelForXp } from "./levels";
import { randomLook, randomName } from "./names";

export type WorldInit = {
  characters: Character[]; repos: Repo[]; sessions: Session[]; settings: Settings;
  learnedLimits: Record<string, number>;     // model id → context limit in tokens, learned from automatic compactions
  purchases: { id: string; boughtAt: number }[];
};
export type WorldDeps = { rng: () => number; newId: () => string };
export type World = {
  apply(ev: AgentEvent): Delta[];      // ev.repoPath is already the resolved repo root
  tick(now: number): Delta[];
  ack(sessionKey: string): Delta[];
  end(sessionKey: string, at: number): Delta[];   // dismisses a session as SessionEnd would; [] for an unknown key
  updateCharacter(id: string, patch: { name?: string; look?: Look; retired?: boolean }): Delta[];  // throws Error on invalid patch
  updateSettings(patch: Partial<Settings>): Delta[];                                               // throws Error on invalid patch
  buy(id: string, at: number): Delta[];   // throws ShopError ("unknown" | "owned" | "poor"); emits purchase and shop deltas
  snapshot(now: number, demo: boolean): Snapshot;
};

const TEMP_NAME = "Temp";
/** How notices name a session that is still waiting for its tier (and so has no character yet). */
export const ARRIVAL_NAME = "A new arrival";
const clone = <T>(x: T): T => structuredClone(x);
const noMoments = (): MomentStats => ({ commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 });
const emptyStats = (): Session["pendingStats"] => ({ tasks: 0, tools: 0, compactions: 0, sidekicks: 0, failures: 0, ...noMoments() });
const emptyUsage = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 });
const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "costMicros"] as const;
const addUsage = (to: UsageTotals, u: UsageTotals): void => { for (const k of USAGE_KEYS) to[k] += u[k]; };
const hasUsage = (u: UsageTotals): boolean => USAGE_KEYS.some(k => u[k] > 0);
/** The counter each moment adds to (both test moments are runs; a failed one is also a failure); push counts nowhere. */
const MOMENT_COUNTS: Record<MomentKind, (keyof MomentStats)[]> = {
  commit: ["commits"], push: [], pr_opened: ["prsOpened"], pr_merged: ["prsMerged"], tests_passed: ["testRuns"], tests_failed: ["testRuns", "testFails"],
};
const MOMENT_VERB: Record<MomentKind, (name: string) => string> = {
  commit: n => `${n} committed`, push: n => `${n} pushed`, pr_opened: n => `${n} opened a pull request`,
  pr_merged: n => `${n} merged a pull request`, tests_passed: n => `${n}'s tests passed`, tests_failed: n => `${n}'s tests failed`,
};
type CappedMoment = keyof typeof CONFIG.moments.xp;
const isCapped = (m: MomentKind): m is CappedMoment => m in CONFIG.moments.xp;
const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>(["edit", "shell", "read", "web", "delegate", "other"]);
const toolKind = (k: string | undefined): ToolKind => (k !== undefined && TOOL_KINDS.has(k) ? k as ToolKind : "other");

/**
 * The limit a reading is measured against: the override if set, else the learned limit for the model, else the
 * default. A session whose peak has exceeded that estimate keeps the first step at or above its peak (or the peak
 * itself past the last step), so the limit sticks after a compaction.
 */
function contextLimit(peak: number, override: number | null, learned: number | undefined): { limit: number; estimated: boolean } {
  if (override !== null) return { limit: override, estimated: false };
  const base = learned ?? CONFIG.context.defaultLimit;
  if (peak <= base) return { limit: base, estimated: true };
  return { limit: CONFIG.context.steps.find(step => step >= peak) ?? peak, estimated: true };
}

const sameContext = (a: ContextInfo, b: ContextInfo): boolean =>
  a.tokens === b.tokens && a.peak === b.peak && a.limit === b.limit && a.estimated === b.estimated && a.compactions === b.compactions &&
  a.warned === b.warned && a.seen.length === b.seen.length && a.seen.every((u, i) => u === b.seen[i]);

export function createWorld(init: WorldInit, deps: WorldDeps): World {
  const characters = new Map(init.characters.map(c => [c.id, clone(c)]));
  const repos = new Map(init.repos.map(r => [r.id, clone(r)]));
  const sessions = new Map(init.sessions.map(s => [s.key, clone(s)]));
  let settings: Settings = clone(init.settings);
  const learnedLimits = new Map(Object.entries(init.learnedLimits));
  const purchases = new Map(init.purchases.map(p => [p.id, p.boughtAt]));
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
          stats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, ...noMoments() }, achievements: {}, usage: emptyUsage(),
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
      effort: ev.effort ?? null, tierKnown: ev.tier !== undefined,
      // the grace clock starts at the first prompt; a session first seen mid-way (not at its start) starts it now
      graceSince: ev.tier === undefined && ev.kind !== "session_start" ? ev.at : null,
      pendingXp: 0, pendingStats: emptyStats(),
      startedAt: ev.at, lastEventAt: ev.at, task: null, lastSummary: null, attention: false, activity: [],
      sidekicks: [], lastTool: null, context: null, usage: emptyUsage(), pendingUsage: emptyUsage(), moments: {},
    };
    sessions.set(key, session);
    if (session.tierKnown) assign(session, ev.at, out);
    else session.tempLook = randomLook(deps.rng);
    return session;
  }

  /**
   * Ends the wait for a tier: binds the session at `tier`. The held XP and counters are credited by the next `settle`;
   * for a temp that credit carries the counters only.
   */
  function bindArrival(s: Session, tier: Tier, at: number, out: Delta[]): void {
    s.tierKnown = true;
    s.tier = tier;
    assign(s, at, out);
  }

  /**
   * Ends a session (SessionEnd or stale). One still waiting for its tier that has earned something is bound at the
   * default tier and credited first, so nothing is lost; one that earned nothing just leaves, adding no character.
   */
  function endSession(s: Session, at: number, out: Delta[]): void {
    const held = s.pendingXp > 0 || Object.values(s.pendingStats).some(n => n > 0) || hasUsage(s.pendingUsage);
    if (!s.tierKnown && held) {
      bindArrival(s, s.tier, at, out);
      const c = s.characterId === null ? undefined : characters.get(s.characterId);
      out.push(...settle(s, at, false));
      if (c !== undefined) out.push(characterDelta(c));
    }
    out.push(removeSession(s.key));
  }

  /** Adds the sidekick `id`, or refreshes its `lastAt` if it is already there (its type and start stay as they were). */
  function touchSidekick(s: Session, id: string, type: string, at: number): void {
    const k = s.sidekicks.find(x => x.id === id);
    if (k === undefined) s.sidekicks.push({ id, type, since: at, lastAt: at });
    else k.lastAt = at;
  }

  function setState(s: Session, state: Session["state"], at: number): void {
    if (s.state !== state) { s.state = state; s.stateSince = at; }
  }

  /** A notice about session `s`, naming its character (or "Temp", or the arrival); `text` gets that name. */
  function sessionNotice(s: Session, kind: NoticeKind, at: number, repo: Repo | undefined, text: (name: string) => string, extra: Pick<Notice, "moment"> = {}): { type: "notice"; notice: Notice } {
    const c = s.characterId === null ? undefined : characters.get(s.characterId);
    const name = c?.name ?? (s.tierKnown ? TEMP_NAME : ARRIVAL_NAME);
    const n: Notice = { id: deps.newId(), at, kind, sessionKey: s.key, characterId: c?.id ?? null, characterName: name, repoName: repo?.name ?? null, text: text(name), ...extra };
    return { type: "notice", notice: n };
  }

  /** The moment notice for `ev` and its text, e.g. "Ada committed in agent-world: fix the gauge". */
  function momentNotice(s: Session, moment: MomentKind, ev: AgentEvent, repo: Repo): { type: "notice"; notice: Notice } {
    const subject = ev.detail?.momentText;
    const text = (name: string) => `${MOMENT_VERB[moment](name)} in ${repo.name}${subject ? `: ${subject}` : ""}`;
    return sessionNotice(s, "moment", ev.at, repo, text, { moment });
  }

  /**
   * Adds `ev.usage`, priced at `ev.usageModel` or else the session's model (unpriced: tokens at cost 0), to the session's
   * totals and to what it holds for its character. Returns whether there was any.
   */
  function addEventUsage(s: Session, ev: AgentEvent): boolean {
    if (ev.usage === undefined) return false;
    const u: UsageTotals = { ...ev.usage, costMicros: costMicros(ev.usageModel ?? s.model ?? undefined, ev.usage, ev.longPrompt === true) ?? 0 };
    if (!hasUsage(u)) return false;
    addUsage(s.usage, u);
    addUsage(s.pendingUsage, u);
    return true;
  }

  /** A usage reading for a known session: credited through `settle`; moves no state, attention, XP or lastEventAt. */
  function applyUsage(s: Session, ev: AgentEvent): Delta[] {
    if (!addEventUsage(s, ev)) return [];
    const c = s.characterId === null ? undefined : characters.get(s.characterId);
    const credited = settle(s, ev.at, false);
    const out: Delta[] = [...credited];
    if (c !== undefined && credited.length > 0) out.push(characterDelta(c));
    out.push(sessionDelta(s));
    return out;
  }

  /**
   * The XP a moment earns this session: its reward while under its cap (rewards earned inside the cap window), else 0.
   * Earning records the time in `s.moments`, pruned to the window.
   */
  function momentXp(s: Session, moment: MomentKind, at: number): number {
    if (!isCapped(moment)) return 0;
    const [max, windowMs] = CONFIG.moments.caps[moment];
    const times = (s.moments[moment] ?? []).filter(t => at - t <= windowMs);
    const gain = times.length < max ? CONFIG.moments.xp[moment] : 0;
    if (gain > 0) times.push(at);
    s.moments[moment] = times;
    return gain;
  }

  function notice(s: Session, kind: "needs_input" | "done", at: number, repo: Repo): Delta[] {
    const throttleKey = `${s.key}|${kind}`;
    const last = lastNoticeAt.get(throttleKey);
    if (last !== undefined && at - last < CONFIG.noticeThrottleMs) return [];
    lastNoticeAt.set(throttleKey, at);
    return [sessionNotice(s, kind, at, repo, name => kind === "needs_input" ? `${name} needs you in ${repo.name}` : `${name} finished a task in ${repo.name}`)];
  }

  /**
   * Applies a context reading to a known session. The first reading only records the boundaries already in the tail
   * (the last automatic one still teaches the learned limit); later ones apply each boundary newer than the last one
   * seen, once. Never moves state, attention or lastEventAt.
   */
  function applyContext(s: Session, ev: AgentEvent): Delta[] {
    const prev = s.context;
    const boundaries = ev.boundaries ?? [];
    const seen = prev?.seen ?? [];
    const learned: Delta[] = [];
    let compactions = prev?.compactions ?? 0, warned = prev?.warned ?? false, applied = 0;
    // a boundary at or before the newest one already seen is old, even if it has dropped out of `seen`
    let lastSeen = -1;
    boundaries.forEach((b, i) => { if (seen.includes(b.uuid)) lastSeen = i; });
    const fresh = prev === null ? [] : boundaries.slice(lastSeen + 1).filter(b => !seen.includes(b.uuid));
    for (const b of fresh) {
      compactions++; applied++; warned = false;
      s.pendingStats.compactions++;
      s.activity.push({ at: ev.at, kind: "context", text: `Compacted ${formatTokens(b.preTokens)} → ${formatTokens(b.postTokens)}, ${b.trigger}` });
    }
    // the most recent automatic compaction teaches the learned limit, up or down. Boundaries already in the tail on the
    // first reading are not compactions of this session, but an automatic one still shows where the window filled.
    const latestAuto = (prev === null ? boundaries : fresh).filter(b => b.trigger === "auto").at(-1);
    if (latestAuto !== undefined && s.model !== null && latestAuto.preTokens !== learnedLimits.get(s.model)) {
      learnedLimits.set(s.model, latestAuto.preTokens);
      learned.push({ type: "learned_limit", model: s.model, limit: latestAuto.preTokens });
    }
    if (s.activity.length > CONFIG.activityMax) s.activity.splice(0, s.activity.length - CONFIG.activityMax);
    const newSeen = [...seen, ...(prev === null ? boundaries : fresh).map(b => b.uuid).filter(u => !seen.includes(u))].slice(-CONFIG.context.seenMax);

    const tokens = ev.contextTokens ?? fresh.at(-1)?.postTokens ?? prev?.tokens ?? 0;
    // the highest count the session has shown: every reading and every applied (or, on the first reading, seeded) boundary
    const peak = Math.max(prev?.peak ?? 0, tokens, ...(prev === null ? boundaries : fresh).map(b => b.preTokens));
    const { limit, estimated } = contextLimitFor(s, peak);
    const pct = settings.contextWarnPct;
    // whole-number comparisons: tokens / limit against pct / 100. Only a real fall in tokens re-arms (or a compaction,
    // above): a ratio that fell because the limit stepped up does not.
    if (warned && prev !== null && tokens < prev.tokens && tokens * 100 < (pct - CONFIG.context.rearmPoints) * limit) warned = false;
    const notices: Delta[] = [];
    if (!warned && atWarn(tokens, limit)) {
      warned = true;
      if (settings.notifyContext) {
        const repo = repos.get(s.repoId);
        const share = Math.floor((tokens * 100) / limit);
        notices.push(sessionNotice(s, "context_low", ev.at, repo, name => `${name} is running low on context (${share}%)${repo === undefined ? "" : ` in ${repo.name}`}`));
      }
    }

    const next: ContextInfo = { tokens, peak, limit, estimated, compactions, warned, seen: newSeen };
    if (prev !== null && applied === 0 && notices.length === 0 && sameContext(prev, next)) return [];
    s.context = next;
    const out: Delta[] = [];
    if (applied > 0) {
      const c = s.characterId === null ? undefined : characters.get(s.characterId);
      const credited = settle(s, ev.at, false);
      out.push(...credited);
      if (c !== undefined && credited.length > 0) out.push(characterDelta(c));
    }
    out.push(...learned, sessionDelta(s), ...notices);
    return out;
  }

  /** The limit a reading of session `s` at `peak` is measured against, under the current settings and learned limits. */
  function contextLimitFor(s: Session, peak: number): { limit: number; estimated: boolean } {
    return contextLimit(peak, settings.contextLimitOverride, s.model === null ? undefined : learnedLimits.get(s.model));
  }

  /** Whether `tokens` of `limit` is at or past the warn threshold. */
  const atWarn = (tokens: number, limit: number): boolean => tokens * 100 >= settings.contextWarnPct * limit;

  /**
   * After a settings change, measures every session's last reading against the new limit and threshold. Emits no
   * notice: a reading now past the threshold is only marked warned, and nothing re-arms (the tokens did not fall).
   */
  function remeasureContexts(): Delta[] {
    const out: Delta[] = [];
    for (const s of sessions.values()) {
      const c = s.context;
      if (c === null) continue;
      const { limit, estimated } = contextLimitFor(s, c.peak);
      const next: ContextInfo = { ...c, limit, estimated, warned: c.warned || atWarn(c.tokens, limit) };
      if (sameContext(c, next)) continue;
      s.context = next;
      out.push(sessionDelta(s));
    }
    return out;
  }

  function removeSession(key: string): Delta {
    sessions.delete(key);
    lastNoticeAt.delete(`${key}|needs_input`);
    lastNoticeAt.delete(`${key}|done`);
    toolWindow.delete(key);
    return { type: "session_removed", key };
  }

  /**
   * Adds what `ev` earns to the session's held XP and counters, then settles them. A session still waiting for its
   * tier holds what it earns; a temp earns no XP but its counters are still credited. A failed tool earns nothing and
   * counts as a failure. A moment counts always and earns its XP under its cap. Tokens come only from `usage` events.
   * Returns credit and notices only; apply emits the character delta.
   */
  function award(session: Session, ev: AgentEvent): Delta[] {
    const temp = session.tierKnown && session.characterId === null;
    if (ev.kind === "tool" && ev.moment !== undefined) {
      for (const k of MOMENT_COUNTS[ev.moment]) session.pendingStats[k]++;
      if (!temp && ev.failed !== true) session.pendingXp += momentXp(session, ev.moment, ev.at);
    }
    if (ev.kind === "tool" && ev.failed === true) session.pendingStats.failures++;
    else if (ev.kind === "tool") {
      session.pendingStats.tools++;
      if (!temp) {
        let w = toolWindow.get(session.key);
        if (w === undefined || ev.at - w.start >= CONFIG.toolWindowMs) { w = { start: ev.at, earned: 0 }; toolWindow.set(session.key, w); }
        const gain = Math.min(CONFIG.xp.tool, CONFIG.xp.toolCapPerMinute - w.earned);
        w.earned += gain;
        session.pendingXp += gain;
      }
    } else if (ev.kind === "prompt" && !temp) session.pendingXp += CONFIG.xp.prompt;
    else if (ev.kind === "task_done" && ev.repeat !== true) {
      if (!temp) session.pendingXp += CONFIG.xp.taskDone;
      session.pendingStats.tasks++;
    }
    return settle(session, ev.at, ev.kind === "task_done" && ev.repeat !== true);
  }

  /**
   * Credits the session's held XP, counters and usage to its character with level-ups and achievements, through the one
   * path every award takes, and reports it as one `credit` delta. Held while the tier is unknown. A temp's credit
   * carries its counters and usage with no XP (held XP is dropped). Returns the credit and notices only.
   */
  function settle(session: Session, at: number, finishedTask: boolean): Delta[] {
    if (!session.tierKnown) return [];
    const gain = session.pendingXp, stats = session.pendingStats, usage = session.pendingUsage;
    session.pendingXp = 0;
    session.pendingStats = emptyStats();
    session.pendingUsage = emptyUsage();
    const c = session.characterId === null ? undefined : characters.get(session.characterId);
    const credit = {
      type: "credit" as const, at, characterId: c?.id ?? null, repoId: session.repoId,
      tasks: stats.tasks, tools: stats.tools, failures: stats.failures, xp: c === undefined ? 0 : gain, levels: 0,
      compactions: stats.compactions, sidekicks: stats.sidekicks,
      commits: stats.commits, prsOpened: stats.prsOpened, prsMerged: stats.prsMerged, testRuns: stats.testRuns, testFails: stats.testFails,
      usage,
    };
    const counted = credit.xp > 0 || Object.values(stats).some(n => n > 0) || hasUsage(usage);
    if (!counted) return [];
    if (c === undefined) return [credit];
    c.stats.tools += stats.tools;
    c.stats.tasks += stats.tasks;
    c.stats.compactions += stats.compactions;
    c.stats.sidekicks += stats.sidekicks;
    for (const k of ["commits", "prsOpened", "prsMerged", "testRuns", "testFails"] as const) c.stats[k] += stats[k];
    addUsage(c.usage, usage);

    const levelBefore = levelForXp(c.xp);
    c.xp += gain;
    c.repoXp[session.repoId] = (c.repoXp[session.repoId] ?? 0) + gain;
    c.lastActiveAt = at;

    const repoName = repos.get(session.repoId)?.name ?? null;
    const out: Delta[] = [credit];
    const push = (kind: "level_up" | "achievement", text: string): void => {
      out.push({ type: "notice", notice: { id: deps.newId(), at, kind, sessionKey: session.key, characterId: c.id, characterName: c.name, repoName, text } });
    };
    const levelAfter = levelForXp(c.xp);
    credit.levels = levelAfter - levelBefore;
    if (levelAfter > levelBefore) push("level_up", `${c.name} reached level ${levelAfter}`);
    for (const id of earned(c, { at, session, levelBefore, finishedTask })) {
      c.achievements[id] = at;
      push("achievement", `${c.name} earned ${ACHIEVEMENTS.find(a => a.id === id)!.title}`);
    }
    return out;
  }

  const totalXp = (): number => { let n = 0; for (const c of characters.values()) n += c.xp; return n; };
  function shopState(): ShopState {
    let spent = 0;
    for (const u of UPGRADES) if (purchases.has(u.id)) spent += u.cost;
    return { coins: totalXp() - spent, owned: [...purchases.keys()] };
  }
  /** Runs `fn`; when it changed total XP (the wallet is derived from it), a `shop` delta follows its deltas. */
  function withShop(fn: () => Delta[]): Delta[] {
    const before = totalXp();
    const out = fn();
    return totalXp() === before ? out : [...out, { type: "shop", shop: shopState() }];
  }

  function buy(id: string, at: number): Delta[] {
    const u = UPGRADES.find(x => x.id === id);
    if (u === undefined) throw new ShopError("unknown", "unknown upgrade");
    if (purchases.has(id)) throw new ShopError("owned", "already owned");
    if (shopState().coins < u.cost) throw new ShopError("poor", "not enough coins");
    purchases.set(id, at);
    return [{ type: "purchase", id, boughtAt: at }, { type: "shop", shop: shopState() }];
  }

  function apply(ev: AgentEvent): Delta[] { return withShop(() => applyEvent(ev)); }

  function applyEvent(ev: AgentEvent): Delta[] {
    const key = `${ev.source}:${ev.sessionId}`;
    let s = sessions.get(key);
    if (ev.kind === "session_end") {
      if (s === undefined) return [];
      const out: Delta[] = [];
      if (!s.tierKnown && ev.tier !== undefined) s.tier = ev.tier;
      endSession(s, ev.at, out);
      return out;
    }

    const agentId = ev.kind === "tool" && ev.detail?.agentId ? ev.detail.agentId : null;
    // these never create a session: for an unknown one they do nothing
    if (s === undefined && (ev.kind === "sub_start" || ev.kind === "sub_end" || ev.kind === "context" || ev.kind === "usage" || agentId !== null)) return [];
    if (ev.kind === "context") return s === undefined ? [] : applyContext(s, ev);
    if (ev.kind === "usage") return s === undefined ? [] : applyUsage(s, ev);

    const out: Delta[] = [];
    const repo = repoFor(ev.repoPath, ev.at, out);
    if (s === undefined) s = createSession(ev, key, repo, out);
    // an idle-type nudge (Claude Code's idle_prompt, about a minute after it starts waiting) is only an activity line at rest
    const idleNudge = ev.kind === "needs_input" && ev.inputKind === "idle" && (s.state === "done" || s.state === "idle");

    s.repoId = repo.id;
    s.lastEventAt = ev.at;
    if (ev.effort !== undefined) s.effort = ev.effort;
    if (ev.model !== undefined) s.model = ev.model;
    const tier: Tier = ev.tier ?? s.tier;
    if (!s.tierKnown) {
      // grace counts only from the first prompt: before it the transcript cannot name a model yet
      const graceOver = s.graceSince !== null && ev.at - s.graceSince > CONFIG.modelGraceMs;
      if (ev.tier !== undefined || graceOver) bindArrival(s, tier, ev.at, out);
      else if (ev.kind === "prompt" && s.graceSince === null) s.graceSince = ev.at;
    } else if (tier !== s.tier) {
      s.tier = tier;
      s.characterId = null;          // release before assigning, so the old character is free again
      assign(s, ev.at, out);
    }

    const notices: Delta[] = [];
    switch (ev.kind) {
      case "session_start": break;     // a new session starts idle; compact or resume of a live one keeps its state
      case "prompt": setState(s, "working", ev.at); s.attention = false; s.task = ev.detail?.text ?? null; break;
      case "tool":
        setState(s, "working", ev.at); s.attention = false;
        if (agentId !== null) touchSidekick(s, agentId, ev.detail?.agentType || "agent", ev.at);
        s.lastTool = { kind: toolKind(ev.detail?.toolKind), at: ev.at, failed: ev.failed === true, agentId };
        break;
      case "sub_start":
        if (ev.detail?.agentId) touchSidekick(s, ev.detail.agentId, ev.detail.agentType || "agent", ev.at);
        break;
      case "sub_end": {
        const i = s.sidekicks.findIndex(k => k.id === ev.detail?.agentId);
        if (i >= 0) { s.sidekicks.splice(i, 1); s.pendingStats.sidekicks++; }
        break;
      }
      case "needs_input":
        if (idleNudge) break;
        setState(s, "needs_input", ev.at); s.attention = true; notices.push(...notice(s, "needs_input", ev.at, repo));
        break;
      case "task_done":
        setState(s, "done", ev.at);
        if (ev.detail?.summary !== undefined) s.lastSummary = ev.detail.summary;
        if (ev.repeat) break;          // attention left as it is: not re-raised after an ack, not cleared
        s.attention = true;
        notices.push(...notice(s, "done", ev.at, repo));
        break;
      case "model_change": break;
    }
    if (ev.kind !== "session_start" && ev.kind !== "sub_start" && ev.kind !== "sub_end") {
      const base = ev.detail?.summary ?? ev.detail?.text ?? ev.detail?.reason ?? ev.kind;
      const text = ev.kind === "tool" && ev.failed === true ? `Failed: ${base}` : base;
      s.activity.push({ at: ev.at, kind: ev.kind, text });
      if (ev.kind === "tool" && ev.moment !== undefined) {
        const n = momentNotice(s, ev.moment, ev, repo);
        notices.push(n);
        s.activity.push({ at: ev.at, kind: "tool", text: n.notice.text });
      }
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
      if (now - s.lastEventAt >= CONFIG.sessionStaleMs) { endSession(s, now, out); continue; }
      let changed = false;
      if (s.state === "done" && now - s.stateSince >= CONFIG.doneToIdleMs) {
        setState(s, "idle", s.stateSince + CONFIG.doneToIdleMs);
        changed = true;
      }
      // a missed SubagentStop: drop the sidekick without counting it
      const fresh = s.sidekicks.filter(k => now - k.lastAt <= CONFIG.sidekickStaleMs);
      if (fresh.length !== s.sidekicks.length) { s.sidekicks = fresh; changed = true; }
      if (changed) out.push(sessionDelta(s));
    }
    return out;
  }

  function ack(sessionKey: string): Delta[] {
    const s = sessions.get(sessionKey);
    if (s === undefined) return [];
    s.attention = false;
    return [sessionDelta(s)];
  }

  function end(sessionKey: string, at: number): Delta[] {
    const s = sessions.get(sessionKey);
    if (s === undefined) return [];
    const out: Delta[] = [];
    endSession(s, at, out);
    return out;
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
    if (patch.contextWarnPct !== undefined) {
      const { warnMin, warnMax } = CONFIG.context;
      if (!Number.isInteger(patch.contextWarnPct) || patch.contextWarnPct < warnMin || patch.contextWarnPct > warnMax) {
        throw new Error(`contextWarnPct must be an integer from ${warnMin} to ${warnMax}`);
      }
      next.contextWarnPct = patch.contextWarnPct;
    }
    if (patch.contextLimitOverride !== undefined) {
      const o = patch.contextLimitOverride;
      const min = CONFIG.context.overrideMin;
      if (o !== null && (!Number.isInteger(o) || o < min)) throw new Error(`contextLimitOverride must be an integer of at least ${min} or null`);
      next.contextLimitOverride = o;
    }
    for (const k of ["notifyNeedsInput", "notifyDone", "sound", "notifyContext", "showCost"] as const) {
      if (patch[k] === undefined) continue;
      if (typeof patch[k] !== "boolean") throw new Error(`${k} must be a boolean`);
      next[k] = patch[k];
    }
    const remeasure = next.contextLimitOverride !== settings.contextLimitOverride || next.contextWarnPct !== settings.contextWarnPct;
    settings = next;
    return [{ type: "settings", settings: clone(settings) }, ...(remeasure ? remeasureContexts() : [])];
  }

  function snapshot(now: number, demo: boolean): Snapshot {
    return clone({
      serverTime: now, demo,
      characters: [...characters.values()], repos: [...repos.values()], sessions: [...sessions.values()], settings, shop: shopState(),
      focus: {},                     // the core never sees terminals: the app fills this in
    });
  }

  return {
    apply, tick: now => withShop(() => tick(now)), ack, end: (key, at) => withShop(() => end(key, at)),
    updateCharacter, updateSettings, buy, snapshot,
  };
}
