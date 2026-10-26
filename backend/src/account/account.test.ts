import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { EmailCodeService, hashCode } from './email-code.service';
import {
  RENEW_AFTER_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionService,
  rotatedToken,
  sessionTokenFrom,
} from './session.service';
import { SessionAlertService } from './session-alert.service';
import { deviceLabel } from './device-label';
import { createHash } from 'node:crypto';

function emailCodes() {
  const prisma = createMockPrisma();
  const sent: { to: string; text: string }[] = [];
  const mail = { send: mock(async (m: any) => void sent.push(m)) };
  const service = new EmailCodeService(prisma as any, mail as any);
  return { prisma, sent, service };
}

const liveRow = (email: string, code: string, extra: Record<string, unknown> = {}) => ({
  id: 'code-1',
  email,
  code_hash: hashCode(email, code),
  expires_at: new Date(Date.now() + 60_000),
  attempts: 0,
  consumed_at: null,
  ...extra,
});

describe('EmailCodeService', () => {
  test('sends an 8-digit code and retires the previous one', async () => {
    const { prisma, sent, service } = emailCodes();
    await service.send('  Jo@School.EDU ');
    expect(sent[0].to).toBe('jo@school.edu');
    const code = /(\d{8})/.exec(sent[0].text)![1];
    const created = prisma.email_code.create.mock.calls[0][0].data;
    expect(created.code_hash).toBe(hashCode('jo@school.edu', code));
    expect(prisma.email_code.updateMany.mock.calls[0][0].where).toEqual({
      email: 'jo@school.edu',
      consumed_at: null,
    });
  });

  test('a code expires five minutes after it is sent', async () => {
    const { prisma, sent, service } = emailCodes();
    const before = Date.now();
    await service.send('jo@school.edu');
    const expires = prisma.email_code.create.mock.calls[0][0].data.expires_at.getTime();
    expect(expires - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(expires - before).toBeLessThanOrEqual(5 * 60_000 + 1000);
    expect(sent[0].text).toContain('expires in 5 minutes');
  });

  test('refuses after five sends in the window', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.count.mockResolvedValue(5);
    await expect(service.send('jo@school.edu')).rejects.toThrow('Too many codes');
  });

  test('a right code is used once', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678'));
    prisma.email_code.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.verify('JO@school.edu', '12345678')).toBe('jo@school.edu');
    prisma.email_code.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verify('jo@school.edu', '12345678')).rejects.toThrow('Invalid');
  });

  test('a wrong code counts an attempt', async () => {
    const { prisma, service } = emailCodes();
    prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678'));
    await expect(service.verify('jo@school.edu', '00000000')).rejects.toThrow('Invalid');
    expect(prisma.email_code.update.mock.calls[0][0].data).toEqual({ attempts: { increment: 1 } });
  });

  test('expired codes and exhausted attempts are refused without checking', async () => {
    for (const extra of [{ expires_at: new Date(Date.now() - 1) }, { attempts: 5 }]) {
      const { prisma, service } = emailCodes();
      prisma.email_code.findFirst.mockResolvedValue(liveRow('jo@school.edu', '12345678', extra));
      await expect(service.verify('jo@school.edu', '12345678')).rejects.toThrow('Invalid');
      expect(prisma.email_code.updateMany).not.toHaveBeenCalled();
    }
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

type Row = Record<string, any>;

/** Whether a row matches a (small subset of a) Prisma where clause. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    const value = row[key];
    if (cond === null) return value == null;
    if (cond instanceof Date) return value?.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return value !== cond.not;
      if ('gt' in cond) return value > cond.gt;
      if ('gte' in cond) return value >= cond.gte;
    }
    return value === cond;
  });
}

/**
 * An in-memory account.session table behind the Prisma mock, so rotation,
 * reuse and concurrent renewals run against real conditional updates.
 */
function sessions() {
  const prisma = createMockPrisma();
  const cache = createMockCacheService();
  const alerts = {
    newSignIn: mock(async (_s: unknown) => {}),
    tokenReuse: mock(async (_s: unknown) => {}),
  };
  const service = new SessionService(prisma as any, cache as any, alerts as any);
  const rows: Row[] = [];
  const users: Record<string, Row> = {
    u1: { id: 'u1', email: 'jo@school.edu', disabled_at: null, last_sign_in_at: new Date() },
    u2: { id: 'u2', email: 'al@school.edu', disabled_at: null, last_sign_in_at: new Date() },
  };
  const withUser = (r: Row) => ({ ...r, app_user: users[r.user_id] });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  prisma.session.create.mockImplementation(async ({ data }: any) => {
    const row = {
      id: `s${rows.length + 1}`,
      created_at: new Date(),
      last_seen_at: new Date(),
      revoked_at: null,
      revoked_reason: null,
      previous_token_hash: null,
      rotated_at: null,
      ...data,
    };
    rows.push(row);
    return row;
  });
  prisma.session.findFirst.mockImplementation(async ({ where }: any) => {
    await tick();
    const row = rows.find((r) => matches(r, where));
    return row ? withUser(row) : null;
  });
  prisma.session.findUnique.mockImplementation(async ({ where }: any) => {
    const row = rows.find((r) => matches(r, where));
    return row ? withUser(row) : null;
  });
  prisma.session.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => matches(r, where)).map(withUser),
  );
  prisma.session.count.mockImplementation(
    async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
  );
  prisma.session.updateMany.mockImplementation(async ({ where, data }: any) => {
    await tick();
    const hit = rows.filter((r) => matches(r, where));
    for (const r of hit) Object.assign(r, data);
    return { count: hit.length };
  });
  prisma.app_user.findUnique.mockImplementation(async ({ where }: any) => users[where.id] ?? null);
  const known = new Map<string, Row>();
  const kKey = (w: any) => `${w.user_id}:${w.fingerprint}`;
  prisma.known_device.findUnique.mockImplementation(
    async ({ where }: any) => known.get(kKey(where.user_id_fingerprint)) ?? null,
  );
  prisma.known_device.upsert.mockImplementation(async ({ where, create, update }: any) => {
    const k = kKey(where.user_id_fingerprint);
    known.set(k, known.has(k) ? { ...known.get(k), ...update } : create);
  });
  prisma.known_device.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = known.get(kKey(where));
    if (row) Object.assign(row, data);
    return { count: row ? 1 : 0 };
  });

  const cookies: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const reply = () => {
    for (const k of Object.keys(cookies)) delete cookies[k];
    for (const k of Object.keys(headers)) delete headers[k];
    return {
      setCookie: mock((name: string, value: string) => void (cookies[name] = value)),
      clearCookie: mock((name: string) => void (cookies[name] = null)),
      header: mock((name: string, value: string) => void (headers[name] = value)),
    } as any;
  };

  /** Sign in and return the token. */
  const signIn = async (userId = 'u1', extra: Row = {}) =>
    service.create(
      reply(),
      { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Chrome/130.0 Safari/537.36' }, ip: '1.2.3.4', ...extra } as any,
      userId,
      'email-code',
    );
  const viaCookie = (token: string) => ({ cookies: { [SESSION_COOKIE]: token }, headers: {}, ip: '5.6.7.8' }) as any;
  const viaBearer = (token: string) =>
    ({ headers: { authorization: `Bearer ${token}`, 'x-gradebook-client': 'native' }, ip: '5.6.7.8' }) as any;
  /** Pretend a day has passed since the last renewal. */
  const ageSession = (row: Row, ms = RENEW_AFTER_MS + 60_000) => {
    row.last_seen_at = new Date(Date.now() - ms);
  };
  return { prisma, cache, alerts, service, rows, users, known, cookies, headers, reply, signIn, viaCookie, viaBearer, ageSession };
}

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('SessionService: sign-in', () => {
  test('stores only a hash of the token, the device label and both expiries', async () => {
    const t = sessions();
    const before = Date.now();
    const token = await t.signIn();
    const row = t.rows[0];
    expect(row.token_hash).toBe(sha(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.method).toBe('email-code');
    expect(row.device).toBe('Chrome on macOS');
    expect(row.expires_at.getTime() - before).toBeGreaterThanOrEqual(SESSION_TTL_MS - 1000);
    expect(row.expires_at.getTime() - before).toBeLessThanOrEqual(SESSION_TTL_MS + 1000);
    expect(Math.round((row.absolute_expires_at.getTime() - before) / DAY)).toBe(90);
  });

  test('a short SESSION_MAX_AGE_DAYS caps the first expiry too', async () => {
    await withEnv({ SESSION_MAX_AGE_DAYS: '10' }, async () => {
      const t = sessions();
      await t.signIn();
      const row = t.rows[0];
      expect(Math.round((row.absolute_expires_at.getTime() - Date.now()) / DAY)).toBe(10);
      expect(row.expires_at.getTime()).toBe(row.absolute_expires_at.getTime());
    });
  });

  test('the app gets its token in a header and is labelled from X-GradeBook-Device', async () => {
    const t = sessions();
    const r = t.reply();
    const token = await t.service.create(
      r,
      { headers: { 'user-agent': 'GradeBook/1 CFNetwork Darwin', 'x-gradebook-client': 'native', 'x-gradebook-device': 'iPhone 15 · iOS 19.0' } } as any,
      'u1',
      'email-code',
    );
    expect(t.headers['x-session-token']).toBe(token);
    expect(t.rows[0].device).toBe('GradeBook app on iPhone 15 (iOS 19.0)');
  });
});

describe('SessionService: resolve', () => {
  test('returns the user and caches it', async () => {
    const t = sessions();
    const token = await t.signIn();
    expect(await t.service.resolve(t.viaCookie(token))).toMatchObject({ userId: 'u1', email: 'jo@school.edu', sessionId: 's1' });
    await t.service.resolve(t.viaCookie(token));
    expect(t.prisma.session.findFirst).toHaveBeenCalledTimes(1);
  });

  test('revoked, expired, past the absolute lifetime and disabled sessions are null and clear the cookie', async () => {
    const cases: [string, (row: Row, t: ReturnType<typeof sessions>) => void][] = [
      ['revoked', (row) => (row.revoked_at = new Date())],
      ['expired', (row) => (row.expires_at = new Date(Date.now() - 1))],
      ['absolute', (row) => (row.absolute_expires_at = new Date(Date.now() - 1))],
      ['disabled', (_row, t) => (t.users.u1.disabled_at = new Date())],
    ];
    for (const [, spoil] of cases) {
      const t = sessions();
      const token = await t.signIn();
      spoil(t.rows[0], t);
      const r = t.reply();
      expect(await t.service.resolve(t.viaCookie(token), r)).toBeNull();
      expect(r.clearCookie).toHaveBeenCalled();
    }
  });

  test('the absolute lifetime holds however active the session is', async () => {
    const t = sessions();
    const token = await t.signIn();
    const row = t.rows[0];
    // Used every day; 90 days later it is still over.
    row.absolute_expires_at = new Date(Date.now() - 1000);
    row.expires_at = new Date(Date.now() + 20 * DAY);
    expect(await t.service.resolve(t.viaCookie(token), t.reply())).toBeNull();
  });

  test('a cached session does not outlive its expiry', async () => {
    const t = sessions();
    const token = await t.signIn();
    await t.service.resolve(t.viaCookie(token));
    const entry = (await t.cache.get(`session:${sha(token)}`)) as Row;
    await t.cache.set(`session:${sha(token)}`, { ...entry, expiresAt: Date.now() - 1 }, 60);
    t.rows[0].absolute_expires_at = new Date(Date.now() - 1);
    expect(await t.service.resolve(t.viaCookie(token))).toBeNull();
  });

  test('sliding renewal never goes past the absolute lifetime', async () => {
    const t = sessions();
    const token = await t.signIn();
    const row = t.rows[0];
    t.ageSession(row);
    row.absolute_expires_at = new Date(Date.now() + 5 * DAY);
    await t.service.resolve(t.viaCookie(token), t.reply());
    expect(row.expires_at.getTime()).toBe(row.absolute_expires_at.getTime());
  });

  test('no token, no lookup', async () => {
    const t = sessions();
    expect(await t.service.resolve({ cookies: {}, headers: {} } as any)).toBeNull();
    expect(t.prisma.session.findFirst).not.toHaveBeenCalled();
  });
});

describe('SessionService: rotation', () => {
  test('the daily renewal issues a new token and sets it as the cookie', async () => {
    const t = sessions();
    const token = await t.signIn();
    const row = t.rows[0];
    t.ageSession(row);
    const before = row.expires_at.getTime();
    const r = t.reply();
    expect(await t.service.resolve(t.viaCookie(token), r)).not.toBeNull();
    const next = t.cookies[SESSION_COOKIE] as string;
    expect(next).toBe(rotatedToken(token));
    expect(next).not.toBe(token);
    expect(row.token_hash).toBe(sha(next));
    expect(row.previous_token_hash).toBe(sha(token));
    expect(row.rotated_at).toBeInstanceOf(Date);
    expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before);
    // A cookie session gets no header.
    expect(t.headers['x-session-token']).toBeUndefined();
    expect(await t.service.resolve(t.viaCookie(next))).toMatchObject({ sessionId: 's1' });
  });

  test('a bearer token gets the new one in X-Session-Token, not a cookie', async () => {
    const t = sessions();
    const token = await t.signIn();
    t.ageSession(t.rows[0]);
    t.reply();
    const r = t.reply();
    await t.service.resolve(t.viaBearer(token), r);
    expect(t.headers['x-session-token']).toBe(rotatedToken(token));
    expect(t.headers['Cache-Control']).toBe('no-store');
    expect(r.setCookie).not.toHaveBeenCalled();
  });

  test('the replaced token works within the grace period and hands the new one over again', async () => {
    const t = sessions();
    const token = await t.signIn();
    t.ageSession(t.rows[0]);
    await t.service.resolve(t.viaBearer(token), t.reply());
    const r = t.reply();
    expect(await t.service.resolve(t.viaBearer(token), r)).toMatchObject({ userId: 'u1' });
    expect(t.headers['x-session-token']).toBe(rotatedToken(token));
    expect(t.rows[0].revoked_at).toBeNull();
  });

  test('the replaced token after the grace period revokes the whole session and alerts the user', async () => {
    const t = sessions();
    const token = await t.signIn();
    const row = t.rows[0];
    t.ageSession(row);
    await t.service.resolve(t.viaCookie(token), t.reply());
    const next = rotatedToken(token);
    await t.service.resolve(t.viaCookie(next)); // cached under the new token
    row.rotated_at = new Date(Date.now() - 121_000);
    const r = t.reply();
    expect(await t.service.resolve(t.viaCookie(token), r)).toBeNull();
    expect(r.clearCookie).toHaveBeenCalled();
    expect(row.revoked_at).toBeInstanceOf(Date);
    expect(row.revoked_reason).toBe('token_reuse');
    expect(t.alerts.tokenReuse).toHaveBeenCalledTimes(1);
    expect(t.alerts.tokenReuse.mock.calls[0][0]).toMatchObject({ userId: 'u1', device: 'Chrome on macOS', ip: '5.6.7.8' });
    // The current token dies with it, cache or not.
    expect(await t.service.resolve(t.viaCookie(next))).toBeNull();
  });

  test('a token older than the previous one is a plain 401', async () => {
    const t = sessions();
    const t0 = await t.signIn();
    const row = t.rows[0];
    t.ageSession(row);
    await t.service.resolve(t.viaCookie(t0), t.reply());
    const t1 = rotatedToken(t0);
    t.ageSession(row);
    await t.cache.delete(`session:${sha(t1)}`); // a minute later
    await t.service.resolve(t.viaCookie(t1), t.reply());
    expect(row.token_hash).toBe(sha(rotatedToken(t1)));
    expect(await t.service.resolve(t.viaCookie(t0), t.reply())).toBeNull();
    expect(row.revoked_at).toBeNull();
    expect(t.alerts.tokenReuse).not.toHaveBeenCalled();
  });

  test('concurrent renewals rotate once and both requests get the same token', async () => {
    const t = sessions();
    const token = await t.signIn();
    const row = t.rows[0];
    t.ageSession(row);
    const replies = [t.reply(), t.reply()];
    const tokens: string[] = [];
    for (const r of replies) r.header.mockImplementation((n: string, v: string) => n === 'x-session-token' && tokens.push(v));
    const users = await Promise.all(replies.map((r) => t.service.resolve(t.viaBearer(token), r)));
    expect(users.every((u) => u?.userId === 'u1')).toBe(true);
    expect(tokens).toEqual([rotatedToken(token), rotatedToken(token)]);
    expect(row.token_hash).toBe(sha(rotatedToken(token)));
    expect(row.previous_token_hash).toBe(sha(token));
    expect(row.revoked_at).toBeNull();
    const rotations = t.prisma.session.updateMany.mock.calls.filter((c: any) => c[0].data.token_hash);
    expect(rotations.length).toBe(2); // both tried, guarded on the old hash
  });
});

