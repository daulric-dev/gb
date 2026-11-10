import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OwnershipService } from './ownership.service';
import { SchoolOwnershipController } from './ownership.controller';
import { OrganisationController } from './organisation.controller';
import { OrganisationService } from './organisation.service';
import { ownershipEmail } from './ownership.email';
import { STEP_UP_KEY, StepUpGuard } from '@/auth/step-up.guard';
import { AuthGuard } from '@/auth/auth.guard';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const OWNER = 'u-owner';
const TARGET = 'u-target';
const OTHER = 'u-other';
const SCHOOL = 's-1';

const person = (first: string, email: string, disabled = false) => ({
  first_name: first,
  last_name: 'X',
  email,
  app_user: { email, disabled_at: disabled ? new Date() : null },
});

describe('OwnershipService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let mail: { configured: ReturnType<typeof mock>; send: ReturnType<typeof mock> };
  let audit: { record: ReturnType<typeof mock> };
  let service: OwnershipService;
  const prevEnv = process.env.ORG_ADMIN_EMAILS;

  beforeEach(() => {
    delete process.env.ORG_ADMIN_EMAILS;
    prisma = createMockPrisma();
    cache = createMockCacheService();
    mail = { configured: mock(() => true), send: mock(async () => {}) };
    audit = { record: mock(async () => {}) };
    service = new OwnershipService(prisma as any, cache as any, mail as any, audit as any);
    prisma.user_profile.findUnique.mockImplementation(async ({ where }: any) =>
      person(where.id, `${where.id}@x.org`),
    );
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ORG_ADMIN_EMAILS;
    else process.env.ORG_ADMIN_EMAILS = prevEnv;
  });

  // --- the organisation ----------------------------------------------------

  describe('transferOrganisation', () => {
    beforeEach(() => {
      prisma.organisation.findFirst.mockResolvedValue({
        id: 'org-1',
        name: 'Trust',
        owner_id: OWNER,
      });
      prisma.organisation_admin.findUnique.mockImplementation(async ({ where }: any) =>
        where.user_id === TARGET
          ? { user_id: TARGET, user_profile: person('Tara', 'tara@x.org') }
          : null,
      );
      prisma.organisation.updateMany.mockResolvedValue({ count: 1 });
    });

    test('the owner hands it to another organisation admin; audited and emailed', async () => {
      const result = await service.transferOrganisation(OWNER, TARGET);
      expect(result).toEqual({
        ownerId: TARGET,
        owner: { userId: TARGET, name: 'Tara X', email: 'tara@x.org' },
      });
      expect(prisma.organisation.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'org-1', owner_id: OWNER },
        data: { owner_id: TARGET },
      });
      const [, schoolId, actor, entry] = audit.record.mock.calls[0];
      expect(schoolId).toBeNull(); // the organisation's audit log
      expect(actor).toEqual({ id: OWNER });
      expect(entry).toEqual({
        entity: 'organisation',
        entityId: 'org-1',
        action: 'update',
        changes: { owner_id: { before: OWNER, after: TARGET } },
      });
      // Both parties hear about it.
      const to = mail.send.mock.calls.map((c: any) => c[0].to).sort();
      expect(to).toEqual(['tara@x.org', `${OWNER}@x.org`].sort());
      // No organisation_admin row is removed: the old owner stays an admin.
      expect(prisma.organisation_admin.deleteMany).not.toHaveBeenCalled();
    });

    test('only the owner may transfer', async () => {
      const err = await expectRejection(service.transferOrganisation(OTHER, TARGET));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.organisation.updateMany).not.toHaveBeenCalled();
    });

    test('the target must be a stored organisation admin', async () => {
      const err = await expectRejection(service.transferOrganisation(OWNER, OTHER));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.organisation.updateMany).not.toHaveBeenCalled();
    });

    test('a disabled target is refused', async () => {
      prisma.organisation_admin.findUnique.mockResolvedValue({
        user_id: TARGET,
        user_profile: person('Tara', 'tara@x.org', true),
      });
      expect(await expectRejection(service.transferOrganisation(OWNER, TARGET))).toBeInstanceOf(
        BadRequestException,
      );
    });

    test('transferring to the current owner is refused', async () => {
      expect(await expectRejection(service.transferOrganisation(OWNER, OWNER))).toBeInstanceOf(
        BadRequestException,
      );
    });

    test('a concurrent change is a 409', async () => {
      prisma.organisation.updateMany.mockResolvedValue({ count: 0 });
      expect(await expectRejection(service.transferOrganisation(OWNER, TARGET))).toBeInstanceOf(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    test('with no owner yet, any organisation admin may assign it', async () => {
      prisma.organisation.findFirst.mockResolvedValue({ id: 'org-1', name: 'Trust', owner_id: null });
      prisma.organisation_admin.findUnique.mockImplementation(async ({ where }: any) =>
        where.user_id === TARGET || where.user_id === OTHER
          ? { user_id: where.user_id, user_profile: person('P', `${where.user_id}@x.org`) }
          : null,
      );
      await service.transferOrganisation(OTHER, TARGET);
      expect(prisma.organisation.updateMany.mock.calls[0][0].where).toEqual({
        id: 'org-1',
        owner_id: null,
      });
    });

    test('404 before setup', async () => {
      prisma.organisation.findFirst.mockResolvedValue(null);
      expect(await expectRejection(service.transferOrganisation(OWNER, TARGET))).toBeInstanceOf(
        NotFoundException,
      );
    });

    test('a mail failure does not fail the transfer', async () => {
      mail.send.mockRejectedValue(new Error('smtp down'));
      expect((await service.transferOrganisation(OWNER, TARGET)).ownerId).toBe(TARGET);
    });
  });

  // --- a school ------------------------------------------------------------

  describe('transferSchool', () => {
    beforeEach(() => {
      prisma.school.findUnique.mockResolvedValue({ id: SCHOOL, name: 'Hill', owner_id: OWNER });
      prisma.school_management.findUnique.mockImplementation(async ({ where, select }: any) => {
        const userId = where.user_id_school_id?.user_id;
        if (userId === TARGET && select?.user_profile) {
          return {
            id: 'm-target',
            role: 'teacher',
            user_profile: {
              id: TARGET,
              school_id: SCHOOL,
              account_type: 'staff',
              ...person('Tara', 'tara@x.org'),
            },
          };
        }
        if (userId === 'u-student' && select?.user_profile) {
          return {
            id: 'm-s',
            role: 'member',
            user_profile: { id: 'u-student', school_id: SCHOOL, account_type: 'student', ...person('S', 's@x.org') },
          };
        }
        return null;
      });
      prisma.school_management.findFirst.mockResolvedValue({ id: 'm-owner', user_id: OWNER });
    });

    test('the owner hands the school to a staff member: owner and admin seat move, audited', async () => {
      const result = await service.transferSchool(OWNER, SCHOOL, TARGET);
      expect(result).toMatchObject({ schoolId: SCHOOL, ownerId: TARGET, previousOwnerId: OWNER });

      // seatSchoolAdmin: previous admin -> teacher, target -> admin, owner set.
      expect(prisma.school_management.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm-owner' },
        data: { role: 'teacher' },
      });
      expect(prisma.school.update.mock.calls[0][0]).toMatchObject({
        where: { id: SCHOOL },
        data: { owner_id: TARGET },
      });

      const entries = audit.record.mock.calls.map((c: any) => [c[1], c[3]]);
      expect(entries).toEqual([
        [
          SCHOOL,
          {
            entity: 'school',
            entityId: SCHOOL,
            action: 'update',
            changes: { owner_id: { before: OWNER, after: TARGET } },
          },
        ],
        [
          SCHOOL,
          {
            entity: 'school_membership',
            entityId: 'm-target',
            action: 'update',
            changes: { role: { before: 'teacher', after: 'admin' } },
          },
        ],
        [
          SCHOOL,
          {
            entity: 'school_membership',
            entityId: 'm-owner',
            action: 'update',
            changes: { role: { before: 'admin', after: 'teacher' } },
          },
        ],
      ]);
      expect(mail.send).toHaveBeenCalledTimes(2);
    });

    test('an organisation admin who is not a member may transfer', async () => {
      prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: OTHER });
      const result = await service.transferSchool(OTHER, SCHOOL, TARGET);
      expect(result.ownerId).toBe(TARGET);
      expect(audit.record.mock.calls[0][2]).toEqual({ id: OTHER });
    });

    test('anyone else is refused', async () => {
      const err = await expectRejection(service.transferSchool(OTHER, SCHOOL, TARGET));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.school.update).not.toHaveBeenCalled();
    });

    test("the admin seat holder may transfer only while the school has no owner", async () => {
      prisma.school.findUnique.mockResolvedValue({ id: SCHOOL, name: 'Hill', owner_id: null });
      prisma.school_management.findFirst.mockResolvedValue({ id: 'm-a', user_id: OTHER });
      expect((await service.transferSchool(OTHER, SCHOOL, TARGET)).ownerId).toBe(TARGET);
    });

    test('the target must be a staff member of the school', async () => {
      expect(await expectRejection(service.transferSchool(OWNER, SCHOOL, 'u-nobody'))).toBeInstanceOf(
        BadRequestException,
      );
      expect(await expectRejection(service.transferSchool(OWNER, SCHOOL, 'u-student'))).toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.school.update).not.toHaveBeenCalled();
    });

    test('transferring to the current owner is refused', async () => {
      expect(await expectRejection(service.transferSchool(OWNER, SCHOOL, OWNER))).toBeInstanceOf(
        BadRequestException,
      );
    });

    test('404 for an unknown school', async () => {
      prisma.school.findUnique.mockResolvedValue(null);
      expect(await expectRejection(service.transferSchool(OWNER, SCHOOL, TARGET))).toBeInstanceOf(
        NotFoundException,
      );
    });

    test('candidates: staff of the school, not the owner, not disabled', async () => {
      prisma.school_management.findMany.mockResolvedValue([
        { user_id: TARGET, role: 'teacher', user_profile: person('Tara', 'tara@x.org') },
        { user_id: 'u-off', role: 'teacher', user_profile: person('Off', 'off@x.org', true) },
      ]);
      const result = await service.schoolCandidates(OWNER, SCHOOL);
      expect(result.owner).toEqual({ userId: OWNER, name: `${OWNER} X`, email: `${OWNER}@x.org` });
      expect(result.candidates).toEqual([
        { userId: TARGET, name: 'Tara X', email: 'tara@x.org', role: 'teacher' },
      ]);
      expect(prisma.school_management.findMany.mock.calls[0][0].where).toEqual({
        school_id: SCHOOL,
        user_profile: { account_type: 'staff' },
        user_id: { not: OWNER },
      });
    });
  });
});

