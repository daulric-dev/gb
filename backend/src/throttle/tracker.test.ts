import { afterAll, beforeAll, describe, test, expect } from 'bun:test';
import {
  accessTokenFromCookies,
  getClientIp,
  getSessionTracker,
  fingerprint,
  verifiedSubject,
} from './tracker';
import { mintUploadToken } from '@/supabase/upload-token';

const SECRET = 'test-jwt-secret-with-enough-length';

function token(userId: string, ttlSeconds = 60, secret = SECRET) {
  return mintUploadToken({ userId, ttlSeconds, secret }).token;
}

function ssrCookie(accessToken: string) {
  const json = JSON.stringify({ access_token: accessToken, token_type: 'bearer' });
  return `base64-${Buffer.from(json).toString('base64url')}`;
}

describe('getClientIp', () => {
  test('uses req.ip, which Fastify resolves from trusted proxy hops', () => {
    expect(getClientIp({ headers: {}, ip: '10.0.0.5' })).toBe('10.0.0.5');
  });

  test('ignores client-sent X-Real-IP / X-Forwarded-For', () => {
    const req = {
      headers: {
        'x-real-ip': '6.6.6.6',
        'x-forwarded-for': '7.7.7.7, 8.8.8.8',
      },
      ip: '203.0.113.9',
    };
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  test('returns undefined when nothing identifies the client', () => {
    expect(getClientIp({ headers: {} })).toBeUndefined();
    expect(getClientIp({ headers: {}, ip: '' })).toBeUndefined();
  });
});

describe('verifiedSubject', () => {
  test('returns sub for a correctly signed, unexpired token', () => {
    expect(verifiedSubject(token('user-1'), SECRET)).toBe('user-1');
  });

  test('rejects a token signed with another secret', () => {
    expect(verifiedSubject(token('user-1', 60, 'other'), SECRET)).toBeUndefined();
  });

  test('rejects an expired token', () => {
    const t = token('user-1', 60);
    const later = Math.floor(Date.now() / 1000) + 3600;
    expect(verifiedSubject(t, SECRET, later)).toBeUndefined();
  });

  test('rejects a tampered payload', () => {
    const [h, , s] = token('user-1').split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url');
    expect(verifiedSubject(`${h}.${forged}.${s}`, SECRET)).toBeUndefined();
  });

  test('rejects garbage and missing secrets', () => {
    expect(verifiedSubject('abc.def', SECRET)).toBeUndefined();
    expect(verifiedSubject('a.b.c', SECRET)).toBeUndefined();
    expect(verifiedSubject(token('user-1'), undefined)).toBeUndefined();
    expect(verifiedSubject(token('user-1'), '')).toBeUndefined();
  });
});

describe('accessTokenFromCookies', () => {
  test('reads a base64 @supabase/ssr session cookie', () => {
    const t = token('user-1');
    expect(accessTokenFromCookies({ 'sb-ref-auth-token': ssrCookie(t) })).toBe(t);
  });

  test('reassembles chunked cookies in order', () => {
    const t = token('user-1');
    const full = ssrCookie(t);
    const mid = Math.floor(full.length / 2);
    expect(
      accessTokenFromCookies({
        'sb-ref-auth-token.1': full.slice(mid),
        'sb-ref-auth-token.0': full.slice(0, mid),
      }),
    ).toBe(t);
  });

  test('ignores unrelated and malformed cookies', () => {
    expect(accessTokenFromCookies({ theme: 'dark' })).toBeUndefined();
    expect(accessTokenFromCookies({ 'sb-ref-auth-token': 'junk' })).toBeUndefined();
  });
});

describe('getSessionTracker', () => {
  const prev = process.env.SUPABASE_JWT_SECRET;
  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = prev;
  });

  test('keys a verified Bearer token by user, not by token', () => {
    const a = getSessionTracker({ headers: { authorization: `Bearer ${token('u1', 60)}` } });
    const b = getSessionTracker({ headers: { authorization: `bearer  ${token('u1', 120)} ` } });
    expect(a).toBe(`u:${fingerprint('u1')}`);
    expect(b).toBe(a);
  });

  test('random Bearer values do not get their own bucket', () => {
    expect(
      getSessionTracker({ headers: { authorization: 'Bearer rotating-1' } }),
    ).toBeUndefined();
    expect(
      getSessionTracker({ headers: { authorization: 'Bearer a.b.c' } }),
    ).toBeUndefined();
  });

  test('falls back to the session cookie', () => {
    const tracker = getSessionTracker({
      cookies: { 'sb-ref-auth-token': ssrCookie(token('u2')), theme: 'x' },
    });
    expect(tracker).toBe(`u:${fingerprint('u2')}`);
  });

  test('forged cookies do not get their own bucket', () => {
    expect(
      getSessionTracker({ cookies: { 'sb-ref-auth-token': ssrCookie('x.y.z') } }),
    ).toBeUndefined();
  });

  test('does not leak the user id or token', () => {
    const t = token('user-secret-id');
    const tracker = getSessionTracker({ headers: { authorization: `Bearer ${t}` } });
    expect(tracker).not.toContain('user-secret-id');
    expect(tracker).not.toContain(t);
  });

  test('returns undefined when there is no identifying material', () => {
    expect(getSessionTracker({ headers: {} })).toBeUndefined();
    expect(getSessionTracker({})).toBeUndefined();
    expect(getSessionTracker({ headers: { authorization: 'Basic xyz' } })).toBeUndefined();
  });

});