describe('SessionService: signed-in devices', () => {
  test('lists live sessions of the user only, current first, without token hashes', async () => {
    const t = sessions();
    await t.signIn();
    await t.signIn();
    await t.signIn('u2');
    const ended = await t.signIn();
    t.rows[3].revoked_at = new Date();
    void ended;
    const list = await t.service.list('u1', 's2');
    expect(list.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(list[0]).toMatchObject({ current: true, device: 'Chrome on macOS', ip: '1.2.3.4', method: 'email-code' });
    expect(JSON.stringify(list)).not.toContain('token');
    expect(JSON.stringify(list)).not.toContain(t.rows[0].token_hash);
  });

  test('revoking your own session works; someone else\'s is a 404', async () => {
    const t = sessions();
    await t.signIn();
    await t.signIn('u2');
    await expect(t.service.revokeOwn('u1', 's2', 's1')).rejects.toThrow('Session not found');
    expect(t.rows[1].revoked_at).toBeNull();
    expect(await t.service.revokeOwn('u1', 's1', 's1')).toEqual({ current: true });
    expect(t.rows[0].revoked_reason).toBe('signed_out');
    await expect(t.service.revokeOwn('u1', 's1', 's1')).rejects.toThrow('Session not found');
  });

  test('revoke-others keeps only the current session', async () => {
    const t = sessions();
    await t.signIn();
    await t.signIn();
    await t.signIn();
    await t.signIn('u2');
    expect(await t.service.revokeOthers('u1', 's2')).toBe(2);
    expect(t.rows.map((r) => !!r.revoked_at)).toEqual([true, false, true, false]);
    expect(t.rows[0].revoked_reason).toBe('signed_out_others');
  });

  test('revocation is immediate: the cached lookup is dropped (current and previous token)', async () => {
    const t = sessions();
    const token = await t.signIn();
    t.ageSession(t.rows[0]);
    await t.service.resolve(t.viaCookie(token), t.reply());
    const next = rotatedToken(token);
    expect(await t.service.resolve(t.viaCookie(next))).not.toBeNull();
    expect(await t.cache.get(`session:${sha(next)}`)).not.toBeNull();
    await t.service.revokeAll('u1', 'admin');
    expect(await t.cache.get(`session:${sha(next)}`)).toBeNull();
    expect(await t.service.resolve(t.viaCookie(next))).toBeNull();
    expect(await t.service.resolve(t.viaCookie(token))).toBeNull();
    expect(t.rows[0].revoked_reason).toBe('admin');
  });

  test('logout revokes this device and drops its cache entry', async () => {
    const t = sessions();
    const token = await t.signIn();
    await t.service.resolve(t.viaCookie(token));
    const r = t.reply();
    await t.service.revoke(t.viaCookie(token), r);
    expect(r.clearCookie).toHaveBeenCalled();
    expect(t.rows[0].revoked_reason).toBe('logout');
    expect(await t.service.resolve(t.viaCookie(token))).toBeNull();
  });
});

describe('SessionService: new sign-in alerts', () => {
  const settle = () => new Promise((r) => setTimeout(r, 5));

  test('no alert on the very first sign-in of a new account', async () => {
    const t = sessions();
    t.users.u1.last_sign_in_at = null;
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).not.toHaveBeenCalled();
  });

  test('an alert for a device not seen recently, none for a known one', async () => {
    const t = sessions();
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).toHaveBeenCalledTimes(1);
    expect(t.alerts.newSignIn.mock.calls[0][0]).toMatchObject({ userId: 'u1', device: 'Chrome on macOS', ip: '1.2.3.4' });
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).toHaveBeenCalledTimes(1);
    // A different browser is new.
    await t.signIn('u1', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0' } });
    await settle();
    expect(t.alerts.newSignIn).toHaveBeenCalledTimes(2);
  });

  test('signing out and back in on the same device is not new, even once the session is purged', async () => {
    const t = sessions();
    await t.signIn();
    t.rows.splice(0); // logged out, then purged by the retention job
    t.alerts.newSignIn.mockClear();
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).not.toHaveBeenCalled();
  });

  test('a device not used for more than 90 days counts as new', async () => {
    const t = sessions();
    await t.signIn();
    for (const row of t.known.values()) row.last_seen_at = new Date(Date.now() - 100 * DAY);
    t.alerts.newSignIn.mockClear();
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).toHaveBeenCalledTimes(1);
  });

  test('daily use keeps a device known', async () => {
    const t = sessions();
    const token = await t.signIn();
    const [entry] = [...t.known.values()];
    entry.last_seen_at = new Date(Date.now() - 80 * DAY);
    t.ageSession(t.rows[0]);
    await t.service.resolve(t.viaCookie(token), t.reply());
    await settle();
    expect(Date.now() - entry.last_seen_at.getTime()).toBeLessThan(60_000);
  });

  test('sessions from before device labels match on the user agent', async () => {
    const t = sessions();
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Chrome/130.0 Safari/537.36';
    t.rows.push({ id: 'old', user_id: 'u1', method: 'email-code', device: null, user_agent: ua, created_at: new Date(Date.now() - DAY), revoked_at: null });
    await t.signIn();
    await settle();
    expect(t.alerts.newSignIn).not.toHaveBeenCalled();
  });

  test('SESSION_ALERTS_ENABLED=false turns alerts off', async () => {
    await withEnv({ SESSION_ALERTS_ENABLED: 'false' }, async () => {
      const t = sessions();
      await t.signIn();
      await settle();
      expect(t.alerts.newSignIn).not.toHaveBeenCalled();
    });
  });

  test('a failing alert never fails the sign-in', async () => {
    const t = sessions();
    t.prisma.known_device.findUnique.mockRejectedValue(new Error('db down'));
    expect(await t.signIn()).toBeString();
  });
});

