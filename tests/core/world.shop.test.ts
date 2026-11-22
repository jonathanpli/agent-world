import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import { ShopError } from "../../src/shared/shop";
import type { Character } from "../../src/shared/types";
import type { World } from "../../src/core/world";
import { ev, newWorld } from "../helpers/events";

const char = (id: string, xp: number, retired = false): Character => ({
  id, name: id, tier: 2, look: { body: "a", skin: "a", hairStyle: 0, hairColor: "a", hat: null, accessory: null }, xp, createdAt: 0, lastActiveAt: 0,
  retired, repoXp: {}, achievements: {},
  stats: { tasks: 0, tools: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0 },
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 },
});
const shop = (w: World) => w.snapshot(0, false).shop;
const code = (fn: () => unknown): string | undefined => { try { fn(); } catch (e) { return e instanceof ShopError ? e.code : "other"; } return undefined; };

test("the wallet is the XP sum on a fresh world, retired characters included", () => {
  expect(shop(newWorld())).toEqual({ coins: 0, owned: [] });
  expect(shop(newWorld({ characters: [char("a", 30), char("b", 70, true)] }))).toEqual({ coins: 100, owned: [] });
});

test("buying with exactly enough coins succeeds and leaves 0", () => {
  const w = newWorld({ characters: [char("a", 100)] });
  const d = w.buy("office.desk-plants", 5);
  expect(d).toEqual([{ type: "purchase", id: "office.desk-plants", boughtAt: 5 }, { type: "shop", shop: { coins: 0, owned: ["office.desk-plants"] } }]);
  expect(shop(w)).toEqual({ coins: 0, owned: ["office.desk-plants"] });
});

test("one coin short throws poor and changes nothing", () => {
  const w = newWorld({ characters: [char("a", 99)] });
  expect(code(() => w.buy("office.desk-plants", 1))).toBe("poor");
  expect(shop(w)).toEqual({ coins: 99, owned: [] });
});

test("buying twice throws owned; an unknown id throws unknown", () => {
  const w = newWorld({ characters: [char("a", 1000)] });
  w.buy("office.desk-plants", 1);
  expect(code(() => w.buy("office.desk-plants", 2))).toBe("owned");
  expect(code(() => w.buy("office.nope", 2))).toBe("unknown");
  expect(shop(w).coins).toBe(900);
});

test("purchases from the init reduce the wallet", () => {
  const w = newWorld({ characters: [char("a", 1000)], purchases: [{ id: "office.desk-plants", boughtAt: 1 }, { id: "space.drink-dispenser", boughtAt: 2 }] });
  expect(shop(w)).toEqual({ coins: 650, owned: ["office.desk-plants", "space.drink-dispenser"] });
  expect(code(() => w.buy("office.desk-plants", 3))).toBe("owned");
});

test("earning XP raises the wallet and emits a shop delta; calls that earn nothing do not", () => {
  const w = newWorld({ settings: { ...CONFIG.defaultSettings } });
  const d = w.apply(ev("session_start"));
  expect(d.some(x => x.type === "shop")).toBe(false);
  const earned = w.apply(ev("prompt"));
  const delta = earned.find(x => x.type === "shop");
  expect(delta).toEqual({ type: "shop", shop: { coins: CONFIG.xp.prompt, owned: [] } });
  expect(earned.at(-1)).toBe(delta);
  expect(shop(w).coins).toBe(CONFIG.xp.prompt);
  expect(w.ack("t:s1").some(x => x.type === "shop")).toBe(false);
});
