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
  // school join code. Both wait on the school list.
  if (!profile.school) return "/schools";
  return profile.account_type === "student" ? "/portal" : "/dashboard";
}

/** QR check-in landing page (the QR encodes `?s=<session>&t=<token>`). */
export const SCAN_PATH = "/portal/attendance/scan";

/** Query parameter carrying where to go after signing in. */
export const NEXT_PARAM = "next";

const SAFE_PATH_BASE = "http://gradebook.invalid";

/**
 * A same-origin path to return to after sign-in, or null when `raw` is not
 * one. Only plain relative paths starting with a single "/" pass: no scheme,
 * no protocol-relative "//host", no backslashes (browsers read "/\host" as
 * "//host"), no control characters, and never back into /login itself.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f\s]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, SAFE_PATH_BASE);
  } catch {
    return null;
  }
  if (url.origin !== SAFE_PATH_BASE) return null;
  const path = url.pathname;
  // Dot segments can collapse into "//host" ("/..//host"), which would be
  // protocol-relative again once handed to the router.
  if (path.startsWith("//")) return null;
  if (path === "/login" || path.startsWith("/login/")) return null;
  return `${path}${url.search}${url.hash}`;
}

/** /login, carrying `next` along when it is a safe path worth returning to. */
export function loginPath(next?: string | null): string {
  const safe = safeNextPath(next);
  if (!safe || safe === "/") return "/login";
  return `/login?${new URLSearchParams({ [NEXT_PARAM]: safe }).toString()}`;
}

/** True when this profile belongs to the student portal rather than the staff app. */
export function isStudentProfile(profile: UserProfile | null): boolean {
  return profile?.account_type === "student";
}
