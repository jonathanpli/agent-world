import { CONFIG } from "../../src/shared/config";
import type { Character, Look, Notice, Repo, Session, Snapshot } from "../../src/shared/types";

export const LOOK: Look = { body: "#4a8fe0", skin: "#f1c9a1", hairStyle: 0, hairColor: "#2b2118", hat: null, accessory: null };

export function char(id: string, over: Partial<Character> = {}): Character {
  return {
    id, name: id.toUpperCase(), tier: 2, look: LOOK, xp: 0, createdAt: 0, lastActiveAt: 0, retired: false,
    repoXp: {}, stats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 }, achievements: {},
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 }, ...over,
  };
}

export function repo(id: string, createdAt = 0): Repo {
  return { id, path: `/r/${id}`, name: id, createdAt };
}

export function session(key: string, characterId: string | null, repoId: string, over: Partial<Session> = {}): Session {
  return {
    key, source: "t", sessionId: key, characterId, tempLook: characterId === null ? LOOK : null, repoId,
    state: "working", stateSince: 0, model: null, tier: 2, effort: "medium",
    tierKnown: true, graceSince: null, pendingXp: 0, pendingStats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, failures: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 }, startedAt: 0, lastEventAt: 0,
    task: null, lastSummary: null, attention: false, activity: [], sidekicks: [], lastTool: null, context: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 },
    pendingUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 }, moments: {}, ...over,
  };
}

export function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { serverTime: 0, demo: false, characters: [], repos: [], sessions: [], settings: { ...CONFIG.defaultSettings }, ...over };
}

export function notice(id: string): Notice {
  return { id, at: 0, kind: "done", sessionKey: "k", characterId: "c", characterName: "Bo", repoName: "r", text: `notice ${id}` };
}
