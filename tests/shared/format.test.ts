import { expect, test } from "vitest";
import { formatTokens } from "../../src/shared/format";

test("formatTokens", () => {
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(143_200)).toBe("143k");
  expect(formatTokens(1_200_000)).toBe("1.2M");
  expect(formatTokens(200_000)).toBe("200k");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(999_499)).toBe("999k");
  expect(formatTokens(999_600)).toBe("1M");             // never "1000k"
});
