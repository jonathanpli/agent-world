import { describe, expect, test, vi } from "vitest";
import { DEFAULTS, drawUpgrades } from "../../src/client/engine/extras";
import { BURST_COLORS, burstParticles, drawScreens } from "../../src/client/engine/loop";
import { socialSpotsWith } from "../../src/client/engine/social";
import { getTheme, ownedFor, VIEW, type Ctx, type Particle, type Theme } from "../../src/client/engine/theme";
import { mulberry32 } from "../../src/shared/rng";
import { mockCtx } from "../helpers/mockCtx";

describe("ownedFor", () => {
  test("keeps only that theme's ids", () => {
    const owned = ["office.coffee-machine", "space.drink-dispenser", "office.desk-plants", "underwater.treasure-chest"];
    expect([...ownedFor("office", owned)].sort()).toEqual(["office.coffee-machine", "office.desk-plants"]);
    expect([...ownedFor("space", owned)]).toEqual(["space.drink-dispenser"]);
    expect([...ownedFor("underwater", owned)]).toEqual(["underwater.treasure-chest"]);
  });
  test("matches the whole theme prefix, not a look-alike", () => {
    expect(ownedFor("office", ["officex.coffee-machine", "office", "xoffice.a"]).size).toBe(0);
  });
  test("nothing owned, or bad data, gives an empty set", () => {
    expect(ownedFor("office", []).size).toBe(0);
    expect(ownedFor("office", null as never).size).toBe(0);
    expect(ownedFor("office", [3 as never, "office.desk-plants"])).toEqual(new Set(["office.desk-plants"]));
  });
});

describe("socialSpotsWith", () => {
  const lounge = { x: 10, y: 20, w: 40, h: 30 };
  const base = { lounge, socialSpots: [{ x: 20, y: 30 }] };
  const theme = (upgradeSocialSpots: Record<string, unknown>): Theme =>
    ({ ...getTheme("office"), ...base, upgradeSocialSpots } as unknown as Theme);

  test("adds the spots of owned upgrades only", () => {
    const t = theme({ "office.coffee-machine": { x: 40, y: 40 }, "office.arcade-cabinet": { x: 30, y: 25 } });
    expect(socialSpotsWith(t, new Set())).toEqual([{ x: 20, y: 30 }]);
    expect(socialSpotsWith(t, new Set(["office.coffee-machine"]))).toEqual([{ x: 20, y: 30 }, { x: 40, y: 40 }]);
  });
  test("drops spots outside the lounge or not finite", () => {
    const t = theme({
      "office.a": { x: 5, y: 30 }, "office.b": { x: 20, y: 60 }, "office.c": { x: NaN, y: 30 },
      "office.d": { x: Infinity, y: 30 }, "office.e": null, "office.f": { x: "20", y: 30 }, "office.g": { x: 50, y: 50 },
    });
    const all = new Set(["office.a", "office.b", "office.c", "office.d", "office.e", "office.f", "office.g"]);
    expect(socialSpotsWith(t, all)).toEqual([{ x: 20, y: 30 }, { x: 50, y: 50 }]);   // the lounge edge counts as inside
  });
  test("a theme without upgrade spots gives its plain social spots", () => {
    const t = { ...getTheme("office"), ...base } as Theme;
    delete t.upgradeSocialSpots;
    expect(socialSpotsWith(t, new Set(["office.coffee-machine"]))).toEqual([{ x: 20, y: 30 }]);
  });
  test("a theme whose upgrade spots throw keeps its plain spots, and never throws", () => {
    const t = { ...getTheme("office"), ...base, get upgradeSocialSpots(): never { throw new Error("boom"); } } as unknown as Theme;
    expect(socialSpotsWith(t, new Set(["office.coffee-machine"]))).toEqual([{ x: 20, y: 30 }]);
  });
  test("an inherited key is not an owned spot", () => {
    const t = theme({});
    expect(socialSpotsWith(t, new Set(["toString", "constructor"]))).toEqual([{ x: 20, y: 30 }]);
  });
});

/** A spy theme: office with every backdrop and upgrade call recorded. */
function spyTheme(id: string, drawUp?: Theme["drawUpgrades"]): { theme: Theme; calls: { what: string; screen: number; owned?: string[] }[] } {
  const calls: { what: string; screen: number; owned?: string[] }[] = [];
  const theme = {
    ...getTheme("office"), id,
    drawBackdrop: (_c: Ctx, _t: number, screen: number) => { calls.push({ what: "backdrop", screen }); },
  } as Theme;
  if (drawUp !== undefined) theme.drawUpgrades = (c, owned, t, screen) => { calls.push({ what: "upgrades", screen, owned: [...owned].sort() }); drawUp(c, owned, t, screen); };
  else delete theme.drawUpgrades;
  return { theme, calls };
}

