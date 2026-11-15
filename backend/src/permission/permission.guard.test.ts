import { describe, test, expect } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { computeEffectivePermissions } from './permission.effective';
import { defaultsForRole } from './permission.catalog';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  PERMISSION_SCOPE_KEY,
  type PermissionScope,
} from './require-permission.decorator';

function makeContext(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({ name: 'handler' }),
    getClass: () => ({ name: 'TestController' }),
  } as unknown as ExecutionContext;
}

// Reflector stub: the required permission key, and the declared school scope
// when the test sets one. Keyed, because the guard reads both.
const reflector = (key: string | undefined, scope?: PermissionScope) =>
  ({
    getAllAndOverride: (metadataKey: string) =>
      metadataKey === PERMISSION_SCOPE_KEY ? scope : key,
  }) as any;

const noopCache = {
  get: () => Promise.resolve(null),
  set: async () => {},
  deleteByPrefix: async () => {},
} as any;

const guardWith = (
  prisma: any,
  key: string | undefined,
  cache: any = noopCache,
  scope?: PermissionScope,
) => new PermissionGuard(reflector(key, scope), cache, prisma);

/** A membership as computeEffectivePermissions selects it. */
const membership = (role: string, grantedKeys: string[] = []) => ({
  role,
  school_management_role: grantedKeys.length
    ? [
        {
          school_role: {
            school_role_permission: grantedKeys.map((key) => ({
              permission_catalog: { key },
            })),
          },
        },
      ]
    : [],
});

