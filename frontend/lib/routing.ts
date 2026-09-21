import type { UserProfile } from "@/providers/AuthProvider";

/**
 * Where a signed-in user belongs.
 *
 * Account type decides the app surface - students get /portal, staff get
 * /dashboard - but only once setup is finished, so the earlier steps come
 * first. Every entry point routes through this rather than hardcoding
 * /dashboard, which sent students into the staff shell just to be bounced out
 * of it by the dashboard layout.
 */
export function homePathFor(profile: UserProfile | null): string {
  if (!profile) return "/login";
  // Named at onboarding; without it we do not yet know which flow they chose.
  if (!profile.first_name) return "/onboard";
  // Staff await approval of a join request, students await approval or a
  // claim code. Both wait on the school list.
  if (!profile.school) return "/schools";
  return profile.account_type === "student" ? "/portal" : "/dashboard";
}

/** True when this profile belongs to the student portal rather than the staff app. */
export function isStudentProfile(profile: UserProfile | null): boolean {
  return profile?.account_type === "student";
}
