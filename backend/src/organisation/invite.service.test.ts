import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { AccountService } from '@/account/account.service';
import { permCacheKey, userPermCachePrefix } from '@/permission/permission.effective';
import { INVITE_TTL_MS, InviteService } from './invite.service';
import { inviteEmail } from './invite.email';

const ME = 'u-org-admin';
const DAY = 24 * 3600 * 1000;

type Row = Record<string, any>;

/** Matches the where clauses InviteService writes (null, gt, in, equality). */
const hit = (row: Row, where: Row) =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === null) return value == null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('gt' in cond) return value > cond.gt;
    }
    return value === cond;
  });

/** public.organisation_invite in memory, so open / expired filters run for real. */
function inviteTable(prisma: MockPrisma) {
  const rows: Row[] = [];
  prisma.organisation_invite.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => hit(r, where)).map((r) => ({ ...r })),
  );
  prisma.organisation_invite.findUnique.mockImplementation(async ({ where }: any) => {
    const row = rows.find((r) => r.id === where.id);
    return row ? { ...row, school: null, inviter: null } : null;
  });
  prisma.organisation_invite.findUniqueOrThrow.mockImplementation(async ({ where }: any) => {
    const row = rows.find((r) => r.id === where.id);
    if (!row) throw new Error('Not found');
    return { ...row };
  });
  prisma.organisation_invite.updateMany.mockImplementation(async ({ where, data }: any) => {
    const matched = rows.filter((r) => hit(r, where));
    for (const r of matched) Object.assign(r, data);
    return { count: matched.length };
  });
  prisma.organisation_invite.create.mockImplementation(async ({ data }: any) => {
    const row = {
      id: `inv-${rows.length + 1}`,
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
      ...data,
    };
    rows.push(row);
    return { ...row };
  });
  const add = (extra: Row): Row => {
    const row: Row = {
      id: `inv-${rows.length + 1}`,
      email: 'head@x.org',
      kind: 'school_admin',
      school_id: 's1',
      invited_by: ME,
      created_at: new Date(Date.now() - DAY),
      expires_at: new Date(Date.now() + 13 * DAY),
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
      ...extra,
    };
    rows.push(row);
    return row;
  };
  return { rows, add };
}

