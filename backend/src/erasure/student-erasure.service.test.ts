import { describe, expect, mock, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createFakeStorage } from '@/test/erasure-mocks';
import { ErasureLogService } from './erasure-log.service';
import { validatePlan } from './erasure-plan';
import { StudentErasureService } from './student-erasure.service';
import { StudentErasureController } from '@/student/student-erasure.controller';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SCHOOL = U(1);
const OTHER_SCHOOL = U(2);
const STUDENT = U(3);
const USER = U(4);
const TERM = U(5);
const ENROLMENT = U(6);
const ADMIN = U(7);
const REPORT = `report-cards/schools/${SCHOOL}/terms/${TERM}/${STUDENT}.pdf`;
const PERSONAL = ['Jane', 'Doe', 'jane@example.com'];

interface Opts {
  linked?: boolean;
  sso?: boolean;
  otherSchool?: boolean;
  ownsSchool?: boolean;
}

function setup(opts: Opts = {}) {
  const prisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  let n = 0;
  tx.erasure_log.create.mockImplementation(async () => ({ id: `log-${++n}` }));
  tx.student.deleteMany.mockResolvedValue({ count: 1 });

  prisma.student.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === STUDENT && where.school_id === SCHOOL
      ? { id: STUDENT, user_profile_id: opts.linked ? USER : null, first_name: 'Jane', last_name: 'Doe' }
      : null,
  );
  prisma.report_document.findMany.mockResolvedValue([
    { school_id: SCHOOL, term_id: TERM, storage_key: REPORT },
  ]);
  prisma.course_student.findMany.mockResolvedValue([{ id: ENROLMENT }]);
  prisma.identity.findMany.mockResolvedValue(opts.sso ? [{ provider: 'google' }] : []);
  prisma.school_management.count.mockResolvedValue(opts.otherSchool ? 1 : 0);
  prisma.school_management.findMany.mockResolvedValue([]);
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, account_type: 'student' });
  prisma.school.findMany.mockResolvedValue(opts.ownsSchool ? [{ id: OTHER_SCHOOL, name: 'Hill' }] : []);
  prisma.file.findMany.mockResolvedValue([
    { school_id: SCHOOL, bucket: 'file-manager', storage_path: `${SCHOOL}/${USER}/x-essay.pdf` },
  ]);

  const storage = createFakeStorage({
    [REPORT]: 'pdf',
    [`file-manager/${SCHOOL}/${USER}/x-essay.pdf`]: 'bytes',
    [`images/avatars/${USER}.png`]: 'img',
  });
  const erasure = new ErasureLogService(prisma as any, storage as any);
  const cache = createMockCacheService();
  const sessions = { revokeAll: mock(async () => 1) };
  const service = new StudentErasureService(prisma as any, erasure, cache as any, sessions as any);
  return { prisma, tx, storage, cache, sessions, service };
}

/** Every log entry written in the transaction, validated and checked for personal data. */
function entries(prisma: MockPrisma, tx: MockPrisma) {
  expect(prisma.erasure_log.create).not.toHaveBeenCalled();
  return tx.erasure_log.create.mock.calls.map(([{ data }]: any) => {
    validatePlan(data.replay);
    const text = JSON.stringify(data);
    for (const p of PERSONAL) expect(text).not.toContain(p);
    return data;
  });
}

