import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { TimetableService } from './timetable.service';

const COURSE = { id: 'c1', school_id: 's1', term_id: null, status: 'published' };

describe('TimetableService', () => {
  let prisma: MockPrisma;
  let role: string;
  let service: TimetableService;

  beforeEach(() => {
    prisma = createMockPrisma();
    role = 'teacher';
    const access = {
      require: mock(async (_u: string, courseId: string, allowed: string[]) => {
        if (courseId !== 'c1') throw new NotFoundException('Course not found');
        if (!allowed.includes(role)) throw new ForbiddenException('nope');
        return { course: COURSE, role };
      }),
    };
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'Europe/London' });
    prisma.bell_period.findMany.mockResolvedValue([
      { id: 'p1', name: 'P1', position: 1, bell_period_time: [{ weekday: 1, start_minute: 540, end_minute: 600 }] },
    ]);
    prisma.room.findMany.mockResolvedValue([
      { id: 'r1', name: 'Lab', latitude: null, longitude: null, radius_m: null },
    ]);
    prisma.timetable_entry.findMany.mockResolvedValue([
      {
        id: 'e1',
        course_id: 'c1',
        period_id: 'p1',
        room_id: 'r1',
        weekday: 1,
        cycle_day: null,
        valid_from: null,
        valid_to: null,
        course: { name: 'Maths', code: null, term: null },
      },
    ]);
    prisma.timetable_entry.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.timetable_entry.create.mockResolvedValue({ id: 'e1' });
    service = new TimetableService(prisma as any, access as any);
  });

  test('a TA can read the timetable but not change it', async () => {
    role = 'ta';
    const t = await service.courseTimetable('u1', 'c1');
    expect(t.canEdit).toBe(false);
    expect(t.entries[0]).toMatchObject({ periodName: 'P1', roomName: 'Lab', weekday: 1 });
    expect(await expectRejection(service.createEntry('u1', 'c1', { periodId: 'p1', weekday: 1 }))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      await expectRejection(service.setOverride('u1', 'c1', 'e1', '2026-11-09', { kind: 'cancel' })),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('another course is a 404', async () => {
    expect(await expectRejection(service.courseTimetable('u1', 'c2'))).toBeInstanceOf(NotFoundException);
  });

  test('entries need a known period and room of the school and one kind of day', async () => {
    const bad = async (dto: object) =>
      expect(await expectRejection(service.createEntry('u1', 'c1', dto as any))).toBeInstanceOf(
        BadRequestException,
      );
    await bad({ periodId: '00000000-0000-0000-0000-000000000000', weekday: 1 });
    await bad({ periodId: 'p1', weekday: 1, roomId: 'other-school-room' });
    await bad({ periodId: 'p1' });
    await bad({ periodId: 'p1', weekday: 1, cycleDay: 1 });
    // The school is weekly: no cycle days.
    await bad({ periodId: 'p1', cycleDay: 1 });
    await bad({ periodId: 'p1', weekday: 1, validFrom: '2026-12-01', validTo: '2026-11-01' });
    await service.createEntry('u1', 'c1', { periodId: 'p1', weekday: 1, roomId: 'r1' });
    expect(prisma.timetable_entry.create).toHaveBeenCalledTimes(1);
  });

  test('cancel or move only a real occurrence that has not opened yet', async () => {
    // Tuesday: entry e1 runs Mondays only.
    expect(
      await expectRejection(service.setOverride('u1', 'c1', 'e1', '2026-11-10', { kind: 'cancel' })),
    ).toBeInstanceOf(NotFoundException);
    prisma.timetable_occurrence.findUnique.mockResolvedValueOnce({ status: 'opened' });
    expect(
      await expectRejection(service.setOverride('u1', 'c1', 'e1', '2026-11-09', { kind: 'cancel' })),
    ).toBeInstanceOf(ConflictException);
    expect(
      await expectRejection(
        service.setOverride('u1', 'c1', 'e1', '2026-11-09', { kind: 'move', startMinute: 700, endMinute: 650 }),
      ),
    ).toBeInstanceOf(BadRequestException);
    await service.setOverride('u1', 'c1', 'e1', '2026-11-09', { kind: 'move', startMinute: 780, endMinute: 840 });
    const call = prisma.timetable_override.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ kind: 'move', moved_start_minute: 780, moved_end_minute: 840 });
    expect(call.create.moved_date.toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  test('settings refuse an unknown time zone and a cycle without a start', async () => {
    expect(await expectRejection(service.updateSettings('u1', 's1', { timeZone: 'Mars/Base' }))).toBeInstanceOf(
      BadRequestException,
    );
    expect(await expectRejection(service.updateSettings('u1', 's1', { cycleLength: 6 }))).toBeInstanceOf(
      BadRequestException,
    );
    await service.updateSettings('u1', 's1', { cycleLength: 6, cycleStartDate: '2026-09-07' });
    expect(prisma.timetable_setting.upsert.mock.calls[0][0].create.cycle_length).toBe(6);
  });

  test('school open weekdays are read and replaced as relational rows', async () => {
    prisma.timetable_school_day.findMany.mockResolvedValue([{ weekday: 1 }, { weekday: 3 }, { weekday: 5 }]);
    expect((await service.context('s1')).settings.schoolDays).toEqual([1, 3, 5]);

    await service.updateSettings('u1', 's1', { schoolDays: [2, 4] });

    expect(prisma.timetable_school_day.deleteMany).toHaveBeenCalledWith({ where: { school_id: 's1' } });
    expect(prisma.timetable_school_day.createMany).toHaveBeenCalledWith({
      data: [
        { school_id: 's1', weekday: 2 },
        { school_id: 's1', weekday: 4 },
      ],
    });
  });

  test('time zone names are validated (IANA only)', async () => {
    for (const tz of ['Mars/Base', '', 'Europe/Londonn', 'GMT+25', 'x'.repeat(65)]) {
      expect(await expectRejection(service.updateSettings('u1', 's1', { timeZone: tz }))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.school.update).not.toHaveBeenCalled();
    await service.updateSettings('u1', 's1', { timeZone: 'America/New_York' });
    expect(prisma.school.update.mock.calls[0][0].data).toEqual({ time_zone: 'America/New_York' });
  });

  test('a school without a time zone: UTC for computing, timeZoneSet false', async () => {
    prisma.school.findUnique.mockResolvedValue({ time_zone: null });
    const ctx = await service.context('s1');
    expect(ctx.settings.timeZone).toBe('UTC');
    expect(ctx.settings.timeZoneSet).toBe(false);
    expect((await service.setup('s1')).settings.timeZoneSet).toBe(false);
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's1' });
    prisma.course_staff.findMany.mockResolvedValue([{ course_id: 'c1' }]);
    const mine = await service.myOccurrences('u1', '2026-11-09', '2026-11-09');
    expect(mine).toMatchObject({ timeZone: 'UTC', timeZoneSet: false });
    // A 09:00 period is placed at 09:00 UTC meanwhile.
    expect(mine.occurrences[0].startsAt).toBe('2026-11-09T09:00:00.000Z');
    const course = await service.courseOccurrences('u1', 'c1', '2026-11-09', '2026-11-09');
    expect(course.timeZoneSet).toBe(false);
    prisma.course_student.findMany.mockResolvedValue([{ course_id: 'c1' }]);
    expect((await service.studentOccurrences('st1', 's1')).timeZoneSet).toBe(false);
  });

  test('turning automatic sessions on is refused until the time zone is set', async () => {
    prisma.school.findUnique.mockResolvedValue({ time_zone: null });
    const err = await expectRejection(service.updateSettings('u1', 's1', { autoSessions: true }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Set your school's time zone before turning on automatic sessions");
    expect(prisma.timetable_setting.upsert).not.toHaveBeenCalled();
    // Turning them off, or other settings, are fine without a zone.
    await service.updateSettings('u1', 's1', { autoSessions: false });
    await service.updateSettings('u1', 's1', { leadMinutes: 5 });
    // Setting the zone in the same request is enough.
    await service.updateSettings('u1', 's1', { timeZone: 'Europe/London', autoSessions: true });
    expect(prisma.timetable_setting.upsert.mock.calls.at(-1)![0].update.auto_sessions).toBe(true);
    // And once it is set, switching them on works.
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'Europe/London' });
    await service.updateSettings('u1', 's1', { autoSessions: true });
  });

  test('a time zone change is audit-logged on the school; an unchanged one is not', async () => {
    const record = mock(async () => undefined);
    const audited = new TimetableService(prisma as any, {} as any, { record } as any);
    prisma.school.findUnique.mockResolvedValue({ time_zone: null });
    await audited.updateSettings('admin-1', 's1', { timeZone: 'Asia/Tokyo' });
    expect(record).toHaveBeenCalledTimes(1);
    const [, schoolId, actor, entry] = record.mock.calls[0] as any;
    expect(schoolId).toBe('s1');
    expect(actor).toEqual({ id: 'admin-1' });
    expect(entry).toMatchObject({
      entity: 'school',
      entityId: 's1',
      action: 'update',
      changes: { time_zone: { before: null, after: 'Asia/Tokyo' } },
    });
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'Asia/Tokyo' });
    await audited.updateSettings('admin-1', 's1', { timeZone: 'Asia/Tokyo' });
    expect(record).toHaveBeenCalledTimes(1);
  });

  test('the migration makes the zone nullable without a default and clears the old UTC default', () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20261122100000_school_time_zone_explicit/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('ALTER TABLE public.school ALTER COLUMN time_zone DROP NOT NULL;');
    expect(sql).toContain('ALTER TABLE public.school ALTER COLUMN time_zone DROP DEFAULT;');
    expect(sql).toContain("UPDATE public.school SET time_zone = NULL WHERE time_zone = 'UTC';");
    // Only the old default is cleared: a real zone is left alone.
    expect(sql).not.toMatch(/UPDATE public\.school SET time_zone = NULL;/);
  });

  test('ranges are validated and capped', async () => {
    const ctx = await service.context('s1');
    expect(() => service.range(ctx, '2026-11-09', '2026-11-01')).toThrow(BadRequestException);
    expect(() => service.range(ctx, '2026-01-01', '2026-06-01')).toThrow(BadRequestException);
    expect(service.range(ctx, '2026-11-09', undefined, 6).to).toBe('2026-11-15');
  });
});
