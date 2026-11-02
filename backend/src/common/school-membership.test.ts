import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { setSchoolMembership } from './school-membership';

describe('setSchoolMembership', () => {
  test('updates the existing row for the pair', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findUnique.mockResolvedValue({ id: 'm1' });
    prisma.school_management.update.mockResolvedValue({ id: 'm1' });

    expect(await setSchoolMembership(prisma as any, 'u1', 's1', 'admin')).toEqual({ id: 'm1' });
    expect(prisma.school_management.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'm1' },
      data: { role: 'admin' },
    });
    expect(prisma.school_management.create).not.toHaveBeenCalled();
  });

  test('creates a row when the user has none in that school', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findUnique.mockResolvedValue(null);
    prisma.school_management.create.mockResolvedValue({ id: 'm2' });

    expect(await setSchoolMembership(prisma as any, 'u1', 's1', 'teacher')).toEqual({ id: 'm2' });
    expect(prisma.school_management.create.mock.calls[0][0].data).toMatchObject({
      user_id: 'u1',
      school_id: 's1',
      role: 'teacher',
    });
  });

  test('never uses Prisma upsert (its ON CONFLICT cannot match the partial admin index)', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findUnique.mockResolvedValue(null);
    prisma.school_management.create.mockResolvedValue({ id: 'm3' });
    await setSchoolMembership(prisma as any, 'u1', 's1', 'admin');
    expect(prisma.school_management.upsert).not.toHaveBeenCalled();
  });
});
