/**
 * "Late (2 days)" from a submission's lateSeconds. A started day counts as a
 * day, matching how the late penalty counts it; under a day shows hours.
 */
export function lateLabel(lateSeconds: number): string {
  if (lateSeconds <= 0) return "";
  if (lateSeconds < 86_400) {
    const hours = Math.ceil(lateSeconds / 3_600);
    return `Late (${hours} ${hours === 1 ? "hour" : "hours"})`;
  }
  const days = Math.ceil(lateSeconds / 86_400);
  return `Late (${days} ${days === 1 ? "day" : "days"})`;
}

/** "85 − 10% late = 76.5" (or the plain mark when there is no penalty). */
export function penaltyBreakdown(
  rawScore: number | null | undefined,
  percent: number | null | undefined,
  score: number | null | undefined,
  waived = false,
): string | null {
  if (!percent || rawScore === null || rawScore === undefined) return null;
  if (waived) return `${rawScore} (${percent}% late penalty waived)`;
  return `${rawScore} − ${percent}% late = ${score ?? ""}`;
}
