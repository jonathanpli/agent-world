import { CONFIG } from "../shared/config";

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(CONFIG.levelBase * Math.pow(level, CONFIG.levelExponent));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function repoRank(repoXp: number): string {
  let name: string = CONFIG.repoRanks[0][0];
  for (const [n, min] of CONFIG.repoRanks) if (repoXp >= min) name = n;
  return name;
}
