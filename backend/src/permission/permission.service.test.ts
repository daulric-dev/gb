import { describe, test, expect } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { PERM_CACHE_PREFIX } from './permission.effective';

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

/** A database where the caller's active school is `schoolId`. */
function prismaInSchool(schoolId: string | null = 's1'): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: schoolId });
  return prisma;
}

const pgError = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

const ADMIN = 'admin-1';

describe('PermissionService', () => {
  test('createRole inserts a role scoped to the admin school', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.create.mockResolvedValue({
      id: 'r1',
      name: 'Librarian',
      is_system: false,
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const role = await svc.createRole(ADMIN, { name: 'Librarian' });
    expect(role.id).toBe('r1');

    expect(prisma.school_role.create.mock.calls[0][0].data).toMatchObject({
      school_id: 's1',
      is_system: false,
    });
  });

  test('createRole surfaces a duplicate-name conflict as 400', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.create.mockRejectedValue(pgError('23505'));
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    expect(
      await expectRejection(svc.createRole(ADMIN, { name: 'Teacher' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('system roles cannot be modified', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.findUnique.mockResolvedValue({
      id: 'r1',
      school_id: 's1',
      is_system: true,
      name: 'admin',
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    expect(
      await expectRejection(svc.updateRole(ADMIN, 'r1', { name: 'x' })),
    ).toBeInstanceOf(ForbiddenException);
    expect(prisma.school_role.update).not.toHaveBeenCalled();
  });

  test('system roles expose their code-defined default permissions', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.findUnique.mockResolvedValue({
      id: 'r1',
      school_id: 's1',
      is_system: true,
      name: 'teacher',
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const permissions = await svc.getRolePermissions(ADMIN, 'r1');
    expect(permissions).toContain('course:create');
    expect(permissions).toContain('student:read');
    expect(permissions).not.toContain('course:update');
  });

  test('setRolePermissions rejects unknown keys', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.findUnique.mockResolvedValue({
      id: 'r1',
      school_id: 's1',
      is_system: false,
      name: 'Librarian',
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    expect(
      await expectRejection(
        svc.setRolePermissions(ADMIN, 'r1', ['bogus:read']),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('setRolePermissions replaces grants and invalidates the cache', async () => {
    const prisma = prismaInSchool();
    prisma.school_role.findUnique.mockResolvedValue({
      id: 'r1',
      school_id: 's1',
      is_system: false,
      name: 'Librarian',
    });
    prisma.permission_catalog.findMany.mockResolvedValue([{ id: 'p1' }]);
    const { cache, prefixes } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.setRolePermissions(ADMIN, 'r1', ['student:read']);
    expect(result.keys).toEqual(['student:read']);

    // Old grants cleared, new grants inserted, in one transaction.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(
      prisma.school_role_permission.deleteMany.mock.calls[0][0].where,
    ).toEqual({ school_role_id: 'r1' });
    expect(
      prisma.school_role_permission.createMany.mock.calls[0][0].data,
    ).toEqual([{ school_role_id: 'r1', permission_id: 'p1' }]);
    expect(prefixes).toContain(PERM_CACHE_PREFIX);
  });

  test('getMyPermissions returns empty for a user with no active school', async () => {
    const prisma = prismaInSchool(null);
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.getMyPermissions('u1');
    expect(result).toEqual({
      schoolId: null,
      role: null,
      accountType: 'staff',
      isAdmin: false,
      permissions: [],
    });
  });

  test('getMyPermissions gives a student no catalog permissions', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({
      school_id: 's1',
      account_type: 'student',
    });
    // Reaching for a membership would mean the student path was not taken.
    prisma.school_management.findFirst.mockImplementation(() => {
      throw new Error('should not query membership for a student');
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.getMyPermissions('u1');
    expect(result).toEqual({
      schoolId: 's1',
      role: null,
      accountType: 'student',
      isAdmin: false,
      permissions: [],
    });
  });

  test('getMyPermissions reports admin with the full catalog', async () => {
    const prisma = prismaInSchool();
    prisma.school_management.findFirst.mockResolvedValue({
      role: 'admin',
      school_management_role: [],
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.getMyPermissions('u1');
    expect(result.isAdmin).toBe(true);
    expect(result.role).toBe('admin');
    expect(result.permissions).toContain('student:delete');
  });

  test('getMyPermissions serves a cached effective set without re-querying', async () => {
    const prisma = prismaInSchool();
    // A cache hit must not reach the membership/role tables.
    prisma.school_management.findFirst.mockImplementation(() => {
      throw new Error('should not query on cache hit');
    });
    const cache = {
      get: () =>
        Promise.resolve({
          member: true,
          role: 'teacher',
          keys: ['student:read'],
        }),
      set: async () => {},
      delete: async () => {},
      deleteByPrefix: async () => {},
    } as any;
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.getMyPermissions('u1');
    expect(result.permissions).toEqual(['student:read']);
    expect(result.role).toBe('teacher');
    expect(result.isAdmin).toBe(false);
  });

  test('assignRoleToMember rejects a membership from another school', async () => {
    const prisma = prismaInSchool();
    prisma.school_management.findUnique.mockResolvedValue({
      id: 'm1',
      school_id: 's2',
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    expect(
      await expectRejection(svc.assignRoleToMember(ADMIN, 'm1', 'r1')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('changeMemberRole allows clearing a member default role to null', async () => {
    const prisma = prismaInSchool();
    prisma.school.findUnique.mockResolvedValue({ owner_id: 'owner-user' });
    prisma.school_management.findUnique.mockResolvedValue({
      id: 'm1',
      user_id: 'u2',
      school_id: 's1',
    });
    const { cache, prefixes } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const result = await svc.changeMemberRole(ADMIN, 'm1', null);
    expect(result).toEqual({ role: null });
    expect(prefixes).toContain(PERM_CACHE_PREFIX);

    const mgmtUpdate = prisma.school_management.update.mock.calls[0][0];
    expect(mgmtUpdate.data.role).toBeNull();
    // Mirrored onto the profile only while that school is active.
    expect(prisma.user_profile.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'u2', school_id: 's1' },
      data: { role: null },
    });
  });

  test('changeMemberRole rejects changing the school owner role', async () => {
    const prisma = prismaInSchool();
    prisma.school.findUnique.mockResolvedValue({ owner_id: 'u2' });
    prisma.school_management.findUnique.mockResolvedValue({
      id: 'm1',
      user_id: 'u2',
      school_id: 's1',
    });
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    expect(
      await expectRejection(svc.changeMemberRole(ADMIN, 'm1', 'teacher')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('changeMemberRole gives actionable error when nullable migration is missing (code 23502)', async () => {
    const prisma = prismaInSchool();
    prisma.school.findUnique.mockResolvedValue({ owner_id: 'owner-user' });
    prisma.school_management.findUnique.mockResolvedValue({
      id: 'm1',
      user_id: 'u2',
      school_id: 's1',
    });
    prisma.school_management.update.mockRejectedValue(
      pgError('23502', 'not-null violation'),
    );
    const { cache } = makeCache();
    const svc = new PermissionService(cache, prisma as any);

    const err = await expectRejection(svc.changeMemberRole(ADMIN, 'm1', null));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(
      'The database must allow members without a default role. Apply the nullable membership role migration first.',
    );
  });
});
