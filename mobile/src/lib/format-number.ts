/**
 * Scores, points and percentages for display: at most two decimal places,
 * with trailing zeros dropped (6.666… → "6.67", 9.5 → "9.5", 90 → "90").
 * Quiz scores are scaled to an activity's points and so are often long
 * fractions; nobody needs to see past the hundredths.
 */
export function roundScore(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return String(roundScore(n));
}
