import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate } from '@/common/db-values';
import { userSchoolId } from '@/common/user-school';
import { roundScore } from '@/grading/round';

/** One dated piece of work on a calendar. */
export interface CalendarItem {
  activityId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  title: string;
  kind: 'quiz' | 'assignment' | 'offline';
  /** Staff calendars include drafts; a student's only published and closed. */
  status: 'draft' | 'published' | 'closed';
  points: number;
  dueAt: string;
}

/** A student's own state on the item; null until they start it. */
export interface StudentCalendarItem extends CalendarItem {
  submission: {
    status: 'draft' | 'submitted' | 'graded';
    /** Only once graded, as on the to-do list. */
    score: number | null;
    excused: boolean;
    submittedAt: string | null;
  } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A calendar reads at most about a year at a time. */
const MAX_RANGE_DAYS = 400;
/** Without a `to`: six weeks, enough for any month grid. */
const DEFAULT_RANGE_DAYS = 42;

const ITEM_SELECT = {
  id: true,
  course_id: true,
  title: true,
  kind: true,
  status: true,
  points: true,
  due_at: true,
} as const;

/**
 * Due dates across a person's courses.
 *
 * Staff see every activity with a due date in the courses they teach or
 * assist (drafts too, so they can plan); students see published and closed
 * work in the published courses they are enrolled in, with their own
 * submission state. Undated work has no place on a calendar and is left out.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve and check the window; defaults to six weeks from today. */
  range(from?: string, to?: string): { from: Date; to: Date } {
    const start = from ? new Date(from) : startOfTodayUtc();
    const end = to
      ? new Date(to)
      : new Date(start.getTime() + DEFAULT_RANGE_DAYS * DAY_MS);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (end <= start) {
      throw new BadRequestException('`to` must be after `from`');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `A calendar range can span at most ${MAX_RANGE_DAYS} days`,
      );
    }
    return { from: start, to: end };
  }

  /** Activities due in the window across the courses the caller staffs. */
  async forStaff(
    userId: string,
    from?: string,
    to?: string,
  ): Promise<CalendarItem[]> {
    const window = this.range(from, to);

    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) return [];

    const staffRows = await this.prisma.course_staff.findMany({
      where: { user_profile_id: userId },
      select: { course_id: true },
    });
    if (staffRows.length === 0) return [];

    // The current school only, and not archived: a closed course has
    // nothing left to plan.
    const courses = await this.prisma.course.findMany({
      where: {
        id: { in: staffRows.map((r) => r.course_id) },
        school_id: schoolId,
        status: { in: ['draft', 'published'] },
      },
      select: { id: true, name: true, code: true },
    });

    return this.items(courses, window, ['draft', 'published', 'closed']);
  }

  /** Published work due in the window across the student's courses. */
  async forStudent(
    studentId: string,
    from?: string,
    to?: string,
  ): Promise<StudentCalendarItem[]> {
    const window = this.range(from, to);

    const enrolments = await this.prisma.course_student.findMany({
      where: { student_id: studentId, status: { in: ['active', 'completed'] } },
      select: { course_id: true },
    });
    if (enrolments.length === 0) return [];

    const courses = await this.prisma.course.findMany({
      where: {
        id: { in: enrolments.map((e) => e.course_id) },
        status: 'published',
      },
      select: { id: true, name: true, code: true },
    });

    const items = await this.items(courses, window, ['published', 'closed']);
    if (items.length === 0) return [];

    const submissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
        activity_id: { in: items.map((i) => i.activityId) },
      },
      select: {
        activity_id: true,
        status: true,
        score: true,
        excused: true,
        submitted_at: true,
      },
    });
    const byActivity = new Map(submissions.map((s) => [s.activity_id, s]));

    return items.map((item) => {
      const s = byActivity.get(item.activityId);
      return {
        ...item,
        submission: s
          ? {
              status: s.status,
              score:
                s.status === 'graded' && s.score !== null
                  ? roundScore(Number(s.score))
                  : null,
              excused: !!s.excused,
              submittedAt: isoDate(s.submitted_at),
            }
          : null,
      };
    });
  }

  private async items(
    courses: { id: string; name: string; code: string | null }[],
    window: { from: Date; to: Date },
    statuses: CalendarItem['status'][],
  ): Promise<CalendarItem[]> {
    if (courses.length === 0) return [];
    const byId = new Map(courses.map((c) => [c.id, c]));

    const rows = await this.prisma.activity.findMany({
      where: {
        course_id: { in: [...byId.keys()] },
        status: { in: statuses },
        due_at: { gte: window.from, lt: window.to },
      },
      select: ITEM_SELECT,
      orderBy: [{ due_at: 'asc' }, { title: 'asc' }],
    });

    return rows.map((a) => {
      const course = byId.get(a.course_id)!;
      return {
        activityId: a.id,
        courseId: a.course_id,
        courseName: course.name,
        courseCode: course.code,
        title: a.title,
        kind: a.kind,
        status: a.status,
        points: Number(a.points),
        dueAt: isoDate(a.due_at)!,
      };
    });
  }
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Escape a value for an iCalendar TEXT property (RFC 5545 3.3.11). */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** A UTC timestamp in iCalendar's basic format, e.g. 20261023T120000Z. */
function icsDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold lines longer than 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * Calendar items as an .ics file: one zero-length event at each due time,
 * stable UIDs so re-importing updates rather than duplicates.
 */
export function toIcs(items: CalendarItem[], name: string): string {
  const stamp = icsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GradeBook//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  for (const item of items) {
    const due = icsDate(item.dueAt);
    lines.push(
      'BEGIN:VEVENT',
      `UID:activity-${item.activityId}@gradebook`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${due}`,
      `DTEND:${due}`,
      `SUMMARY:${icsText(`${item.title} (${item.courseName})`)}`,
      `DESCRIPTION:${icsText(`${item.kind} - ${item.points} points`)}`,
      `CATEGORIES:${icsText(item.courseName)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
