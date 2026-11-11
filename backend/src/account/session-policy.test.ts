import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { renewAfterMs, sessionIdleMs, sessionPolicy } from './session.config';
import { SESSION_COOKIE, SessionService } from './session.service';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ENV = ['SESSION_IDLE_DAYS', 'SESSION_MAX_AGE_DAYS', 'STAFF_SESSION_IDLE_HOURS', 'STAFF_SESSION_MAX_DAYS'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('session lifetimes (config)', () => {
  test('defaults: everyone 30 days idle / 90 absolute; staff 7 days idle / 30 absolute', () => {
    for (const k of ENV) delete process.env[k];
    expect(sessionPolicy('standard')).toEqual({ idleMs: 30 * DAY, maxAgeMs: 90 * DAY });
    expect(sessionPolicy('staff')).toEqual({ idleMs: 7 * DAY, maxAgeMs: 30 * DAY });
    expect(renewAfterMs()).toBe(DAY);
  });

  test('configurable; staff never longer than everyone; renewal at most half the shortest idle time', () => {
    process.env.SESSION_IDLE_DAYS = '14';
    process.env.SESSION_MAX_AGE_DAYS = '20';
    process.env.STAFF_SESSION_IDLE_HOURS = '8';
    process.env.STAFF_SESSION_MAX_DAYS = '60';
    expect(sessionIdleMs()).toBe(14 * DAY);
    expect(sessionPolicy('staff')).toEqual({ idleMs: 8 * HOUR, maxAgeMs: 20 * DAY });
    expect(renewAfterMs()).toBe(4 * HOUR);
    process.env.SESSION_IDLE_DAYS = 'junk';
    expect(sessionIdleMs()).toBe(30 * DAY);
  });
});

function harness(profile: { account_type: string; role: string | null } | null) {
  const prisma = createMockPrisma();
  const rows: Record<string, any>[] = [];
  prisma.user_profile.findUnique.mockImplementation(async () => profile);
  prisma.session.create.mockImplementation(async ({ data }: any) => {
    const row = {
      id: `s${rows.length + 1}`,
      user_id: data.user_id,
      created_at: new Date(),
      last_seen_at: new Date(),
      revoked_at: null,
      previous_token_hash: null,
      rotated_at: null,
      rotation_confirmed_at: null,
      elevated_until: null,
      ...data,
    };
    rows.push(row);
    return row;
  });
  prisma.session.findFirst.mockImplementation(async () => ({
    ...rows[0],
    app_user: { id: 'u1', email: 'jo@school.edu', disabled_at: null },
  }));
  prisma.session.updateMany.mockImplementation(async ({ data }: any) => {
    Object.assign(rows[0], data);
    return { count: 1 };
  });
  const alerts = { newSignIn: mock(async () => undefined), tokenReuse: mock(async () => undefined) };
  const service = new SessionService(prisma as any, createMockCacheService() as any, alerts as any);
  const reply = () => ({ setCookie: mock(() => undefined), clearCookie: mock(() => undefined), header: mock(() => undefined) }) as any;
  const signIn = () =>
    service.create(reply(), { headers: { 'user-agent': 'Mozilla/5.0' }, ip: '1.2.3.4' } as any, 'u1', 'email-code');
  return { prisma, rows, service, reply, signIn };
}

describe('SessionService applies the policy', () => {
  test('a staff sign-in: 7 days idle, 30 days absolute', async () => {
    for (const k of ENV) delete process.env[k];
    const t = harness({ account_type: 'staff', role: 'teacher' });
    const before = Date.now();
    await t.signIn();
    expect(Math.round((t.rows[0].absolute_expires_at.getTime() - before) / DAY)).toBe(30);
    expect(Math.round((t.rows[0].expires_at.getTime() - before) / DAY)).toBe(7);
  });

  test('a student or parent keeps the general lifetimes; so does a first sign-in without a profile', async () => {
    for (const k of ENV) delete process.env[k];
    for (const profile of [{ account_type: 'student', role: null }, { account_type: 'parent', role: null }, null]) {
      const t = harness(profile);
      const before = Date.now();
      await t.signIn();
      expect(Math.round((t.rows[0].absolute_expires_at.getTime() - before) / DAY)).toBe(90);
      expect(Math.round((t.rows[0].expires_at.getTime() - before) / DAY)).toBe(30);
    }
  });

  test('renewal applies staff lifetimes to an account that became staff after signing in', async () => {
    for (const k of ENV) delete process.env[k];
    const profile: { account_type: string; role: string | null } = { account_type: 'student', role: null };
    const t = harness(profile);
    const token = await t.signIn();
    expect(Math.round((t.rows[0].absolute_expires_at.getTime() - Date.now()) / DAY)).toBe(90);
    profile.account_type = 'staff';
    t.rows[0].last_seen_at = new Date(Date.now() - DAY - 60_000);
    const user = await t.service.resolve({ cookies: { [SESSION_COOKIE]: token }, headers: {}, ip: '5.6.7.8' } as any, t.reply());
    expect(user?.userId).toBe('u1');
    expect(Math.round((t.rows[0].absolute_expires_at.getTime() - Date.now()) / DAY)).toBe(30);
    expect(Math.round((t.rows[0].expires_at.getTime() - Date.now()) / DAY)).toBe(7);
  });

  test('renewal ends a session already past the staff absolute lifetime', async () => {
    for (const k of ENV) delete process.env[k];
    const t = harness({ account_type: 'staff', role: null });
    process.env.STAFF_SESSION_MAX_DAYS = '90';
    const token = await t.signIn();
    delete process.env.STAFF_SESSION_MAX_DAYS;
    t.rows[0].created_at = new Date(Date.now() - 40 * DAY);
    t.rows[0].last_seen_at = new Date(Date.now() - 2 * DAY);
    const user = await t.service.resolve({ cookies: { [SESSION_COOKIE]: token }, headers: {}, ip: '5.6.7.8' } as any, t.reply());
    expect(user).toBeNull();
    expect(t.rows[0].absolute_expires_at.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
