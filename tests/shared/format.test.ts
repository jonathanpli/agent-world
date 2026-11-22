import { expect, test } from "vitest";
import { formatCost, formatTokens } from "../../src/shared/format";

test("formatTokens", () => {
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(143_200)).toBe("143k");
  expect(formatTokens(1_200_000)).toBe("1.2M");
  expect(formatTokens(200_000)).toBe("200k");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(999_499)).toBe("999k");
  expect(formatTokens(999_600)).toBe("1M");             // never "1000k"
});

test("formatCost", () => {
  expect(formatCost(0)).toBe("$0.00");
  expect(formatCost(3_104_000)).toBe("$3.10");
  expect(formatCost(999)).toBe("<$0.01");
  expect(formatCost(1_234_560_000)).toBe("$1,234.56");
  expect(formatCost(10_000)).toBe("$0.01");
  expect(formatCost(4_999)).toBe("<$0.01");
  expect(formatCost(5_000)).toBe("$0.01");
  expect(formatCost(-5_000)).toBe("$0.00");
  expect(formatCost(NaN)).toBe("$0.00");
  expect(formatCost(Infinity)).toBe("$0.00");
  expect(formatCost(-Infinity)).toBe("$0.00");
});
