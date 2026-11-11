import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createFakeStorage } from '@/test/erasure-mocks';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { OrganisationUsersController } from '@/organisation/organisation-users.controller';
import { ErasureLogService } from './erasure-log.service';
import { validatePlan } from './erasure-plan';
import { AccountErasureService } from './account-erasure.service';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ADMIN = U(1);
const USER = U(2);
const SCHOOL = U(3);

function setup(opts: { owns?: boolean; sso?: boolean; missing?: boolean } = {}) {
  const prisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  tx.erasure_log.create.mockResolvedValue({ id: 'log-1' });
  prisma.app_user.findUnique.mockResolvedValue(opts.missing ? null : { id: USER });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, account_type: 'student' });
  prisma.identity.findMany.mockResolvedValue(opts.sso ? [{ provider: 'azure' }] : []);
  prisma.school.findMany.mockResolvedValue(opts.owns ? [{ id: SCHOOL, name: 'Hill School' }] : []);
  const storage = createFakeStorage({ [`images/avatars/${USER}.png`]: 'img' });
  const erasure = new ErasureLogService(prisma as any, storage as any);
  const sessions = { revokeAll: mock(async () => 2) };
  const service = new AccountErasureService(prisma as any, erasure, createMockCacheService() as any, sessions as any);
  return { prisma, tx, storage, sessions, service };
}

describe('AccountErasureService.deleteByAdmin', () => {
  test('deletes the account as the admin, logs it, and signs it out', async () => {
    const { prisma, tx, storage, sessions, service } = setup();
    expect(await service.deleteByAdmin(ADMIN, USER)).toEqual({ deleted: true });
    expect(sessions.revokeAll).toHaveBeenCalledWith(USER, 'organisation_admin');
    expect(tx.app_user.deleteMany.mock.calls[0][0]).toEqual({ where: { id: USER } });
    expect(prisma.erasure_log.create).not.toHaveBeenCalled();
    const { data } = tx.erasure_log.create.mock.calls[0][0];
    validatePlan(data.replay);
    expect(data).toMatchObject({ kind: 'account', subject_ids: [USER], actor: ADMIN, reason: 'admin' });
    expect(storage.objects.size).toBe(0);
  });

  test('a school-managed (SSO) student account is not a blocker for an admin', async () => {
    const { tx, service } = setup({ sso: true });
    await service.deleteByAdmin(ADMIN, USER);
    expect(tx.app_user.deleteMany).toHaveBeenCalled();
  });

  test('ownership blocks it, worded for the admin, before anything is touched', async () => {
    const { prisma, sessions, service } = setup({ owns: true });
    const err = await expectRejection(service.deleteByAdmin(ADMIN, USER));
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as any;
    expect(body.code).toBe('ACCOUNT_DELETION_BLOCKED');
    expect(body.blockers.map((b: any) => b.code)).toEqual(['SCHOOL_OWNER']);
    expect(body.message).toBe('They own Hill School. Transfer its ownership first.');
    expect(sessions.revokeAll).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('refuses their own account and unknown users', async () => {
    expect(await expectRejection(setup().service.deleteByAdmin(ADMIN, ADMIN))).toBeInstanceOf(BadRequestException);
    expect(await expectRejection(setup({ missing: true }).service.deleteByAdmin(ADMIN, USER))).toBeInstanceOf(
      NotFoundException,
    );
  });

  test('a failed transaction is a 400 and leaves storage alone', async () => {
    const { tx, storage, service } = setup();
    tx.erasure_log.create.mockRejectedValue(new Error('log insert failed'));
    expect(await expectRejection(service.deleteByAdmin(ADMIN, USER))).toBeInstanceOf(BadRequestException);
    expect(storage.objects.size).toBe(1);
  });
});

test('DELETE /organisation/users/:userId needs step-up and is route-throttled', () => {
  const handler = OrganisationUsersController.prototype.deleteUser;
  expect(Reflect.getMetadata(STEP_UP_KEY, handler)).toBe(true);
  expect(Reflect.getMetadata('THROTTLER:LIMITroute', handler)).toBe(10);
});
