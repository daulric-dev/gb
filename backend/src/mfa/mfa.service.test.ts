import { beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import {
  CHALLENGE_TTL_S,
  LOCKOUT_MS,
  MAX_CHALLENGE_ATTEMPTS,
  MAX_FAILED_ATTEMPTS,
  MFA_CHALLENGE_EXPIRED,
  MFA_ENROLMENT_REQUIRED,
  MFA_INVALID_CODE,
  MFA_LOCKED,
  MFA_REQUIRED,
  MfaService,
  forgetMfaRequirement,
} from './mfa.service';
import { base32Decode, totp } from './totp';

const USER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
/** The start of the current 30 s step: challenges expire on the real clock. */
const T0 = Math.floor(Date.now() / 30_000) * 30_000;

type Row = Record<string, any>;

/** Just enough of Prisma's filters for the queries MfaService makes. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
      if ('lt' in cond) return v != null && v < cond.lt;
      return true;
    }
    if (cond === null) return v == null;
    return v === cond;
  });
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] ?? 0) + v.increment : v;
  }
}

function table(pk: string) {
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)),
    count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: Row) => {
      const row = { [pk]: `id-${++seq}`, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: Row) => {
      for (const d of data) rows.push({ [pk]: `id-${++seq}`, used_at: null, ...d });
      return { count: data.length };
    },
    update: async ({ where, data }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      applyData(row, data);
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (row) applyData(row, update);
      else rows.push({ ...create });
      return row;
    },
    deleteMany: async ({ where }: Row = {}) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
  };
}

function setup(opts: { policy?: boolean; admin?: boolean } = {}) {
  const prisma: any = {
    mfa_totp: table('user_id'),
    mfa_recovery_code: table('id'),
    mfa_enrolment_gate: table('session_id'),
    session: table('id'),
    organisation: table('id'),
    organisation_admin: table('user_id'),
    school_management: table('id'),
    app_user: table('id'),
    user_profile: table('id'),
  };
  prisma.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
  prisma.organisation.rows.push({ id: 'org', require_mfa_for_admins: !!opts.policy });
  if (opts.admin) prisma.organisation_admin.rows.push({ user_id: USER });
  prisma.app_user.rows.push({ id: USER, email: 'user@school.test', user_profile: null });

  const cache = createMockCacheService();
  let n = 0;
  const sessions = {
    create: async (_reply: any, _req: any, userId: string, method: string) => {
      const token = `token-${++n}`;
      prisma.session.rows.push({
        id: `session-${n}`,
        user_id: userId,
        method,
        token_hash: createHash('sha256').update(token).digest('hex'),
      });
      return token;
    },
    revoked: [] as { userId: string; reason: string }[],
    revokeAll: async (userId: string, reason: string) => {
      sessions.revoked.push({ userId, reason });
      const live = prisma.session.rows.filter((r: Row) => r.user_id === userId && !r.revoked_at);
      live.forEach((r: Row) => (r.revoked_at = new Date()));
      return live.length;
    },
  };
  const audits: { action: string; event: unknown; actor: string }[] = [];
  const audit = {
    record: async (_tx: any, _school: any, actor: { id: string }, entry: any) => {
      audits.push({ action: entry.action, event: entry.changes.event?.after ?? entry.changes, actor: actor.id });
    },
  };
  const mails: string[] = [];
  const mail = {
    configured: () => true,
    send: async (m: { subject: string }) => void mails.push(m.subject),
  };
  const service = new MfaService(prisma, cache as any, sessions as any, audit as any, mail as any);
  return { service, prisma, cache, audits, mails, sessions };
}

const req: any = { ip: '203.0.113.9', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120' } };
const reply: any = {};
const me = { id: USER, email: 'user@school.test', sessionId: 'session-x' };

/** Set up an authenticator for USER at T0; returns its key and recovery codes. */
async function enrol(service: MfaService) {
  const { secret } = await service.startEnrolment(me, T0);
  const key = base32Decode(secret);
  const { recoveryCodes } = await service.confirmEnrolment(me, totp(key, T0), T0);
  return { key, recoveryCodes };
}

/** A challenge token from an email-code sign-in. */
async function challenge(service: MfaService): Promise<string> {
  const err = await expectRejection(service.startSession(reply, req, USER, 'email-code'));
  const body = (err as any).getResponse();
  expect(body.code).toBe(MFA_REQUIRED);
  expect(body.expiresIn).toBe(CHALLENGE_TTL_S);
  return body.mfaToken;
}

const codeOf = (err: unknown) => (err as any).getResponse?.().code;

beforeEach(() => {
  process.env.AUTH_SECRET = 'x'.repeat(40);
  delete process.env.DATA_ENCRYPTION_KEY;
});

describe('MfaService enrolment', () => {
  test('stores the secret sealed, enables on a correct code, and returns ten recovery codes', async () => {
    const { service, prisma, audits, mails } = setup();
    const start = await service.startEnrolment(me, T0);
    expect(start.otpauthUri).toContain(`secret=${start.secret}`);
    const row = prisma.mfa_totp.rows[0];
    expect(row.pending_secret_enc).toStartWith('v1:');
    expect(row.pending_secret_enc).not.toContain(start.secret);

    const wrong = await expectRejection(service.confirmEnrolment(me, '000000', T0));
    expect(codeOf(wrong)).toBe(MFA_INVALID_CODE);

    const { recoveryCodes } = await service.confirmEnrolment(me, totp(base32Decode(start.secret), T0), T0);
    expect(recoveryCodes).toHaveLength(10);
    expect(row.enabled_at).toBeInstanceOf(Date);
    expect(row.pending_secret_enc).toBeNull();
    // Hashes only.
    expect(prisma.mfa_recovery_code.rows.map((r: Row) => r.code_hash)).not.toContain(recoveryCodes[0]);
    expect(audits.at(-1)).toMatchObject({ action: 'create', event: 'enabled' });
    expect(mails).toHaveLength(1);
    expect((await service.status(me)).enabled).toBe(true);
  });

  test('a pending secret expires', async () => {
    const { service } = setup();
    const { secret } = await service.startEnrolment(me);
    const late = Date.now() + 16 * 60_000;
    const err = await expectRejection(service.confirmEnrolment(me, totp(base32Decode(secret), late), late));
    expect((err as Error).message).toContain('expired');
  });

  test('the secret is bound to the user (AAD): another user id cannot open it', async () => {
    const { service, prisma } = setup();
    await enrol(service);
    const row = prisma.mfa_totp.rows[0];
    row.user_id = ADMIN; // as if the row were copied to another account
    const err = await expectRejection(service.startSession(reply, req, ADMIN, 'email-code'));
    const token = (err as any).getResponse().mfaToken;
    const bad = await expectRejection(
      service.verifyChallenge(req, reply, { token, code: '123456' }, T0 + 30_000),
    );
    expect(codeOf(bad)).toBe(MFA_INVALID_CODE);
  });
});

describe('MfaService sign-in challenge', () => {
  test('no authenticator: the session starts straight away', async () => {
    const { service, prisma } = setup();
    await service.startSession(reply, req, USER, 'email-code');
    expect(prisma.session.rows).toHaveLength(1);
  });

  test('a valid code starts the session once; the same code cannot be replayed', async () => {
    const { service, prisma, audits } = setup();
    const { key } = await enrol(service);
    const now = T0 + 60_000;
    const token = await challenge(service);
    expect(prisma.session.rows).toHaveLength(0);

    const ok = await service.verifyChallenge(req, reply, { token, code: totp(key, now) }, now);
    expect(ok.signedIn).toBe(true);
    expect(prisma.session.rows).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ event: 'sign_in_verified' });

    // The token is single use.
    const again = await expectRejection(service.verifyChallenge(req, reply, { token, code: totp(key, now) }, now));
    expect(codeOf(again)).toBe(MFA_CHALLENGE_EXPIRED);

    // A new challenge with the same (already used) code: refused as a replay.
    const token2 = await challenge(service);
    const replay = await expectRejection(service.verifyChallenge(req, reply, { token: token2, code: totp(key, now) }, now));
    expect(codeOf(replay)).toBe(MFA_INVALID_CODE);
    // The next step's code works.
    await service.verifyChallenge(req, reply, { token: token2, code: totp(key, now + 30_000) }, now + 30_000);
    expect(prisma.session.rows).toHaveLength(2);
  });

  test('the challenge expires after five minutes', async () => {
    const { service } = setup();
    const { key } = await enrol(service);
    const token = await challenge(service);
    const later = Date.now() + CHALLENGE_TTL_S * 1000 + 1000;
    const err = await expectRejection(service.verifyChallenge(req, reply, { token, code: totp(key, later) }, later));
    expect(codeOf(err)).toBe(MFA_CHALLENGE_EXPIRED);
  });

  test('a challenge dies after too many wrong codes', async () => {
    const { service, audits } = setup();
    await enrol(service);
    const token = await challenge(service);
    for (let i = 0; i < MAX_CHALLENGE_ATTEMPTS; i++) {
      const err = await expectRejection(service.verifyChallenge(req, reply, { token, code: '000000' }, T0 + 60_000));
      expect(codeOf(err)).toBe(MFA_INVALID_CODE);
    }
    const dead = await expectRejection(service.verifyChallenge(req, reply, { token, code: '000000' }, T0 + 60_000));
    expect(codeOf(dead)).toBe(MFA_CHALLENGE_EXPIRED);
    expect(audits.filter((a) => a.event === 'sign_in_failed')).toHaveLength(MAX_CHALLENGE_ATTEMPTS);
  });

  test('repeated wrong codes lock the account for a while, even with the right code', async () => {
    const { service, prisma, audits } = setup();
    const { key } = await enrol(service);
    const now = Date.now();
    let failures = 0;
    while (failures < MAX_FAILED_ATTEMPTS) {
      const token = await challenge(service);
      for (let i = 0; i < MAX_CHALLENGE_ATTEMPTS && failures < MAX_FAILED_ATTEMPTS; i++, failures++) {
        await expectRejection(service.verifyChallenge(req, reply, { token, code: '000000' }, now));
      }
    }
    expect(audits.some((a) => a.event === 'sign_in_locked')).toBe(true);
    const row = prisma.mfa_totp.rows[0];
    expect(row.locked_until.getTime()).toBe(now + LOCKOUT_MS);

    const token = await challenge(service);
    const locked = await expectRejection(
      service.verifyChallenge(req, reply, { token, code: totp(key, now + 30_000) }, now + 30_000),
    );
    expect(codeOf(locked)).toBe(MFA_LOCKED);
    expect(prisma.session.rows).toHaveLength(0);
  });

  test('a recovery code works once, and the user is emailed', async () => {
    const { service, prisma, mails, audits } = setup();
    const { recoveryCodes } = await enrol(service);
    mails.length = 0;
    const token = await challenge(service);
    const res = await service.verifyChallenge(req, reply, { token, recoveryCode: recoveryCodes[3].toUpperCase() }, T0);
    expect(res).toMatchObject({ recoveryCodeUsed: true, recoveryCodesRemaining: 9 });
    expect(prisma.session.rows).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ event: 'sign_in_recovery_code' });
    await Bun.sleep(0);
    expect(mails).toEqual(['A recovery code was used to sign in to GradeBook']);

    const token2 = await challenge(service);
    const reused = await expectRejection(service.verifyChallenge(req, reply, { token: token2, recoveryCode: recoveryCodes[3] }, T0));
    expect(codeOf(reused)).toBe(MFA_INVALID_CODE);
  });

  test('single sign-on: challenged only when the organisation requires it for the role', async () => {
    const optional = setup({ admin: true });
    await enrol(optional.service);
    await optional.service.startSession(reply, req, USER, 'google');
    expect(optional.prisma.session.rows).toHaveLength(1);

    const required = setup({ admin: true, policy: true });
    await enrol(required.service);
    const url = await required.service.finishWebSignIn(reply, req, USER, 'google', '/dashboard');
    expect(url).toContain('/login/two-step?token=');
    expect(url).toContain('next=%2Fdashboard');
    expect(required.prisma.session.rows).toHaveLength(0);
  });
});

