/** Join codes are short, upper-case letters and digits (see the course API). */
const JOIN_CODE = /^[A-Z0-9]{4,20}$/;

/**
 * The course join code in a scanned join QR (`<web origin>/join/<code>`, or
 * the app's own scheme `gradebook://join/<code>`), or null for anything else.
 */
export function parseJoinQr(data: string): string | null {
  const raw = data.trim();
  if (!raw || raw.length > 2048) return null;
  const withoutQuery = raw.split(/[?#]/)[0];
  const rest = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Drop the host for http(s) links; custom schemes put the first segment there.
  const path = /^https?:/i.test(withoutQuery)
    ? rest.replace(/^[^/]*/, "")
    : `/${rest}`;
  const match = /^\/+join\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  let code: string;
  try {
    code = decodeURIComponent(match[1]).trim().toUpperCase();
  } catch {
    return null;
  }
  return JOIN_CODE.test(code) ? code : null;
}
