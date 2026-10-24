const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GPS accuracy is generous only up to this much; beyond it, it is a guess. */
export const MAX_ACCURACY_ALLOWANCE_M = 50;

/**
 * Whether a check-in from `from` (with its reported accuracy) is close enough
 * to the session point: distance ≤ radius + min(accuracy, 50 m).
 */
export function withinGeofence(
  center: LatLng,
  radiusM: number,
  from: LatLng & { accuracy?: number | null },
): { ok: boolean; distanceM: number } {
  const distanceM = haversineMeters(center, from);
  const allowance = Math.min(
    Math.max(from.accuracy ?? 0, 0),
    MAX_ACCURACY_ALLOWANCE_M,
  );
  return { ok: distanceM <= radiusM + allowance, distanceM };
}
