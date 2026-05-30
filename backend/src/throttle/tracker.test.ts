import { describe, test, expect } from 'bun:test';
import {
  getClientIp,
  getSessionTracker,
  fingerprint,
  type ThrottlerReq,
} from './tracker';

describe('getClientIp', () => {
  test('prefers X-Real-IP (set by the trusted proxy to the true peer)', () => {
    const req: ThrottlerReq = {
      headers: {
        'x-real-ip': '203.0.113.7',
        'x-forwarded-for': '1.2.3.4, 203.0.113.7',
      },
      ip: '10.0.0.1',
    };
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  test('trims whitespace around X-Real-IP', () => {
    const req: ThrottlerReq = { headers: { 'x-real-ip': '  203.0.113.7  ' } };
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  test('ignores an empty/whitespace X-Real-IP and falls through to XFF', () => {
    const req: ThrottlerReq = {
      headers: { 'x-real-ip': '   ', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
    };
    expect(getClientIp(req)).toBe('2.2.2.2');
  });

  test('uses the RIGHTMOST X-Forwarded-For entry (proxy-appended, trustworthy)', () => {
    // Attacker spoofs the leftmost entries; nginx appends the real peer last.
    const req: ThrottlerReq = {
      headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.9' },
    };
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  test('a spoofed leftmost XFF entry cannot change the bucket', () => {
    const real = { headers: { 'x-forwarded-for': '203.0.113.9' } };
    const spoofed = {
      headers: { 'x-forwarded-for': 'evil-rotating-value, 203.0.113.9' },
    };
    expect(getClientIp(spoofed)).toBe(getClientIp(real));
  });

  test('handles surrounding whitespace in XFF entries', () => {
    const req: ThrottlerReq = {
      headers: { 'x-forwarded-for': ' 1.1.1.1 ,  9.9.9.9 ' },
    };
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  test('handles an array-valued XFF header by taking the last element', () => {
    const req: ThrottlerReq = {
      headers: { 'x-forwarded-for': ['1.1.1.1', '8.8.8.8'] },
    };
    expect(getClientIp(req)).toBe('8.8.8.8');
  });

  test('falls back to req.ip when no proxy headers are present', () => {
    expect(getClientIp({ headers: {}, ip: '10.0.0.5' })).toBe('10.0.0.5');
  });

  test('falls back to req.ip when there are no headers at all', () => {
    expect(getClientIp({ ip: '10.0.0.5' })).toBe('10.0.0.5');
  });

  test('falls back to req.ip when XFF is present but empty', () => {
    const req: ThrottlerReq = {
      headers: { 'x-forwarded-for': '   ,  ' },
      ip: '10.0.0.6',
    };
    expect(getClientIp(req)).toBe('10.0.0.6');
  });

  test('falls back to req.ip when XFF is an empty array', () => {
    const req: ThrottlerReq = {
      headers: { 'x-forwarded-for': [] },
      ip: '10.0.0.7',
    };
    expect(getClientIp(req)).toBe('10.0.0.7');
  });

  test('returns undefined when nothing identifies the client', () => {
    expect(getClientIp({ headers: {} })).toBeUndefined();
  });
});

describe('getSessionTracker', () => {
  test('derives a stable token from a Bearer header', () => {
    const a = getSessionTracker({
      headers: { authorization: 'Bearer abc.def' },
    });
    const b = getSessionTracker({
      headers: { authorization: 'Bearer abc.def' },
    });
    expect(a).toBe(b);
    expect(a).toStartWith('u:');
  });

  test('is case-insensitive on the Bearer scheme and trims the token', () => {
    const a = getSessionTracker({
      headers: { authorization: 'bearer   tok ' },
    });
    const b = getSessionTracker({ headers: { authorization: 'Bearer tok' } });
    expect(a).toBe(b);
  });

  test('different tokens map to different trackers', () => {
    const a = getSessionTracker({ headers: { authorization: 'Bearer one' } });
    const b = getSessionTracker({ headers: { authorization: 'Bearer two' } });
    expect(a).not.toBe(b);
  });

  test('does not leak the raw token (it is hashed and truncated)', () => {
    const token = 'super-secret-jwt-value';
    const tracker = getSessionTracker({
      headers: { authorization: `Bearer ${token}` },
    });
    expect(tracker).not.toContain(token);
    expect(tracker).toBe(`u:${fingerprint(token)}`);
  });

  test('falls back to Supabase auth-token cookies when no Bearer header', () => {
    const tracker = getSessionTracker({
      cookies: { 'sb-xyz-auth-token': 'v1', unrelated: 'x' },
    });
    expect(tracker).toStartWith('u:');
  });

  test('cookie tracker is order-independent', () => {
    const a = getSessionTracker({
      cookies: { 'sb-a-auth-token': '1', 'sb-b-auth-token': '2' },
    });
    const b = getSessionTracker({
      cookies: { 'sb-b-auth-token': '2', 'sb-a-auth-token': '1' },
    });
    expect(a).toBe(b);
  });

  test('ignores non-auth cookies entirely', () => {
    expect(
      getSessionTracker({ cookies: { theme: 'dark', session: 'x' } }),
    ).toBeUndefined();
  });

  test('returns undefined when there is no identifying material', () => {
    expect(getSessionTracker({ headers: {} })).toBeUndefined();
    expect(getSessionTracker({})).toBeUndefined();
  });

  test('a malformed Authorization header does not produce a tracker', () => {
    expect(
      getSessionTracker({ headers: { authorization: 'Basic xyz' } }),
    ).toBeUndefined();
  });
});
