import { NEXT_PARAM, safeNextPath } from "@/lib/routing";

/** The API code for a session limited to setting up an authenticator app. */
export const MFA_ENROLMENT_REQUIRED = "MFA_ENROLMENT_REQUIRED";
/** The forced set-up page for a session the organisation limits to it. Signed-in page. */
export const TWO_STEP_SETUP_PATH = "/two-step-setup";

/** Pages that must never bounce to the set-up page (they are the way out). */
const NO_REDIRECT_PREFIXES = [TWO_STEP_SETUP_PATH, "/login"];

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Where to send the browser on a 403 MFA_ENROLMENT_REQUIRED, or null to
 * stay put: already on the set-up page (its own calls would loop) or on a
 * sign-in page. The current page comes back as `next` after set-up.
 */
export function mfaSetupRedirect(pathname: string, search = ""): string | null {
  if (NO_REDIRECT_PREFIXES.some((p) => startsWithSegment(pathname, p))) return null;
  const here = safeNextPath(`${pathname}${search}`);
  if (!here || here === "/") return TWO_STEP_SETUP_PATH;
  return `${TWO_STEP_SETUP_PATH}?${new URLSearchParams({ [NEXT_PARAM]: here }).toString()}`;
}
