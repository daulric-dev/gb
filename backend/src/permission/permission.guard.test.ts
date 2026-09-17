import { describe, test, expect } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

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

const guardWith = (sb: any, key: string | undefined, cache: any = noopCache) =>
  new PermissionGuard(reflector(key), sb, cache);

describe('PermissionGuard', () => {
  test('is inert when the route has no @RequirePermission metadata', async () => {
    const guard = guardWith({}, undefined);
    expect(await guard.canActivate(makeContext({}))).toBe(true);
  });

  test('fails closed when request.user is missing', async () => {
    const guard = guardWith({}, 'student:read');
    expect(
      await expectRejection(guard.canActivate(makeContext({}))),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('admin is granted any catalog permission in their school', async () => {
    const sb = createRoutingSupabase({
      tables: {
        school_management: { data: { id: 'm1', role: 'admin' }, error: null },
      },
    });
    const guard = guardWith(sb, 'student:delete');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('teacher default allows a mapped key', async () => {
    const sb = createRoutingSupabase({
      tables: {
        school_management: { data: { id: 'm1', role: 'teacher' }, error: null },
        school_management_role: { data: [], error: null },
      },
    });
    const guard = guardWith(sb, 'attendance:create');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('teacher default denies an unmapped key', async () => {
    const sb = createRoutingSupabase({
      tables: {
        school_management: { data: { id: 'm1', role: 'teacher' }, error: null },
        school_management_role: { data: [], error: null },
      },
    });
    const guard = guardWith(sb, 'school:delete');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await expectRejection(guard.canActivate(ctx))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('a custom role grants an otherwise-denied key', async () => {
    const sb = createRoutingSupabase({
      tables: {
        school_management: { data: { id: 'm1', role: 'member' }, error: null },
        school_management_role: {
          data: [{ school_role_id: 'r1' }],
          error: null,
        },
        school_role_permission: {
          data: [{ permission_catalog: { key: 'school:delete' } }],
          error: null,
        },
      },
    });
    const guard = guardWith(sb, 'school:delete');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('a non-member of the resolved school is denied', async () => {
    const sb = createRoutingSupabase({
      tables: { school_management: { data: null, error: null } },
    });
    const guard = guardWith(sb, 'student:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await expectRejection(guard.canActivate(ctx))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('resolves school context from a classId when no :schoolId is present', async () => {
    const sb = createRoutingSupabase({
      tables: {
        student_group: {
          data: { academic_year: { school_id: 's1' } },
          error: null,
        },
        school_management: { data: { id: 'm1', role: 'admin' }, error: null },
      },
    });
    const guard = guardWith(sb, 'attendance:read');
    const ctx = makeContext({ user: { id: 'u1' }, params: { classId: 'c1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  test('uses the cached effective set without hitting the DB', async () => {
    const cache = {
      get: () => Promise.resolve({ member: true, keys: ['student:read'] }),
      set: async () => {},
      deleteByPrefix: async () => {},
    } as any;
    // Supabase that throws if queried, proving the cache short-circuits.
    const exploding = {
      getServiceClient: () => {
        throw new Error('should not query the DB on a cache hit');
      },
    };
    const guard = guardWith(exploding, 'student:read', cache);
    const ctx = makeContext({ user: { id: 'u1' }, params: { schoolId: 's1' } });
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
