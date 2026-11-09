/**
 * Per-student quiz accommodations: extra time (a multiplier or extra
 * minutes) and an exemption from Lockdown. The server checks the same rules.
 */

export const TIME_MULTIPLIERS = [1.25, 1.5, 2] as const;
export const MAX_EXTRA_MINUTES = 600;

/** The roster's view of an accommodation (staff only). */
export interface AccommodationSummary {
  /** This quiz's own accommodation, or the student's school-wide default. */
  source: "activity" | "student";
  timeMultiplier: number | null;
  extraMinutes: number | null;
  lockdownExempt: boolean;
}

/** A saved accommodation (on one quiz, or a student's default). */
export interface Accommodation {
  id: string;
  studentId: string;
  activityId?: string;
  timeMultiplier: number | null;
  extraMinutes: number | null;
  lockdownExempt: boolean;
  reason: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** The body of PUT .../accommodations/:studentId and PUT /students/:id/accommodation. */
export interface AccommodationRequest {
  timeMultiplier: number | null;
  extraMinutes: number | null;
  lockdownExempt: boolean;
  reason?: string;
}

/** What the dialog edits. `time` is "none", "extra", or a multiplier as text. */
export interface AccommodationForm {
  time: string;
  extraMinutes: string;
  lockdownExempt: boolean;
  reason: string;
}

/** "×1.5" - "×1.25", "×2". */
export function multiplierLabel(multiplier: number): string {
  return `×${Number(multiplier.toFixed(2))}`;
}

/** The roster badges, e.g. ["×1.5 time", "No lockdown"] or ["+20 min"]. */
export function accommodationBadges(
  accommodation:
    | Pick<AccommodationSummary, "timeMultiplier" | "extraMinutes" | "lockdownExempt">
    | null
    | undefined,
): string[] {
  if (!accommodation) return [];
  const labels: string[] = [];
  if (accommodation.timeMultiplier) {
    labels.push(`${multiplierLabel(accommodation.timeMultiplier)} time`);
  } else if (accommodation.extraMinutes) {
    labels.push(`+${accommodation.extraMinutes} min`);
  }
  if (accommodation.lockdownExempt) labels.push("No lockdown");
  return labels;
}

/** The dialog's starting values from what the student has now. */
export function accommodationForm(
  current:
    | (Pick<Accommodation, "timeMultiplier" | "extraMinutes" | "lockdownExempt"> & {
        reason?: string | null;
      })
    | null
    | undefined,
): AccommodationForm {
  return {
    time: current?.timeMultiplier
      ? String(current.timeMultiplier)
      : current?.extraMinutes
        ? "extra"
        : "none",
    extraMinutes: current?.extraMinutes ? String(current.extraMinutes) : "",
    lockdownExempt: !!current?.lockdownExempt,
    reason: current?.reason ?? "",
  };
}

/** Check the dialog and build the request body. */
export function accommodationRequest(
  form: AccommodationForm,
): { ok: true; body: AccommodationRequest } | { ok: false; error: string } {
  let timeMultiplier: number | null = null;
  let extraMinutes: number | null = null;
  if (form.time === "extra") {
    const minutes = Number(form.extraMinutes.trim());
    if (
      !form.extraMinutes.trim() ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_EXTRA_MINUTES
    ) {
      return {
        ok: false,
        error: `Extra minutes must be a whole number from 1 to ${MAX_EXTRA_MINUTES}`,
      };
    }
    extraMinutes = minutes;
  } else if (form.time !== "none") {
    const multiplier = Number(form.time);
    if (!(TIME_MULTIPLIERS as readonly number[]).includes(multiplier)) {
      return { ok: false, error: "Choose ×1.25, ×1.5 or ×2" };
    }
    timeMultiplier = multiplier;
  }
  if (timeMultiplier === null && extraMinutes === null && !form.lockdownExempt) {
    return { ok: false, error: "Give extra time or a Lockdown exemption" };
  }
  const reason = form.reason.trim();
  if (reason.length > 500) {
    return { ok: false, error: "Keep the reason under 500 characters" };
  }
  return {
    ok: true,
    body: {
      timeMultiplier,
      extraMinutes,
      lockdownExempt: form.lockdownExempt,
      ...(reason ? { reason } : {}),
    },
  };
}

/** The roster summary of a saved per-quiz accommodation. */
export function toSummary(saved: Accommodation): AccommodationSummary {
  return {
    source: "activity",
    timeMultiplier: saved.timeMultiplier,
    extraMinutes: saved.extraMinutes,
    lockdownExempt: saved.lockdownExempt,
  };
}

/**
 * The student's time line on the quiz page: "45 minutes (the quiz is 30
 * minutes; you have extra time)" when their limit differs.
 */
export function quizMinutesLabel(
  timeLimitMinutes: number,
  standardTimeLimitMinutes?: number | null,
): string {
  if (standardTimeLimitMinutes && standardTimeLimitMinutes !== timeLimitMinutes) {
    return `${timeLimitMinutes} minutes (extra time: the quiz is ${standardTimeLimitMinutes} minutes)`;
  }
  return `${timeLimitMinutes} minutes`;
}
