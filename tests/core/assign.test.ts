import { describe, it, expect } from "vitest";
import { pickCharacter } from "../../src/core/assign";
import { randomLook, randomName } from "../../src/core/names";
import { mulberry32 } from "../../src/shared/rng";
import { isValidLook } from "../../src/shared/cosmetics";
import type { Character, Tier } from "../../src/shared/types";

function c(id: string, tier: Tier, over: Partial<Character> = {}): Character {
  return {
    id, name: id, tier,
    look: { body: "#e05555", skin: "#fbe0c8", hairStyle: 0, hairColor: "#2b2118", hat: null, accessory: null },
    xp: 0, createdAt: 0, lastActiveAt: 0, retired: false, repoXp: {},
    stats: { tasks: 0, tools: 0 }, achievements: {}, ...over,
  };
}

describe("pickCharacter", () => {
  it("matches tier only", () => {
    expect(pickCharacter([c("a", 2), c("b", 3)], new Set(), 3, "r1")?.id).toBe("b");
  });
  it("skips bound characters", () => {
    expect(pickCharacter([c("a", 2)], new Set(["a"]), 2, "r1")).toBeNull();
  });
  it("skips retired characters", () => {
    expect(pickCharacter([c("a", 2, { retired: true })], new Set(), 2, "r1")).toBeNull();
  });
  it("prefers highest repo XP", () => {
    expect(pickCharacter([c("a", 2, { repoXp: { r1: 5 } }), c("b", 2, { repoXp: { r1: 50 } }), c("d", 2)], new Set(), 2, "r1")?.id).toBe("b");
  });
  it("otherwise least recently active", () => {
    expect(pickCharacter([c("a", 2, { lastActiveAt: 9 }), c("b", 2, { lastActiveAt: 3 })], new Set(), 2, "r1")?.id).toBe("b");
  });
});

describe("names", () => {
  it("randomName never returns a taken name", () => {
    const rng = mulberry32(7);
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const name = randomName(rng, taken);
      expect(taken.has(name)).toBe(false);
      expect(name.length).toBeGreaterThan(0);
      taken.add(name);
    }
  });
  it("randomLook is valid at level 1", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) expect(isValidLook(randomLook(rng), 1)).toBe(true);
  });
});
