/**
 * The fixed-period purges of personal data (not soft-deleted first):
 * notifications, rostering history and raw attendance coordinates, and the
 * hook into schools' own student-record retention.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createFakeStorage } from '@/test/erasure-mocks';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { RetentionService } from './retention.service';
import {
  attendanceLocationRetentionHours,
  notificationRetentionDays,
  rosterHistoryRetentionDays,
} from './retention.config';

const NOW = new Date('2026-12-10T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ENV = ['NOTIFICATION_RETENTION_DAYS', 'ROSTER_HISTORY_RETENTION_DAYS', 'ATTENDANCE_LOCATION_RETENTION_HOURS'];

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** findMany answers `rows` once, then nothing, so each batch loop ends. */
function once(m: any, rows: unknown[]) {
  m.mockResolvedValueOnce(rows).mockResolvedValue([]);
}

function setup(schools?: { purge: ReturnType<typeof mock> }) {
  const prisma = createMockPrisma();
  const storage = createFakeStorage();
  const erasure = new ErasureLogService(prisma as any, storage as any);
  const replay = { retryStorage: mock(async () => 0) };
  const service = new RetentionService(prisma as any, storage as any, erasure, replay as any, schools as any);
  return { prisma, service, replay };
}

test('defaults: notifications 180 days, roster history 90 days, coordinates 24 hours', () => {
  expect(notificationRetentionDays()).toBe(180);
  expect(rosterHistoryRetentionDays()).toBe(90);
  expect(attendanceLocationRetentionHours()).toBe(24);
});

describe('notifications', () => {
  test('course, file-share and parent-notice rows older than 180 days are deleted', async () => {
    const { prisma, service } = setup();
    once(prisma.course_notification.findMany, [{ id: 'c1' }, { id: 'c2' }]);
    prisma.course_notification.deleteMany.mockResolvedValue({ count: 2 });
    once(prisma.notification.findMany, [{ id: 'f1' }]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    prisma.parent_notification_sent.deleteMany.mockResolvedValue({ count: 4 });

    const report = await service.purge({ now: NOW });
    const cutoff = NOW.getTime() - 180 * DAY;
    expect(prisma.course_notification.findMany.mock.calls[0][0].where.created_at.lt.getTime()).toBe(cutoff);
    expect(prisma.notification.findMany.mock.calls[0][0].where.created_at.lt.getTime()).toBe(cutoff);
    expect(prisma.parent_notification_sent.deleteMany.mock.calls[0][0].where.sent_at.lt.getTime()).toBe(cutoff);
    expect(prisma.course_notification.deleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['c1', 'c2'] } } });
    expect(report.notifications).toBe(7);
    // A fixed-period purge, not an erasure someone asked for: no log entry.
    expect(prisma.erasure_log.create).not.toHaveBeenCalled();
  });

  test('NOTIFICATION_RETENTION_DAYS=0 keeps them', async () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '0';
    const { prisma, service } = setup();
    await service.purge({ now: NOW });
    expect(prisma.course_notification.findMany).not.toHaveBeenCalled();
    expect(prisma.parent_notification_sent.deleteMany).not.toHaveBeenCalled();
  });

  test('a dry run only counts', async () => {
    const { prisma, service } = setup();
    prisma.course_notification.count.mockResolvedValue(3);
    const report = await service.purge({ now: NOW, dryRun: true });
    expect(report.notifications).toBe(3);
    expect(prisma.course_notification.deleteMany).not.toHaveBeenCalled();
  });
});

