/**
 * Per-student quiz accommodations, as the teacher roster reports them
 * (GET /activities/:id/submissions). Students never see anyone else's; their
 * own arrives already applied to timeLimitMinutes and lockdownBrowser.
 */

export interface AccommodationSummary {
  /** This quiz's own accommodation, or the student's school-wide default. */
  source: "activity" | "student";
  timeMultiplier: number | null;
  extraMinutes: number | null;
  lockdownExempt: boolean;
}

/** The roster badges, e.g. ["×1.5 time", "No lockdown"] or ["+20 min"]. */
export function accommodationBadges(
  accommodation: AccommodationSummary | null | undefined,
): string[] {
  if (!accommodation) return [];
  const labels: string[] = [];
  if (accommodation.timeMultiplier) {
    labels.push(`×${Number(accommodation.timeMultiplier.toFixed(2))} time`);
  } else if (accommodation.extraMinutes) {
    labels.push(`+${accommodation.extraMinutes} min`);
  }
  if (accommodation.lockdownExempt) labels.push("No lockdown");
  return labels;
}

/** "45 minutes (extra time: the quiz is 30 minutes)" when the student has extra time. */
export function quizMinutesLabel(
  timeLimitMinutes: number,
  standardTimeLimitMinutes?: number | null,
): string {
  if (standardTimeLimitMinutes && standardTimeLimitMinutes !== timeLimitMinutes) {
    return `${timeLimitMinutes} minutes (extra time: the quiz is ${standardTimeLimitMinutes} minutes)`;
  }
  return `${timeLimitMinutes} minutes`;
}
