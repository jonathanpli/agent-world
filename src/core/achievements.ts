import { CONFIG } from "../shared/config";
import type { Character, Session } from "../shared/types";
import { levelForXp } from "./levels";

export type AchievementDef = { id: string; title: string; description: string };

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_task", title: "First Task", description: "Finish a task." },
  { id: "tasks_100", title: "Centurion", description: `Finish ${CONFIG.achievements.tasksMany} tasks.` },
  { id: "tools_1000", title: "Tool Time", description: `Use ${CONFIG.achievements.toolsMany} tools.` },
  { id: "repos_5", title: "Globetrotter", description: `Earn XP in ${CONFIG.achievements.reposNeeded} repos.` },
  { id: "level_10", title: "Level 10", description: `Reach level ${CONFIG.achievements.levelHigh}.` },
  { id: "level_25", title: "Level 25", description: `Reach level ${CONFIG.achievements.levelTop}.` },
  { id: "legend", title: "Legend", description: `Earn ${CONFIG.achievements.legendRepoXp} XP in one repo.` },
  { id: "night_owl", title: "Night Owl", description: "Finish a task between midnight and 5am." },
  { id: "early_bird", title: "Early Bird", description: "Finish a task between 5am and 7am." },
  { id: "marathon", title: "Marathon", description: "Finish a task in a session over 4 hours old." },
  { id: "delegator", title: "Delegator", description: `${CONFIG.achievements.sidekicksMany} sidekicks finished` },
];

type Ctx = {
  at: number; session: Session; levelBefore: number;
  /** Whether this event finished a task (gates the task-time achievements). Defaults to true. */
  finishedTask?: boolean;
};

const within = (h: number, [lo, hi]: readonly [number, number]): boolean => h >= lo && h <= hi;

/** Ids newly earned, excluding ones already in `c.achievements`. */
export function earned(c: Character, ctx: Ctx): string[] {
  const A = CONFIG.achievements;
  const hour = new Date(ctx.at).getHours();
  const task = ctx.finishedTask ?? true;
  const repoCount = Object.values(c.repoXp).filter(x => x > 0).length;
  const level = levelForXp(c.xp);
  const met: Record<string, boolean> = {
    first_task: c.stats.tasks >= 1,
    tasks_100: c.stats.tasks >= A.tasksMany,
    tools_1000: c.stats.tools >= A.toolsMany,
    repos_5: repoCount >= A.reposNeeded,
    level_10: level >= A.levelHigh,
    level_25: level >= A.levelTop,
    legend: Object.values(c.repoXp).some(x => x >= A.legendRepoXp),
    night_owl: task && within(hour, A.nightHours),
    early_bird: task && within(hour, A.earlyHours),
    marathon: task && ctx.at - ctx.session.startedAt >= A.marathonMs,
    delegator: c.stats.sidekicks >= A.sidekicksMany,
  };
  return ACHIEVEMENTS.filter(a => met[a.id] && c.achievements[a.id] === undefined).map(a => a.id);
}
