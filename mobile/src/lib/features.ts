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
};

const REQUIRES: Partial<Record<FeatureKey, FeatureKey[]>> = {
  student_messaging: ["messaging"],
  chat_channels: ["messaging"],
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