describe('MfaService organisation requirement', () => {
  test('an admin without an authenticator gets a session limited to setting one up', async () => {
    const { service, prisma } = setup({ policy: true, admin: true });
    await service.startSession(reply, req, USER, 'email-code');
    const sessionId = prisma.session.rows[0].id;
    expect(prisma.mfa_enrolment_gate.rows).toHaveLength(1);

    const user = { id: USER, sessionId };
    const blocked = await expectRejection(service.assertSessionAllowed({ url: '/api/courses', user }));
    expect(codeOf(blocked)).toBe(MFA_ENROLMENT_REQUIRED);
    for (const url of ['/api/auth/me', '/api/auth/mfa', '/api/auth/mfa/enrol/confirm', '/api/auth/step-up/send', '/api/auth/logout']) {
      await service.assertSessionAllowed({ url, user });
    }
    expect((await service.status(user)).enrolmentRequired).toBe(true);

    // Setting one up lifts the limit.
    const { secret } = await service.startEnrolment({ ...me, sessionId });
    await service.confirmEnrolment({ ...me, sessionId }, totp(base32Decode(secret), Date.now()), Date.now());
    expect(prisma.mfa_enrolment_gate.rows).toHaveLength(0);
    await service.assertSessionAllowed({ url: '/api/courses', user });
  });

  test('setting off, or a role it does not cover: no limit', async () => {
    const off = setup({ policy: false, admin: true });
    await off.service.startSession(reply, req, USER, 'email-code');
    expect(off.prisma.mfa_enrolment_gate.rows).toHaveLength(0);

    const teacher = setup({ policy: true });
    teacher.prisma.school_management.rows.push({ user_id: USER, role: 'teacher', school_management_role: [] });
    await teacher.service.startSession(reply, req, USER, 'email-code');
    expect(teacher.prisma.mfa_enrolment_gate.rows).toHaveLength(0);
  });

  test('a custom role granting safeguarding is covered', async () => {
    const { service, prisma } = setup({ policy: true });
    prisma.school_management.rows.push({
      user_id: USER,
      role: 'teacher',
      school_management_role: [{ school_role: { school_role_permission: [{ id: 'p' }] } }],
    });
    expect(await service.holdsPrivilegedRole(USER)).toBe(true);
  });

  test('cannot be turned off while required; can be when not', async () => {
    const required = setup({ policy: true, admin: true });
    const { key } = await enrol(required.service);
    const err = await expectRejection(required.service.disable(me, { code: totp(key, T0 + 30_000) }, T0 + 30_000));
    expect((err as Error).message).toContain('requires');

    const optional = setup();
    const enrolled = await enrol(optional.service);
    await optional.service.disable(me, { code: totp(enrolled.key, T0 + 30_000) }, T0 + 30_000);
    expect(optional.prisma.mfa_totp.rows).toHaveLength(0);
    expect(optional.prisma.mfa_recovery_code.rows).toHaveLength(0);
  });

  test('policy changes are audited', async () => {
    const { service, prisma, audits } = setup();
    expect(await service.policy()).toEqual({ requireMfaForAdmins: false });
    await service.setPolicy(ADMIN, true);
    expect(prisma.organisation.rows[0].require_mfa_for_admins).toBe(true);
    expect(audits.at(-1)).toMatchObject({ actor: ADMIN, action: 'update' });
  });

  test('an organisation admin reset removes the app and codes, audits and emails', async () => {
    const { service, prisma, audits, mails, sessions } = setup();
    await enrol(service);
    mails.length = 0;
    await service.adminReset(ADMIN, USER);
    expect(prisma.mfa_totp.rows).toHaveLength(0);
    expect(prisma.mfa_recovery_code.rows).toHaveLength(0);
    expect(audits.at(-1)).toMatchObject({ actor: ADMIN, action: 'delete', event: 'reset_by_admin' });
    expect(sessions.revoked).toEqual([{ userId: USER, reason: 'mfa_reset' }]);
    await Bun.sleep(0);
    expect(mails).toEqual(['Your GradeBook two-step verification was reset']);
    // Nothing left to reset.
    await expectRejection(service.adminReset(ADMIN, USER));
    // Signing in no longer asks for a code.
    await service.startSession(reply, req, USER, 'email-code');
    expect(prisma.session.rows).toHaveLength(1);
  });

  test('an organisation admin cannot reset their own two-step verification', async () => {
    const { service, prisma, sessions } = setup();
    await enrol(service);
    const err = await expectRejection(service.adminReset(USER, USER));
    expect((err as any).getStatus()).toBe(403);
    expect(prisma.mfa_totp.rows).toHaveLength(1);
    expect(sessions.revoked).toHaveLength(0);
  });

  test('single sign-on sessions are gated too when an authenticator is required and missing', async () => {
    const { service, prisma } = setup({ policy: true, admin: true });
    await service.startSession(reply, req, USER, 'google');
    expect(prisma.mfa_enrolment_gate.rows).toHaveLength(1);
    const user = { id: USER, sessionId: prisma.session.rows[0].id };
    const blocked = await expectRejection(service.assertSessionAllowed({ url: '/api/courses', user }));
    expect(codeOf(blocked)).toBe(MFA_ENROLMENT_REQUIRED);

    const web = setup({ policy: true, admin: true });
    await web.service.finishWebSignIn(reply, req, USER, 'microsoft', '/dashboard');
    expect(web.prisma.mfa_enrolment_gate.rows).toHaveLength(1);
  });

  test('existing sessions are caught when the policy is switched on, without a gate row', async () => {
    const { service, prisma } = setup({ policy: false, admin: true });
    await service.startSession(reply, req, USER, 'email-code');
    const user = { id: USER, sessionId: prisma.session.rows[0].id };
    await service.assertSessionAllowed({ url: '/api/courses', user }); // caches "not needed"
    await service.setPolicy(ADMIN, true);
    expect(prisma.mfa_enrolment_gate.rows).toHaveLength(0);
    const blocked = await expectRejection(service.assertSessionAllowed({ url: '/api/courses', user }));
    expect(codeOf(blocked)).toBe(MFA_ENROLMENT_REQUIRED);
    // Enrolment routes still work, and status says so.
    await service.assertSessionAllowed({ url: '/api/auth/mfa/enrol', user });
    expect((await service.status(user)).enrolmentRequired).toBe(true);
    expect(await service.sessionUsable(USER, user.sessionId)).toBe(false);
  });

  test('a promoted user is caught once their cached answer is forgotten', async () => {
    const { service, prisma, cache } = setup({ policy: true });
    await service.startSession(reply, req, USER, 'email-code');
    const user = { id: USER, sessionId: prisma.session.rows[0].id };
    await service.assertSessionAllowed({ url: '/api/courses', user });
    prisma.organisation_admin.rows.push({ user_id: USER });
    await forgetMfaRequirement(cache as any, USER);
    const blocked = await expectRejection(service.assertSessionAllowed({ url: '/api/courses', user }));
    expect(codeOf(blocked)).toBe(MFA_ENROLMENT_REQUIRED);
  });

  test('regenerating recovery codes invalidates the old ones', async () => {
    const { service } = setup();
    const { recoveryCodes } = await enrol(service);
    const fresh = await service.regenerateRecoveryCodes(me);
    expect(fresh.recoveryCodes).toHaveLength(10);
    const token = await challenge(service);
    const old = await expectRejection(service.verifyChallenge(req, reply, { token, recoveryCode: recoveryCodes[0] }, T0));
    expect(codeOf(old)).toBe(MFA_INVALID_CODE);
    await service.verifyChallenge(req, reply, { token, recoveryCode: fresh.recoveryCodes[0] }, T0);
  });
});
