/**
 * Live teacher position for an open attendance session, and the readable
 * side of suspicious check-in readings. Pure helpers (no React Native
 * imports, so Bun can test them), mirrored from
 * frontend/lib/attendance-location.ts; keep the two in step.
 */

/** Suspicious-reading markers on a check-in; staff only, never refused on. */
export type AttendanceLocationFlag =
  | "exact_point"
  | "duplicate_coords"
  | "zero_accuracy"
  | "low_precision";

/** Send a new point at least this often while the teacher stands still. */
export const LIVE_LOCATION_INTERVAL_MS = 30_000;
/** ...or as soon as they have moved this far from the last point sent. */
export const LIVE_LOCATION_MOVE_M = 20;
/** Never faster than this: the API refuses updates under 5 s apart. */
export const LIVE_LOCATION_MIN_GAP_MS = 6_000;
/** Fixes worse than this are not sent (the API ignores them too). */
export const LIVE_LOCATION_MAX_ACCURACY_M = 100;

export interface SentPoint {
  latitude: number;
  longitude: number;
  /** Epoch ms the server stored it. */
  at: number;
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a new fix is worth sending: usable accuracy, not too soon after
 * the last one, and either 30 s old or 20 m away from it.
 */
export function shouldSendLocation(
  last: SentPoint | null,
  fix: Fix,
  now: number,
): boolean {
  if (
    typeof fix.accuracy === "number" &&
    fix.accuracy > LIVE_LOCATION_MAX_ACCURACY_M
  ) {
    return false;
  }
  if (!last || !Number.isFinite(last.at)) return true;
  const elapsed = now - last.at;
  if (elapsed < LIVE_LOCATION_MIN_GAP_MS) return false;
  if (elapsed >= LIVE_LOCATION_INTERVAL_MS) return true;
  return distanceMeters(last, fix) > LIVE_LOCATION_MOVE_M;
}

/** "just now", "12s ago", "3m ago", "1h ago". */
export function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export const LOCATION_FLAG_LABEL: Record<AttendanceLocationFlag, string> = {
  exact_point: "Same spot as your device (copied coordinates?)",
  duplicate_coords: "Identical location to another student's check-in",
  zero_accuracy: "Phone reported no GPS accuracy",
  low_precision: "Rounded coordinates (typed in by hand?)",
};

/** The reasons a check-in was flagged, one per line, plus its distance. */
export function describeLocationFlags(
  flags: readonly string[],
  distanceM: number | null,
): string[] {
  const lines = flags
    .filter((f): f is AttendanceLocationFlag => f in LOCATION_FLAG_LABEL)
    .map((f) => LOCATION_FLAG_LABEL[f]);
  if (distanceM !== null) lines.push(`${Math.round(distanceM)} m from the check-in point`);
  return lines;
}
