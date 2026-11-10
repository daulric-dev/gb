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
  // Parents belong to no school; their children are in the parent portal.
  if (profile.account_type === "parent") return PARENT_HOME_PATH;
  // An organisation admin need not belong to a school (nor finish the
  // staff/student onboarding); their home is the organisation console.
  if (profile.is_org_admin && !profile.school) return ORGANISATION_PATH;
  // Named at onboarding; without it we do not yet know which flow they chose.
  if (!profile.first_name) return "/onboard";
  // Staff await approval of a join request, students await approval or a
  // school join code. Both wait on the school list.
  if (!profile.school) return "/schools";
  return profile.account_type === "student" ? "/portal" : "/dashboard";
}

/** The parent portal (`app/parent`). */
export const PARENT_HOME_PATH = "/parent";

/** True for a parent account (the parent portal, never the staff app or portal). */
export function isParentProfile(profile: UserProfile | null): boolean {
  return profile?.account_type === "parent";
}

/** The organisation console, for organisation admins. */
export const ORGANISATION_PATH = "/organisation";
/** Where first-run setup lands: the school manager, ready to add the first school. */
export const ORGANISATION_SCHOOLS_WELCOME_PATH = "/organisation/schools?welcome=1";

/** First-run setup: names the organisation that runs this install. */
export const SETUP_PATH = "/setup";

/**
 * Where to send a signed-in user before setup has run, or null to stay put.
 * Until the install has an organisation, everyone the API says may set it up
 * goes to the setup wizard from every signed-in entry point; nobody else does.
 */
export function setupRedirectPath(
  canSetUp: boolean | null,
  pathname: string,
): string | null {
  if (canSetUp !== true) return null;
  if (pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`)) {
    return null;
  }
  return SETUP_PATH;
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
