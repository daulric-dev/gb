import { describe, test, expect } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

function makeContext(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

// Reflector stub: returns the required permission key (or undefined).
const reflector = (key: string | undefined) =>
  ({ getAllAndOverride: () => key }) as any;

const noopCache = {
  get: () => Promise.resolve(null),
  set: async () => {},
  deleteByPrefix: async () => {},
} as any;

const guardWith = (
  prisma: any,
  key: string | undefined,
  cache: any = noopCache,
) => new PermissionGuard(reflector(key), cache, prisma);

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
});