describe('ownership routes', () => {
  const meta = (proto: any, name: string) => {
    const h = proto[name];
    return {
      method: Reflect.getMetadata(METHOD_METADATA, h),
      path: Reflect.getMetadata(PATH_METADATA, h),
      stepUp: !!Reflect.getMetadata(STEP_UP_KEY, h),
      guards: (Reflect.getMetadata(GUARDS_METADATA, h) ?? []) as unknown[],
    };
  };

  test('POST /organisation/transfer-ownership requires step-up', () => {
    const m = meta(OrganisationController.prototype, 'transferOwnership');
    expect(m.method).toBe(RequestMethod.POST);
    expect(m.path).toBe('transfer-ownership');
    expect(m.stepUp).toBe(true);
    expect(m.guards).toContain(StepUpGuard);
  });

  test('POST /schools/:schoolId/transfer-ownership requires step-up; candidates do not', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SchoolOwnershipController)).toBe('schools');
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolOwnershipController)).toContain(AuthGuard);
    const t = meta(SchoolOwnershipController.prototype, 'transfer');
    expect(t.method).toBe(RequestMethod.POST);
    expect(t.path).toBe(':schoolId/transfer-ownership');
    expect(t.stepUp).toBe(true);
    expect(t.guards).toContain(StepUpGuard);
    const c = meta(SchoolOwnershipController.prototype, 'candidates');
    expect(c.method).toBe(RequestMethod.GET);
    expect(c.stepUp).toBe(false);
  });
});

