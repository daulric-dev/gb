/**
 * A Content-Disposition value that is safe for any filename.
 *
 * Header values must be ASCII, so a raw non-ASCII name makes Fastify throw
 * (a 500), and a `"` or newline in a raw name corrupts the header. The
 * RFC 6266 form carries the real name percent-encoded in `filename*`, with a
 * plain-ASCII `filename` fallback for old clients.
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  filename: string | null | undefined,
): string {
  const name = filename || 'file';
  const fallback =
    name
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '')
      .trim() || 'file';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
