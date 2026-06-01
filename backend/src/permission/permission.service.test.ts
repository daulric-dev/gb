import { describe, test, expect } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';
import { PERM_CACHE_PREFIX } from './permission.guard';

function makeCache() {
  const prefixes: string[] = [];
  return {
    cache: {
      get: () => Promise.resolve(null),
      set: async () => {},
      delete: async () => {},
      deleteByPrefix: (p: string) => {
        prefixes.push(p);
        return Promise.resolve();
      },
    } as any,
    prefixes,
  };
}

const ADMIN = 'admin-1';

describe('PermissionService', () => {
  test('createRole inserts a role scoped to the admin school', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_role: {
          data: { id: 'r1', name: 'Librarian', is_system: false },
          error: null,
        },
      },
    });
    const { cache } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    const role = await svc.createRole(ADMIN, { name: 'Librarian' });
    expect(role.id).toBe('r1');

    const insert = sb._calls.find(
      (c) => c.table === 'school_role' && c.op === 'insert',
    );
    expect(insert?.payload).toMatchObject({
      school_id: 's1',
      is_system: false,
    });
  });

  test('createRole surfaces a duplicate-name conflict as 400', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_role: { data: null, error: { code: '23505' } },
      },
    });
    const { cache } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    expect(
      await expectRejection(svc.createRole(ADMIN, { name: 'Teacher' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('system roles cannot be modified', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_role: {
          data: { id: 'r1', school_id: 's1', is_system: true, name: 'admin' },
          error: null,
        },
      },
    });
    const { cache } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    expect(
      await expectRejection(svc.updateRole(ADMIN, 'r1', { name: 'x' })),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('setRolePermissions rejects unknown keys', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_role: {
          data: {
            id: 'r1',
            school_id: 's1',
            is_system: false,
            name: 'Librarian',
          },
          error: null,
        },
      },
    });
    const { cache } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    expect(
      await expectRejection(
        svc.setRolePermissions(ADMIN, 'r1', ['bogus:read']),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('setRolePermissions replaces grants and invalidates the cache', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_role: {
          data: {
            id: 'r1',
            school_id: 's1',
            is_system: false,
            name: 'Librarian',
          },
          error: null,
        },
        permission_catalog: { data: [{ id: 'p1' }], error: null },
        school_role_permission: { data: null, error: null },
      },
    });
    const { cache, prefixes } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    const result = await svc.setRolePermissions(ADMIN, 'r1', ['student:read']);
    expect(result.keys).toEqual(['student:read']);

    // Old grants cleared, new grants inserted.
    expect(
      sb._calls.some(
        (c) => c.table === 'school_role_permission' && c.op === 'delete',
      ),
    ).toBe(true);
    expect(
      sb._calls.some(
        (c) => c.table === 'school_role_permission' && c.op === 'insert',
      ),
    ).toBe(true);
    expect(prefixes).toContain(PERM_CACHE_PREFIX);
  });

  test('assignRoleToMember rejects a membership from another school', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: 's1' }, error: null },
        school_management: { data: { id: 'm1', school_id: 's2' }, error: null },
      },
    });
    const { cache } = makeCache();
    const svc = new PermissionService(sb as any, cache);

    expect(
      await expectRejection(svc.assignRoleToMember(ADMIN, 'm1', 'r1')),
    ).toBeInstanceOf(ForbiddenException);
  });
});
