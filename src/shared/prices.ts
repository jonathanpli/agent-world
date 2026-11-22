import type { UsageDelta } from "./types";

/** The day the price table was taken from Anthropic's pricing page. */
export const PRICES_AS_OF = "2026-11-21";

/**
 * Rates in thousandths of a US dollar per million tokens, which is thousandths of a micro-dollar per token: every
 * listed price has at most three decimals, so a cost is an exact integer of these before it is rounded to micros.
 */
type Rates = { input: number; output: number; cacheWrite: number; cacheWrite1h: number; cacheRead: number };
type Row = { match: string[]; rates: Rates; longPrompt?: Rates };

const r = (input: number, output: number, cacheWrite: number, cacheWrite1h: number, cacheRead: number): Rates =>
  ({ input, output, cacheWrite, cacheWrite1h, cacheRead });

/** USD per million tokens × 1000, matched on the lower-cased model id; the first row with a matching substring wins. */
const TABLE: Row[] = [
  { match: ["haiku-4"], rates: r(1_000, 5_000, 1_250, 2_000, 100) },
  { match: ["sonnet-4"], rates: r(3_000, 15_000, 3_750, 6_000, 300) },
  { match: ["opus-4"], rates: r(5_000, 25_000, 6_250, 10_000, 500) },
  { match: ["fable-5-1", "mythos-5-1"], rates: r(10_000, 50_000, 12_500, 20_000, 250) },
  { match: ["haiku"], rates: r(100, 500, 125, 200, 10), longPrompt: r(500, 2_500, 625, 1_000, 50) },
  { match: ["sonnet"], rates: r(2_000, 10_000, 2_500, 4_000, 100) },
  { match: ["opus"], rates: r(4_000, 20_000, 5_000, 8_000, 200) },
  { match: ["fable", "mythos"], rates: r(8_000, 40_000, 10_000, 16_000, 200) },
];

/** A count as a BigInt: anything but a whole, safe, non-negative number is 0. */
const tokens = (n: number): bigint => (Number.isSafeInteger(n) && n > 0 ? BigInt(n) : 0n);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The estimated API cost of `u` in micro-dollars, or null when the model has no price. `longPrompt` picks Haiku's
 * rate for prompts over 100 000 tokens where the row has one. The cost is computed exactly, then rounded half up to
 * a whole micro-dollar: per-call rounding is the precision, so callers sum these integers without drift. A count that
 * is not a whole, safe, non-negative number counts as 0, and the result is always a safe integer (capped at the largest).
 */
export function costMicros(model: string | undefined, u: UsageDelta, longPrompt: boolean): number | null {
  if (model === undefined) return null;
  const id = model.toLowerCase();
  const row = TABLE.find(x => x.match.some(m => id.includes(m)));
  if (row === undefined) return null;
  const p = longPrompt && row.longPrompt !== undefined ? row.longPrompt : row.rates;
  const milli = tokens(u.input) * BigInt(p.input) + tokens(u.output) * BigInt(p.output) + tokens(u.cacheWrite) * BigInt(p.cacheWrite)
    + tokens(u.cacheWrite1h) * BigInt(p.cacheWrite1h) + tokens(u.cacheRead) * BigInt(p.cacheRead);
  const micros = (milli + 500n) / 1000n;
  return Number(micros > MAX_SAFE ? MAX_SAFE : micros);
}
