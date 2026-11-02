import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';

function context(user?: { id: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('OrganisationAdminGuard', () => {
  let prisma: MockPrisma;
  let guard: OrganisationAdminGuard;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.ORG_ADMIN_EMAILS;
    delete process.env.ORG_ADMIN_EMAILS;
    prisma = createMockPrisma();
    guard = new OrganisationAdminGuard(prisma as any);
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ORG_ADMIN_EMAILS;
    else process.env.ORG_ADMIN_EMAILS = prevEnv;
  });

  test('403 without a user', async () => {
    expect(await expectRejection(guard.canActivate(context()))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('403 for a user who is not an organisation admin', async () => {
    expect(
      await expectRejection(guard.canActivate(context({ id: 'u-1' }))),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('lets a user with an organisation_admin row through', async () => {
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u-1' });
    expect(await guard.canActivate(context({ id: 'u-1' }))).toBe(true);
  });

  test('lets a verified email listed in ORG_ADMIN_EMAILS through', async () => {
    process.env.ORG_ADMIN_EMAILS = 'ops@x.org';
    prisma.app_user.findUnique.mockResolvedValue({
      email: 'Ops@X.org',
      email_verified_at: new Date(),
      disabled_at: null,
    });
    expect(await guard.canActivate(context({ id: 'u-1' }))).toBe(true);
  });

  test('an unverified or disabled listed account is refused', async () => {
    process.env.ORG_ADMIN_EMAILS = 'ops@x.org';
    prisma.app_user.findUnique.mockResolvedValue({
      email: 'ops@x.org',
      email_verified_at: null,
      disabled_at: null,
    });
    expect(
      await expectRejection(guard.canActivate(context({ id: 'u-1' }))),
    ).toBeInstanceOf(ForbiddenException);
    prisma.app_user.findUnique.mockResolvedValue({
      email: 'ops@x.org',
      email_verified_at: new Date(),
      disabled_at: new Date(),
    });
    expect(
      await expectRejection(guard.canActivate(context({ id: 'u-1' }))),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a database error fails closed', async () => {
    prisma.organisation_admin.findUnique.mockRejectedValue(new Error('down'));
    expect(
      await expectRejection(guard.canActivate(context({ id: 'u-1' }))),
    ).toBeInstanceOf(ForbiddenException);
  });
});
