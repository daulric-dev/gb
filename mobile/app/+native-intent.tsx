import { isScanPath, parseAttendanceQr } from "@/lib/attendance";

/**
 * Rewrites incoming OS links before expo-router resolves them. The attendance
 * QR encodes a web URL (`<web origin>/scan?s=&t=`, or the older
 * `/portal/attendance/scan`), so if the app is ever opened with it (universal /
 * app links, or `gradebook://scan?...`) it lands on the in-app scan flow.
 * Single sign-on returns as `gradebook://sso?...` and goes to the /sso route.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    // The SSO return (`gradebook://sso?code=` / `?error=`): normalised onto
    // the /sso route, which redeems the code if the login screen's auth
    // session is not around to (cold start, or Android's plain deep link).
    const sso = path.match(/^(?:gradebook:\/\/|\/)?sso\/?(\?.*)?$/);
    if (sso) return `/sso${sso[1] ?? ""}`;

    if (isScanPath(path.split(/[?#]/)[0])) {
      const code = parseAttendanceQr(path);
      if (code) {
        return `/attendance/scan?s=${encodeURIComponent(code.sessionId)}&t=${encodeURIComponent(code.token)}`;
      }
      return "/attendance/scan";
    }
  } catch {
    // Never throw here: it would crash app launch.
  }
  return path;
}
