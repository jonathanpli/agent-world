import type { AgentEvent } from "../shared/types";
import { claudeCode } from "./claudeCode";

/** Pure; never throws; returns [] for anything unrecognized. */
export type Adapter = { source: string; parse(raw: unknown, now: number): AgentEvent[] };

export const ADAPTERS: Record<string, Adapter> = { "claude-code": claudeCode };
