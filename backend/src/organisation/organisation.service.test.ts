import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrganisationService, SETUP_REFUSED } from './organisation.service';
import { InviteService } from './invite.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { permCacheKey } from '@/permission/permission.effective';
import { Prisma } from '@/generated/prisma/client';

const ME = 'user-me';
const NOW = new Date('2026-11-01T10:00:00Z');

function account(email: string, verified = true) {
  return { email, email_verified_at: verified ? NOW : null, disabled_at: null };
}

describe('OrganisationService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let sessions: { revokeAll: ReturnType<typeof mock> };
  let service: OrganisationService;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.ORG_ADMIN_EMAILS;
    delete process.env.ORG_ADMIN_EMAILS;
    prisma = createMockPrisma();
    cache = createMockCacheService();
    sessions = { revokeAll: mock(async () => 3) };
    const mail = { configured: () => false, send: mock(async () => {}) };
    const accounts = { onVerifiedSignIn: mock(() => {}) };
    const invites = new InviteService(
      prisma as any,
      cache as any,
      mail as any,
      accounts as any,
    );
    service = new OrganisationService(
      prisma as any,
      cache as any,
      sessions as any,
      invites,
    );
    prisma.organisation_invite.create.mockImplementation(
      async ({ data }: any) => ({
        id: 'inv-1',
        email: data.email,
        expires_at: data.expires_at,
      }),
    );
    prisma.organisation.create.mockImplementation(async ({ data }: any) => ({
      id: 'org-1',
      created_at: NOW,
      ...data,
    }));
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ORG_ADMIN_EMAILS;
    else process.env.ORG_ADMIN_EMAILS = prevEnv;
  });

  // --- setup ---------------------------------------------------------------

  describe('status', () => {
    test('needs setup without an organisation', async () => {
      prisma.organisation.findFirst.mockResolvedValue(null);
      expect(await service.status()).toEqual({
        needsSetup: true,
        organisation: null,
      });
    });

    test('done once the organisation exists', async () => {
      prisma.organisation.findFirst.mockResolvedValue({
        name: 'Northside Trust',
      });
      expect(await service.status()).toEqual({
        needsSetup: false,
        organisation: { name: 'Northside Trust' },
      });
    });
  });

  describe('setup warning at boot', () => {
    let prevNodeEnv: string | undefined;
    let warn: ReturnType<typeof mock>;

    beforeEach(() => {
      prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      warn = mock(() => {});
      (service as any).logger.warn = warn;
      prisma.organisation.count.mockResolvedValue(0);
      prisma.school.count.mockResolvedValue(0);
    });

    afterEach(() => {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    });

    test('warns in production when the first sign-in would claim the install', async () => {
      await service.onApplicationBootstrap();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('ORG_ADMIN_EMAILS');
      expect(warn.mock.calls[0][0]).toContain('first account to sign in');
    });

    test('is quiet with ORG_ADMIN_EMAILS set', async () => {
      process.env.ORG_ADMIN_EMAILS = 'boss@school.test';
      await service.onApplicationBootstrap();
      expect(warn).not.toHaveBeenCalled();
    });

    test('is quiet once set up, or with schools already', async () => {
      prisma.organisation.count.mockResolvedValue(1);
      await service.onApplicationBootstrap();
      prisma.organisation.count.mockResolvedValue(0);
      prisma.school.count.mockResolvedValue(2);
      await service.onApplicationBootstrap();
      expect(warn).not.toHaveBeenCalled();
    });

    test('is quiet outside production', async () => {
      process.env.NODE_ENV = 'development';
      await service.onApplicationBootstrap();
      expect(warn).not.toHaveBeenCalled();
    });

    test('a database error at boot is not fatal', async () => {
      prisma.organisation.count.mockRejectedValue(new Error('db down'));
      await service.onApplicationBootstrap();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('eligibility', () => {
    test('on an empty install, any signed-in user is sent to setup', async () => {
      prisma.organisation.count.mockResolvedValue(0);
      prisma.school.count.mockResolvedValue(0);
      expect(await service.eligibility(ME)).toEqual({
        needsSetup: true,
        canSetUp: true,
      });
    });

    test('a stranger on an install with schools cannot set up', async () => {
      prisma.organisation.count.mockResolvedValue(0);
      prisma.school.count.mockImplementation(async (args: any) =>
        args?.where ? 0 : 2,
      );
      prisma.school_management.count.mockResolvedValue(0);
      expect(await service.eligibility(ME)).toEqual({
        needsSetup: true,
        canSetUp: false,
      });
    });

    test('nothing to do once the organisation exists', async () => {
      prisma.organisation.count.mockResolvedValue(1);
      expect(await service.eligibility(ME)).toEqual({
        needsSetup: false,
        canSetUp: false,
      });
    });
  });

  describe('setup', () => {
    test('on an empty install the first signed-in user sets up and becomes admin', async () => {
      prisma.school.count.mockResolvedValue(0);
      await cache.set('profile:someone', { id: 'someone' }, 60);

      const result = await service.setup(ME, '  Riverside Trust ');

      expect(result).toEqual({
        id: 'org-1',
        name: 'Riverside Trust',
        createdAt: NOW.toISOString(),
        ownerId: ME,
      });
      // No session lock: the singleton index settles a race (see below).
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      // Whoever runs setup owns the organisation.
      expect(prisma.organisation.create.mock.calls[0][0].data).toEqual({
        name: 'Riverside Trust',
        owner_id: ME,
      });
      // The profile the owner key references exists first.
      expect(
        prisma.user_profile.upsert.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.organisation.create.mock.invocationCallOrder[0]);
      expect(prisma.organisation_admin.upsert.mock.calls[0][0].create).toEqual({
        user_id: ME,
        created_by: ME,
      });
      // Every cached profile carries the organisation.
      expect(await cache.get('profile:someone')).toBeNull();
    });

    test('409 when already set up', async () => {
      prisma.organisation.count.mockResolvedValue(1);
      const err = await expectRejection(service.setup(ME, 'Again'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(prisma.organisation.create).not.toHaveBeenCalled();
    });

    test('a stranger on an install that already has schools is refused', async () => {
      prisma.school.count.mockImplementation(async (args: any) =>
        args?.where ? 0 : 4,
      );
      prisma.school_management.count.mockResolvedValue(0);

      const err: any = await expectRejection(service.setup(ME, 'Takeover'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe(SETUP_REFUSED);
      expect(prisma.organisation.create).not.toHaveBeenCalled();
    });

    test('the owner of an existing school may set up', async () => {
      prisma.school.count.mockImplementation(async (args: any) =>
        args?.where?.owner_id === ME ? 1 : 4,
      );
      await service.setup(ME, 'Riverside');
      expect(prisma.organisation.create).toHaveBeenCalled();
    });

    test('an admin of an existing school may set up', async () => {
      prisma.school.count.mockImplementation(async (args: any) =>
        args?.where ? 0 : 4,
      );
      prisma.school_management.count.mockResolvedValue(1);
      await service.setup(ME, 'Riverside');
      expect(prisma.school_management.count.mock.calls[0][0].where).toEqual({
        user_id: ME,
        role: 'admin',
      });
      expect(prisma.organisation.create).toHaveBeenCalled();
    });

    test('with ORG_ADMIN_EMAILS set, only listed verified emails may set up', async () => {
      process.env.ORG_ADMIN_EMAILS = 'it@example.org';
      prisma.school.count.mockResolvedValue(0);
      prisma.app_user.findUnique.mockResolvedValue(
        account('someone@example.org'),
      );

      const err = await expectRejection(service.setup(ME, 'Riverside'));
      expect(err).toBeInstanceOf(ForbiddenException);

      prisma.app_user.findUnique.mockResolvedValue(
        account('it@example.org', false),
      );
      expect(
        await expectRejection(service.setup(ME, 'Riverside')),
      ).toBeInstanceOf(ForbiddenException);
      expect(prisma.organisation.create).not.toHaveBeenCalled();
    });

    test('a listed email may set up an install that already has schools', async () => {
      process.env.ORG_ADMIN_EMAILS = 'IT@example.org';
      prisma.school.count.mockResolvedValue(4);
      prisma.app_user.findUnique.mockResolvedValue(account('it@example.org'));

      await service.setup(ME, 'Riverside');
      expect(prisma.organisation.create).toHaveBeenCalled();
      expect(prisma.school_management.count).not.toHaveBeenCalled();
    });

    test('race: a setup that committed first makes the second a 409 (re-check in the transaction)', async () => {
      prisma.organisation.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      const err = await expectRejection(service.setup(ME, 'Riverside'));
      expect(err).toBeInstanceOf(ConflictException);
      expect(prisma.organisation.create).not.toHaveBeenCalled();
    });

    test('race: the singleton index refusing the insert is a 409', async () => {
      prisma.organisation.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const err = await expectRejection(service.setup(ME, 'Riverside'));
      expect(err).toBeInstanceOf(ConflictException);
    });
  });

  // --- the organisation ----------------------------------------------------

  describe('organisation', () => {
    test('get is 404 before setup', async () => {
      expect(await expectRejection(service.get())).toBeInstanceOf(
        NotFoundException,
      );
    });

    test('rename updates the name and clears every cached profile', async () => {
      prisma.organisation.findFirst.mockResolvedValue({ id: 'org-1' });
      prisma.organisation.findUniqueOrThrow.mockResolvedValue({
        id: 'org-1',
        name: 'Old Name',
        created_at: NOW,
      });
      prisma.organisation.update.mockImplementation(async ({ data }: any) => ({
        id: 'org-1',
        created_at: NOW,
        ...data,
      }));
      await cache.set('profile:a', {}, 60);
      await cache.set('profile:b', {}, 60);
      await cache.set('schools:all', [], 60);

      const result = await service.rename(' New Name ');
      expect(result.name).toBe('New Name');
      expect(await cache.get('profile:a')).toBeNull();
      expect(await cache.get('profile:b')).toBeNull();
      expect(await cache.get('schools:all')).toEqual([]);
    });

    test('overview counts schools, active schools, staff and students', async () => {
      prisma.school.count.mockImplementation(async (args: any) =>
        args?.where?.is_active ? 2 : 3,
      );
      prisma.user_profile.count.mockResolvedValue(12);
      prisma.student.count.mockResolvedValue(140);

      expect(await service.overview()).toEqual({
        schools: 3,
        activeSchools: 2,
        staff: 12,
        students: 140,
      });
      expect(prisma.user_profile.count.mock.calls[0][0].where).toEqual({
        account_type: 'staff',
        school_management: { some: {} },
      });
    });
  });

  // --- admins --------------------------------------------------------------

  describe('admins', () => {
    const row = (id: string, email: string) => ({
      user_id: id,
      created_at: NOW,
      user_profile: {
        first_name: 'A',
        last_name: id,
        email,
        app_user: { email },
      },
    });

    test('lists rows and env-listed accounts, flagging fromEnv', async () => {
      process.env.ORG_ADMIN_EMAILS = 'env@x.org,both@x.org,nobody@x.org';
      prisma.organisation_admin.findMany.mockResolvedValue([
        row('u-db', 'db@x.org'),
        row('u-both', 'both@x.org'),
      ]);
      prisma.app_user.findMany.mockResolvedValue([
        {
          id: 'u-both',
          email: 'both@x.org',
          created_at: NOW,
          user_profile: null,
        },
        {
          id: 'u-env',
          email: 'env@x.org',
          created_at: NOW,
          user_profile: {
            first_name: 'Env',
            last_name: 'Admin',
            email: 'env@x.org',
          },
        },
      ]);

      const list = await service.admins();
      expect(list).toEqual([
        {
          userId: 'u-db',
          email: 'db@x.org',
          name: 'A u-db',
          createdAt: NOW.toISOString(),
          fromEnv: false,
          isOwner: false,
          stored: true,
        },
        {
          userId: 'u-both',
          email: 'both@x.org',
          name: 'A u-both',
          createdAt: NOW.toISOString(),
          fromEnv: true,
          isOwner: false,
          stored: true,
        },
        {
          userId: 'u-env',
          email: 'env@x.org',
          name: 'Env Admin',
          createdAt: NOW.toISOString(),
          fromEnv: true,
          isOwner: false,
          stored: false,
        },
      ]);
      // Only verified, live accounts count.
      expect(prisma.app_user.findMany.mock.calls[0][0].where).toMatchObject({
        email_verified_at: { not: null },
        disabled_at: null,
      });
    });

    test('add: invites an email nobody signs in with yet', async () => {
      const added = await service.addAdmin(ME, ' Ghost@X.org ');
      expect(added).toEqual({
        invited: {
          id: 'inv-1',
          email: 'ghost@x.org',
          expiresAt: expect.any(String),
        },
      });
      expect(prisma.organisation_admin.upsert).not.toHaveBeenCalled();
      expect(
        prisma.organisation_invite.create.mock.calls[0][0].data,
      ).toMatchObject({
        email: 'ghost@x.org',
        kind: 'organisation_admin',
        school_id: null,
        invited_by: ME,
      });
      // It replaces the same email's open organisation admin invite.
      expect(
        prisma.organisation_invite.updateMany.mock.calls[0][0].where,
      ).toEqual({
        kind: 'organisation_admin',
        email: 'ghost@x.org',
        accepted_at: null,
        revoked_at: null,
      });
    });

    test('add: makes the account an admin and drops its cached profile', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-new', school_id: null, account_type: 'staff' },
      });
      prisma.organisation_admin.findMany.mockResolvedValue([
        row('u-new', 'new@x.org'),
      ]);
      await cache.set('profile:u-new', {}, 60);

      const added = await service.addAdmin(ME, ' New@X.org ');
      expect(prisma.app_user.findUnique.mock.calls[0][0].where).toEqual({
        email: 'new@x.org',
      });
      expect(prisma.organisation_admin.upsert.mock.calls[0][0].create).toEqual({
        user_id: 'u-new',
        created_by: ME,
      });
      expect((added as { userId: string }).userId).toBe('u-new');
      expect(added.invited).toBeNull();
      expect(await cache.get('profile:u-new')).toBeNull();
      // Added directly: any open invite for the email is moot.
      expect(
        prisma.organisation_invite.updateMany.mock.calls[0][0],
      ).toMatchObject({
        where: {
          kind: 'organisation_admin',
          email: 'new@x.org',
          revoked_at: null,
        },
      });
    });

    test('remove: refuses the last admin from the database, yourself included', async () => {
      prisma.organisation_admin.findMany.mockResolvedValue([
        row(ME, 'me@x.org'),
      ]);
      prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: ME });

      const err: any = await expectRejection(service.removeAdmin(ME, ME));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/last organisation admin/);
      expect(prisma.organisation_admin.deleteMany).not.toHaveBeenCalled();
    });

    test('remove: an env-listed admin does not stand in for the last database admin', async () => {
      process.env.ORG_ADMIN_EMAILS = 'env@x.org';
      prisma.organisation_admin.findMany.mockResolvedValue([
        row('u-db', 'db@x.org'),
      ]);
      prisma.app_user.findMany.mockResolvedValue([
        {
          id: 'u-env',
          email: 'env@x.org',
          created_at: NOW,
          user_profile: null,
        },
      ]);
      prisma.organisation_admin.findUnique.mockResolvedValue({
        user_id: 'u-db',
      });

      expect(
        await expectRejection(service.removeAdmin(ME, 'u-db')),
      ).toBeInstanceOf(BadRequestException);
    });

    test('remove: another admin can go while one remains', async () => {
      prisma.organisation_admin.findMany.mockResolvedValue([
        row(ME, 'me@x.org'),
        row('u-2', 'two@x.org'),
      ]);
      prisma.organisation_admin.findUnique.mockResolvedValue({
        user_id: 'u-2',
      });
      await cache.set('profile:u-2', {}, 60);

      expect(await service.removeAdmin(ME, 'u-2')).toEqual({ removed: true });
      expect(prisma.organisation_admin.deleteMany.mock.calls[0][0]).toEqual({
        where: { user_id: 'u-2' },
      });
      expect(await cache.get('profile:u-2')).toBeNull();
    });

    test('remove: an admin who is only in ORG_ADMIN_EMAILS is a 400', async () => {
      process.env.ORG_ADMIN_EMAILS = 'env@x.org';
      prisma.organisation_admin.findMany.mockResolvedValue([
        row(ME, 'me@x.org'),
      ]);
      prisma.app_user.findMany.mockResolvedValue([
        {
          id: 'u-env',
          email: 'env@x.org',
          created_at: NOW,
          user_profile: null,
        },
      ]);
      const err: any = await expectRejection(service.removeAdmin(ME, 'u-env'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/ORG_ADMIN_EMAILS/);
    });

    test('remove: 404 for someone who is not an admin', async () => {
      expect(
        await expectRejection(service.removeAdmin(ME, 'u-x')),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  // --- schools -------------------------------------------------------------

  describe('schools', () => {
    const school = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: `School ${id}`,
      code: null,
      school_type: 'primary',
      is_active: true,
      created_at: NOW,
      ...extra,
    });

    test('lists schools with their admin, staff and student counts', async () => {
      prisma.school.findMany.mockResolvedValue([
        school('s1'),
        school('s2', { is_active: null }),
      ]);
      prisma.school_management.findMany.mockResolvedValue([
        {
          school_id: 's1',
          user_id: 'u-a',
          user_profile: {
            first_name: 'Ada',
            last_name: 'L',
            email: null,
            app_user: { email: 'ada@x.org' },
          },
        },
      ]);
      prisma.school_management.groupBy.mockResolvedValue([
        { school_id: 's1', _count: { _all: 5 } },
      ]);
      prisma.student.groupBy.mockResolvedValue([
        { school_id: 's1', _count: { _all: 40 } },
        { school_id: 's2', _count: { _all: 7 } },
      ]);

      const rows = await service.schools(undefined, 'all');
      expect(rows).toEqual([
        {
          id: 's1',
          name: 'School s1',
          code: null,
          schoolType: 'primary',
          isActive: true,
          createdAt: NOW.toISOString(),
          admin: { userId: 'u-a', email: 'ada@x.org', name: 'Ada L' },
          ownerId: null,
          staffCount: 5,
          studentCount: 40,
          pendingAdminInvite: null,
        },
        {
          id: 's2',
          name: 'School s2',
          code: null,
          schoolType: 'primary',
          isActive: true,
          createdAt: NOW.toISOString(),
          admin: null,
          ownerId: null,
          staffCount: 0,
          studentCount: 7,
          pendingAdminInvite: null,
        },
      ]);
      expect(prisma.school.findMany.mock.calls[0][0].where).toEqual({});
    });

    test('a school without an admin shows its pending admin invite', async () => {
      const expires = new Date('2026-11-15T10:00:00Z');
      prisma.school.findMany.mockResolvedValue([school('s1'), school('s2')]);
      prisma.school_management.findMany.mockResolvedValue([
        {
          school_id: 's2',
          user_id: 'u-a',
          user_profile: {
            first_name: 'Ada',
            last_name: null,
            email: 'ada@x.org',
            app_user: null,
          },
        },
      ]);
      prisma.organisation_invite.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'head@x.org',
          school_id: 's1',
          expires_at: expires,
        },
      ]);
      const rows = await service.schools(undefined, 'all');
      expect(rows[0].pendingAdminInvite).toEqual({
        id: 'inv-1',
        email: 'head@x.org',
        expiresAt: expires.toISOString(),
      });
      expect(rows[1].pendingAdminInvite).toBeNull();
      expect(
        prisma.organisation_invite.findMany.mock.calls[0][0].where,
      ).toEqual({
        kind: 'school_admin',
        school_id: { in: ['s1', 's2'] },
        accepted_at: null,
        revoked_at: null,
      });
    });

    test('filters by search and status', async () => {
      await service.schools(' river ', 'inactive');
      expect(prisma.school.findMany.mock.calls[0][0].where).toEqual({
        AND: [
          {
            OR: [
              { name: { contains: 'river', mode: 'insensitive' } },
              { code: { contains: 'river', mode: 'insensitive' } },
            ],
          },
          { is_active: false },
        ],
      });
      await service.schools(undefined, 'active');
      expect(prisma.school.findMany.mock.calls[1][0].where).toEqual({
        AND: [{ OR: [{ is_active: true }, { is_active: null }] }],
      });
    });

    test('one school: its row plus the logo URL', async () => {
      const prev = process.env.S3_PUBLIC_URL;
      process.env.S3_PUBLIC_URL = 'https://cdn.example';
      try {
        prisma.school.findUnique.mockResolvedValue({
          ...school('s1'),
          logo_path: 'school-logos/s1-abc.png',
        });
        prisma.school_management.findMany.mockResolvedValue([]);
        prisma.school_management.groupBy.mockResolvedValue([]);
        prisma.student.groupBy.mockResolvedValue([]);
        const row = await service.school('s1');
        expect(row).toMatchObject({
          id: 's1',
          name: 'School s1',
          admin: null,
          studentCount: 0,
        });
        expect(row.logoUrl).toStartWith('https://cdn.example/');
        expect(row.logoUrl).toContain('school-logos/s1-abc.png');
        expect(prisma.school.findUnique.mock.calls[0][0].select.logo_path).toBe(
          true,
        );
      } finally {
        if (prev === undefined) delete process.env.S3_PUBLIC_URL;
        else process.env.S3_PUBLIC_URL = prev;
      }
    });

    test('one school: 404 when it does not exist', async () => {
      prisma.school.findUnique.mockResolvedValue(null);
      expect(await expectRejection(service.school('nope'))).toBeInstanceOf(
        NotFoundException,
      );
      expect(
        await expectRejection(service.requireSchool('nope')),
      ).toBeInstanceOf(NotFoundException);
    });

    test('create: makes the school without making the organisation admin a member', async () => {
      prisma.school.create.mockResolvedValue({ id: 's-new' });
      prisma.school.findUnique.mockResolvedValue(school('s-new'));
      await cache.set('schools:all', [], 60);

      const row = await service.createSchool(ME, {
        name: ' New ',
        code: '',
        schoolType: 'secondary',
      });
      expect(prisma.school.create.mock.calls[0][0].data).toEqual({
        name: 'New',
        code: null,
        school_type: 'secondary',
        is_active: true,
      });
      expect(prisma.school_management.create).not.toHaveBeenCalled();
      expect(prisma.school_management.create).not.toHaveBeenCalled();
      expect(row.id).toBe('s-new');
      expect(row.admin).toBeNull();
      expect(await cache.get('schools:all')).toBeNull();
    });

    test('create with adminEmail of an existing account appoints them', async () => {
      prisma.school.create.mockResolvedValue({ id: 's-new' });
      prisma.school.findUnique.mockResolvedValue(school('s-new'));
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-head', school_id: null, account_type: 'staff' },
      });

      await service.createSchool(ME, { name: 'New', adminEmail: 'head@x.org' });
      expect(
        prisma.school_management.create.mock.calls[0][0].data,
      ).toMatchObject({
        user_id: 'u-head',
        school_id: 's-new',
        role: 'admin',
      });
    });

    test('create with an unknown adminEmail invites them', async () => {
      prisma.school.create.mockResolvedValue({ id: 's-new' });
      prisma.school.findUnique.mockResolvedValue(school('s-new'));
      const row = await service.createSchool(ME, {
        name: 'New',
        adminEmail: 'ghost@x.org',
      });
      expect(row.admin).toBeNull();
      expect(row.invited).toEqual({
        id: 'inv-1',
        email: 'ghost@x.org',
        expiresAt: expect.any(String),
      });
      expect(prisma.school_management.create).not.toHaveBeenCalled();
      expect(
        prisma.organisation_invite.create.mock.calls[0][0].data,
      ).toMatchObject({
        kind: 'school_admin',
        school_id: 's-new',
        email: 'ghost@x.org',
      });
    });

    test('create without adminEmail invites nobody', async () => {
      prisma.school.create.mockResolvedValue({ id: 's-new' });
      prisma.school.findUnique.mockResolvedValue(school('s-new'));
      const row = await service.createSchool(ME, { name: 'New' });
      expect(row.invited).toBeNull();
      expect(prisma.organisation_invite.create).not.toHaveBeenCalled();
    });

    test('update: 404 for an unknown school', async () => {
      expect(
        await expectRejection(service.updateSchool('s-x', { isActive: false })),
      ).toBeInstanceOf(NotFoundException);
    });

    test('update: writes only the fields given and drops members’ profiles', async () => {
      prisma.school.findUnique.mockResolvedValue(school('s1'));
      prisma.school.findUniqueOrThrow.mockResolvedValue(school('s1'));
      prisma.user_profile.findMany.mockResolvedValue([{ id: 'u-1' }]);
      await cache.set('profile:u-1', {}, 60);

      await service.updateSchool('s1', { isActive: false, code: 'RV' });
      const data = prisma.school.update.mock.calls[0][0].data;
      expect(data.is_active).toBe(false);
      expect(data.code).toBe('RV');
      expect('name' in data).toBe(false);
      expect(await cache.get('profile:u-1')).toBeNull();
    });
  });

  describe('appointAdmin', () => {
    beforeEach(() => {
      prisma.school.findUnique.mockResolvedValue({
        id: 's1',
        name: 'S1',
        code: null,
        school_type: null,
        is_active: true,
        created_at: NOW,
      });
    });

    test('invites an email nobody signs in with yet, replacing the school’s other invite', async () => {
      const row = await service.appointAdmin(ME, 's1', 'Ghost@x.org');
      expect(row.invited).toMatchObject({ id: 'inv-1', email: 'ghost@x.org' });
      expect(prisma.school_management.create).not.toHaveBeenCalled();
      // One admin per school: the school's other open admin invite goes.
      expect(
        prisma.organisation_invite.updateMany.mock.calls[0][0].where,
      ).toEqual({
        kind: 'school_admin',
        school_id: 's1',
        accepted_at: null,
        revoked_at: null,
      });
      expect(
        prisma.organisation_invite.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.organisation_invite.create.mock.invocationCallOrder[0],
      );
      const data = prisma.organisation_invite.create.mock.calls[0][0].data;
      expect(data.expires_at.getTime() - data.created_at.getTime()).toBe(
        14 * 24 * 3600 * 1000,
      );
    });

    test('appointing an existing account revokes the school’s open admin invite', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-new', school_id: null, account_type: 'staff' },
      });
      const row = await service.appointAdmin(ME, 's1', 'new@x.org');
      expect(row.invited).toBeNull();
      expect(prisma.organisation_invite.create).not.toHaveBeenCalled();
      expect(
        prisma.organisation_invite.updateMany.mock.calls[0][0],
      ).toMatchObject({
        where: {
          school_id: 's1',
          kind: 'school_admin',
          accepted_at: null,
          revoked_at: null,
        },
        data: { revoked_at: expect.any(Date) },
      });
    });

    test('a student account cannot run a school', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-s', school_id: null, account_type: 'student' },
      });
      expect(
        await expectRejection(service.appointAdmin(ME, 's1', 's@x.org')),
      ).toBeInstanceOf(BadRequestException);
    });

    test('demotes the previous admin to teacher, then appoints and sets the owner', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: {
          id: 'u-new',
          school_id: 's-other',
          account_type: 'staff',
        },
      });
      prisma.school_management.findFirst.mockResolvedValue({
        id: 'm-old',
        user_id: 'u-old',
      });
      for (const key of [
        'profile:u-new',
        'profile:u-old',
        permCacheKey('u-new', 's1'),
        permCacheKey('u-old', 's1'),
      ]) {
        await cache.set(key, {}, 60);
      }

      await service.appointAdmin(ME, 's1', 'new@x.org');

      expect(prisma.school_management.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm-old' },
        data: { role: 'teacher' },
      });
      // Mirror only where s1 is the old admin's active school.
      expect(prisma.user_profile.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'u-old', school_id: 's1' },
        data: { role: 'teacher' },
      });
      // The demotion runs before the new admin's row is written (one admin
      // per school); with no row of their own yet, one is created.
      expect(
        prisma.school_management.findUnique.mock.calls[0][0],
      ).toMatchObject({
        where: { user_id_school_id: { user_id: 'u-new', school_id: 's1' } },
      });
      expect(
        prisma.school_management.update.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.school_management.create.mock.invocationCallOrder[0],
      );
      expect(
        prisma.school_management.create.mock.calls[0][0].data,
      ).toMatchObject({
        user_id: 'u-new',
        school_id: 's1',
        role: 'admin',
      });
      // Never Prisma's upsert: its ON CONFLICT cannot match the partial index.
      expect(prisma.school_management.upsert).not.toHaveBeenCalled();
      expect(prisma.school.update.mock.calls[0][0].data.owner_id).toBe('u-new');
      // Their active school is elsewhere: their profile is left alone.
      expect(prisma.user_profile.update).not.toHaveBeenCalled();

      expect(await cache.get('profile:u-new')).toBeNull();
      expect(await cache.get('profile:u-old')).toBeNull();
      expect(await cache.get(permCacheKey('u-new', 's1'))).toBeNull();
      expect(await cache.get(permCacheKey('u-old', 's1'))).toBeNull();
    });

    test('a user without an active school gets this one, as admin', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-new', school_id: null, account_type: 'staff' },
      });

      await service.appointAdmin(ME, 's1', 'new@x.org');
      expect(prisma.school_management.update).not.toHaveBeenCalled();
      expect(prisma.user_profile.update.mock.calls[0][0]).toEqual({
        where: { id: 'u-new' },
        data: { school_id: 's1', role: 'admin', is_active: true },
      });
    });

    test('re-appointing the current admin demotes nobody', async () => {
      prisma.app_user.findUnique.mockResolvedValue({
        user_profile: { id: 'u-new', school_id: 's1', account_type: 'staff' },
      });
      prisma.school_management.findFirst.mockResolvedValue({
        id: 'm',
        user_id: 'u-new',
      });

      await service.appointAdmin(ME, 's1', 'new@x.org');
      expect(prisma.school_management.update).not.toHaveBeenCalled();
      expect(prisma.user_profile.update.mock.calls[0][0].data).toEqual({
        role: 'admin',
      });
    });
  });

  describe('revokeUserSessions', () => {
    test('404 for an unknown user', async () => {
      expect(
        await expectRejection(service.revokeUserSessions(ME, 'u-x')),
      ).toBeInstanceOf(NotFoundException);
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    test('signs the user out everywhere with the organisation_admin reason', async () => {
      prisma.app_user.findUnique.mockResolvedValue({ id: 'u-1' });
      expect(await service.revokeUserSessions(ME, 'u-1')).toEqual({
        revoked: 3,
      });
      expect(sessions.revokeAll).toHaveBeenCalledWith(
        'u-1',
        'organisation_admin',
      );
    });
  });
});
