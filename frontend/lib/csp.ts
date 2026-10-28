import { trustedImageOrigins, urlOrigin } from "./image-src";

// Object storage (S3-compatible): uploads PUT straight to it with presigned
// URLs from the API, so its origin must be allowed for fetch/XHR.
export const storageOrigin = urlOrigin(process.env.NEXT_PUBLIC_STORAGE_URL);

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The page CSP, set per request by `proxy.ts` (it carries that request's
 * nonce; Next reads it back from the request header and stamps it on its own
 * scripts). Only enforced in production: local dev reaches the API and
 * Storage on arbitrary localhost / LAN ports and Next's dev runtime needs eval.
 */
export function contentSecurityPolicy(nonce: string): string {
  // The browser talks to the API (fetch + chat SSE) and the storage endpoint.
  const connectSrc = [
    "'self'",
    urlOrigin(process.env.NEXT_PUBLIC_API_URL),
    storageOrigin,
  ].filter(Boolean);

  // Only images we host: avatars come from the API or the image CDN, files
  // from object storage, previews are blob:. No `https:` - Markdown that
  // points at any other host renders as a link (components/markdown.tsx), so
  // a post cannot carry a tracking pixel that logs readers' IPs.
  const imgSrc = ["'self'", "blob:", "data:", ...trustedImageOrigins()];

  return [
    "default-src 'self'",
    // No 'unsafe-inline': only scripts carrying this response's nonce run, and
    // 'strict-dynamic' lets those load Next's chunks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline styles stay allowed (chart theming, UI libraries). Adding a nonce
    // here would make browsers ignore 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    // The file viewer frames PDFs and text as blob: URLs.
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
