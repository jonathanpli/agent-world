import { describe, it, expect } from "vitest";
import { HATS, BODY_COLORS, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, unlocked, isValidLook } from "../../src/shared/cosmetics";

describe("cosmetics", () => {
  it("unlocked", () => {
    expect(unlocked(4)).toEqual({ hats: [], accessories: [] });
    expect(unlocked(5).hats).toEqual([HATS[0]]);
    expect(unlocked(10).hats).toEqual([HATS[0], HATS[1]]);
  });
  it("isValidLook", () => {
    const base = { body: BODY_COLORS[0], skin: SKIN_TONES[0], hairStyle: 0, hairColor: HAIR_COLORS[0], hat: null, accessory: null };
    expect(isValidLook(base, 1)).toBe(true);
    expect(isValidLook({ ...base, hat: HATS[0] }, 4)).toBe(false);
    expect(isValidLook({ ...base, hat: HATS[0] }, 5)).toBe(true);
    expect(isValidLook({ ...base, hairStyle: HAIR_STYLES }, 1)).toBe(false);
    expect(isValidLook({ ...base, body: "#nope" }, 1)).toBe(false);
    expect(isValidLook(null, 1)).toBe(false);
  });
});
