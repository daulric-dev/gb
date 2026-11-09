/**
 * What a school lets parents see, stored in `public.school.parent_settings`
 * (jsonb). Unknown keys and wrongly typed values are ignored, so a missing
 * object reads as the defaults. Enforced on the server: a hidden area is a
 * 403 `PARENT_VIEW_HIDDEN`, never just hidden in the apps.
 */
export interface ParentSettings {
  /** Course grades and marked scores. */
  showGrades: boolean;
  /** Upcoming and missing work (titles, due dates, handed in or not). */
  showWork: boolean;
  /** Attendance history. */
  showAttendance: boolean;
  /** Course announcements. */
  showAnnouncements: boolean;
  /** Published term report cards (PDFs) and the transcript. */
  showReports: boolean;
  /**
   * Students this age or older are left out of the parent portal (their
   * parents cannot see them). Null: no age limit. A student with no date of
   * birth is never excluded.
   */
  maxStudentAge: number | null;
}

export const DEFAULT_PARENT_SETTINGS: ParentSettings = {
  showGrades: true,
  showWork: true,
  showAttendance: true,
  showAnnouncements: true,
  showReports: true,
  maxStudentAge: null,
};

const BOOLEAN_KEYS = [
  'showGrades',
  'showWork',
  'showAttendance',
  'showAnnouncements',
  'showReports',
] as const;

export const MIN_AGE_LIMIT = 10;
export const MAX_AGE_LIMIT = 30;

function validAge(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= MIN_AGE_LIMIT && v <= MAX_AGE_LIMIT
  );
}

/** The stored jsonb as settings, defaults filling anything missing or invalid. */
export function parseParentSettings(stored: unknown): ParentSettings {
  const raw =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const out: ParentSettings = { ...DEFAULT_PARENT_SETTINGS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (validAge(raw.maxStudentAge)) out.maxStudentAge = raw.maxStudentAge;
  return out;
}

/**
 * Apply a PATCH. Returns the merged settings or the error to answer 400 with.
 */
export function mergeParentSettings(
  current: ParentSettings,
  patch: Record<string, unknown>,
): { settings: ParentSettings } | { error: string } {
  const next: ParentSettings = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return { error: `${key} must be true or false` };
      next[key as (typeof BOOLEAN_KEYS)[number]] = value;
    } else if (key === 'maxStudentAge') {
      if (value !== null && !validAge(value)) {
        return {
          error: `maxStudentAge must be null or a whole number from ${MIN_AGE_LIMIT} to ${MAX_AGE_LIMIT}`,
        };
      }
      next.maxStudentAge = value;
    } else {
      return { error: `Unknown setting: ${key}` };
    }
  }
  return { settings: next };
}

/** Whole years between a date of birth and `now` (UTC). */
export function ageOn(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

/** True when the school's age limit leaves this student out of the portal. */
export function excludedByAge(
  settings: ParentSettings,
  dateOfBirth: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (settings.maxStudentAge === null || !dateOfBirth) return false;
  return ageOn(dateOfBirth, now) >= settings.maxStudentAge;
}
