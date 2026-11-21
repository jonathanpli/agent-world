import type { ContextInfo, LastTool, Session, ToolKind } from "../../shared/types";
import type { Point } from "./theme";
import { VIEW } from "./view";

/** How long a tool action plays, and how long the compaction moment lasts (ms). */
export const ACTION_MS = 2_500;
export const COMPACTION_MS = 2_000;
/** Sidekicks drawn beside a work spot; any beyond are counted on a "+n" tag. */
export const SIDEKICKS_SHOWN = 3;

const SLOT = { first: 11, step: 7, margin: 4 } as const;   // px from the spot to the first sidekick, between them, from the screen edge

/** The tool action an actor (or one of its sidekicks) is playing. `startedAt` is the tool's `at` (epoch ms). */
export type ActiveAction = { kind: ToolKind; failed: boolean; agentId: string | null; startedAt: number };

/**
 * The action to play now. A tool whose `at` differs from the current action's start begins a new one (replacing it);
 * an action ends ACTION_MS after its start, so a tool already that old never plays.
 */
export function nextAction(prev: ActiveAction | null, lastTool: LastTool | null, now: number): ActiveAction | null {
  if (lastTool === null || now - lastTool.at >= ACTION_MS) return null;
  if (prev !== null && prev.startedAt === lastTool.at) return prev;
  return { kind: lastTool.kind, failed: lastTool.failed, agentId: lastTool.agentId, startedAt: lastTool.at };
}

/** Percentage of the window in use (unclamped; 0 for a zero limit). Same rule as the inspector's context level. */
export function contextUsePct(c: ContextInfo): number {
  return c.limit > 0 ? (c.tokens / c.limit) * 100 : 0;
}

/** The gauge's fill step: below 25%, 50%, 75%, and from 75% up. */
export function gaugeStep(c: ContextInfo): 0 | 1 | 2 | 3 {
  const pct = contextUsePct(c);
  return pct < 25 ? 0 : pct < 50 ? 1 : pct < 75 ? 2 : 3;
}

/**
 * Where up to SIDEKICKS_SHOWN sidekicks stand beside a work spot (to its right, or its left near the screen's right
 * edge), kept inside the screen that holds the spot. `more` is how many are left over for the "+n" tag.
 */
export function sidekickSlots(spot: Point, count: number): { points: Point[]; more: number } {
  const shown = Math.max(0, Math.min(SIDEKICKS_SHOWN, count));
  const left = Math.floor(spot.x / VIEW.w) * VIEW.w;
  const span = SLOT.first + (SIDEKICKS_SHOWN - 1) * SLOT.step;
  const dir = spot.x + span > left + VIEW.w - SLOT.margin ? -1 : 1;
  const y = Math.max(0, Math.min(VIEW.h - 1, Math.round(spot.y)));
  const points: Point[] = [];
  for (let i = 0; i < shown; i++) {
    const x = Math.round(spot.x + dir * (SLOT.first + i * SLOT.step));
    points.push({ x: Math.max(left + SLOT.margin, Math.min(left + VIEW.w - SLOT.margin, x)), y });
  }
  return { points, more: Math.max(0, count - SIDEKICKS_SHOWN) };
}

/** Per actor: the compaction count last seen, and when the current compaction moment began (null = none playing). */
export type CompactionWatch = { count: number; startedAt: number | null };

/** A rise in `count` starts a COMPACTION_MS moment; the first reading and any fall only set the baseline. */
export function nextCompaction(prev: CompactionWatch | undefined, count: number, now: number): CompactionWatch {
  if (prev === undefined || count < prev.count) return { count, startedAt: null };
  if (count > prev.count) return { count, startedAt: now };
  return prev.startedAt !== null && now - prev.startedAt >= COMPACTION_MS ? { count, startedAt: null } : prev;
}

/** What to draw at a session-bound actor's work spot this frame. `action` is the one to draw at the spot, if any. */
export type Extras = { gauge: boolean; sidekicks: boolean; busySidekick: string | null; action: ActiveAction | null; compaction: boolean };

/**
 * Nothing until the actor has arrived at its work spot. Then the gauge (once there is a reading), the sidekicks, and
 * the compaction moment while `compacting`. An action owned by a drawn sidekick (one of the first SIDEKICKS_SHOWN)
 * only makes that sidekick busy; any other action plays at the spot. No action, and no busy sidekick, while it needs you.
 */
export function extrasFor(session: Session, arrived: boolean, action: ActiveAction | null, compacting: boolean): Extras {
  if (!arrived) return { gauge: false, sidekicks: false, busySidekick: null, action: null, compaction: false };
  const live = session.state === "needs_input" ? null : action;
  const drawn = session.sidekicks.slice(0, SIDEKICKS_SHOWN);
  const owner = live?.agentId == null ? undefined : drawn.find(k => k.id === live.agentId);
  return {
    gauge: session.context !== null,
    sidekicks: session.sidekicks.length > 0,
    busySidekick: owner?.id ?? null,
    action: owner === undefined ? live : null,
    compaction: compacting,
  };
}
