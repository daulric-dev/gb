import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { AttendanceReportService } from './attendance-report.service';

const rec = (student: string, course: string, status: string, iso: string) => ({
  student_id: student,
  course_id: course,
  status,
  attendance_session: { opened_at: new Date(iso) },
});

describe('AttendanceReportService', () => {
  let prisma: MockPrisma;
  let keys: string[];
  let member: boolean;
  let service: AttendanceReportService;

  beforeEach(() => {
    prisma = createMockPrisma();
    keys = ['attendance-report:read'];
    member = true;
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'America/New_York' });
    prisma.course_attendance_record.findMany.mockResolvedValue([
      rec('s1', 'c1', 'present', '2026-11-02T14:00:00Z'),
      rec('s1', 'c1', 'absent', '2026-11-03T14:00:00Z'),
      rec('s2', 'c1', 'late', '2026-11-02T14:00:00Z'),
      rec('s2', 'c2', 'excused', '2026-11-04T14:00:00Z'),
    ]);
    prisma.course.findMany.mockResolvedValue([
      { id: 'c1', name: 'Maths', code: 'MA' },
      { id: 'c2', name: 'Art', code: null },
    ]);
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', first_name: '=HYPERLINK("x")', last_name: 'Lee', form_tutor_id: 'tutor-1' },
      { id: 's2', first_name: 'Bo', last_name: 'Abe', form_tutor_id: null },
    ]);
    const cache = {
      get: async () => ({ member, role: 'teacher', keys }),
      set: async () => undefined,
    };
    const access = {
      require: async (_u: string, courseId: string) => {
        if (courseId !== 'c1') throw new NotFoundException('Course not found');
        return { course: { id: 'c1', school_id: 'school-1', name: 'Maths', code: 'MA' }, role: 'teacher' };
      },
    };
    service = new AttendanceReportService(prisma as any, cache as any, access as any);
  });

  test('school report: overall, per course and per student percentages', async () => {
    const r = await service.school('admin', '2026-11-01', '2026-11-07');
    expect(r.overall).toEqual({ present: 1, late: 1, absent: 1, excused: 1, rate: 66.7 });
    expect(r.courses.map((c) => [c.name, c.rate, c.students])).toEqual([
      ['Art', null, 1],
      ['Maths', 66.7, 2],
    ]);
    expect(r.students.map((s) => [s.lastName, s.rate])).toEqual([
      ['Abe', 100],
      ['Lee', 50],
    ]);
  });

  test('the range is local days in the school time zone', async () => {
    await service.school('admin', '2026-11-01', '2026-11-07');
    const where = prisma.course_attendance_record.findMany.mock.calls[0][0].where;
    // New York is UTC-4 until 1 Nov 2026 02:00, then UTC-5.
    expect(where.attendance_session.opened_at.gte.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(where.attendance_session.opened_at.lt.toISOString()).toBe('2026-11-08T05:00:00.000Z');
    expect(where.course).toEqual({ school_id: 'school-1', is_template: false });
  });

  test('ranges are validated', async () => {
    for (const [f, t] of [['2026-11-07', '2026-11-01'], ['2025-01-01', '2026-11-01'], ['2026-02-30', undefined]]) {
      expect(await expectRejection(service.school('admin', f, t))).toBeInstanceOf(BadRequestException);
    }
    const d = service.resolveRange('UTC', undefined, undefined, new Date('2026-11-09T12:00:00Z'));
    expect(d).toEqual({ from: '2026-10-13', to: '2026-11-09', timeZone: 'UTC', timeZoneSet: true });
  });

  test('report-card:read alone no longer grants attendance reports; attendance-report:read does', async () => {
    keys = ['report-card:read'];
    expect(await expectRejection(service.school('u'))).toBeInstanceOf(ForbiddenException);
    expect(await expectRejection(service.schoolCsv('u'))).toBeInstanceOf(ForbiddenException);
    prisma.student.findFirst.mockResolvedValue({ id: 's1', first_name: 'A', last_name: 'L', form_tutor_id: 'tutor-1' });
    expect(await expectRejection(service.student('u', 's1'))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(service.studentCsv('u', 's1'))).toBeInstanceOf(NotFoundException);
    expect((await service.scope('u')).canSeeSchool).toBe(false);

    keys = ['attendance-report:read'];
    expect((await service.school('u', '2026-11-01', '2026-11-07')).students).toHaveLength(2);
    expect((await service.schoolCsv('u', '2026-11-01', '2026-11-07')).filename).toContain('attendance-');
    expect((await service.student('u', 's1')).student.id).toBe('s1');
    expect((await service.studentCsv('u', 's1')).csv).toContain('Date,Course,Status');
    expect((await service.scope('u')).canSeeSchool).toBe(true);
  });

  test('a school without a time zone: UTC days, and the response says so', async () => {
    prisma.school.findUnique.mockResolvedValue({ time_zone: null });
    const r = await service.school('admin', '2026-11-01', '2026-11-07');
    expect(r.range).toEqual({ from: '2026-11-01', to: '2026-11-07', timeZone: 'UTC', timeZoneSet: false });
    const where = prisma.course_attendance_record.findMany.mock.calls[0][0].where;
    expect(where.attendance_session.opened_at.gte.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(where.attendance_session.opened_at.lt.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    const course = await service.course('u', 'c1', '2026-11-01', '2026-11-07');
    expect(course.range.timeZoneSet).toBe(false);
    prisma.school.findUnique.mockResolvedValue({ time_zone: 'America/New_York' });
    expect((await service.school('admin', '2026-11-01', '2026-11-07')).range.timeZoneSet).toBe(true);
  });

  test('without attendance-report:read: no school report; a form tutor sees only their tutee', async () => {
    keys = [];
    expect(await expectRejection(service.school('tutor-1'))).toBeInstanceOf(ForbiddenException);
    prisma.student.findFirst.mockResolvedValue({ id: 's1', first_name: 'A', last_name: 'L', form_tutor_id: 'tutor-1' });
    const mine = await service.student('tutor-1', 's1');
    expect(mine.student.id).toBe('s1');
    expect(await expectRejection(service.student('someone-else', 's1'))).toBeInstanceOf(NotFoundException);
    // Another school's student is not found at all.
    prisma.student.findFirst.mockResolvedValue(null);
    keys = ['attendance-report:read'];
    expect(await expectRejection(service.student('admin', 's-other'))).toBeInstanceOf(NotFoundException);
    expect(prisma.student.findFirst.mock.calls.at(-1)![0].where).toEqual({ id: 's-other', school_id: 'school-1' });
  });

  test('a non-member is refused', async () => {
    member = false;
    expect(await expectRejection(service.school('x'))).toBeInstanceOf(ForbiddenException);
  });

  test('course report goes through course access', async () => {
    expect(await expectRejection(service.course('u', 'c9'))).toBeInstanceOf(NotFoundException);
    const r = await service.course('u', 'c1', '2026-11-01', '2026-11-07');
    expect(r.course.name).toBe('Maths');
    expect(prisma.course_attendance_record.findMany.mock.calls.at(-1)![0].where.course_id).toBe('c1');
  });

  test('CSV export defuses formulas', async () => {
    const { csv, filename } = await service.schoolCsv('admin', '2026-11-01', '2026-11-07');
    expect(filename).toBe('attendance-2026-11-01-to-2026-11-07.csv');
    expect(csv.split('\r\n')[0]).toBe('Last name,First name,Present,Late,Absent,Excused,Rate %');
    expect(csv).toContain(`Lee,"'=HYPERLINK(""x"")",1,0,1,0,50`);
  });

  test('the upgrade grants attendance-report:read to every role holding report-card:read', () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20261122110000_attendance_report_permission/migration.sql'),
      'utf8',
    );
    expect(sql).toContain("'attendance-report', 'read', 'attendance-report:read'");
    expect(sql).toMatch(/new_perm\.key = 'attendance-report:read'\s+WHERE old_perm\.key = 'report-card:read'/);
    expect(sql).toContain('ON CONFLICT (school_role_id, permission_id) DO NOTHING');
    // report-card:read itself is kept: it still gates report cards.
    expect(sql).not.toMatch(/DELETE FROM public\.permission_catalog/);
  });
});
