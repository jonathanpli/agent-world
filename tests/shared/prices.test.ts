import { test, expect } from "vitest";
import { costMicros, PRICES_AS_OF } from "../../src/shared/prices";
import type { UsageDelta } from "../../src/shared/types";

const million: UsageDelta = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6 };
const zero: UsageDelta = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };

test("the table is dated", () => {
  expect(PRICES_AS_OF).toBe("2026-11-21");
});

// a million of each kind costs the row's sum (input + output + 5m write + 1h write + read) in dollars
test.each([
  ["claude-haiku-4-5", 1 + 5 + 1.25 + 2 + 0.10],
  ["claude-sonnet-4-6", 3 + 15 + 3.75 + 6 + 0.30],
  ["claude-opus-4-8", 46.75],
  ["claude-fable-5-1", 10 + 50 + 12.5 + 20 + 0.25],
  ["claude-mythos-5-1", 10 + 50 + 12.5 + 20 + 0.25],
  ["claude-haiku-5-5", 0.10 + 0.50 + 0.125 + 0.20 + 0.01],
  ["claude-sonnet-5-5", 2 + 10 + 2.5 + 4 + 0.10],
  ["claude-opus-5-5", 37.2],
  ["claude-fable-5-2", 74.2],
  ["claude-mythos-5-5", 8 + 40 + 10 + 16 + 0.20],
  ["CLAUDE-OPUS-5-5", 37.2],
])("%s: a million of each costs the row's sum", (model, dollars) => {
  expect(costMicros(model, million, false)).toBe(Math.round(dollars * 1e6));
});

test("the exact figures named in the plan", () => {
  expect(costMicros("claude-opus-5-5", million, false)).toBe(37_200_000);
  expect(costMicros("claude-fable-5-2", million, false)).toBe(74_200_000);
  expect(costMicros("claude-opus-4-8", million, false)).toBe(46_750_000);
});

test("current Haiku uses the long-prompt rate when asked", () => {
  expect(costMicros("claude-haiku-5-5", million, false)).toBe(935_000);
  expect(costMicros("claude-haiku-5-5", million, true)).toBe(4_675_000);   // 0.5 + 2.5 + 0.625 + 1 + 0.05
});

test("previous Haiku has one rate regardless of prompt length", () => {
  expect(costMicros("claude-haiku-4-5", million, true)).toBe(costMicros("claude-haiku-4-5", million, false));
  expect(costMicros("claude-haiku-4-5", million, true)).toBe(9_350_000);
});

test("each kind of token is priced at its own rate", () => {
  const one = (k: keyof UsageDelta) => costMicros("claude-opus-5-5", { ...zero, [k]: 1e6 }, false);
  expect([one("input"), one("output"), one("cacheWrite"), one("cacheWrite1h"), one("cacheRead")]).toEqual([4e6, 20e6, 5e6, 8e6, 0.2e6]);
});

test.each([["gpt-x"], [undefined], ["<synthetic>"], [""]])("%s has no price", model => {
  expect(costMicros(model, million, false)).toBeNull();
});

test("fractional micros round half up per call and the result is always an integer", () => {
  expect(costMicros("claude-haiku-5-5", { ...zero, cacheWrite: 3 }, false)).toBe(0);    // 0.375
  expect(costMicros("claude-haiku-5-5", { ...zero, cacheWrite: 4 }, false)).toBe(1);    // 0.5 rounds up
  expect(costMicros("claude-haiku-5-5", { ...zero, cacheRead: 149 }, false)).toBe(1);   // 1.49
  expect(costMicros("claude-haiku-5-5", { ...zero, cacheRead: 150 }, false)).toBe(2);   // 1.5
  for (let n = 0; n < 500; n += 7) {
    const c = costMicros("claude-haiku-5-5", { input: n, output: n * 3, cacheRead: n * 11, cacheWrite: n * 5, cacheWrite1h: n * 2 }, n % 2 === 0);
    expect(Number.isInteger(c)).toBe(true);
  }
});

test.each([[1.5], [1e308], [-3], [NaN], [Infinity], [2 ** 53]])("a count of %s is priced as 0", n => {
  for (const k of Object.keys(zero) as (keyof UsageDelta)[]) {
    expect(costMicros("claude-opus-5-5", { ...zero, input: 1, [k]: n }, false)).toBe(k === "input" ? 0 : 4);
  }
});

test("the cost is always a safe integer, even for the largest safe counts", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const c = costMicros("claude-fable-5-1", { input: max, output: max, cacheRead: max, cacheWrite: max, cacheWrite1h: max }, false);
  expect(Number.isSafeInteger(c)).toBe(true);
  expect(c).toBe(Number.MAX_SAFE_INTEGER);
  expect(Number.isSafeInteger(costMicros("claude-opus-5-5", { ...zero, output: 1e12 }, false))).toBe(true);
  expect(costMicros("claude-opus-5-5", { ...zero, output: 1e12 }, false)).toBe(20e12);
});

test("large counts stay exact", () => {
  const big: UsageDelta = { input: 3e9, output: 1e9, cacheRead: 7e9, cacheWrite: 2e9, cacheWrite1h: 1e9 };
  // 3000×4 + 1000×20 + 7000×0.2 + 2000×5 + 1000×8 dollars
  expect(costMicros("claude-opus-5-5", big, false)).toBe(51_400 * 1e6);
});
