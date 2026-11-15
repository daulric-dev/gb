import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { createMockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { SchoolRetentionService } from './school-retention.service';
import { SchoolRetentionController } from './school-retention.controller';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-12-10T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function setup(row: Record<string, unknown> | null = null) {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
  prisma.school_retention_setting.findUnique.mockResolvedValue(row);
  const students = { erase: mock(async () => ({})) };
  const service = new SchoolRetentionService(prisma as any, students as any);
  return { prisma, students, service };
}

describe('settings', () => {
  test('off by default: no periods, not confirmed, nothing due', async () => {
    const { prisma, service } = setup();
    const view = await service.view(ADMIN, NOW);
    expect(view).toEqual({
      leaverRetentionDays: null,
      closedYearRetentionYears: null,
      confirmedAt: null,
      active: false,
      due: [],
      noticeDays: 30,
    });
    expect(prisma.student.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  test('changing a period clears the confirmation; saving the same values keeps it', async () => {
    const { prisma, service } = setup({
      leaver_retention_days: 365,
      closed_year_retention_years: null,
      confirmed_at: new Date('2026-12-01T00:00:00Z'),
    });
    await service.update(ADMIN, { leaverRetentionDays: 180, closedYearRetentionYears: null });
    expect(prisma.school_retention_setting.upsert.mock.calls[0][0].update).toMatchObject({
      leaver_retention_days: 180,
      confirmed_at: null,
    });
    await service.update(ADMIN, { leaverRetentionDays: 365, closedYearRetentionYears: null });
    expect(prisma.school_retention_setting.upsert.mock.calls[1][0].update.confirmed_at).toBeUndefined();
  });

  test('confirming needs a period', async () => {
    const { service } = setup();
    expect(await expectRejection(service.confirm(ADMIN))).toBeInstanceOf(BadRequestException);
  });
});

describe('due list', () => {
  test('leavers: due the set number of days after they were made inactive', async () => {
    const { prisma, service } = setup();
    const leftAt = new Date(NOW.getTime() - 340 * DAY);
    prisma.student.findMany.mockResolvedValue([{ id: 's1', first_name: 'A', last_name: 'B', left_at: leftAt }]);
    const until = new Date(NOW.getTime() + 30 * DAY);
    const due = await service.dueStudents(SCHOOL, { leaverRetentionDays: 365, closedYearRetentionYears: null }, until);
    const where = prisma.student.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ school_id: SCHOOL, is_active: false });
    expect(where.left_at.lte.getTime()).toBe(until.getTime() - 365 * DAY);
    expect(due).toEqual([
      { id: 's1', firstName: 'A', lastName: 'B', rule: 'leaver', dueAt: new Date(leftAt.getTime() + 365 * DAY).toISOString() },
    ]);
  });

  test('closed years: due the set number of years after their last academic year ended; the earlier rule wins', async () => {
    const { prisma, service } = setup();
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', first_name: 'A', last_name: 'B', left_at: new Date('2026-01-01T00:00:00Z') },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { id: 's1', first_name: 'A', last_name: 'B', last_end: new Date('2020-07-31') },
      { id: 's2', first_name: 'C', last_name: 'D', last_end: new Date('2021-07-31') },
    ]);
    const due = await service.dueStudents(SCHOOL, { leaverRetentionDays: 365, closedYearRetentionYears: 5 }, NOW);
    expect(due.map((d) => [d.id, d.rule, d.dueAt.slice(0, 10)])).toEqual([
      ['s1', 'closed_year', '2025-07-31'],
      ['s2', 'closed_year', '2026-07-31'],
    ]);
  });
});

describe('purge', () => {
  test('only confirmed schools; each due record erased as the system', async () => {
    const { prisma, students, service } = setup();
    prisma.school_retention_setting.findMany.mockResolvedValue([
      { school_id: SCHOOL, leaver_retention_days: 30, closed_year_retention_years: null, confirmed_at: new Date() },
    ]);
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', first_name: 'A', last_name: 'B', left_at: new Date(NOW.getTime() - 40 * DAY) },
    ]);
    const report = await service.purge(NOW);
    expect(prisma.school_retention_setting.findMany.mock.calls[0][0].where.confirmed_at).toEqual({ not: null });
    expect(students.erase).toHaveBeenCalledWith('s1', { schoolId: SCHOOL, actor: 'system', reason: 'retention_purge' });
    expect(report).toEqual({ erased: 1, errors: [] });
  });

  test('a dry run counts without erasing; a failure is reported and the rest go on', async () => {
    const { prisma, students, service } = setup();
    prisma.school_retention_setting.findMany.mockResolvedValue([
      { school_id: SCHOOL, leaver_retention_days: 30, closed_year_retention_years: null, confirmed_at: new Date() },
    ]);
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', first_name: null, last_name: null, left_at: new Date(NOW.getTime() - 40 * DAY) },
      { id: 's2', first_name: null, last_name: null, left_at: new Date(NOW.getTime() - 50 * DAY) },
    ]);
    expect(await service.purge(NOW, { dryRun: true })).toEqual({ erased: 2, errors: [] });
    expect(students.erase).not.toHaveBeenCalled();

    students.erase.mockRejectedValueOnce(new Error('boom'));
    const report = await service.purge(NOW);
    expect(report.erased).toBe(1);
    expect(report.errors).toHaveLength(1);
  });
});

test('changing periods and confirming need student:erase and step-up', () => {
  const p = SchoolRetentionController.prototype;
  for (const handler of [p.update, p.confirm]) {
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe('student:erase');
    expect(Reflect.getMetadata(STEP_UP_KEY, handler)).toBe(true);
  }
  expect(Reflect.getMetadata(STEP_UP_KEY, p.get)).toBeUndefined();
});
