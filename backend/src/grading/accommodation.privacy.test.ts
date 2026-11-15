import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { AccommodationService } from './accommodation.service';
import { isSealedText, openText } from '@/account/sensitive-text';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const saved = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = 'x'.repeat(40);
});
afterAll(() => {
  if (saved === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved;
});

const PAST = new Date(Date.now() - 86_400_000);
const ID = '0b0b0b0b-1111-4111-8111-111111111111';

function build(keys: string[] | 'admin') {
  const prisma: MockPrisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue({ id: 'act-1', course_id: 'course-1', kind: 'quiz' });
  prisma.course_student.findUnique.mockResolvedValue({ status: 'active' });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.student.findFirst.mockResolvedValue({ id: 'stu-1' });
  prisma.school_management.findFirst.mockResolvedValue(
    keys === 'admin'
      ? { role: 'admin', school_management_role: [] }
      : {
          role: 'teacher',
          school_management_role: [
            { school_role: { school_role_permission: keys.map((key) => ({ permission_catalog: { key } })) } },
          ],
        },
  );
  // upsert echoes what was written, so the stored value can be checked.
  for (const model of ['activity_accommodation', 'student_accommodation'] as const) {
    prisma[model].upsert.mockImplementation(async ({ create, update }: any) => {
      const before = await prisma[model].findUnique.mock.results.at(-1)?.value;
      const data = before ? { ...before, ...update } : create;
      return {
        id: data.id ?? before?.id,
        activity_id: 'act-1',
        student_id: 'stu-1',
        time_multiplier: data.time_multiplier ?? null,
        extra_minutes: data.extra_minutes ?? null,
        lockdown_exempt: data.lockdown_exempt ?? false,
        reason: 'reason' in data ? data.reason : (before?.reason ?? null),
        created_by: 'u',
        created_at: PAST,
        updated_at: PAST,
      };
    });
  }
  const records: any[] = [];
  const access = {
    require: async (_u: string, courseId: string) => ({ course: { id: courseId, school_id: 'school-1' }, role: 'teacher' }),
  };
  const audit = { record: async (...args: any[]) => void records.push(args[3]) };
  return { prisma, records, service: new AccommodationService(prisma as any, access as any, audit as any) };
}

describe('accommodation reasons', () => {
  test('are stored encrypted against the row id, and never written to the audit log', async () => {
    const { prisma, records, service } = build('admin');
    const out = await service.setForStudent('u', 'stu-1', { timeMultiplier: 1.5, reason: ' Dyslexia ' });
    const create = prisma.student_accommodation.upsert.mock.calls[0][0].create;
    expect(isSealedText(create.reason)).toBe(true);
    expect(openText('student_accommodation.reason', create.id, create.reason)).toBe('Dyslexia');
    // Bound to its row: another id does not open it.
    expect(openText('student_accommodation.reason', ID, create.reason)).not.toBe('Dyslexia');
    expect(out.reason).toBe('Dyslexia');
    expect(JSON.stringify(records)).not.toContain('Dyslexia');
    expect(records[0].changes.hasReason).toEqual({ before: null, after: true });
    expect(records[0].changes.reasonChanged).toEqual({ before: null, after: true });
  });

  test('are left out of responses without student:sensitive', async () => {
    const { prisma, service } = build(['student:read', 'student:read-all']);
    prisma.student_accommodation.findUnique.mockResolvedValue({
      id: ID, student_id: 'stu-1', time_multiplier: '2', extra_minutes: null, lockdown_exempt: false,
      reason: 'Medical', created_by: 'x', created_at: PAST, updated_at: PAST,
    });
    const out = await service.getForStudent('u', 'stu-1');
    expect(out).not.toHaveProperty('reason');
    expect(out?.timeMultiplier).toBe(2);

    prisma.activity_accommodation.findMany.mockResolvedValue([
      { id: ID, activity_id: 'act-1', student_id: 'stu-1', time_multiplier: null, extra_minutes: 5, lockdown_exempt: false, reason: 'Medical', created_by: 'x', created_at: PAST, updated_at: PAST },
    ]);
    const list = await service.listForActivity('u', 'act-1');
    expect(list[0]).not.toHaveProperty('reason');
  });

  test('a caller without student:sensitive cannot overwrite or clear a reason they cannot see', async () => {
    const { prisma, service } = build(['student:read', 'student:read-all']);
    prisma.activity_accommodation.findUnique.mockResolvedValue({
      id: ID, activity_id: 'act-1', student_id: 'stu-1', time_multiplier: null, extra_minutes: 5, lockdown_exempt: false,
      reason: 'sealed-before', created_by: 'x', created_at: PAST, updated_at: PAST,
    });
    await service.setForActivity('u', 'act-1', 'stu-1', { extraMinutes: 10, reason: null });
    const update = prisma.activity_accommodation.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('reason');
  });

  test('without student:read-all the student must be one of the caller\'s own', async () => {
    const { prisma, service } = build(['student:read']);
    prisma.student.findFirst.mockResolvedValue(null);
    expect(await service.getForStudent('u', 'stu-9').catch((e) => e)).toBeInstanceOf(NotFoundException);
    expect(JSON.stringify(prisma.student.findFirst.mock.calls[0][0].where)).toContain('course_staff');
  });
});
