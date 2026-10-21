import { isScanPath, parseAttendanceQr } from "@/lib/attendance";

/**
 * Rewrites incoming OS links before expo-router resolves them. The attendance
 * QR encodes a web URL (`<web origin>/scan?s=&t=`, or the older
 * `/portal/attendance/scan`), so if the app is ever opened with it (universal /
 * app links, or `gradebook://scan?...`) it lands on the in-app scan flow.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
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
