export type Tier = 1 | 2 | 3 | 4;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type CharState = "working" | "needs_input" | "done" | "idle" | "off_duty";
export type ToolKind = "edit" | "shell" | "read" | "web" | "delegate" | "other";
export type Compaction = { uuid: string; trigger: "auto" | "manual"; preTokens: number; postTokens: number };
export type EventKind = "session_start" | "prompt" | "tool" | "needs_input" | "task_done" | "model_change" | "session_end" | "sub_start" | "sub_end" | "context";
export type AgentEvent = {
  source: string; sessionId: string; repoPath: string; at: number; kind: EventKind;
  model?: string; tier?: Tier; effort?: Effort; detail?: Record<string, string>;
  inputKind?: "idle" | "blocking";   // needs_input: "idle" is a nudge after the agent stopped; unspecified means blocking
  repeat?: true;                     // task_done: the end of a continuation a blocking Stop hook forced (no XP, no notice)
  failed?: true;                     // tool: a PostToolUseFailure that was not an interrupt
  contextTokens?: number;            // context
  boundaries?: Compaction[];         // context: every boundary found in the tail, oldest first
};
export type Look = { body: string; skin: string; hairStyle: number; hairColor: string; hat: string | null; accessory: string | null };
export type Character = {
  id: string; name: string; tier: Tier; look: Look; xp: number; createdAt: number; lastActiveAt: number;
  retired: boolean; repoXp: Record<string, number>;          // repoId → xp
  stats: { tasks: number; tools: number; compactions: number; sidekicks: number }; achievements: Record<string, number>; // id → when
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
  pendingStats: { tasks: number; tools: number; compactions: number; sidekicks: number; failures: number };
  startedAt: number; lastEventAt: number; task: string | null; lastSummary: string | null;
  attention: boolean; activity: ActivityLine[];
  sidekicks: Sidekick[];             // running subagents, oldest first
  lastTool: LastTool | null;         // the most recent tool event, successful or failed
  context: ContextInfo | null;       // null until the first reading
};
export type Settings = {
  theme: string; notifyNeedsInput: boolean; notifyDone: boolean; sound: boolean; rosterCap: number;
  notifyContext: boolean; contextWarnPct: number;
  contextLimitOverride: number | null;   // tokens; null = estimate the limit
};
export type NoticeKind = "needs_input" | "done" | "level_up" | "achievement" | "context_low";
export type Notice = { id: string; at: number; kind: NoticeKind; sessionKey: string | null; characterId: string | null; characterName: string; repoName: string | null; text: string };
export type Delta =
  | { type: "character"; character: Character }
  | { type: "repo"; repo: Repo }
  | { type: "session"; session: Session }
  | { type: "session_removed"; key: string }
  | { type: "settings"; settings: Settings }
  | { type: "notice"; notice: Notice }
  /** What one call credited, at the moment it was credited (held "Arriving" XP lands in the binding call). */
  | { type: "credit"; at: number; characterId: string | null; repoId: string;      // null = temp
      tasks: number; tools: number; failures: number; xp: number; levels: number; compactions: number; sidekicks: number }
  /** An automatic compaction raised the learned context limit of `model` (tokens). */
  | { type: "learned_limit"; model: string; limit: number };
export type Snapshot = { serverTime: number; demo: boolean; characters: Character[]; repos: Repo[]; sessions: Session[]; settings: Settings };
