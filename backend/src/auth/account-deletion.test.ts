import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import {
  ACCOUNT_DELETION_BLOCKED,
  LAST_ORG_ADMIN_MESSAGE,
  ORG_OWNER_MESSAGE,
  accountDeletionCheck,
  isSsoProvider,
  providerLabel,
} from './account-deletion';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { FeatureService } from '@/features/feature.service';

const ME = 'user-me';

/** Who the user is, as the deletion check reads it. */
function given(
  prisma: MockPrisma,
  opts: {
    accountType?: 'staff' | 'student' | 'parent';
    studentRow?: boolean;
    providers?: string[];
    ownsOrg?: boolean;
    orgAdminRow?: boolean;
    otherOrgAdmins?: number;
    ownedSchools?: { id: string; name: string | null }[];
    adminSeats?: { school_id: string; name: string; owner_id: string | null }[];
    schoolStaff?: number;
    schoolStudents?: number;
  },
) {
  prisma.user_profile.findUnique.mockResolvedValue({
    account_type: opts.accountType ?? 'staff',
  });
  prisma.student.findFirst.mockResolvedValue(opts.studentRow ? { id: 'st-1' } : null);
  prisma.identity.findMany.mockResolvedValue(
    (opts.providers ?? []).map((provider) => ({ provider })),
  );
  prisma.organisation.findFirst.mockResolvedValue(opts.ownsOrg ? { id: 'org-1' } : null);
  prisma.organisation_admin.findUnique.mockResolvedValue(
    opts.orgAdminRow ? { user_id: ME } : null,
  );
  prisma.organisation_admin.count.mockResolvedValue(opts.otherOrgAdmins ?? 1);
  prisma.school.findMany.mockResolvedValue(opts.ownedSchools ?? []);
  prisma.school_management.findMany.mockResolvedValue(
    (opts.adminSeats ?? []).map((s) => ({
      school_id: s.school_id,
      school: { id: s.school_id, name: s.name, owner_id: s.owner_id },
    })),
  );
  prisma.school_management.count.mockResolvedValue(opts.schoolStaff ?? 0);
  prisma.student.count.mockResolvedValue(opts.schoolStudents ?? 0);
}

