/**
 * App version comparison, matching the API's (backend/src/app-version):
 * MAJOR[.MINOR[.PATCH]], missing parts count as 0, a `-pre` / `+build` suffix
 * is ignored. Pure, so it can be tested on its own.
 */

const VERSION_RE =
  /^(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+][0-9A-Za-z.-]{1,64})?$/;

export function parseVersion(
  value: string | null | undefined,
): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = VERSION_RE.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Negative when a < b, 0 when equal, positive when a > b; null when either is
 * not a version.
 */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** True only when both are versions and `installed` is below `target`. */
export function isOlder(
  installed: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const c = compareVersions(installed, target);
  return c !== null && c < 0;
}
