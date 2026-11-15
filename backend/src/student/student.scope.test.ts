import { describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { StudentService } from './student.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const SCHOOL = 'school-1';

function setup(role: string, keys: string[] = []) {
  const prisma: MockPrisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
  prisma.school_management.findFirst.mockResolvedValue({
    role,
    school_management_role: [
      { school_role: { school_role_permission: keys.map((key) => ({ permission_catalog: { key } })) } },
    ],
  });
  const cache = createMockCacheService();
  const svc = new StudentService(prisma as any, cache as any, undefined, { record: async () => undefined } as any);
  return { prisma, cache, svc };
}

const scoped = (where: any) => JSON.stringify(where).includes('course_staff');

describe('student read scope', () => {
  test('a teacher lists only students of their own courses and tutees, never from the cache', async () => {
    const { prisma, cache, svc } = setup('teacher');
    await cache.set(`students:${SCHOOL}`, [{ id: 'everyone' }], 60);
    prisma.student.findMany.mockResolvedValue([]);
    await svc.findAll('t1');
    const where = prisma.student.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ school_id: SCHOOL });
    expect(where.AND[1].OR).toContainEqual({ form_tutor_id: 't1' });
    expect(scoped(where)).toBe(true);
  });

  test('paged lists are scoped the same way', async () => {
    const { prisma, svc } = setup('teacher');
    await svc.findAllPaginated('t1', { page: 1 } as any);
    expect(scoped(prisma.student.findMany.mock.calls[0][0].where)).toBe(true);
    expect(scoped(prisma.student.count.mock.calls[0][0].where)).toBe(true);
  });

  test('a student outside the scope is a 404', async () => {
    const { prisma, svc } = setup('teacher');
    prisma.student.findFirst.mockResolvedValue(null);
    expect(await expectRejection(svc.findOne('t1', 'st-9'))).toBeInstanceOf(NotFoundException);
    expect(scoped(prisma.student.findFirst.mock.calls[0][0].where)).toBe(true);
    expect(await expectRejection(svc.profile('t1', 'st-9'))).toBeInstanceOf(NotFoundException);
  });

  test('student:read-all (a role) sees the whole school', async () => {
    const { prisma, svc } = setup('member', ['student:read', 'student:read-all']);
    prisma.student.findMany.mockResolvedValue([]);
    await svc.findAll('office');
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ school_id: SCHOOL });
  });
});

describe('guardian contacts need student:sensitive', () => {
  const student = { id: 'st-1', school_id: SCHOOL, user_profile_id: null, date_of_birth: null, enrollment_date: null };

  test('without it, guardians are left out and not even queried', async () => {
    const { prisma, svc } = setup('teacher');
    prisma.student.findFirst.mockResolvedValue(student);
    const out = await svc.profile('t1', 'st-1');
    expect(out.guardians).toBeNull();
    expect(prisma.parent_student_link.findMany).not.toHaveBeenCalled();
  });

  test('with it, they are listed', async () => {
    const { prisma, svc } = setup('member', ['student:read', 'student:read-all', 'student:sensitive']);
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.parent_student_link.findMany.mockResolvedValue([
      { user_profile_id: 'g1', relationship: null, user_profile: { id: 'g1', first_name: 'A', last_name: 'B', email: 'a@x' } },
    ]);
    const out = await svc.profile('o1', 'st-1');
    expect(out.guardians).toEqual([{ id: 'g1', name: 'A B', email: 'a@x', relationship: null }]);
  });
});
