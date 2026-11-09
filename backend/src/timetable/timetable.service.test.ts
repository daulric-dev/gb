import { beforeEach, describe, expect, mock, test } from 'bun:test';
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

  test('ranges are validated and capped', async () => {
    const ctx = await service.context('s1');
    expect(() => service.range(ctx, '2026-11-09', '2026-11-01')).toThrow(BadRequestException);
    expect(() => service.range(ctx, '2026-01-01', '2026-06-01')).toThrow(BadRequestException);
    expect(service.range(ctx, '2026-11-09', undefined, 6).to).toBe('2026-11-15');
  });
});
