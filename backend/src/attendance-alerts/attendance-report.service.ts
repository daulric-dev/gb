import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { userSchoolId } from '@/common/user-school';
import {
  addDays,
  daysBetween,
  isIsoDate,
  localParts,
  safeTimeZone,
  zonedToUtc,
} from '@/common/time-zone';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { CourseAccessService, STAFF_ROLES } from '@/course/access/course-access.service';
import { csvCell } from '@/grading/gradebook.service';
import type { AttendanceStatus } from '@/attendance/attendance.types';
import { tally, type AttendanceTally } from './rates';

/** Default report range: the last four weeks, today included. */
export const DEFAULT_RANGE_DAYS = 28;
export const MAX_RANGE_DAYS = 400;

/** The school-wide power that sees every student's attendance report. */
export const REPORT_PERMISSION = 'report-card:read';

export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

interface Rec {
  student_id: string;
  course_id: string;
  status: AttendanceStatus;
  attendance_session: { opened_at: Date };
}

export interface StudentRow extends AttendanceTally {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  formTutorId: string | null;
  openAlerts: string[];
}

export interface CourseRow extends AttendanceTally {
  courseId: string;
  name: string;
  code: string | null;
  students: number;
}

const byName = (
  a: { lastName: string | null; firstName: string | null },
  b: { lastName: string | null; firstName: string | null },
) =>
  `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(`${b.lastName ?? ''} ${b.firstName ?? ''}`);

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

const STATUS_WORD: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

function toCsv(lines: string[][]): string {
  return lines.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const tallyCells = (t: AttendanceTally) => [
  String(t.present),
  String(t.late),
  String(t.absent),
  String(t.excused),
  t.rate === null ? '' : String(t.rate),
];
const TALLY_HEAD = ['Present', 'Late', 'Absent', 'Excused', 'Rate %'];

/**
 * Attendance percentages over a date range for the school, a course or a
 * student, and their CSV exports. Dates are local days in the school's time
 * zone; a session counts on the day it opened.
 *
 * Who sees what: the school report and any student's report need
 * `report-card:read` in the active school (admins by default); a form tutor
 * sees their own tutees' reports; a course report is for the course's staff.
 */
@Injectable()
export class AttendanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
  ) {}

  /** The caller's school and whether they see every student. */
  async scope(userId: string): Promise<{ schoolId: string; canSeeSchool: boolean }> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    const eff = await loadEffectivePermissions(this.prisma, this.cache, userId, schoolId);
    if (!eff.member) throw new ForbiddenException('You are not a member of this school');
    return { schoolId, canSeeSchool: eff.keys.includes(REPORT_PERMISSION) };
  }

  async timeZoneOf(schoolId: string): Promise<string> {
    const s = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { time_zone: true },
    });
    return safeTimeZone(s?.time_zone);
  }

  /** Validate a range of local days; default the last four weeks. */
  resolveRange(timeZone: string, from?: string, to?: string, now = new Date()): ReportRange {
    for (const d of [from, to]) {
      if (d !== undefined && !isIsoDate(d)) throw new BadRequestException('Use real dates (YYYY-MM-DD)');
    }
    const t = to ?? localParts(now, timeZone).date;
    const f = from ?? addDays(t, -(DEFAULT_RANGE_DAYS - 1));
    const span = daysBetween(f, t);
    if (span < 0) throw new BadRequestException('`to` is before `from`');
    if (span >= MAX_RANGE_DAYS) {
      throw new BadRequestException(`A report can cover at most ${MAX_RANGE_DAYS} days`);
    }
    return { from: f, to: t, timeZone };
  }

  /** [start, end) instants of a range. */
  instants(r: ReportRange) {
    return {
      start: zonedToUtc(r.from, 0, r.timeZone),
      end: zonedToUtc(addDays(r.to, 1), 0, r.timeZone),
    };
  }

  private async records(
    schoolId: string,
    r: ReportRange,
    filter: { courseId?: string; studentId?: string } = {},
  ): Promise<Rec[]> {
    const { start, end } = this.instants(r);
    return this.prisma.course_attendance_record.findMany({
      where: {
        course: { school_id: schoolId, is_template: false },
        ...(filter.courseId ? { course_id: filter.courseId } : {}),
        ...(filter.studentId ? { student_id: filter.studentId } : {}),
        attendance_session: { opened_at: { gte: start, lt: end } },
      },
      select: {
        student_id: true,
        course_id: true,
        status: true,
        attendance_session: { select: { opened_at: true } },
      },
    });
  }

  private async studentRows(schoolId: string, recs: Rec[]): Promise<StudentRow[]> {
    const byStudent = group(recs, (r) => r.student_id);
    const ids = [...byStudent.keys()];
    if (ids.length === 0) return [];
    const [students, alerts] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: ids }, school_id: schoolId },
        select: { id: true, first_name: true, last_name: true, form_tutor_id: true },
      }),
      this.prisma.attendance_alert.findMany({
        where: { school_id: schoolId, student_id: { in: ids }, resolved_at: null },
        select: { student_id: true, kind: true },
      }),
    ]);
    const alertKinds = group(alerts, (a) => a.student_id);
    return students
      .map((s) => ({
        studentId: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        formTutorId: s.form_tutor_id,
        openAlerts: (alertKinds.get(s.id) ?? []).map((a) => a.kind),
        ...tally(byStudent.get(s.id) ?? []),
      }))
      .sort(byName);
  }

  // ── school ───────────────────────────────────────────────────────────────

  async school(userId: string, from?: string, to?: string) {
    const { schoolId, canSeeSchool } = await this.scope(userId);
    if (!canSeeSchool) throw new ForbiddenException('You cannot see the school attendance report');
    const range = this.resolveRange(await this.timeZoneOf(schoolId), from, to);
    const recs = await this.records(schoolId, range);

    const byCourse = group(recs, (r) => r.course_id);
    const courses = byCourse.size
      ? await this.prisma.course.findMany({
          where: { id: { in: [...byCourse.keys()] } },
          select: { id: true, name: true, code: true },
        })
      : [];
    return {
      range,
      overall: tally(recs),
      sessions: new Set(recs.map((r) => `${r.course_id}|${r.attendance_session.opened_at.getTime()}`)).size,
      courses: courses
        .map(
          (c): CourseRow => ({
            courseId: c.id,
            name: c.name,
            code: c.code,
            students: new Set((byCourse.get(c.id) ?? []).map((r) => r.student_id)).size,
            ...tally(byCourse.get(c.id) ?? []),
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
      students: await this.studentRows(schoolId, recs),
    };
  }

  async schoolCsv(userId: string, from?: string, to?: string) {
    const r = await this.school(userId, from, to);
    const lines = [
      ['Last name', 'First name', ...TALLY_HEAD],
      ...r.students.map((s) => [s.lastName ?? '', s.firstName ?? '', ...tallyCells(s)]),
    ];
    return { csv: toCsv(lines), filename: `attendance-${r.range.from}-to-${r.range.to}.csv` };
  }

  // ── course ───────────────────────────────────────────────────────────────

  async course(userId: string, courseId: string, from?: string, to?: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const range = this.resolveRange(await this.timeZoneOf(course.school_id), from, to);
    const recs = await this.records(course.school_id, range, { courseId });
    return {
      range,
      course: { id: course.id, name: course.name, code: course.code },
      overall: tally(recs),
      sessions: new Set(recs.map((r) => r.attendance_session.opened_at.getTime())).size,
      students: await this.studentRows(course.school_id, recs),
    };
  }

  async courseCsv(userId: string, courseId: string, from?: string, to?: string) {
    const r = await this.course(userId, courseId, from, to);
    const lines = [
      ['Last name', 'First name', ...TALLY_HEAD],
      ...r.students.map((s) => [s.lastName ?? '', s.firstName ?? '', ...tallyCells(s)]),
    ];
    const base =
      (r.course.code || r.course.name || 'course').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ||
      'course';
    return { csv: toCsv(lines), filename: `${base}-attendance-${r.range.from}-to-${r.range.to}.csv` };
  }

  // ── student ──────────────────────────────────────────────────────────────

  async student(userId: string, studentId: string, from?: string, to?: string) {
    const { schoolId, canSeeSchool } = await this.scope(userId);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, school_id: schoolId },
      select: { id: true, first_name: true, last_name: true, form_tutor_id: true },
    });
    // Another school's student, or one the caller may not see, is a 404.
    if (!student || (!canSeeSchool && student.form_tutor_id !== userId)) {
      throw new NotFoundException('Student not found');
    }
    const range = this.resolveRange(await this.timeZoneOf(schoolId), from, to);
    const recs = await this.records(schoolId, range, { studentId });
    const byCourse = group(recs, (r) => r.course_id);
    const [courses, alerts] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: [...byCourse.keys()] } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.attendance_alert.findMany({
        where: { student_id: studentId, school_id: schoolId },
        orderBy: { opened_at: 'desc' },
        take: 20,
        select: {
          id: true,
          kind: true,
          value: true,
          threshold: true,
          window_days: true,
          opened_at: true,
          resolved_at: true,
        },
      }),
    ]);
    const name = new Map(courses.map((c) => [c.id, c]));
    return {
      range,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        formTutorId: student.form_tutor_id,
      },
      overall: tally(recs),
      courses: courses
        .map((c) => ({ courseId: c.id, name: c.name, code: c.code, ...tally(byCourse.get(c.id) ?? []) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      records: recs
        .map((r) => ({
          courseId: r.course_id,
          courseName: name.get(r.course_id)?.name ?? '',
          status: r.status,
          openedAt: r.attendance_session.opened_at.toISOString(),
        }))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
      alerts: alerts.map((a) => ({
        id: a.id,
        kind: a.kind,
        value: a.value,
        threshold: a.threshold,
        windowDays: a.window_days,
        openedAt: a.opened_at.toISOString(),
        resolvedAt: a.resolved_at?.toISOString() ?? null,
      })),
    };
  }

  async studentCsv(userId: string, studentId: string, from?: string, to?: string) {
    const r = await this.student(userId, studentId, from, to);
    const lines = [
      ['Date', 'Course', 'Status'],
      ...r.records.map((x) => [
        localParts(new Date(x.openedAt), r.range.timeZone).date,
        x.courseName,
        STATUS_WORD[x.status],
      ]),
      [],
      ['Course', ...TALLY_HEAD],
      ...r.courses.map((c) => [c.name, ...tallyCells(c)]),
      ['All courses', ...tallyCells(r.overall)],
    ];
    const who =
      [r.student.lastName, r.student.firstName].filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '-') ||
      'student';
    return { csv: toCsv(lines), filename: `${who}-attendance-${r.range.from}-to-${r.range.to}.csv` };
  }
}
