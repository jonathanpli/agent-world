import { CONFIG } from "./config";
import type { Look } from "./types";

export const BODY_COLORS: string[] = ["#e05555", "#e08a3c", "#e0c040", "#5fb85f", "#3fb5a8", "#4a8fe0", "#7a62d6", "#d462b0", "#8a8f99"];
export const SKIN_TONES: string[] = ["#fbe0c8", "#f1c9a1", "#d9a577", "#b07a4e", "#7d5233"];
export const HAIR_COLORS: string[] = ["#2b2118", "#5a3a22", "#a8692e", "#d8b25a", "#c9462c", "#9aa0a6", "#5b6cd6"];
export const HAIR_STYLES = 6;
export const HATS: string[] = ["cap", "beanie", "headband", "cowboy", "wizard", "crown"];
export const ACCESSORIES: string[] = ["glasses", "scarf", "headphones", "monocle", "cape", "badge"];

const step = CONFIG.cosmeticEveryLevels;

function count(level: number, total: number): number {
  return Math.max(0, Math.min(total, Math.floor(level / step)));
}

export function unlocked(level: number): { hats: string[]; accessories: string[] } {
  return {
    hats: HATS.slice(0, count(level, HATS.length)),
    accessories: ACCESSORIES.slice(0, count(level, ACCESSORIES.length)),
  };
}

export function isValidLook(look: unknown, level: number): look is Look {
  if (typeof look !== "object" || look === null) return false;
  const l = look as Record<string, unknown>;
  if (typeof l.body !== "string" || !BODY_COLORS.includes(l.body)) return false;
  if (typeof l.skin !== "string" || !SKIN_TONES.includes(l.skin)) return false;
  if (typeof l.hairColor !== "string" || !HAIR_COLORS.includes(l.hairColor)) return false;
  if (!Number.isInteger(l.hairStyle) || (l.hairStyle as number) < 0 || (l.hairStyle as number) >= HAIR_STYLES) return false;
  const u = unlocked(level);
  if (l.hat !== null && (typeof l.hat !== "string" || !u.hats.includes(l.hat))) return false;
  if (l.accessory !== null && (typeof l.accessory !== "string" || !u.accessories.includes(l.accessory))) return false;
  return true;
}
