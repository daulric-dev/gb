import { describe, test, expect } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

const ctx = (userId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { id: userId } : undefined }),
    }),
  }) as unknown as ExecutionContext;

const ACTIVE = { role: 'admin', is_active: true, school_id: 's1' };

describe('AdminGuard', () => {
  test('a school admin with an admin membership passes', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(ACTIVE);
    prisma.school_management.findFirst.mockResolvedValue({ id: 'm1' });
    expect(await new AdminGuard(prisma as any).canActivate(ctx('u1'))).toBe(true);
  });

  test('a mirrored admin role without the membership is refused', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(ACTIVE);
    const err = await expectRejection(new AdminGuard(prisma as any).canActivate(ctx('u1')));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('an organisation admin passes in the active school without a membership', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ ...ACTIVE, role: 'teacher' });
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    expect(await new AdminGuard(prisma as any).canActivate(ctx('u1'))).toBe(true);
  });

  test('an organisation admin with no active school is refused', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ ...ACTIVE, school_id: null });
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });
    const err = await expectRejection(new AdminGuard(prisma as any).canActivate(ctx('u1')));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('no user is refused', async () => {
    const err = await expectRejection(
      new AdminGuard(createMockPrisma() as any).canActivate(ctx()),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });
});
