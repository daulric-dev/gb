import { ApiError } from "@/lib/api";

/**
 * Platform features an organisation can switch on or off, and a school can
 * additionally switch off. Mirrors the web `lib/features.ts`; the API sends
 * the effective map for the active school as `profile.features`.
 */
export const FEATURE_KEYS = [
  "messaging",
  "student_messaging",
  "chat_channels",
  "announcements",
  "discussions",
  "attendance",
  "files",
  "calendar",
  "course_copy",
  "push_notifications",
  "integrations",
  "report_cards",
  "parent_portal",
  "parent_notifications",
  "timetable",
  "attendance_alerts",
  "rostering",
  "lti",
  "mastery",
  "peer_review",
  "similarity_check",
  "pastoral_notes",
  "ai_assistance",
  "analytics",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureMap = Record<FeatureKey, boolean>;

/** An older server (no `features`): everything on but the two newer ones. */
export const FALLBACK_FEATURES: FeatureMap = {
  messaging: true,
  student_messaging: false,
  chat_channels: false,
  announcements: true,
  discussions: true,
  attendance: true,
  files: true,
  calendar: true,
  course_copy: true,
  push_notifications: true,
  integrations: false,
  // An older server has no report cards.
  report_cards: false,
  // Older servers have no parent portal.
  parent_portal: false,
  parent_notifications: false,
  // Older servers have no timetable or attendance alerts.
  timetable: false,
  attendance_alerts: false,
  // Older servers have no rostering sync.
  rostering: false,
  // Older servers have no external tools (LTI).
  lti: false,
  // Older servers have no mastery tracking.
  mastery: false,
  // Older servers have no peer review or similarity check.
  peer_review: false,
  similarity_check: false,
  // Older servers have no pastoral notes.
  pastoral_notes: false,
  // Older servers have no AI assistance.
  ai_assistance: false,
  // Older servers have no analytics.
  analytics: false,
};

const REQUIRES: Partial<Record<FeatureKey, FeatureKey[]>> = {
  student_messaging: ["messaging"],
  chat_channels: ["messaging"],
  parent_notifications: ["parent_portal"],
  timetable: ["attendance"],
  attendance_alerts: ["attendance"],
};

export function resolveFeatures(
  features: Partial<Record<string, boolean>> | null | undefined,
): FeatureMap {
  const out = { ...FALLBACK_FEATURES };
  if (features && typeof features === "object") {
    for (const key of FEATURE_KEYS) {
      const v = features[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  for (const key of FEATURE_KEYS) {
    if ((REQUIRES[key] ?? []).some((req) => !out[req])) out[key] = false;
  }
  return out;
}

export function hasFeature(
  features: Partial<Record<string, boolean>> | null | undefined,
  key: FeatureKey,
): boolean {
  return resolveFeatures(features)[key];
}

/** A 403 `{ code: 'FEATURE_DISABLED', feature, message }` from the API. */
export function isFeatureDisabledError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "FEATURE_DISABLED";
}

/** Course sections that belong to a feature (student and staff course screens). */
export const SECTION_FEATURE: Partial<Record<string, FeatureKey>> = {
  announcements: "announcements",
  discussions: "discussions",
  attendance: "attendance",
};

/** Whether a course section is available with these features. */
export function sectionEnabled(features: FeatureMap, section: string): boolean {
  const key = SECTION_FEATURE[section];
  return !key || features[key];
}
