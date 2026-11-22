import type { ShopState } from "./shop";
export type Tier = 1 | 2 | 3 | 4;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type CharState = "working" | "needs_input" | "done" | "idle" | "off_duty";
export type ToolKind = "edit" | "shell" | "read" | "web" | "delegate" | "other";
export type Compaction = { uuid: string; trigger: "auto" | "manual"; preTokens: number; postTokens: number };
export type EventKind = "session_start" | "prompt" | "tool" | "needs_input" | "task_done" | "model_change" | "session_end" | "sub_start" | "sub_end" | "context" | "usage";
export type MomentKind = "commit" | "push" | "pr_opened" | "pr_merged" | "tests_passed" | "tests_failed";
/** cacheWrite is the 5-minute cache writes only and cacheWrite1h the 1-hour ones: disjoint, so their sum is all cache writes. */
export type UsageDelta = { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number };
/** Token totals and their estimated API cost in millionths of a US dollar (an integer; unpriced models add 0). */
export type UsageTotals = UsageDelta & { costMicros: number };
/** Counters a character keeps and a session holds until it credits them. testRuns counts passed and failed runs. */
export type MomentStats = { commits: number; prsOpened: number; prsMerged: number; testRuns: number; testFails: number };
export type AgentEvent = {
  source: string; sessionId: string; repoPath: string; at: number; kind: EventKind;
  model?: string; tier?: Tier; effort?: Effort; detail?: Record<string, string>;
  inputKind?: "idle" | "blocking";   // needs_input: "idle" is a nudge after the agent stopped; unspecified means blocking
  repeat?: true;                     // task_done: the end of a continuation a blocking Stop hook forced (no XP, no notice)
  failed?: true;                     // tool: a PostToolUseFailure that was not an interrupt
  contextTokens?: number;            // context
  boundaries?: Compaction[];         // context: every boundary found in the tail, oldest first
  moment?: MomentKind;               // tool: a git or test moment recognised in a Bash command
  usage?: UsageDelta;                // usage; and tool events for the Agent tool (the subagent's totals)
  usageModel?: string;               // the model the usage is priced at
  sidekick?: true;                   // usage that belongs to a subagent
  longPrompt?: true;                 // usage: every message in this batch had a prompt over 100 000 tokens
};
export type Look = { body: string; skin: string; hairStyle: number; hairColor: string; hat: string | null; accessory: string | null };
export type Character = {
  id: string; name: string; tier: Tier; look: Look; xp: number; createdAt: number; lastActiveAt: number;
  retired: boolean; repoXp: Record<string, number>;          // repoId → xp
  stats: { tasks: number; tools: number; compactions: number; sidekicks: number } & MomentStats; achievements: Record<string, number>; // id → when
  usage: UsageTotals;                // lifetime
};
export type Repo = { id: string; path: string; name: string; createdAt: number };
export type Sidekick = { id: string; type: string; since: number; lastAt: number };
export type LastTool = { kind: ToolKind; at: number; failed: boolean; agentId: string | null };
/** The session's context window: the latest reading, the limit it is measured against, and compactions seen. */
export type ContextInfo = {
  tokens: number;
  peak: number;                      // the highest count this session has shown (readings and boundary preTokens); never decreases
  limit: number;
  estimated: boolean;                // false only when the limit is the owner's override
  compactions: number;               // compaction boundaries applied this session
  warned: boolean;                   // the running-low notice fired for this fill
  seen: string[];                    // the newest boundary uuids already applied (or recorded), at most CONFIG.context.seenMax
};
export type ActivityLine = { at: number; kind: EventKind; text: string };
export type Session = {
  key: string;                       // `${source}:${sessionId}`
  source: string; sessionId: string;
  characterId: string | null;        // null = temp
  tempLook: Look | null;             // set only for temps
  repoId: string; state: Exclude<CharState, "off_duty">; stateSince: number;
  model: string | null; tier: Tier; effort: Effort | null;
  tierKnown: boolean;                // false until an event carries a tier or the grace period ends; unbound until then
  graceSince: number | null;         // when the grace clock started: the first prompt (or first event if seen mid-session)
  pendingXp: number;                 // earned while the tier is unknown, credited on binding
  pendingStats: { tasks: number; tools: number; compactions: number; sidekicks: number; failures: number } & MomentStats;
  startedAt: number; lastEventAt: number; task: string | null; lastSummary: string | null;
  attention: boolean; activity: ActivityLine[];
  sidekicks: Sidekick[];             // running subagents, oldest first
  lastTool: LastTool | null;         // the most recent tool event, successful or failed
  context: ContextInfo | null;       // null until the first reading
  usage: UsageTotals;                // this session's tokens and cost
  pendingUsage: UsageTotals;         // the part of `usage` not yet credited to a character (held while "Arriving")
  moments: Partial<Record<MomentKind, number[]>>;   // when each capped moment earned XP, inside its cap window, oldest first
};
export type Settings = {
  theme: string; notifyNeedsInput: boolean; notifyDone: boolean; sound: boolean; rosterCap: number;
  notifyContext: boolean; contextWarnPct: number;
  contextLimitOverride: number | null;   // tokens; null = estimate the limit
  showCost: boolean;                     // false hides every dollar figure
};
export type NoticeKind = "needs_input" | "done" | "level_up" | "achievement" | "context_low" | "moment";
export type Notice = {
  id: string; at: number; kind: NoticeKind; sessionKey: string | null; characterId: string | null; characterName: string; repoName: string | null; text: string;
  moment?: MomentKind;               // set on "moment" notices
};
export type Delta =
  | { type: "character"; character: Character }
  | { type: "repo"; repo: Repo }
  | { type: "session"; session: Session }
  | { type: "session_removed"; key: string }
  | { type: "settings"; settings: Settings }
  | { type: "notice"; notice: Notice }
  /** What one call credited, at the moment it was credited (held "Arriving" XP lands in the binding call). */
  | { type: "credit"; at: number; characterId: string | null; repoId: string;      // null = temp
      tasks: number; tools: number; failures: number; xp: number; levels: number; compactions: number; sidekicks: number;
      commits: number; prsOpened: number; prsMerged: number; testRuns: number; testFails: number; usage: UsageTotals }
  /** An automatic compaction raised the learned context limit of `model` (tokens). */
  | { type: "learned_limit"; model: string; limit: number }
  /** The wallet or the owned upgrades changed. */
  | { type: "shop"; shop: ShopState }
  /** An upgrade was bought: for the store only, browsers get the `shop` delta. */
  | { type: "purchase"; id: string; boughtAt: number }
  /** How precisely a session's terminal can be brought to the front changed; null = it cannot. */
  | { type: "focus"; key: string; precision: FocusPrecision | null };
/** How precisely the server can bring a session's terminal to the front: its own tab or pane, or only its app. */
export type FocusPrecision = "exact" | "app";
/** What POST /api/sessions/:key/focus did: how precisely the terminal came to the front, and why not more when it could not. */
export type FocusResult = { precision: "exact" | "app"; note?: string };
export type Snapshot = {
  serverTime: number; demo: boolean; characters: Character[]; repos: Repo[]; sessions: Session[]; settings: Settings; shop: ShopState;
  focus: Record<string, FocusPrecision>;   // by session key; a session not listed cannot be focused
};

export type RecapTotals = { tasks: number; tools: number; failures: number; xp: number; levels: number; compactions: number; sidekicks: number } & MomentStats & UsageTotals;
export type Recap = {
  day: string; today: string; totals: RecapTotals;
  characters: ({ characterId: string; name: string } & RecapTotals)[];   // xp desc; excludes temp
  repos: ({ repoId: string; name: string } & RecapTotals)[];             // tasks desc, then tools
  mvpCharacterId: string | null;                                         // most xp, > 0; ties -> most tasks -> name
  streak: number; prevDay: string | null; nextDay: string | null;
};
