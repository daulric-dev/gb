import { afterEach, describe, expect, test } from 'bun:test';
import { ScanClaimController } from './scan-claim.controller';
import {
  SCAN_DEVICE_COOKIE,
  SCAN_DEVICE_MAX_AGE_S,
  newScanDeviceId,
  scanDeviceIdFrom,
  setScanDeviceCookie,
} from './scan-device';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function controller() {
  const calls: any[][] = [];
  const attendance = {
    scanClaim: async (...args: any[]) => {
      calls.push(args);
      return { claim: 'c', expiresAt: 'e' };
    },
  };
  const features = { assertEnabled: async () => {} };
  const prisma = {
    attendance_session: {
      findUnique: async () => ({ course: { school_id: 'school-1' } }),
    },
  };
  return {
    calls,
    ctrl: new ScanClaimController(
      attendance as any,
      features as any,
      prisma as any,
    ),
  };
}

function reply() {
  const cookies: { name: string; value: string; opts: any }[] = [];
  return {
    cookies,
    setCookie(name: string, value: string, opts: any) {
      cookies.push({ name, value, opts });
      return this;
    },
  };
}

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = savedEnv;
});

describe('scan-device cookie', () => {
  test('a first scan gets a fresh HttpOnly device id bound into the claim', async () => {
    process.env.NODE_ENV = 'production';
    const { ctrl, calls } = controller();
    const res = reply();
    await ctrl.scanClaim(
      { sessionId: SESSION_ID, qrToken: 't' } as any,
      { ip: '203.0.113.7', cookies: {} } as any,
      res as any,
    );

    expect(res.cookies).toHaveLength(1);
    const [cookie] = res.cookies;
    expect(cookie.name).toBe(SCAN_DEVICE_COOKIE);
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(cookie.opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api',
    });
    expect(calls[0]).toEqual([SESSION_ID, 't', cookie.value, '203.0.113.7']);
  });

  test('a device that already has an id keeps it', async () => {
    const { ctrl, calls } = controller();
    const res = reply();
    const existing = newScanDeviceId();
    await ctrl.scanClaim(
      { sessionId: SESSION_ID, qrToken: 't' } as any,
      { ip: '203.0.113.7', cookies: { [SCAN_DEVICE_COOKIE]: existing } } as any,
      res as any,
    );
    expect(res.cookies[0].value).toBe(existing);
    expect(calls[0][2]).toBe(existing);
  });

  test('a malformed cookie is replaced, not trusted', () => {
    expect(scanDeviceIdFrom({ cookies: { [SCAN_DEVICE_COOKIE]: 'short' } })).toBeUndefined();
    expect(
      scanDeviceIdFrom({ cookies: { [SCAN_DEVICE_COOKIE]: 'a'.repeat(22) + ';x' } }),
    ).toBeUndefined();
    expect(scanDeviceIdFrom({})).toBeUndefined();
  });
});

describe('scan device cookie lifetime', () => {
  test('is 90 days, not a year', () => {
    const set: any[] = [];
    setScanDeviceCookie({ setCookie: (...a: any[]) => set.push(a) } as any, newScanDeviceId());
    expect(SCAN_DEVICE_MAX_AGE_S).toBe(90 * 24 * 60 * 60);
    expect(set[0][2].maxAge).toBe(90 * 24 * 60 * 60);
    expect(set[0][0]).toBe(SCAN_DEVICE_COOKIE);
  });
});
