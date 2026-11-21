import type { Character, Tier } from "../shared/types";

/**
 * A free, non-retired character of `tier`: highest XP in `repoId` first,
 * otherwise the least recently active. Null when none is free.
 */
export function pickCharacter(characters: Character[], boundIds: Set<string>, tier: Tier, repoId: string): Character | null {
  const free = characters.filter(c => !c.retired && !boundIds.has(c.id) && c.tier === tier);
  if (free.length === 0) return null;
  const xpHere = (c: Character) => c.repoXp[repoId] ?? 0;
  const veterans = free.filter(c => xpHere(c) > 0);
  if (veterans.length > 0) return veterans.reduce((best, c) => (xpHere(c) > xpHere(best) ? c : best));
  return free.reduce((best, c) => (c.lastActiveAt < best.lastActiveAt ? c : best));
}
