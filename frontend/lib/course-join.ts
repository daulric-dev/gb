/** Where a course join QR (and a shared join link) lands. */
export const JOIN_PATH = "/join";

/** Join codes are short, upper-case letters and digits (see the course API). */
const JOIN_CODE = /^[A-Z0-9]{4,20}$/;

/** The code from a `/join/<code>` path segment, normalised, or null. */
export function normaliseJoinCode(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = value.trim().toUpperCase();
  return JOIN_CODE.test(code) ? code : null;
}

/** The absolute link a join QR encodes, on this web app's origin. */
export function joinUrl(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}${JOIN_PATH}/${encodeURIComponent(code)}`;
}
