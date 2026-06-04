import { createHash } from 'node:crypto';

export type ThrottlerReq = {
  body?: { email?: string };
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
};

export function getClientIp(req: ThrottlerReq): string | undefined {
  if (!req.headers) return req.ip;

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[forwarded.length - 1];
  }
  return req.ip;
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

export function getSessionTracker(req: ThrottlerReq): string | undefined {
  const auth = req.headers?.['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return `u:${fingerprint(match[1].trim())}`;
  }

  if (req.cookies) {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(req.cookies)) {
      if (!name.startsWith('sb-') || !name.includes('auth-token')) continue;
      parts.push(`${name}=${value ?? ''}`);
    }
    if (parts.length > 0) {
      return `u:${fingerprint(parts.sort().join('&'))}`;
    }
  }

  return undefined;
}
