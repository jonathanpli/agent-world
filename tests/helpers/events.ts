import { CONFIG } from "../../src/shared/config";
import { mulberry32 } from "../../src/shared/rng";
import type { AgentEvent, EventKind } from "../../src/shared/types";
import { createWorld, type World, type WorldDeps, type WorldInit } from "../../src/core/world";

export function ev(kind: EventKind, over: Partial<AgentEvent> = {}): AgentEvent {
  return { source: "t", sessionId: "s1", repoPath: "/r/a", at: 1000, kind, ...over };
}

export function deps(): WorldDeps {
  let n = 0;
  return { rng: mulberry32(1), newId: () => `id${++n}` };
}

export function newWorld(init: Partial<WorldInit> = {}): World {
  return createWorld(
    { characters: [], repos: [], sessions: [], settings: { ...CONFIG.defaultSettings }, ...init },
    deps(),
  );
}