describe("drawScreens", () => {
  const owned = ["office.desk-plants", "space.drink-dispenser", "office.wall-art"];

  test("draws each visible screen's backdrop, then its upgrades with only that theme's owned ids", () => {
    const { theme, calls } = spyTheme("office", () => {});
    drawScreens(mockCtx(), theme, getTheme("office"), 0, 0, owned);
    expect(calls).toEqual([
      { what: "backdrop", screen: 0 },
      { what: "upgrades", screen: 0, owned: ["office.desk-plants", "office.wall-art"] },
    ]);
  });
  test("mid-pan, both visible screens get one call each", () => {
    const { theme, calls } = spyTheme("office", () => {});
    drawScreens(mockCtx(), theme, getTheme("office"), VIEW.w * 0.5, 0, owned);
    expect(calls.map(c => `${c.what}${c.screen}`)).toEqual(["backdrop0", "upgrades0", "backdrop1", "upgrades1"]);
  });
  test("the owned set is the drawn theme's own", () => {
    const { theme, calls } = spyTheme("space", () => {});
    drawScreens(mockCtx(), theme, getTheme("office"), 0, 0, owned);
    expect(calls.find(c => c.what === "upgrades")?.owned).toEqual(["space.drink-dispenser"]);
  });
  test("a throwing drawUpgrades does not stop the frame, and no other theme's upgrades draw instead", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const office = getTheme("office");
    const officeUp = vi.fn();
    const fallback = { ...office, drawUpgrades: officeUp } as Theme;
    const { theme, calls } = spyTheme("space-broken-upgrades", () => { throw new Error("boom"); });
    expect(() => drawScreens(mockCtx(), theme, fallback, VIEW.w * 0.5, 0, owned)).not.toThrow();
    expect(calls.map(c => `${c.what}${c.screen}`)).toEqual(["backdrop0", "upgrades0", "backdrop1", "upgrades1"]);
    expect(officeUp).not.toHaveBeenCalled();
    errors.mockRestore();
  });
  test("a theme without drawUpgrades draws nothing extra", () => {
    const { theme, calls } = spyTheme("plain-no-upgrades");
    const ctx = mockCtx();
    const spy = vi.spyOn(DEFAULTS, "drawUpgrades");
    drawScreens(ctx, theme, getTheme("office"), 0, 0, owned);
    expect(calls).toEqual([{ what: "backdrop", screen: 0 }]);
    expect(spy).toHaveBeenCalledTimes(1);                   // the engine default, which draws nothing
    spy.mockRestore();
  });
});

test("the engine default for drawUpgrades draws nothing", () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn() } as unknown as Ctx;
  const theme = { ...getTheme("office"), id: "no-upgrades" } as Theme;
  delete theme.drawUpgrades;
  drawUpgrades(ctx, theme, new Set(["office.desk-plants"]), 0, 0);
  expect(ctx.fillRect).not.toHaveBeenCalled();
  expect(ctx.drawImage).not.toHaveBeenCalled();
});

describe("burstParticles", () => {
  const office = getTheme("office");
  const at = { x: 40, y: 50 };
  const celebrate = (): Particle[] => office.effects.celebrate({ ...at }, mulberry32(7));

  test("the moment colours", () => {
    expect(BURST_COLORS).toEqual({ commit: "#5fd38a", merge: "#b58cff" });
  });
  for (const kind of ["commit", "merge"] as const) test(`${kind}: the celebrate particles, recoloured`, () => {
    const ps = burstParticles(office, office, kind, at, mulberry32(7));
    const plain = celebrate();
    expect(ps.length).toBe(plain.length);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p.color).toBe(BURST_COLORS[kind]);
    expect(ps.map(p => ({ ...p, color: "" }))).toEqual(plain.map(p => ({ ...p, color: "" })));
  });
  test("celebrate and levelUp keep the theme's own colours", () => {
    expect(burstParticles(office, office, "celebrate", at, mulberry32(7))).toEqual(celebrate());
    expect(burstParticles(office, office, "levelUp", at, mulberry32(7))).toEqual(office.effects.levelUp({ ...at }, mulberry32(7)));
  });
  test("a theme whose effects throw falls back, and never throws", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { ...office, id: "bad-effects", effects: { celebrate: () => { throw new Error("boom"); }, levelUp: () => [] } } as Theme;
    let ps: Particle[] = [];
    expect(() => { ps = burstParticles(bad, office, "merge", at, mulberry32(7)); }).not.toThrow();
    expect(ps.length).toBe(celebrate().length);
    for (const p of ps) expect(p.color).toBe(BURST_COLORS.merge);
    errors.mockRestore();
  });
});