describe('OrganisationService and the owner', () => {
  let prisma: MockPrisma;
  let service: OrganisationService;

  beforeEach(() => {
    delete process.env.ORG_ADMIN_EMAILS;
    prisma = createMockPrisma();
    service = new OrganisationService(
      prisma as any,
      createMockCacheService() as any,
      { revokeAll: mock(async () => 0) } as any,
      {} as any,
    );
    prisma.organisation.findFirst.mockResolvedValue({ owner_id: OWNER });
    prisma.organisation_admin.findMany.mockResolvedValue(
      [OWNER, OTHER].map((id) => ({
        user_id: id,
        created_at: new Date(),
        user_profile: person(id, `${id}@x.org`),
      })),
    );
  });

  test('admins flag the owner', async () => {
    const rows = await service.admins();
    expect(rows.map((r) => [r.userId, r.isOwner])).toEqual([
      [OWNER, true],
      [OTHER, false],
    ]);
  });

  test('the owner cannot be removed as an admin', async () => {
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: OWNER });
    const err = await expectRejection(service.removeAdmin(OTHER, OWNER));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'The organisation owner cannot be removed. Transfer ownership first.',
    );
    expect(prisma.organisation_admin.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ownershipEmail', () => {
  test('tells the new owner and the previous one', () => {
    const base = {
      kind: 'school' as const,
      place: 'Hill <Primary>',
      other: 'Tara',
      by: 'Olly',
      settingsUrl: 'https://gb.example/dashboard/settings',
    };
    const toNew = ownershipEmail({ ...base, recipient: 'new_owner' });
    expect(toNew.subject).toBe('You now own Hill <Primary> on GradeBook');
    expect(toNew.html).toContain('Hill &lt;Primary&gt;');
    const toOld = ownershipEmail({ ...base, recipient: 'previous_owner' });
    expect(toOld.text).toContain('transferred to Tara by Olly');
  });
});
