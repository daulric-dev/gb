import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { SYSTEM_ROLE_NAMES, seedSchoolSystemRoles } from './system-roles';

describe('seedSchoolSystemRoles', () => {
  test('creates admin, teacher and member as system roles for a new school', async () => {
    const prisma = createMockPrisma();
    await seedSchoolSystemRoles(prisma as never, 'school-1');
    expect(prisma.school_role.createMany.mock.calls[0][0]).toEqual({
      data: [
        { school_id: 'school-1', name: 'admin', is_system: true },
        { school_id: 'school-1', name: 'teacher', is_system: true },
        { school_id: 'school-1', name: 'member', is_system: true },
      ],
    });
    expect([...SYSTEM_ROLE_NAMES]).toEqual(['admin', 'teacher', 'member']);
  });

  test('skips roles the school already has (like ON CONFLICT DO NOTHING)', async () => {
    const prisma = createMockPrisma();
    prisma.school_role.findMany.mockResolvedValue([{ name: 'admin' }, { name: 'member' }]);
    await seedSchoolSystemRoles(prisma as never, 'school-1');
    expect(prisma.school_role.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      name: { in: ['admin', 'teacher', 'member'] },
    });
    expect(prisma.school_role.createMany.mock.calls[0][0].data).toEqual([
      { school_id: 'school-1', name: 'teacher', is_system: true },
    ]);
  });

  test('does nothing when all three exist', async () => {
    const prisma = createMockPrisma();
    prisma.school_role.findMany.mockResolvedValue(SYSTEM_ROLE_NAMES.map((name) => ({ name })));
    await seedSchoolSystemRoles(prisma as never, 'school-1');
    expect(prisma.school_role.createMany).not.toHaveBeenCalled();
  });
});
