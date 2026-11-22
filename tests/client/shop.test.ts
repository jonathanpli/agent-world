import { expect, test } from "vitest";
import { UPGRADES } from "../../src/shared/shop";
import { buyButton, buyDecision, formatCoins, shopItems } from "../../src/client/ui/shop";

test("formatCoins groups thousands", () => {
  expect(formatCoins(950)).toBe("950");
  expect(formatCoins(12_400)).toBe("12,400");
  expect(formatCoins(0)).toBe("0");
});

test("shopItems lists a world's six by cost", () => {
  const items = shopItems("space", { coins: 0, owned: [] });
  expect(items).toHaveLength(6);
  expect(items.every(i => i.upgrade.theme === "space")).toBe(true);
  expect(items.map(i => i.upgrade.cost)).toEqual([100, 250, 500, 1000, 2500, 5000]);
});

test("unknown theme has no items", () => {
  expect(shopItems("nope", { coins: 999, owned: [] })).toEqual([]);
});

test("exact coins is buyable, one short is poor", () => {
  expect(shopItems("office", { coins: 100, owned: [] })[0]).toMatchObject({ status: "buyable", reason: null });
  expect(shopItems("office", { coins: 99, owned: [] })[0]).toMatchObject({ status: "poor", reason: "Need 1 more coin" });
  expect(shopItems("office", { coins: 0, owned: [] })[1]).toMatchObject({ status: "poor", reason: "Need 250 more coins" });
});

test("owned wins over coins", () => {
  const id = UPGRADES.find(u => u.theme === "office")!.id;
  expect(shopItems("office", { coins: 9999, owned: [id] })[0]).toMatchObject({ status: "owned", reason: null });
});

test("a click only confirms and buys a buyable item", () => {
  const [owned, buyable, poor] = [
    { ...shopItems("office", { coins: 250, owned: ["office.desk-plants"] })[0]! },
    shopItems("office", { coins: 250, owned: [] })[1]!,
    shopItems("office", { coins: 0, owned: [] })[1]!,
  ];
  expect(buyDecision(owned)).toBeNull();
  expect(buyDecision(poor)).toBeNull();
  expect(buyDecision(buyable)).toEqual({ id: "office.coffee-machine", prompt: "Buy Coffee machine for 250 coins?" });
});

test("while a buy is in flight its button reads Buying…, is disabled, and a click on it does nothing", () => {
  const [plants, coffee] = shopItems("office", { coins: 500, owned: [] });
  const pending = new Set(["office.desk-plants"]);
  expect(buyButton(plants!, pending)).toEqual({ label: "Buying…", disabled: true });
  expect(buyDecision(plants!, pending)).toBeNull();
  // another item is unaffected
  expect(buyButton(coffee!, pending)).toEqual({ label: "Buy", disabled: false });
  expect(buyDecision(coffee!, pending)).toEqual({ id: "office.coffee-machine", prompt: "Buy Coffee machine for 250 coins?" });
  // settled: back to normal
  expect(buyButton(plants!, new Set())).toEqual({ label: "Buy", disabled: false });
  expect(buyDecision(plants!, new Set())).toMatchObject({ id: "office.desk-plants" });
  // a poor item stays disabled
  expect(buyButton(shopItems("office", { coins: 0, owned: [] })[0]!, new Set())).toEqual({ label: "Buy", disabled: true });
});