describe('accountDeletionCheck', () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = createMockPrisma();
  });

  const codes = async () =>
    (await accountDeletionCheck(prisma as any, ME)).blockers.map((b) => b.code);

  test('an ordinary staff member can delete', async () => {
    given(prisma, {});
    expect(await accountDeletionCheck(prisma as any, ME)).toEqual({
      canDelete: true,
      blockers: [],
    });
  });

  test('ORG_OWNER: the organisation owner must transfer first', async () => {
    given(prisma, { ownsOrg: true, orgAdminRow: true, otherOrgAdmins: 2 });
    const check = await accountDeletionCheck(prisma as any, ME);
    expect(check.canDelete).toBe(false);
    expect(check.blockers).toEqual([
      {
        code: 'ORG_OWNER',
        message: ORG_OWNER_MESSAGE,
        action: { type: 'transfer_organisation_ownership' },
      },
    ]);
    expect(prisma.organisation.findFirst.mock.calls[0][0].where).toEqual({ owner_id: ME });
  });

  test('LAST_ORG_ADMIN: the existing rule stays', async () => {
    given(prisma, { orgAdminRow: true, otherOrgAdmins: 0 });
    const check = await accountDeletionCheck(prisma as any, ME);
    expect(check.blockers).toEqual([
      {
        code: 'LAST_ORG_ADMIN',
        message: LAST_ORG_ADMIN_MESSAGE,
        action: { type: 'add_organisation_admin' },
      },
    ]);
  });

  test('an organisation admin who is not the owner and not the last can delete', async () => {
    given(prisma, { orgAdminRow: true, otherOrgAdmins: 3 });
    expect(await codes()).toEqual([]);
  });

  test('SCHOOL_OWNER: one blocker per owned school, naming it', async () => {
    given(prisma, {
      ownedSchools: [
        { id: 's1', name: 'Hill Primary' },
        { id: 's2', name: null },
      ],
    });
    const check = await accountDeletionCheck(prisma as any, ME);
    expect(check.blockers).toEqual([
      {
        code: 'SCHOOL_OWNER',
        message: 'Transfer ownership of Hill Primary before deleting your account',
        action: { type: 'transfer_school_ownership', schoolId: 's1', schoolName: 'Hill Primary' },
      },
      {
        code: 'SCHOOL_OWNER',
        message: 'Transfer ownership of your school before deleting your account',
        action: { type: 'transfer_school_ownership', schoolId: 's2', schoolName: 'your school' },
      },
    ]);
    expect(prisma.school.findMany.mock.calls[0][0].where).toEqual({ owner_id: ME });
  });

  test('SCHOOL_ADMIN: the admin of an ownerless school with other members', async () => {
    given(prisma, {
      adminSeats: [{ school_id: 's1', name: 'Hill', owner_id: null }],
      schoolStaff: 2,
    });
    const check = await accountDeletionCheck(prisma as any, ME);
    expect(check.blockers).toEqual([
      {
        code: 'SCHOOL_ADMIN',
        message:
          "You're the only administrator of Hill. Hand the school over to another staff member before deleting your account",
        action: { type: 'transfer_school_ownership', schoolId: 's1', schoolName: 'Hill' },
      },
    ]);
    expect(prisma.school_management.count.mock.calls[0][0].where).toEqual({
      school_id: 's1',
      user_id: { not: ME },
    });
  });

  test('an admin seat does not block when the school is empty or has an owner', async () => {
    given(prisma, { adminSeats: [{ school_id: 's1', name: 'Hill', owner_id: null }] });
    expect(await codes()).toEqual([]);

    given(prisma, {
      adminSeats: [{ school_id: 's1', name: 'Hill', owner_id: 'someone-else' }],
      schoolStaff: 5,
      schoolStudents: 100,
    });
    expect(await codes()).toEqual([]);
  });

  test('SSO_STUDENT: a student account that signs in through school SSO', async () => {
    given(prisma, { accountType: 'student', providers: ['google'] });
    const check = await accountDeletionCheck(prisma as any, ME);
    expect(check.blockers).toEqual([
      {
        code: 'SSO_STUDENT',
        message:
          'Your account is managed by your school through Google. Ask your school to remove it.',
        action: { type: 'contact_school' },
      },
    ]);
  });

  test('SSO_STUDENT: a linked student record counts as a student, and names the provider', async () => {
    given(prisma, { accountType: 'staff', studentRow: true, providers: ['azure'] });
    const [blocker] = (await accountDeletionCheck(prisma as any, ME)).blockers;
    expect(blocker.code).toBe('SSO_STUDENT');
    expect(blocker.message).toContain('through Microsoft');

    given(prisma, { accountType: 'student', providers: ['saml'] });
    const [saml] = (await accountDeletionCheck(prisma as any, ME)).blockers;
    expect(saml.message).toContain("through your school's single sign-on");
  });

  test('SSO staff and SSO parents can delete (only students are school-managed)', async () => {
    given(prisma, { accountType: 'staff', providers: ['google', 'saml'] });
    expect(await codes()).toEqual([]);
    given(prisma, { accountType: 'parent', providers: ['azure'] });
    expect(await codes()).toEqual([]);
  });

  test('an email-code student (no SSO identity) can delete', async () => {
    given(prisma, { accountType: 'student', studentRow: true, providers: [] });
    expect(await codes()).toEqual([]);
  });

  test('parents without SSO can delete', async () => {
    given(prisma, { accountType: 'parent' });
    expect(await codes()).toEqual([]);
  });

  test('several blockers are all reported', async () => {
    given(prisma, {
      ownsOrg: true,
      orgAdminRow: true,
      otherOrgAdmins: 0,
      ownedSchools: [{ id: 's1', name: 'Hill' }],
    });
    expect(await codes()).toEqual(['ORG_OWNER', 'LAST_ORG_ADMIN', 'SCHOOL_OWNER']);
  });

  test('provider helpers', () => {
    expect(isSsoProvider('google')).toBe(true);
    expect(isSsoProvider('email')).toBe(false);
    expect(providerLabel('azure')).toBe('Microsoft');
    expect(providerLabel('some-oidc')).toBe("your school's sign-in provider");
  });
});