describe('SessionAlertService', () => {
  function alertService(configured = true, accountType = 'staff') {
    const prisma = createMockPrisma();
    prisma.app_user.findUnique.mockResolvedValue({ email: 'jo@school.edu' });
    prisma.user_profile.findUnique.mockResolvedValue({ account_type: accountType });
    const sent: any[] = [];
    const mail = { configured: () => configured, send: mock(async (m: any) => void sent.push(m)) };
    return { service: new SessionAlertService(prisma as any, mail as any), sent, mail };
  }

  test('a new sign-in email with the device, IP and a link to Signed-in devices (HTML escaped)', async () => {
    const { service, sent } = alertService();
    await service.newSignIn({ userId: 'u1', device: 'GradeBook app on <b>Pixel</b>', ip: '1.2.3.4' });
    expect(sent[0].to).toBe('jo@school.edu');
    expect(sent[0].subject).toBe('New sign-in to GradeBook');
    expect(sent[0].text).toContain('GradeBook app on <b>Pixel</b>');
    expect(sent[0].text).toContain('1.2.3.4');
    expect(sent[0].text).toContain('/dashboard/settings#devices');
    expect(sent[0].html).toContain('&lt;b&gt;Pixel&lt;/b&gt;');
    expect(sent[0].html).not.toContain('<b>Pixel');
  });

  test('students are sent to the portal; the reuse email says the device was signed out', async () => {
    const { service, sent } = alertService(true, 'student');
    await service.tokenReuse({ userId: 'u1', device: 'Chrome on macOS', ip: null });
    expect(sent[0].subject).toContain('signed out');
    expect(sent[0].text).toContain('/portal/settings#devices');
  });

  test('skips when email is not configured, and swallows send failures', async () => {
    const off = alertService(false);
    await off.service.newSignIn({ userId: 'u1', device: 'x', ip: null });
    expect(off.mail.send).not.toHaveBeenCalled();
    const failing = alertService();
    failing.mail.send.mockRejectedValue(new Error('smtp down'));
    await failing.service.newSignIn({ userId: 'u1', device: 'x', ip: null });
  });
});