describe('PermissionGuard', () => {
  test('is inert when the route has no @RequirePermission metadata', async () => {
    const guard = guardWith(createMockPrisma(), undefined);
    expect(await guard.canActivate(makeContext({}))).toBe(true);
  });

  test('fails closed when request.user is missing', async () => {
    const guard = guardWith(createMockPrisma(), 'student:read');
    expect(
      await expectRejection(guard.canActivate(makeContext({}))),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('admin is granted any catalog permission in their school', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('admin'));
    const guard = guardWith(prisma, 'term:delete');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('teacher default allows a mapped key', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('teacher'));
    const guard = guardWith(prisma, 'course:create');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('teacher default denies an unmapped key', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('teacher'));
    const guard = guardWith(prisma, 'course:update');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await expectRejection(guard.canActivate(ctx))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('a custom role grants an otherwise-denied key', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(
      membership('member', ['course:update']),
    );
    const guard = guardWith(prisma, 'course:update');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('audit log access requires an explicit grant for a non-admin member', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('member'));
    const guard = guardWith(prisma, 'audit-log:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });

    expect(await expectRejection(guard.canActivate(ctx))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('a custom role can grant audit log access', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(
      membership('member', ['audit-log:read']),
    );
    const guard = guardWith(prisma, 'audit-log:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('a student is denied every staff route', async () => {
    // A claimed student has a school_id, so the guard resolves a school - but
    // students have no school_management row, which is what fails them closed.
    const prisma = createMockPrisma();
    const guard = guardWith(prisma, 'student:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });

    const err = await expectRejection(guard.canActivate(ctx));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toContain('not a member');
  });

  test('a non-member of the resolved school is denied', async () => {
    const prisma = createMockPrisma();
    const guard = guardWith(prisma, 'student:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await expectRejection(guard.canActivate(ctx))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('resolves school context from a courseId when no :schoolId is present', async () => {
    const prisma = createMockPrisma();
    prisma.course.findUnique.mockResolvedValue({ school_id: 's1' });
    prisma.school_management.findFirst.mockResolvedValue(membership('admin'));
    const guard = guardWith(prisma, 'course:update');
    const ctx = makeContext({ user: { id: 'u1' }, params: { courseId: 'c1' } });
    expect(await guard.canActivate(ctx)).toBe(true);

    expect(prisma.course.findUnique.mock.calls[0][0].where).toEqual({
      id: 'c1',
    });
    expect(prisma.school_management.findFirst.mock.calls[0][0].where).toEqual({
      user_id: 'u1',
      school_id: 's1',
    });
  });

  test('uses the cached effective set without hitting the DB', async () => {
    const cache = {
      get: () => Promise.resolve({ member: true, keys: ['student:read'] }),
      set: async () => {},
      deleteByPrefix: async () => {},
    } as any;
    // A database that throws if queried, proving the cache short-circuits.
    const exploding = new Proxy(
      {},
      {
        get: () => {
          throw new Error('should not query the DB on a cache hit');
        },
      },
    );
    const guard = guardWith(exploding, 'student:read', cache);
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('an organisation admin passes in a school they are not a member of', async () => {
    const prisma = createMockPrisma();
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    const guard = guardWith(prisma, 'school:update');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});

describe('PermissionGuard: declared school scope', () => {
  /** A prisma whose membership lookup records which school was asked about. */
  function tracked() {
    const prisma = createMockPrisma();
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    return prisma;
  }

  const schoolAskedAbout = (prisma: any) =>
    prisma.school_management.findFirst.mock.calls[0]?.[0]?.where?.school_id;

  test("'param' reads :schoolId and nothing else", async () => {
    const prisma = tracked();
    prisma.organisation_admin.findUnique.mockResolvedValue(null);
    const guard = guardWith(prisma, 'student:read', noopCache, 'param');
    const ctx = makeContext({
      user: { id: 'u1' },
      params: { schoolId: 's-param', courseId: 'c1' },
    });

    await expectRejection(guard.canActivate(ctx));
    expect(schoolAskedAbout(prisma)).toBe('s-param');
    // Never consults the course or the profile.
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(prisma.user_profile.findUnique).not.toHaveBeenCalled();
  });

  test("'course' reads the course's school, ignoring :schoolId", async () => {
    const prisma = tracked();
    prisma.organisation_admin.findUnique.mockResolvedValue(null);
    prisma.course.findUnique.mockResolvedValue({ school_id: 's-course' });
    const guard = guardWith(prisma, 'student:read', noopCache, 'course');
    const ctx = makeContext({
      user: { id: 'u1' },
      params: { schoolId: 's-param', courseId: 'c1' },
    });

    await expectRejection(guard.canActivate(ctx));
    expect(schoolAskedAbout(prisma)).toBe('s-course');
  });

  test("'active' reads the profile, ignoring both params", async () => {
    const prisma = tracked();
    prisma.organisation_admin.findUnique.mockResolvedValue(null);
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's-active' });
    const guard = guardWith(prisma, 'student:read', noopCache, 'active');
    const ctx = makeContext({
      user: { id: 'u1' },
      params: { schoolId: 's-param', courseId: 'c1' },
    });

    await expectRejection(guard.canActivate(ctx));
    expect(schoolAskedAbout(prisma)).toBe('s-active');
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
  });

  test("a declared scope that resolves to nothing is refused, not fallen back on", async () => {
    const prisma = tracked();
    const guard = guardWith(prisma, 'student:read', noopCache, 'param');
    // No :schoolId, but an active school that the old fallback would have used.
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's-active' });
    const ctx = makeContext({ user: { id: 'u1' }, params: {} });

    const err = await expectRejection(guard.canActivate(ctx));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toMatch(/school context/);
  });

  test('with no scope declared, the old order still applies', async () => {
    const prisma = tracked();
    prisma.organisation_admin.findUnique.mockResolvedValue(null);
    prisma.course.findUnique.mockResolvedValue({ school_id: 's-course' });
    const guard = guardWith(prisma, 'student:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { courseId: 'c1' } });

    await expectRejection(guard.canActivate(ctx));
    expect(schoolAskedAbout(prisma)).toBe('s-course');
  });
});

describe('computeEffectivePermissions: organisation admins', () => {
  test('get the full catalog without a membership', async () => {
    const prisma = createMockPrisma();
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    const effective = await computeEffectivePermissions(
      prisma as any,
      'u1',
      's1',
    );
    expect(effective).toEqual({
      member: true,
      role: 'admin',
      keys: [...defaultsForRole('admin')],
      viaOrganisation: true,
    });
  });

  test('outrank a teacher membership in the same school', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('teacher'));
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    const effective = await computeEffectivePermissions(
      prisma as any,
      'u1',
      's1',
    );
    expect(effective.role).toBe('admin');
    expect(effective.keys).toContain('course:update');
  });

  test('a plain stranger stays a non-member', async () => {
    const prisma = createMockPrisma();
    const effective = await computeEffectivePermissions(
      prisma as any,
      'u1',
      's1',
    );
    expect(effective).toEqual({ member: false, role: null, keys: [] });
  });
});
