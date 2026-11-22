import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { truncateLog } from "../../src/server/logTruncate";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aw-log-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a log over the cap is emptied; one at the cap or missing is left alone", () => {
  const big = join(dir, "big.log"), exact = join(dir, "exact.log");
  writeFileSync(big, Buffer.alloc(5_000_001));
  writeFileSync(exact, Buffer.alloc(5_000_000));
  truncateLog(big, 5_000_000);
  truncateLog(exact, 5_000_000);
  expect(() => truncateLog(join(dir, "missing.log"), 5_000_000)).not.toThrow();
  expect(statSync(big).size).toBe(0);
  expect(statSync(exact).size).toBe(5_000_000);
});