describe('AuthService.deleteAccount with blockers', () => {
  let prisma: MockPrisma;
  let sessions: { revokeAll: ReturnType<typeof mock> };
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    const cache = createMockCacheService();
    sessions = { revokeAll: mock(async () => 0) };
    service = new AuthService(
      prisma as any,
      cache as any,
      { ssoRequirement: async () => null } as any,
      {} as any,
      {} as any,
      sessions as any,
      createMockErasureLog() as any,
      new FeatureService(prisma as any, cache as any),
    );
  });

  const cases: [string, Parameters<typeof given>[1], string][] = [
    ['organisation owner', { ownsOrg: true, orgAdminRow: true, otherOrgAdmins: 1 }, 'ORG_OWNER'],
    ['last organisation admin', { orgAdminRow: true, otherOrgAdmins: 0 }, 'LAST_ORG_ADMIN'],
    ['school owner', { ownedSchools: [{ id: 's1', name: 'Hill' }] }, 'SCHOOL_OWNER'],
    [
      'only admin of an ownerless school',
      { adminSeats: [{ school_id: 's1', name: 'Hill', owner_id: null }], schoolStudents: 3 },
      'SCHOOL_ADMIN',
    ],
    ['SSO student', { accountType: 'student', providers: ['google'] }, 'SSO_STUDENT'],
  ];

  for (const [label, setup, code] of cases) {
    test(`${label}: 409 ${code}, nothing touched`, async () => {
      given(prisma, setup);
      const err = await expectRejection(service.deleteAccount(ME));
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as any;
      expect(body.statusCode).toBe(409);
      expect(body.code).toBe(ACCOUNT_DELETION_BLOCKED);
      expect(body.blockers.map((b: any) => b.code)).toEqual([code]);
      expect(body.message).toBe(body.blockers[0].message);
      // Never reaches the transaction, so the Restrict owner keys can't fire.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
      expect(prisma.user_profile.deleteMany).not.toHaveBeenCalled();
      expect(prisma.app_user.deleteMany).not.toHaveBeenCalled();
    });
  }

  test('the message says how many more blockers there are', async () => {
    given(prisma, { ownsOrg: true, orgAdminRow: true, otherOrgAdmins: 0 });
    const err = await expectRejection(service.deleteAccount(ME));
    expect((err as ConflictException).message).toBe(
      `${ORG_OWNER_MESSAGE} (and 1 more thing to sort out first)`,
    );
  });

  const allowed: [string, Parameters<typeof given>[1]][] = [
    ['SSO staff', { accountType: 'staff', providers: ['azure'] }],
    ['email-code student', { accountType: 'student', studentRow: true }],
    ['parent', { accountType: 'parent' }],
    ['SSO parent', { accountType: 'parent', providers: ['google'] }],
  ];
  for (const [label, setup] of allowed) {
    test(`${label}: deleted`, async () => {
      given(prisma, setup);
      expect(await service.deleteAccount(ME)).toBe('Account deleted successfully');
      expect(prisma.app_user.deleteMany.mock.calls[0][0]).toEqual({ where: { id: ME } });
    });
  }

  test('deletionCheck returns the same answer', async () => {
    given(prisma, { accountType: 'student', providers: ['google'] });
    const check = await service.deletionCheck(ME);
    expect(check.canDelete).toBe(false);
    expect(check.blockers[0].code).toBe('SSO_STUDENT');
  });
});

describe('GET /auth/account/deletion-check', () => {
  test('is a guarded GET', () => {
    const handler = AuthController.prototype.deletionCheck;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('account/deletion-check');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(0); // GET
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(AuthGuard);
  });
});