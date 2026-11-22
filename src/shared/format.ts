/** Tokens for display: 950 → "950", 143 200 → "143k", 999 600 → "1M", 1 200 000 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1_000)}k`;
  return `${(Math.round(n / 100_000) / 10).toString()}M`;
}

/** An estimated dollar cost from millionths of a dollar: 3 104 000 → "$3.10", 999 → "<$0.01", 0 → "$0.00". */
export function formatCost(micros: number): string {
  const cents = Math.round(micros / 10_000);
  if (micros > 0 && cents === 0) return "<$0.01";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