describe('StudentErasureService.erase', () => {
  test('a record without an account: rows, roster links and log entry in one transaction; the PDF after commit', async () => {
    const { prisma, tx, storage, service } = setup();
    const result = await service.erase(STUDENT, { schoolId: SCHOOL, actor: ADMIN, reason: 'admin' });
    expect(result).toEqual({ studentId: STUDENT, account: 'none', reportFiles: 1 });

    expect(tx.roster_link.deleteMany.mock.calls[0][0]).toEqual({
      where: { target_id: { in: [STUDENT, ENROLMENT] } },
    });
    expect(tx.student.deleteMany.mock.calls[0][0]).toEqual({ where: { id: STUDENT, school_id: SCHOOL } });
    expect(prisma.student.deleteMany).not.toHaveBeenCalled();
    expect(tx.app_user.deleteMany).not.toHaveBeenCalled();

    const [entry, ...rest] = entries(prisma, tx);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'student_record',
      subject_table: 'student.student',
      subject_ids: [STUDENT],
      school_id: SCHOOL,
      actor: ADMIN,
      reason: 'admin',
    });
    expect(entry.replay.steps).toEqual([
      { op: 'delete_storage_prefix', prefixes: [REPORT] },
      { op: 'delete', table: 'public.roster_link', where: { target_id: [STUDENT, ENROLMENT] } },
      { op: 'delete', table: 'student.student', where: { id: [STUDENT] } },
    ]);
    expect(storage.objects.has(REPORT)).toBe(false);
  });

  test('a school-managed (SSO) account in no other school is deleted with it, as its own entry', async () => {
    const { prisma, tx, storage, sessions, cache, service } = setup({ linked: true, sso: true });
    await cache.set(`profile:${USER}`, { id: USER }, 60);
    const result = await service.erase(STUDENT, { schoolId: SCHOOL, actor: ADMIN, reason: 'admin' });
    expect(result.account).toBe('deleted');
    expect(sessions.revokeAll).toHaveBeenCalledWith(USER, 'account_deleted');
    expect(tx.ai_request.updateMany.mock.calls[0][0]).toEqual({
      where: { user_id: USER },
      data: { user_id: null },
    });
    expect(tx.push_device.deleteMany.mock.calls[0][0]).toEqual({ where: { user_id: USER } });
    expect(tx.user_profile.deleteMany.mock.calls[0][0]).toEqual({ where: { id: USER } });
    expect(tx.app_user.deleteMany.mock.calls[0][0]).toEqual({ where: { id: USER } });
    // Kept accounts are unlinked; a deleted one is not.
    expect(tx.user_profile.updateMany).not.toHaveBeenCalled();

    const logged = entries(prisma, tx);
    expect(logged.map((e: any) => e.kind)).toEqual(['student_record', 'account']);
    expect(logged[1]).toMatchObject({ subject_ids: [USER], actor: ADMIN, reason: 'admin' });
    expect(logged[1].replay.steps).toContainEqual({
      op: 'update',
      table: 'public.ai_request',
      where: { user_id: [USER] },
      set: { user_id: null },
    });
    // The account's files and avatar go after commit, and its cache entries.
    expect(storage.objects.size).toBe(0);
    expect(await cache.get(`profile:${USER}`)).toBeNull();
  });

  test("the person's own account (email sign-in) is kept and removed from the school", async () => {
    const { prisma, tx, storage, sessions, service } = setup({ linked: true });
    const result = await service.erase(STUDENT, { schoolId: SCHOOL, actor: ADMIN, reason: 'admin' });
    expect(result.account).toBe('unlinked');
    expect(sessions.revokeAll).not.toHaveBeenCalled();
    expect(tx.app_user.deleteMany).not.toHaveBeenCalled();
    expect(tx.school_management.deleteMany.mock.calls[0][0]).toEqual({
      where: { user_id: USER, school_id: SCHOOL },
    });
    expect(tx.user_profile.updateMany.mock.calls[0][0]).toEqual({
      where: { id: USER, school_id: SCHOOL },
      data: { school_id: null, role: null },
    });
    const [entry] = entries(prisma, tx);
    expect(entry.replay.steps).toContainEqual({
      op: 'update',
      table: 'public.user_profile',
      where: { id: [USER], school_id: [SCHOOL] },
      set: { school_id: null, role: null },
    });
    // Their own files stay; only the report PDF goes.
    expect(storage.objects.has(`file-manager/${SCHOOL}/${USER}/x-essay.pdf`)).toBe(true);
    expect(storage.objects.has(REPORT)).toBe(false);
  });

  test('an SSO account that is also in another school, or owns one, is kept', async () => {
    expect((await setup({ linked: true, sso: true, otherSchool: true }).service.linkedAccountOutcome(USER, SCHOOL))).toBe('unlinked');
    expect((await setup({ linked: true, sso: true, ownsSchool: true }).service.linkedAccountOutcome(USER, SCHOOL))).toBe('unlinked');
    expect((await setup({ linked: true, sso: true }).service.linkedAccountOutcome(USER, SCHOOL))).toBe('deleted');
    expect((await setup().service.linkedAccountOutcome(null, SCHOOL))).toBe('none');
  });

  test("another school's student is a 404 and nothing is touched", async () => {
    const { prisma, service } = setup();
    const err = await expectRejection(service.erase(STUDENT, { schoolId: OTHER_SCHOOL, actor: ADMIN, reason: 'admin' }));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a failed log write fails the erasure and leaves storage alone', async () => {
    const { tx, storage, service } = setup({ linked: true, sso: true });
    tx.erasure_log.create.mockRejectedValue(new Error('log insert failed'));
    await expectRejection(service.erase(STUDENT, { schoolId: SCHOOL, actor: ADMIN, reason: 'admin' }));
    expect(storage.objects.size).toBe(3);
  });

  test('the retention purge erases as the system', async () => {
    const { prisma, tx, service } = setup();
    await service.erase(STUDENT, { schoolId: SCHOOL, actor: 'system', reason: 'retention_purge' });
    expect(entries(prisma, tx)[0]).toMatchObject({ actor: 'system', reason: 'retention_purge' });
  });
});

test('DELETE /students/:id needs student:erase, step-up and a route throttle', () => {
  const handler = StudentErasureController.prototype.erase;
  expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe('student:erase');
  expect(Reflect.getMetadata(STEP_UP_KEY, handler)).toBe(true);
  expect(Reflect.getMetadata('THROTTLER:LIMITroute', handler)).toBe(20);
  expect(Reflect.getMetadata(PERMISSION_KEY, StudentErasureController.prototype.preview)).toBe('student:erase');
});