describe('InviteService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let mail: { configured: ReturnType<typeof mock>; send: ReturnType<typeof mock> };
  let service: InviteService;
  let table: ReturnType<typeof inviteTable>;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    mail = { configured: mock(() => false), send: mock(async () => {}) };
    const accounts = { onVerifiedSignIn: mock(() => {}) };
    service = new InviteService(prisma as any, cache as any, mail as any, accounts as any);
    table = inviteTable(prisma);
  });

  describe('invite', () => {
    test('a new school admin invite revokes the school’s previous one', async () => {
      const old = table.add({ email: 'first@x.org' });
      const other = table.add({ email: 'other@x.org', school_id: 's2' });

      const sent = await service.invite(ME, 'school_admin', ' Second@X.org ', 's1');

      expect(sent.email).toBe('second@x.org');
      expect(new Date(sent.expiresAt).getTime() - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 5000);
      expect(old.revoked_at).toBeInstanceOf(Date);
      expect(other.revoked_at).toBeNull();
      expect(table.rows.filter((r) => r.school_id === 's1' && !r.revoked_at)).toHaveLength(1);
    });

    test('an organisation admin invite replaces only that email’s open one', async () => {
      const same = table.add({ kind: 'organisation_admin', school_id: null, email: 'a@x.org' });
      const other = table.add({ kind: 'organisation_admin', school_id: null, email: 'b@x.org' });
      await service.invite(ME, 'organisation_admin', 'a@x.org');
      expect(same.revoked_at).toBeInstanceOf(Date);
      expect(other.revoked_at).toBeNull();
      expect(table.rows.at(-1)).toMatchObject({ kind: 'organisation_admin', school_id: null });
    });

    test('skips the email without SMTP', async () => {
      await service.invite(ME, 'school_admin', 'new@x.org', 's1');
      expect(mail.send).not.toHaveBeenCalled();
    });

    test('emails the invite when SMTP is configured', async () => {
      mail.configured.mockReturnValue(true);
      const prevUrl = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'https://gb.example.org,https://other.example.org';
      prisma.organisation_invite.findUnique.mockImplementation(async ({ where }: any) => ({
        ...table.rows.find((r) => r.id === where.id),
        school: { id: 's1', name: 'Riverside <Primary>' },
        inviter: { id: ME, first_name: 'Ada', last_name: 'L', email: null, app_user: null },
      }));
      try {
        await service.invite(ME, 'school_admin', 'new@x.org', 's1');
      } finally {
        if (prevUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = prevUrl;
      }
      const sent = mail.send.mock.calls[0][0] as any;
      expect(sent.to).toBe('new@x.org');
      expect(sent.subject).toBe("You've been invited to run Riverside <Primary> on GradeBook");
      expect(sent.text).toContain('Ada L invited you');
      expect(sent.text).toContain('https://gb.example.org/login');
      expect(sent.html).toContain('Riverside &lt;Primary&gt;');
      expect(sent.html).not.toContain('<Primary>');
    });

    test('a mail failure does not fail the invite', async () => {
      mail.configured.mockReturnValue(true);
      mail.send.mockRejectedValue(new Error('SMTP down'));
      const sent = await service.invite(ME, 'organisation_admin', 'new@x.org');
      expect(sent.id).toBeTruthy();
    });
  });

  describe('revoke and resend', () => {
    test('revoke marks an open invite revoked; 404 once it is not open', async () => {
      const row = table.add({});
      expect(await service.revoke(ME, row.id)).toEqual({ revoked: true });
      expect(row.revoked_at).toBeInstanceOf(Date);
      expect(await expectRejection(service.revoke(ME, row.id))).toBeInstanceOf(NotFoundException);
    });

    test('resend gives an expired invite 14 more days and emails it again', async () => {
      mail.configured.mockReturnValue(true);
      const row = table.add({ expires_at: new Date(Date.now() - DAY) });
      const sent = await service.resend(ME, row.id);
      expect(new Date(sent.expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
      expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    test('resend: 404 for an accepted invite', async () => {
      const row = table.add({ accepted_at: new Date(), accepted_by: 'u-1' });
      expect(await expectRejection(service.resend(ME, row.id))).toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    test('open invites only, flagging expired ones', async () => {
      table.add({ id: 'open' });
      table.add({ id: 'old', expires_at: new Date(Date.now() - DAY) });
      table.add({ id: 'gone', revoked_at: new Date() });
      table.add({ id: 'done', accepted_at: new Date() });
      const rows = await service.list();
      expect(rows.map((r) => [r.id, r.expired])).toEqual([
        ['open', false],
        ['old', true],
      ]);
    });
  });

  describe('acceptFor (verified sign-in)', () => {
    const user = { id: 'u-head', email: 'head@x.org' };

    test('appoints the school admin, demotes the previous one and marks it accepted', async () => {
      const invite = table.add({});
      prisma.user_profile.findUnique.mockResolvedValue({
        id: 'u-head',
        school_id: null,
        account_type: 'staff',
      });
      prisma.school_management.findFirst.mockResolvedValue({ id: 'm-old', user_id: 'u-old' });
      for (const key of ['profile:u-head', 'profile:u-old', permCacheKey('u-old', 's1')]) {
        await cache.set(key, {}, 60);
      }

      expect(await service.acceptFor(user)).toBe(1);

      expect(invite.accepted_at).toBeInstanceOf(Date);
      expect(invite.accepted_by).toBe('u-head');
      expect(invite.revoked_at).toBeNull();
      expect(prisma.school_management.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm-old' },
        data: { role: 'teacher' },
      });
      expect(prisma.school_management.create.mock.calls[0][0].data).toMatchObject({
        user_id: 'u-head',
        school_id: 's1',
        role: 'admin',
      });
      expect(prisma.school_management.upsert).not.toHaveBeenCalled();
      expect(prisma.school.update.mock.calls[0][0].data.owner_id).toBe('u-head');
      expect(prisma.user_profile.update.mock.calls[0][0]).toEqual({
        where: { id: 'u-head' },
        data: { school_id: 's1', role: 'admin', is_active: true },
      });
      expect(await cache.get('profile:u-head')).toBeNull();
      expect(await cache.get('profile:u-old')).toBeNull();
      expect(await cache.get(permCacheKey('u-old', 's1'))).toBeNull();
    });

    test('a first sign-in gets a profile before it is seated', async () => {
      table.add({});
      prisma.user_profile.create.mockImplementation(async ({ data }: any) => ({
        id: data.id,
        school_id: null,
        account_type: 'staff',
      }));
      expect(await service.acceptFor(user)).toBe(1);
      expect(prisma.user_profile.create.mock.calls[0][0].data).toEqual({
        id: 'u-head',
        email: 'head@x.org',
      });
      expect(prisma.user_profile.create.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.school_management.create.mock.invocationCallOrder[0],
      );
    });

    test('an organisation admin invite adds the row and clears the permission caches', async () => {
      const invite = table.add({ kind: 'organisation_admin', school_id: null, invited_by: ME });
      prisma.user_profile.findUnique.mockResolvedValue({ id: 'u-head', school_id: 's9', account_type: 'staff' });
      await cache.set(`${userPermCachePrefix('u-head')}s9`, {}, 60);

      expect(await service.acceptFor(user)).toBe(1);
      expect(prisma.organisation_admin.create.mock.calls[0][0].data).toEqual({
        user_id: 'u-head',
        created_by: ME,
      });
      expect(invite.accepted_by).toBe('u-head');
      expect(await cache.get(`${userPermCachePrefix('u-head')}s9`)).toBeNull();
    });

    test('expired and revoked invites are ignored', async () => {
      table.add({ expires_at: new Date(Date.now() - 1000) });
      table.add({ school_id: 's2', revoked_at: new Date() });
      expect(await service.acceptFor(user)).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.school_management.create).not.toHaveBeenCalled();
    });

    test('a student account is never made a school admin; the invite stays open', async () => {
      const invite = table.add({});
      prisma.user_profile.findUnique.mockResolvedValue({
        id: 'u-head',
        school_id: 's2',
        account_type: 'student',
      });
      expect(await service.acceptFor(user)).toBe(0);
      expect(invite.accepted_at).toBeNull();
      expect(prisma.school_management.create).not.toHaveBeenCalled();
    });

    test('an invite another sign-in already claimed is applied once', async () => {
      table.add({});
      prisma.user_profile.findUnique.mockResolvedValue({ id: 'u-head', school_id: null, account_type: 'staff' });
      // Claimed between the read and the claim.
      prisma.organisation_invite.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.acceptFor(user)).toBe(0);
      expect(prisma.school_management.create).not.toHaveBeenCalled();
    });
  });
});

describe('invite email', () => {
  test('organisation admin wording', () => {
    const email = inviteEmail({
      kind: 'organisation_admin',
      place: 'Riverside Trust',
      inviter: null,
      expiresAt: new Date('2026-11-15T10:00:00Z'),
      signInUrl: 'https://gb.example.org/login',
    });
    expect(email.subject).toBe("You've been invited to administer Riverside Trust on GradeBook");
    expect(email.text).toContain('15 November 2026');
    expect(email.html).toContain('href="https://gb.example.org/login"');
  });
});

describe('AccountService verified sign-in hooks', () => {
  function accounts() {
    const prisma = createMockPrisma();
    const service = new AccountService(prisma as any, { purgeCached: mock(async () => {}) } as any);
    return { prisma, service };
  }

  test('a verified email runs the hooks with the user', async () => {
    const { prisma, service } = accounts();
    prisma.app_user.create.mockResolvedValue({ id: 'u-1', email: 'head@x.org' });
    const hook = mock(async () => {});
    service.onVerifiedSignIn(hook);
    expect(await service.userForVerifiedEmail('Head@X.org')).toEqual({ id: 'u-1', email: 'head@x.org' });
    expect(hook).toHaveBeenCalledWith({ id: 'u-1', email: 'head@x.org' });
  });

  test('a failing hook never fails the sign-in', async () => {
    const { prisma, service } = accounts();
    prisma.app_user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'head@x.org',
      disabled_at: null,
      email_verified_at: new Date(),
    });
    service.onVerifiedSignIn(async () => {
      throw new Error('boom');
    });
    expect(await service.userForVerifiedEmail('head@x.org')).toEqual({ id: 'u-1', email: 'head@x.org' });
  });

  test('an unverified SSO email never runs them', async () => {
    const { service } = accounts();
    const hook = mock(async () => {});
    service.onVerifiedSignIn(hook);
    const err = await expectRejection(
      service.userForIdentity(
        { provider: 'oidc', subject: 'x', email: 'head@x.org', claims: {} },
        false,
      ),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(hook).not.toHaveBeenCalled();
  });

  test('a disabled account never runs them', async () => {
    const { prisma, service } = accounts();
    prisma.app_user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'head@x.org',
      disabled_at: new Date(),
      email_verified_at: new Date(),
    });
    const hook = mock(async () => {});
    service.onVerifiedSignIn(hook);
    expect(await expectRejection(service.userForVerifiedEmail('head@x.org'))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(hook).not.toHaveBeenCalled();
  });

  test('InviteService registers itself at boot', () => {
    const { service: accountService } = accounts();
    const spy = mock(() => {});
    accountService.onVerifiedSignIn = spy as any;
    new InviteService({} as any, {} as any, {} as any, accountService).onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
