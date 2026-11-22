import { expect, test } from "vitest";
import { UPGRADES } from "../../src/shared/shop";

const THEMES = ["office", "space", "underwater"] as const;

test("the catalog has 18 unique ids, 6 per theme, prefixed by their theme", () => {
  expect(UPGRADES).toHaveLength(18);
  expect(new Set(UPGRADES.map(u => u.id)).size).toBe(18);
  for (const t of THEMES) {
    const items = UPGRADES.filter(u => u.theme === t);
    expect(items).toHaveLength(6);
    expect(items.every(u => u.id.startsWith(`${t}.`) && /^[a-z]+\.[a-z0-9-]+$/.test(u.id))).toBe(true);
  }
});

test("each theme costs exactly 100, 250, 500, 1000, 2500, 5000 in order", () => {
  for (const t of THEMES) expect(UPGRADES.filter(u => u.theme === t).map(u => u.cost)).toEqual([100, 250, 500, 1000, 2500, 5000]);
});

test("names match the design table and every item has a description", () => {
  const names = (t: string) => UPGRADES.filter(u => u.theme === t).map(u => u.name);
  expect(names("office")).toEqual(["Office plants", "Coffee machine", "Wall art", "Arcade cabinet", "Fish tank", "Rooftop skylight"]);
  expect(names("space")).toEqual(["Hydroponic planter", "Drink dispenser", "Star chart display", "Observation dome", "Docked shuttle", "Ringed planet in the window"]);
  expect(names("underwater")).toEqual(["Sea anemones", "Treasure chest", "Sunken statue", "Glowing jellyfish swarm", "Shipwreck", "Friendly whale that passes by"]);
  expect(UPGRADES.every(u => u.description.length > 0)).toBe(true);
});

test("the ids the art tasks key on exist", () => {
  const ids = UPGRADES.map(u => u.id);
  expect(ids).toEqual(expect.arrayContaining(["office.desk-plants", "office.coffee-machine", "space.drink-dispenser", "underwater.treasure-chest"]));
});

test("the 100-coin office upgrade is named for its art (planters along the walls) and keeps its saved id", () => {
  const u = UPGRADES.find(x => x.id === "office.desk-plants");
  expect(u).toEqual({ id: "office.desk-plants", theme: "office", name: "Office plants", description: "Planters along the walls.", cost: 100 });
  expect(UPGRADES.some(x => x.id === "office.office-plants")).toBe(false);
});
