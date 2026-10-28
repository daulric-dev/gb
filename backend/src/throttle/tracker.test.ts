import { describe, test, expect } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { SESSION_COOKIE, SessionService } from '@/account/session.service';
import { Throttle } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import {
  getClientIp,
  getEmailIpTracker,
  getSessionTracker,
  fingerprint,
  skipUnlessDeclared,
} from './tracker';

/** A session token as SessionService issues it. */
async function issuedToken(): Promise<string> {
  const service = new SessionService(
    createMockPrisma() as any,
    createMockCacheService() as any,
    { newSignIn: async () => {}, tokenReuse: async () => {} } as any,
  );
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

  test('a mobile bearer token gets the same bucket as its cookie', async () => {
    const t = await issuedToken();
    expect(getSessionTracker({ headers: { authorization: `Bearer ${t}` } })).toBe(
      getSessionTracker({ cookies: { gb_session: t } }),
    );
    expect(getSessionTracker({ headers: { authorization: 'Bearer made.up' } })).toBeUndefined();
  });

  test('ignores other cookies and empty requests', async () => {
    const t = await issuedToken();
    expect(getSessionTracker({ cookies: { 'sb-ref-auth-token': t } })).toBeUndefined();
    expect(getSessionTracker({ headers: {} })).toBeUndefined();
    expect(getSessionTracker({})).toBeUndefined();
  });
});

describe('getEmailIpTracker', () => {
  test('keys by address and client IP, so one client cannot use up another\'s budget', () => {
    const victim = getEmailIpTracker({ body: { email: 'Jo@School.edu' }, ip: '1.1.1.1' });
    const attacker = getEmailIpTracker({ body: { email: 'jo@school.edu ' }, ip: '6.6.6.6' });
    expect(victim).not.toBe(attacker);
    expect(getEmailIpTracker({ body: { email: 'jo@school.edu' }, ip: '1.1.1.1' })).toBe(victim);
    expect(victim).not.toContain('jo@school.edu');
  });

  test('a missing or non-string email falls back to the IP instead of throwing', () => {
    for (const body of [undefined, null, {}, { email: 123 }, { email: { a: 1 } }, { email: ['x'] }, { email: ' ' }]) {
      expect(getEmailIpTracker({ body: body as any, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
    }
    expect(getEmailIpTracker({})).toBe('ip:unknown');
  });
});

describe('skipUnlessDeclared', () => {
  class Routes {
    @Throttle({ 'auth-ip': { limit: 1, ttl: 1000 } })
    signIn() {}
    other() {}
  }
  @Throttle({ 'auth-ip': { limit: 1, ttl: 1000 } })
  class AllRoutes {
    any() {}
  }
  const ctx = (cls: any, handler: string) =>
    ({ getHandler: () => cls.prototype[handler], getClass: () => cls }) as unknown as ExecutionContext;

  test('applies the throttler only where a route or its controller names it', () => {
    const skip = skipUnlessDeclared('auth-ip');
    expect(skip(ctx(Routes, 'signIn'))).toBe(false);
    expect(skip(ctx(Routes, 'other'))).toBe(true);
    expect(skip(ctx(AllRoutes, 'any'))).toBe(false);
    expect(skipUnlessDeclared('auth-strict')(ctx(Routes, 'signIn'))).toBe(true);
  });
});
