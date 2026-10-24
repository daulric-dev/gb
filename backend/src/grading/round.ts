/**
 * Two decimals for every score, point total and percentage the API returns.
 * Quiz scores are scaled to the activity's points (2 of 3 right on a 10-point
 * quiz is 6.666…), and nobody needs to see past the hundredths. Stored values
 * keep full precision, and totals are worked out from them before rounding.
 */
export function roundScore(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** roundScore for a nullable database numeric (which arrives as a string). */
export function scoreOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return roundScore(Number(value));
}
