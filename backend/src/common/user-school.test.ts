import { describe, expect, test } from 'bun:test';
import { userSchoolId } from './user-school';
import { createMockPrisma } from '@/test/prisma-mock';

describe('userSchoolId', () => {
  test('returns the profile school id', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    expect(await userSchoolId(prisma as any, 'user-1')).toBe('school-1');
    expect(prisma.user_profile.findUnique.mock.calls[0][0]).toEqual({
      where: { id: 'user-1' },
      select: { school_id: true },
    });
  });

  test('null when the user has no profile', async () => {
    const prisma = createMockPrisma();
    expect(await userSchoolId(prisma as any, 'ghost')).toBeNull();
  });

  test('null when the profile has no school', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
    expect(await userSchoolId(prisma as any, 'user-1')).toBeNull();
  });

  test('propagates database errors', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockRejectedValue(new Error('db down'));
    expect(userSchoolId(prisma as any, 'user-1')).rejects.toThrow('db down');
  });
});
