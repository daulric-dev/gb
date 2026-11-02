import { signal } from "@preact/signals-react";
import { api } from "@/lib/api";
import type { UserProfile } from "@/providers/AuthProvider";

/**
 * The schools the signed-in user can work in (`GET /api/me/schools`): their
 * memberships plus, for an organisation admin, every active school in the
 * organisation. The active school is `profile.school`.
 */
export interface MySchool {
  id: string;
  name: string | null;
  logoUrl: string | null;
  /** Their membership role there; null without one. */
  role: string | null;
  /** Reachable only as an organisation admin (no membership there). */
  viaOrganisation: boolean;
  /** Their active school. */
  isActive: boolean;
}

/**
 * Shared list for the sidebar switcher and the dashboard banner, keyed by the
 * active school it was loaded for. Components that read it must call
 * `useSignals()`.
 */
export const mySchools = signal<{ forSchool: string | null; list: MySchool[] } | null>(null);

let inFlight: { forSchool: string | null; promise: Promise<void> } | null = null;

/** Load (or reload) the list for the given active school, once at a time. */
export function loadMySchools(activeSchoolId: string | null): Promise<void> {
  if (inFlight?.forSchool === activeSchoolId) return inFlight.promise;
  const promise = api<MySchool[]>("/me/schools")
    .then((list) => {
      mySchools.value = {
        forSchool: activeSchoolId,
        list: Array.isArray(list) ? list : [],
      };
    })
    .catch(() => {
      // Non-fatal: without the list there is simply no switcher or banner.
      mySchools.value = { forSchool: activeSchoolId, list: [] };
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { forSchool: activeSchoolId, promise };
  return promise;
}

/** Make `schoolId` the active school; resolves to the refreshed profile. */
export function switchActiveSchool(schoolId: string): Promise<UserProfile> {
  return api<UserProfile>("/me/active-school", {
    method: "PUT",
    body: { schoolId },
  });
}

/** A switcher is worth showing only with somewhere else to go. */
export function canSwitchSchools(list: readonly MySchool[] | null | undefined): boolean {
  return (list?.length ?? 0) > 1;
}

/** The active school's entry, or null when it is not listed. */
export function activeSchoolOf(list: readonly MySchool[] | null | undefined): MySchool | null {
  return list?.find((s) => s.isActive) ?? null;
}

/**
 * True when the active school is one the user manages only as an
 * organisation admin (the dashboard shows a banner then).
 */
export function managingViaOrganisation(list: readonly MySchool[] | null | undefined): boolean {
  return activeSchoolOf(list)?.viaOrganisation ?? false;
}

/** Display name for a school in the switcher. */
export function schoolLabel(school: Pick<MySchool, "name">): string {
  return school.name?.trim() || "Unnamed school";
}
