import { isIP } from 'node:net';

/** Headers a reverse proxy adds; their presence means the request was relayed. */
const FORWARDED_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'x-forwarded-host',
] as const;

interface PeerRequest {
  socket?: { remoteAddress?: string | null } | null;
  raw?: {
    socket?: { remoteAddress?: string | null } | null;
    headers?: Record<string, unknown> | null;
  } | null;
  headers?: Record<string, unknown> | null;
}

/**
 * Whether a request came straight from this machine or the private network the
 * API runs on, and not through a proxy.
 *
 * Both halves matter. The address is read off the raw socket, never `req.ip`:
 * Fastify's `req.ip` walks `X-Forwarded-For`, which a client sets, so trusting
 * it would let anyone call themselves internal.
 *
 * But the address alone is not enough, and this is the trap the first version
 * of this function fell into. The bundled Caddy runs on the Compose network,
 * so for every request it relays - including one from the public internet -
 * the socket peer is Caddy's private address. Checking only the address would
 * have served the detailed health answer to everyone.
 *
 * So a relayed request is never internal, whatever its peer address, and a
 * proxy announces itself by adding `X-Forwarded-For` (Caddy always does; see
 * infrastructure/caddy/Caddyfile). What is left is what we mean by internal:
 * the container's own health check calling `127.0.0.1:3001/health`, and an
 * operator or orchestrator reaching a replica directly on the private network.
 *
 * A client can add `X-Forwarded-For` itself, but that only makes this stricter
 * - it can take the detail away, never grant it.
 *
 * Addresses are taken apart with string and number operations rather than
 * patterns. The input is short and trusted, but a regular expression that has
 * to skip over a repeated character class is the kind code scanning flags as
 * a backtracking risk, and there is nothing a pattern would buy here.
 */
export function isInternalPeer(req: PeerRequest): boolean {
  const headers = req.headers ?? req.raw?.headers ?? {};
  if (FORWARDED_HEADERS.some((name) => headers[name] !== undefined)) return false;

  const address = req.socket?.remoteAddress ?? req.raw?.socket?.remoteAddress;
  return !!address && isPrivateAddress(address);
}

/** `::ffff:10.0.0.4` is how a dual-stack listener reports an IPv4 peer. */
const V4_MAPPED_PREFIX = '::ffff:';

/** Strip `[...]` brackets and any `%eth0` zone id. */
function bareAddress(raw: string): string {
  let value = raw;
  if (value.startsWith('[')) value = value.slice(1);
  if (value.endsWith(']')) value = value.slice(0, -1);
  const zone = value.indexOf('%');
  return zone === -1 ? value : value.slice(0, zone);
}

/** The four octets of a dotted-quad address, or null. */
function octets(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const values = parts.map(Number);
  if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return values as [number, number, number, number];
}

export function isPrivateAddress(raw: string): boolean {
  const address = bareAddress(raw);

  const lower = address.toLowerCase();
  const mapped = lower.startsWith(V4_MAPPED_PREFIX)
    ? address.slice(V4_MAPPED_PREFIX.length)
    : address;

  const quad = octets(mapped);
  if (quad) {
    const [a, b] = quad;
    // 10/8, 127/8, 192.168/16, 172.16/12.
    return (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31)
    );
  }

  if (isIP(address) !== 6) return false;
  if (lower === '::1' || lower === '::') return true;
  // Unique local (fc00::/7) is fc or fd; link-local (fe80::/10) is fe80
  // through febf.
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}