describe('roster history', () => {
  test('change rows of finished runs go; disabled links lose their email and source record', async () => {
    process.env.ROSTER_HISTORY_RETENTION_DAYS = '30';
    const { prisma, service } = setup();
    once(prisma.roster_change.findMany, [{ id: 'ch1' }]);
    prisma.roster_change.deleteMany.mockResolvedValue({ count: 1 });
    once(prisma.roster_link.findMany, [{ id: 'l1' }]);
    prisma.roster_link.updateMany.mockResolvedValue({ count: 1 });

    const report = await service.purge({ now: NOW });
    const cutoff = NOW.getTime() - 30 * DAY;
    const changeWhere = prisma.roster_change.findMany.mock.calls[0][0].where;
    expect(changeWhere.run.created_at.lt.getTime()).toBe(cutoff);
    // Runs still being planned or applied keep their change set.
    expect(changeWhere.run.status.in).toEqual(['planned', 'applied', 'failed', 'cancelled']);
    expect(prisma.roster_link.findMany.mock.calls[0][0].where.disabled_at.lt.getTime()).toBe(cutoff);
    expect(prisma.roster_link.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['l1'] } },
      data: { email: null, data: {} },
    });
    // A planned run without its change set can no longer be applied.
    expect(prisma.roster_run.updateMany.mock.calls[0][0].data.status).toBe('cancelled');
    expect(report).toMatchObject({ rosterChanges: 1, rosterLinksCleared: 1 });
  });
});

describe('attendance coordinates', () => {
  test('raw coordinates of sessions closed over 24 hours ago are cleared; distance and flags stay', async () => {
    const { prisma, service } = setup();
    once(prisma.course_attendance_record.findMany, [{ id: 'r1' }, { id: 'r2' }]);
    prisma.course_attendance_record.updateMany.mockResolvedValue({ count: 2 });
    prisma.attendance_session.updateMany.mockResolvedValue({ count: 1 });

    const report = await service.purge({ now: NOW });
    const where = prisma.course_attendance_record.findMany.mock.calls[0][0].where;
    expect(where.attendance_session.closed_at.lt.getTime()).toBe(NOW.getTime() - 24 * HOUR);
    expect(prisma.course_attendance_record.updateMany.mock.calls[0][0].data).toEqual({ latitude: null, longitude: null });
    const session = prisma.attendance_session.updateMany.mock.calls[0][0];
    expect(session.data).toEqual({ latitude: null, longitude: null });
    expect(session.where.closed_at.not).toBeNull();
    expect(report).toMatchObject({ attendanceCoordinates: 2, sessionCoordinates: 1 });
  });

  test('ATTENDANCE_LOCATION_RETENTION_HOURS sets the window', async () => {
    process.env.ATTENDANCE_LOCATION_RETENTION_HOURS = '2';
    const { prisma, service } = setup();
    await service.purge({ now: NOW });
    expect(
      prisma.course_attendance_record.findMany.mock.calls[0][0].where.attendance_session.closed_at.lt.getTime(),
    ).toBe(NOW.getTime() - 2 * HOUR);
  });
});

describe('school student-record retention and storage retries', () => {
  test('the school purge runs and its count and errors are reported', async () => {
    const schools = { purge: mock(async () => ({ erased: 2, errors: ['student x: boom'] })) };
    const { service, replay } = setup(schools);
    const report = await service.purge({ now: NOW });
    expect(schools.purge).toHaveBeenCalledTimes(1);
    expect(report.studentRecords).toBe(2);
    expect(report.errors).toContain('student-record retention: student x: boom');
    // Report PDFs of erased records are retried like account objects.
    expect(replay.retryStorage.mock.calls.map((c: any) => c[0])).toEqual(['account', 'student_record']);
  });

  test('--only skips the school purge and the fixed-period purges', async () => {
    const schools = { purge: mock(async () => ({ erased: 0, errors: [] })) };
    const { prisma, service } = setup(schools);
    await service.purge({ now: NOW, only: ['00000000-0000-4000-8000-000000000001'] });
    expect(schools.purge).not.toHaveBeenCalled();
    expect(prisma.course_notification.findMany).not.toHaveBeenCalled();
    expect(prisma.course_attendance_record.updateMany).not.toHaveBeenCalled();
  });
});
