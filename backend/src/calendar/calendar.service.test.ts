import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { CalendarService, toIcs } from './calendar.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

const COURSE = { id: 'course-1', name: 'Biology 101', code: 'BIO' };

function activity(over: Record<string, any> = {}) {
  return {
    id: 'act-1',
    course_id: 'course-1',
    title: 'Lab report',
    kind: 'assignment',
    status: 'published',
    points: 10,
    due_at: new Date('2026-10-30T15:00:00Z'),
    ...over,
  };
}

describe('CalendarService.range', () => {
  const service = new CalendarService(createMockPrisma() as any);

  test('defaults to six weeks', () => {
    const { from, to } = service.range('2026-10-01');
    expect(to.getTime() - from.getTime()).toBe(42 * 24 * 60 * 60 * 1000);
  });

  test('rejects a backwards or oversized window', () => {
    expect(() => service.range('2026-10-02', '2026-10-01')).toThrow(
      BadRequestException,
    );
    expect(() => service.range('2026-01-01', '2028-01-01')).toThrow(
      BadRequestException,
    );
  });
});

describe('CalendarService.forStaff', () => {
  test('courses the caller staffs in their school, drafts included', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.course_staff.findMany.mockResolvedValue([{ course_id: 'course-1' }]);
    prisma.course.findMany.mockResolvedValue([COURSE]);
    prisma.activity.findMany.mockResolvedValue([activity({ status: 'draft' })]);

    const items = await new CalendarService(prisma as any).forStaff(
      'u-1',
      '2026-10-01',
      '2026-11-01',
    );

    const courseWhere = prisma.course.findMany.mock.calls[0][0].where;
    expect(courseWhere).toEqual({
      id: { in: ['course-1'] },
      school_id: 'school-1',
      status: { in: ['draft', 'published'] },
    });
    const actWhere = prisma.activity.findMany.mock.calls[0][0].where;
    expect(actWhere.status).toEqual({ in: ['draft', 'published', 'closed'] });
    expect(actWhere.due_at).toEqual({
      gte: new Date('2026-10-01'),
      lt: new Date('2026-11-01'),
    });
    expect(items).toEqual([
      {
        activityId: 'act-1',
        courseId: 'course-1',
        courseName: 'Biology 101',
        courseCode: 'BIO',
        title: 'Lab report',
        kind: 'assignment',
        status: 'draft',
        points: 10,
        dueAt: '2026-10-30T15:00:00.000Z',
      },
    ]);
  });

  test('no school or no courses is an empty calendar', async () => {
    const prisma = createMockPrisma();
    const service = new CalendarService(prisma as any);
    expect(await service.forStaff('u-1')).toEqual([]);
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    expect(await service.forStaff('u-1')).toEqual([]);
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });
});

describe('CalendarService.forStudent', () => {
  test('published work in published courses, with the student’s state', async () => {
    const prisma = createMockPrisma();
    prisma.course_student.findMany.mockResolvedValue([{ course_id: 'course-1' }]);
    prisma.course.findMany.mockResolvedValue([COURSE]);
    prisma.activity.findMany.mockResolvedValue([
      activity(),
      activity({ id: 'act-2', title: 'Quiz', kind: 'quiz' }),
    ]);
    prisma.submission.findMany.mockResolvedValue([
      {
        activity_id: 'act-1',
        status: 'submitted',
        score: 9,
        excused: false,
        submitted_at: new Date('2026-10-29T09:00:00Z'),
      },
    ]);

    const items = await new CalendarService(prisma as any).forStudent(
      'student-1',
      '2026-10-01',
      '2026-11-01',
    );

    expect(prisma.course_student.findMany.mock.calls[0][0].where).toEqual({
      student_id: 'student-1',
      status: { in: ['active', 'completed'] },
    });
    expect(prisma.course.findMany.mock.calls[0][0].where.status).toBe(
      'published',
    );
    expect(prisma.activity.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['published', 'closed'],
    });
    expect(prisma.submission.findMany.mock.calls[0][0].where.student_id).toBe(
      'student-1',
    );
    // A score is only shown once graded.
    expect(items[0].submission).toEqual({
      status: 'submitted',
      score: null,
      excused: false,
      submittedAt: '2026-10-29T09:00:00.000Z',
    });
    expect(items[1].submission).toBeNull();
  });

  test('a bad range is a 400 before any query', async () => {
    const prisma = createMockPrisma();
    const err = await expectRejection(
      new CalendarService(prisma as any).forStudent('s', 'not-a-date'),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.course_student.findMany).not.toHaveBeenCalled();
  });
});

describe('toIcs', () => {
  test('one escaped event per item', () => {
    const ics = toIcs(
      [
        {
          activityId: 'act-1',
          courseId: 'course-1',
          courseName: 'Bio, Year 1',
          courseCode: null,
          title: 'Lab; report',
          kind: 'assignment',
          status: 'published',
          points: 10,
          dueAt: '2026-10-30T15:00:00.000Z',
        },
      ],
      'My due dates',
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:activity-act-1@gradebook');
    expect(ics).toContain('DTSTART:20261030T150000Z');
    expect(ics).toContain('SUMMARY:Lab\\; report (Bio\\, Year 1)');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});
