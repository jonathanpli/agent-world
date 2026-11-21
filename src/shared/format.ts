/** Tokens for display: 950 → "950", 143 200 → "143k", 999 600 → "1M", 1 200 000 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1_000)}k`;
  return `${(Math.round(n / 100_000) / 10).toString()}M`;
}
