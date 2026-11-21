export type Tier = 1 | 2 | 3 | 4;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type CharState = "working" | "needs_input" | "done" | "idle" | "off_duty";
export type EventKind = "session_start" | "prompt" | "tool" | "needs_input" | "task_done" | "model_change" | "session_end";
export type AgentEvent = {
  source: string; sessionId: string; repoPath: string; at: number; kind: EventKind;
  model?: string; tier?: Tier; effort?: Effort; detail?: Record<string, string>;
};
export type Look = { body: string; skin: string; hairStyle: number; hairColor: string; hat: string | null; accessory: string | null };
export type Character = {
  id: string; name: string; tier: Tier; look: Look; xp: number; createdAt: number; lastActiveAt: number;
  retired: boolean; repoXp: Record<string, number>;          // repoId → xp
  stats: { tasks: number; tools: number }; achievements: Record<string, number>; // id → when
};
export type Repo = { id: string; path: string; name: string; createdAt: number };
export type ActivityLine = { at: number; kind: EventKind; text: string };
export type Session = {
  key: string;                       // `${source}:${sessionId}`
  source: string; sessionId: string;
  characterId: string | null;        // null = temp
  tempLook: Look | null;             // set only for temps
  repoId: string; state: Exclude<CharState, "off_duty">; stateSince: number;
  model: string | null; tier: Tier; effort: Effort | null;
  tierKnown: boolean;                // false until an event carries a tier or the grace period ends; unbound until then
  pendingXp: number; pendingStats: { tasks: number; tools: number };   // earned while the tier is unknown, credited on binding
  startedAt: number; lastEventAt: number; task: string | null; lastSummary: string | null;
  attention: boolean; activity: ActivityLine[];
};
export type Settings = { theme: string; notifyNeedsInput: boolean; notifyDone: boolean; sound: boolean; rosterCap: number };
export type NoticeKind = "needs_input" | "done" | "level_up" | "achievement";
export type Notice = { id: string; at: number; kind: NoticeKind; sessionKey: string | null; characterId: string | null; characterName: string; repoName: string | null; text: string };
export type Delta =
  | { type: "character"; character: Character }
  | { type: "repo"; repo: Repo }
  | { type: "session"; session: Session }
  | { type: "session_removed"; key: string }
  | { type: "settings"; settings: Settings }
  | { type: "notice"; notice: Notice };
export type Snapshot = { serverTime: number; demo: boolean; characters: Character[]; repos: Repo[]; sessions: Session[]; settings: Settings };
