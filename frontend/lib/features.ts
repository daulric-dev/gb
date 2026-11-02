import { ApiError } from "@/lib/api";

/**
 * Platform features an organisation can switch on or off, and a school can
 * additionally switch off (never on) for itself. The API sends the effective
 * map for the caller's active school as `profile.features` on `/auth/me`.
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
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureMap = Record<FeatureKey, boolean>;

/**
 * What a server that predates feature switches behaves like: everything on,
 * except the two features that did not exist yet.
 */
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
};

/** Features that only work while another one is on. */
export const FEATURE_REQUIRES: Partial<Record<FeatureKey, FeatureKey[]>> = {
  student_messaging: ["messaging"],
  chat_channels: ["messaging"],
};

/**
 * The effective map from a profile's `features`. A missing object (older
 * server) or a missing key falls back to {@link FALLBACK_FEATURES}; a feature
 * whose requirement is off is off too.
 */
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
    if ((FEATURE_REQUIRES[key] ?? []).some((req) => !out[req])) out[key] = false;
  }
  return out;
}

export function hasFeature(
  features: Partial<Record<string, boolean>> | null | undefined,
  key: FeatureKey,
): boolean {
  return resolveFeatures(features)[key];
}

/**
 * The feature a page belongs to, so a layout can show "turned off" instead of
 * the page on direct navigation. Null for pages that are always available.
 */
export function featureForPath(pathname: string): FeatureKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const under = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);

  if (under("/dashboard/chat")) return "messaging";
  if (under("/dashboard/announcements")) return "announcements";
  if (under("/dashboard/files")) return "files";
  if (under("/dashboard/calendar")) return "calendar";

  if (under("/portal/messages")) return "student_messaging";
  if (under("/portal/calendar")) return "calendar";
  if (under("/portal/attendance")) return "attendance";
  if (under("/scan")) return "attendance";

  const course = path.match(
    /^\/(?:dashboard|portal)\/courses\/[^/]+\/(announcements|discussions|attendance)(?:\/|$)/,
  );
  if (course) return course[1] as FeatureKey;

  return null;
}

// ── Disabled-feature API errors ──────────────────────────────────────────────

export const FEATURE_DISABLED = "FEATURE_DISABLED";

/** A 403 `{ code: 'FEATURE_DISABLED', feature, message }` from the API. */
export function isFeatureDisabledError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === FEATURE_DISABLED;
}

// ── Admin API shapes ─────────────────────────────────────────────────────────

/** GET/PATCH /organisation/features. */
export interface OrganisationFeature {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  default: boolean;
  requires: string[];
}

/** GET/PATCH /schools/current/features. */
export interface SchoolFeature {
  key: string;
  label: string;
  description: string;
  availableInOrganisation: boolean;
  enabledForSchool: boolean;
  effective: boolean;
  requires: string[];
}

/** Display groups, in order; unknown keys land in "Other". */
export const FEATURE_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Communication",
    keys: [
      "messaging",
      "student_messaging",
      "chat_channels",
      "announcements",
      "discussions",
      "push_notifications",
    ],
  },
  { title: "Teaching", keys: ["attendance", "calendar", "course_copy"] },
  { title: "Content", keys: ["files"] },
  { title: "Integrations", keys: ["integrations"] },
];

/** Splits a feature list into the display groups, dropping empty ones. */
export function groupFeatures<T extends { key: string }>(
  list: T[],
): { title: string; items: T[] }[] {
  const known = new Set(FEATURE_GROUPS.flatMap((g) => g.keys));
  const groups = FEATURE_GROUPS.map((g) => ({
    title: g.title,
    items: g.keys
      .map((k) => list.find((f) => f.key === k))
      .filter((f): f is T => !!f),
  }));
  groups.push({ title: "Other", items: list.filter((f) => !known.has(f.key)) });
  return groups.filter((g) => g.items.length > 0);
}

/**
 * A toggle applied to a draft `{ key: on }` map. Switching a feature off also
 * switches off everything that requires it, so the draft never asks for a
 * dependent feature without its requirement.
 */
export function applyFeatureToggle(
  draft: Record<string, boolean>,
  list: { key: string; requires: string[] }[],
  key: string,
  on: boolean,
): Record<string, boolean> {
  const next = { ...draft, [key]: on };
  if (!on) {
    const queue = [key];
    while (queue.length) {
      const off = queue.shift()!;
      for (const f of list) {
        if (f.requires.includes(off) && next[f.key]) {
          next[f.key] = false;
          queue.push(f.key);
        }
      }
    }
  }
  return next;
}

/** The requirements of a feature that are off in `draft`. */
export function missingRequirements(
  feature: { requires: string[] },
  draft: Record<string, boolean>,
): string[] {
  return feature.requires.filter((r) => !draft[r]);
}

/** Only the keys whose value differs from `original`. */
export function changedFeatures(
  original: Record<string, boolean>,
  draft: Record<string, boolean>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (original[k] !== v) out[k] = v;
  }
  return out;
}
