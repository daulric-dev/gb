/** The origin of `url`, or null when it is unset or not an absolute URL. */
export function urlOrigin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * Origins, besides this site, that serve images we host ourselves:
 * - the API (`NEXT_PUBLIC_API_URL`): avatars at `/api/images/avatars/<file>`;
 * - object storage (`NEXT_PUBLIC_STORAGE_URL`): presigned downloads;
 * - the optional public image CDN (`NEXT_PUBLIC_IMAGES_URL`, the origin of
 *   the backend's `S3_PUBLIC_URL`): avatars when that is configured.
 *
 * Both the CSP `img-src` and the Markdown renderer allow exactly these, so
 * nothing on a page can make a student's browser fetch from a third party.
 */
export function trustedImageOrigins(): string[] {
  return [
    urlOrigin(process.env.NEXT_PUBLIC_API_URL),
    urlOrigin(process.env.NEXT_PUBLIC_STORAGE_URL),
    urlOrigin(process.env.NEXT_PUBLIC_IMAGES_URL),
  ].filter((o, i, all): o is string => !!o && all.indexOf(o) === i);
}

// Resolves relative URLs; `.invalid` never names a real host.
const RELATIVE_BASE = "http://relative.invalid";

/**
 * Whether an image URL may load inline: a relative (same-origin) path,
 * `data:`/`blob:`, or one of `origins`. Parsed with `URL`, so protocol-relative
 * (`//host`) and backslash (`/\host`) tricks resolve to their real host.
 */
export function isTrustedImageSrc(
  src: string | undefined,
  origins: readonly string[] = trustedImageOrigins(),
): boolean {
  const value = src?.trim();
  if (!value) return false;
  if (/^(data|blob):/i.test(value)) return true;
  let url: URL;
  try {
    url = new URL(value, RELATIVE_BASE);
  } catch {
    return false;
  }
  return url.origin === RELATIVE_BASE || origins.includes(url.origin);
}
