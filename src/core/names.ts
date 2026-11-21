import { BODY_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from "../shared/cosmetics";
import type { Look } from "../shared/types";

const NAMES: string[] = [
  "Ada", "Alan", "Grace", "Linus", "Barbara", "Ken", "Margaret", "Dennis", "Frances", "Edsger",
  "Radia", "Donald", "Hedy", "John", "Katherine", "Guido", "Joan", "Bjarne", "Annie", "Niklaus",
  "Sophie", "Tim", "Mary", "Brian", "Evelyn", "Larry", "Jean", "Rob", "Carol", "Leslie",
  "Shafi", "Vint", "Lynn", "Bob", "Adele", "Yukihiro", "Fran", "Anders", "Kathleen", "James",
];

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** A name not in `taken`; falls back to numbered names once the base list is used up. */
export function randomName(rng: () => number, taken: Set<string>): string {
  const free = NAMES.filter(n => !taken.has(n));
  if (free.length > 0) return pick(rng, free);
  const base = pick(rng, NAMES);
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** A random level-1 look: no hat or accessory, since none are unlocked yet. */
export function randomLook(rng: () => number): Look {
  return {
    body: pick(rng, BODY_COLORS),
    skin: pick(rng, SKIN_TONES),
    hairStyle: Math.floor(rng() * HAIR_STYLES),
    hairColor: pick(rng, HAIR_COLORS),
    hat: null,
    accessory: null,
  };
}