describe('deviceLabel', () => {
  test.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Chrome on ChromeOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['curl/8.4.0', 'curl'],
    ['', 'Unknown device'],
  ])('%s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  test('the app: the device header wins, else the platform from the user agent', () => {
    expect(deviceLabel('GradeBook/1.0 CFNetwork/1.0 Darwin/24', 'iPhone 15 Pro · iOS 19.0', true)).toBe(
      'GradeBook app on iPhone 15 Pro (iOS 19.0)',
    );
    expect(deviceLabel('okhttp/4.12.0', null, true)).toBe('GradeBook app on Android');
    expect(deviceLabel(null, null, true)).toBe('GradeBook app');
    expect(deviceLabel('x', encodeURIComponent('Galaxy S24 · Android 15'), true)).toBe('GradeBook app on Galaxy S24 (Android 15)');
    expect(deviceLabel('x', '100%', true)).toBe('GradeBook app on 100%');
    expect(deviceLabel('x', 'Pixel\u0000 8\n· Android 15', true)).toBe('GradeBook app on Pixel 8 (Android 15)');
    expect(deviceLabel('x', 'a'.repeat(500), true).length).toBeLessThanOrEqual(80);
  });
});

describe('sessionTokenFrom', () => {
  test('cookie first, then a Bearer header, else nothing', () => {
    expect(sessionTokenFrom({ cookies: { gb_session: 'c.t' }, headers: { authorization: 'Bearer b.t' } })).toBe('c.t');
    expect(sessionTokenFrom({ headers: { authorization: 'Bearer b.t' } })).toBe('b.t');
    // The app's keychain token wins over a cookie its cookie jar replays.
    expect(sessionTokenFrom({ cookies: { gb_session: 'c.t' }, headers: { authorization: 'Bearer b.t', 'x-gradebook-client': 'native' } })).toBe('b.t');
    expect(sessionTokenFrom({ headers: { authorization: 'bearer   b.t ' } })).toBe('b.t');
    expect(sessionTokenFrom({ headers: { authorization: 'Basic xyz' } })).toBeUndefined();
    expect(sessionTokenFrom({ headers: {} })).toBeUndefined();
  });
});
