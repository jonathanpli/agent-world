import { describe, it, expect } from "vitest";
import { xpForLevel, levelForXp, repoRank } from "../../src/core/levels";

describe("levels", () => {
  it("xpForLevel", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(152);
    expect(xpForLevel(5)).toBe(657);
  });
  it("levelForXp", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(151)).toBe(1);
    expect(levelForXp(152)).toBe(2);
    expect(levelForXp(657)).toBe(5);
  });
  it("repoRank", () => {
    expect(repoRank(0)).toBe("Newcomer");
    expect(repoRank(99)).toBe("Newcomer");
    expect(repoRank(100)).toBe("Regular");
    expect(repoRank(500)).toBe("Veteran");
    expect(repoRank(2000)).toBe("Expert");
    expect(repoRank(6000)).toBe("Legend");
  });
});
