/**
 * Markers for check-in locations that look copied, typed in or faked. They
 * are recorded on the attendance record for staff to look at and never used
 * to refuse a check-in: real phones produce odd readings too, and a false
 * positive would lock a student who is in the room out.
 */
export const LOCATION_FLAGS = [
  /** Within 1 m of the session point: coordinates copied from the teacher. */
  'exact_point',
  /** Same latitude and longitude (6 decimals) as another check-in in the session. */
  'duplicate_coords',
  /** Accuracy reported as 0, or missing from the app (which always sends it). */
  'zero_accuracy',
  /** Both coordinates have 3 decimals or fewer (~100 m): typed in by hand. */
  'low_precision',
] as const;

export type LocationFlag = (typeof LOCATION_FLAGS)[number];

/** Closer than this to the session point counts as the same point. */
export const EXACT_POINT_M = 1;
/** Coordinates with this many decimals or fewer are low precision. */
export const LOW_PRECISION_DECIMALS = 3;

/** Decimal places in a number as written; exponent forms count as many. */
export function decimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  if (/e/i.test(text)) return 20;
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** The key two readings share when they are the same to 6 decimals. */
export function coordKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

/**
 * Flags that can be decided from one reading alone. `duplicate_coords` needs
 * the other check-ins and is added by the caller.
 */
export function readingFlags(reading: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  distanceM: number;
  /** The request came from the GradeBook app, which always reports accuracy. */
  nativeClient?: boolean;
}): LocationFlag[] {
  const flags: LocationFlag[] = [];
  if (reading.distanceM < EXACT_POINT_M) flags.push('exact_point');
  const accuracy = reading.accuracy;
  if (accuracy === 0 || (reading.nativeClient && (accuracy === undefined || accuracy === null))) {
    flags.push('zero_accuracy');
  }
  if (
    decimals(reading.latitude) <= LOW_PRECISION_DECIMALS &&
    decimals(reading.longitude) <= LOW_PRECISION_DECIMALS
  ) {
    flags.push('low_precision');
  }
  return flags;
}

/** Keep flags in catalogue order, once each, dropping anything unknown. */
export function normaliseFlags(flags: readonly string[]): LocationFlag[] {
  return LOCATION_FLAGS.filter((f) => flags.includes(f));
}
