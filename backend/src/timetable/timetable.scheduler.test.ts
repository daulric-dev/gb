import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ConflictException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { TimetableScheduler } from './timetable.scheduler';
import type { SchoolContext, TimetableOccurrence } from './timetable.service';

const NOW = new Date('2026-11-09T09:02:00Z'); // Monday, London (GMT)

const occurrence = (over: Partial<TimetableOccurrence> = {}): TimetableOccurrence => ({
  entryId: 'e1',
  courseId: 'c1',
  courseName: 'Maths',
  courseCode: null,
  periodId: 'p1',
  periodName: 'Period 1',
  occursOn: '2026-11-09',
  date: '2026-11-09',
  startMinute: 540,
  endMinute: 600,
  startsAt: '2026-11-09T09:00:00.000Z',
  endsAt: '2026-11-09T10:00:00.000Z',
  roomId: 'r1',
  roomName: 'Lab',
  status: 'scheduled',
  note: null,
  cycleDay: null,
  ...over,
});

describe('TimetableScheduler', () => {
  let prisma: MockPrisma;
  let attendance: { openScheduled: ReturnType<typeof mock> };
  let timetable: { context: ReturnType<typeof mock>; occurrencesFor: ReturnType<typeof mock> };
  let features: { isEnabled: ReturnType<typeof mock> };
  let scheduler: TimetableScheduler;
  let ctx: SchoolContext;
  let occurrences: TimetableOccurrence[];
  let claimed: Set<string>;

  beforeEach(() => {
    prisma = createMockPrisma();
    claimed = new Set();
    prisma.$queryRaw.mockResolvedValue([{ locked: true }]);
    prisma.course.findMany.mockResolvedValue([{ id: 'c1', school_id: 's1' }]);
    // The unique (entry, date) claim: only the first insert returns a row.
    prisma.timetable_occurrence.createManyAndReturn.mockImplementation(async ({ data }: any) => {
      const key = `${data[0].entry_id}|${data[0].occurs_on.toISOString()}`;
      if (claimed.has(key)) return [];
      claimed.add(key);
      return [{ entry_id: data[0].entry_id }];
    });
    ctx = {
      schoolId: 's1',
      settings: {
        timeZone: 'Europe/London',
        timeZoneSet: true,
        cycleLength: null,
        cycleStartDate: null,
        schoolDays: [1, 2, 3, 4, 5],
        autoSessions: true,
        leadMinutes: 5,
        lateAfterMinutes: 10,
        requireCode: true,
      },
      closures: [],
      periods: new Map(),
      rooms: new Map([
        ['r1', { id: 'r1', name: 'Lab', location: { latitude: 51.5, longitude: -0.12, radiusM: 40 } }],
        ['r2', { id: 'r2', name: 'Hall', location: null }],
      ]),
    };
    occurrences = [occurrence()];
    timetable = {
      context: mock(async () => ctx),
      occurrencesFor: mock(async () => occurrences),
    };
    attendance = { openScheduled: mock(async () => ({ id: 'sess-1' })) };
    features = { isEnabled: mock(async () => true) };
    scheduler = new TimetableScheduler(prisma as any, features as any, timetable as any, attendance as any);
  });

  test('opens a session with the room location, closing at the period end', async () => {
    const r = await scheduler.tick(NOW);
    expect(r).toEqual({ opened: 1, skipped: 0 });
    const [courseId, input] = attendance.openScheduled.mock.calls[0];
    expect(courseId).toBe('c1');
    expect(input.location).toEqual({ latitude: 51.5, longitude: -0.12, radiusM: 40 });
    expect(input.closesAt.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(input.requireCode).toBe(true);
    expect(input.title).toBe('Period 1 · Lab');
    // Late 10 min after the period start (09:10), opened at 09:02 → 8 min.
    expect(input.lateAfterMinutes).toBe(8);
    expect(prisma.timetable_occurrence.updateMany.mock.calls[0][0].data).toEqual({ session_id: 'sess-1' });
  });

  test('a room without a saved location opens without a geofence', async () => {
    occurrences = [occurrence({ roomId: 'r2' })];
    await scheduler.tick(NOW);
    expect(attendance.openScheduled.mock.calls[0][1].location).toBeNull();
  });

  test('idempotent: a second tick (or instance) does not open it again', async () => {
    await scheduler.tick(NOW);
    await scheduler.tick(new Date(NOW.getTime() + 60_000));
    expect(attendance.openScheduled).toHaveBeenCalledTimes(1);
  });

  test('not before the lead time, not after the end, never when cancelled', async () => {
    await scheduler.tick(new Date('2026-11-09T08:54:00Z'));
    await scheduler.tick(new Date('2026-11-09T10:00:00Z'));
    occurrences = [occurrence({ status: 'cancelled' })];
    await scheduler.tick(NOW);
    expect(attendance.openScheduled).not.toHaveBeenCalled();
    occurrences = [occurrence()];
    await scheduler.tick(new Date('2026-11-09T08:55:00Z')); // exactly lead time
    expect(attendance.openScheduled).toHaveBeenCalledTimes(1);
  });

  test('a session already open (or an unpublished course) marks the occurrence skipped', async () => {
    attendance.openScheduled.mockImplementation(async () => {
      throw new ConflictException('Attendance is already open in this course');
    });
    const r = await scheduler.tick(NOW);
    expect(r).toEqual({ opened: 0, skipped: 1 });
    expect(prisma.timetable_occurrence.updateMany.mock.calls[0][0].data).toEqual({
      status: 'skipped',
      reason: 'Attendance is already open in this course',
    });
    await scheduler.tick(NOW);
    expect(attendance.openScheduled).toHaveBeenCalledTimes(1);
  });

  test('nothing with the feature off, automatic sessions off, or without the lock', async () => {
    features.isEnabled.mockResolvedValue(false);
    await scheduler.tick(NOW);
    features.isEnabled.mockResolvedValue(true);
    ctx.settings.autoSessions = false;
    await scheduler.tick(NOW);
    ctx.settings.autoSessions = true;
    prisma.$queryRaw.mockResolvedValue([{ locked: false }]);
    await scheduler.tick(NOW);
    expect(attendance.openScheduled).not.toHaveBeenCalled();
    expect(features.isEnabled.mock.calls[0]).toEqual(['s1', 'timetable']);
  });

  test('a school without a time zone is skipped, and logged once per boot', async () => {
    ctx.settings.timeZone = 'UTC';
    ctx.settings.timeZoneSet = false;
    const warn = mock(() => undefined);
    (scheduler as any).logger.warn = warn;
    await scheduler.tick(NOW);
    await scheduler.tick(new Date(NOW.getTime() + 60_000));
    await scheduler.tick(new Date(NOW.getTime() + 120_000));
    expect(attendance.openScheduled).not.toHaveBeenCalled();
    expect(timetable.occurrencesFor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String((warn.mock.calls[0] as unknown[])[0])).toContain('s1');

    // Once an admin sets the zone, the next tick opens the period.
    ctx.settings.timeZone = 'Europe/London';
    ctx.settings.timeZoneSet = true;
    expect(await scheduler.tick(NOW)).toEqual({ opened: 1, skipped: 0 });
  });
});
