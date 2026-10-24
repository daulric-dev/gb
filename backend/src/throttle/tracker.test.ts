import { describe, test, expect } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { SESSION_COOKIE, SessionService } from '@/account/session.service';
import { getClientIp, getSessionTracker, fingerprint } from './tracker';

/** A session token as SessionService issues it. */
async function issuedToken(): Promise<string> {
  const service = new SessionService(createMockPrisma() as any, createMockCacheService() as any);
  const reply = { setCookie: () => {}, clearCookie: () => {} };
  return service.create(reply as any, { headers: {} } as any, 'u1', 'email-code');
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

describe('getSessionTracker', () => {
  test('keys an issued session cookie by session', async () => {
    const a = await issuedToken();
    const b = await issuedToken();
    const ta = getSessionTracker({ cookies: { [SESSION_COOKIE]: a } });
    expect(ta).toBe(`s:${fingerprint(a)}`);
    expect(getSessionTracker({ cookies: { [SESSION_COOKIE]: a, theme: 'x' } })).toBe(ta);
    expect(getSessionTracker({ cookies: { [SESSION_COOKIE]: b } })).not.toBe(ta);
  });

  test('made-up and tampered cookies do not get their own bucket', async () => {
    const real = await issuedToken();
    const [random, tag] = real.split('.');
    for (const value of ['rotating-1', 'a.b', `${random}x.${tag}`, `${random}.${tag}x`, '.x']) {
      expect(getSessionTracker({ cookies: { [SESSION_COOKIE]: value } })).toBeUndefined();
    }
  });

  test('does not leak the token', async () => {
    const t = await issuedToken();
    expect(getSessionTracker({ cookies: { [SESSION_COOKIE]: t } })).not.toContain(t);
  });

  test('ignores bearer headers and other cookies', async () => {
    const t = await issuedToken();
    expect(getSessionTracker({ headers: { authorization: `Bearer ${t}` } })).toBeUndefined();
    expect(getSessionTracker({ cookies: { 'sb-ref-auth-token': t } })).toBeUndefined();
    expect(getSessionTracker({ headers: {} })).toBeUndefined();
    expect(getSessionTracker({})).toBeUndefined();
  });
});
