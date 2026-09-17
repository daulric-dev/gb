import type { UserProfile } from "@/providers/AuthProvider";

/**
 * Where a signed-in user belongs.
 *
 * Account type decides the surface - students get the portal, staff get the
 * tabs - but only once setup is finished, so the earlier steps come first.
 * Every entry point routes through this rather than hardcoding a destination.
 */
export function homeRouteFor(profile: UserProfile | null) {
  if (!profile) return "/(auth)/login" as const;
  // Named at onboarding; without it we do not know which flow they chose.
  if (!profile.first_name) return "/(auth)/onboard" as const;
  // Staff await approval of a join request, students await approval or a
  // claim code. Both wait on the school list.
  if (!profile.school) return "/(auth)/schools" as const;
  return profile.account_type === "student"
    ? ("/(portal)" as const)
    : ("/(tabs)" as const);
}

/** True when this profile belongs to the student portal rather than the tabs. */
export function isStudentProfile(profile: UserProfile | null): boolean {
  return profile?.account_type === "student";
}
