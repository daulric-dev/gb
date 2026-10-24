import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { isoDate, isUniqueViolation } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';
import {
  CourseAccessService,
  CourseRow,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { csvCell } from '@/grading/gradebook.service';
import { PushService } from '@/notifications/push.service';
import { AttendanceRealtime } from './attendance.realtime';
import { withinGeofence } from './geo';
import {
  newQrSecret,
  QR_WINDOW_MS,
  qrClaim,
  qrToken,
  qrWindow,
  verifyQrClaim,
  verifyQrToken,
} from './qr';
import { primaryOrigin } from '@/config/origins';
import type {
  AttendanceCounts,
  AttendanceCourseSummary,
  AttendanceMethod,
  AttendanceRosterEntry,
  AttendanceSession,
  AttendanceSessionDetail,
  AttendanceStatus,
  AttendanceTally,
  PortalCourseAttendance,
  PortalOpenAttendance,
} from './attendance.types';

const SESSION_SELECT = {
  id: true,
  course_id: true,
  title: true,
  opened_by: true,
  opened_at: true,
  closes_at: true,
  closed_at: true,
  check_in_code: true,
  late_after_minutes: true,
  latitude: true,
  longitude: true,
  radius_m: true,
} as const;
const RECORD_SELECT = {
  session_id: true,
  student_id: true,
  status: true,
  method: true,
  checked_in_at: true,
  distance_m: true,
  note: true,
} as const;
const STUDENT_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  user_profile_id: true,
} as const;

const DEFAULT_DURATION_MINUTES = 5;
const DEFAULT_RADIUS_M = 100;
const SWEEP_INTERVAL_MS = 30_000;
/** Wrong codes allowed per student per session before check-in is refused. */
export const MAX_WRONG_CODES = 5;
/** The wrong-code counter outlives the session by this much (seconds). */
const WRONG_CODE_TTL_MARGIN_S = 10 * 60;

export interface SessionRow {
  id: string;
  course_id: string;
  title: string | null;
  opened_by: string | null;
  opened_at: string;
  closes_at: string;
  closed_at: string | null;
  check_in_code: string | null;
  late_after_minutes: number | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
}

interface RecordRow {
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  checked_in_at: string | null;
  distance_m: number | null;
  note: string | null;
}

/**
 * Sessions and records are handled with ISO-string timestamps, as the API
 * has always sent them; the database rows carry Dates.
 */
type SessionDbRow = Omit<SessionRow, 'opened_at' | 'closes_at' | 'closed_at'> & {
  opened_at: Date;
  closes_at: Date;
  closed_at: Date | null;
};

const toSessionRow = (r: SessionDbRow): SessionRow => ({
  ...r,
  opened_at: r.opened_at.toISOString(),
  closes_at: r.closes_at.toISOString(),
  closed_at: isoDate(r.closed_at),
});

type RecordDbRow = Omit<RecordRow, 'checked_in_at'> & {
  checked_in_at: Date | null;
};

const toRecordRow = (r: RecordDbRow): RecordRow => ({
  ...r,
  checked_in_at: isoDate(r.checked_in_at),
});

interface StudentRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  user_profile_id: string | null;
}

export interface OpenAttendanceInput {
  durationMinutes?: number;
  requireCode?: boolean;
  lateAfterMinutes?: number | null;
  title?: string | null;
  location?: { latitude: number; longitude: number; radiusM?: number } | null;
}

export interface CheckInInput {
  code?: string;
  /** From a scanned QR frame; stands in for the room code. */
  qrToken?: string;
  /** A claim the scan page got for a QR token before the student signed in. */
  qrClaim?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  } | null;
}

const isOpen = (s: SessionRow, now = Date.now()) =>
  !s.closed_at && Date.parse(s.closes_at) > now;

const isExpired = (s: SessionRow, now = Date.now()) =>
  !s.closed_at && Date.parse(s.closes_at) <= now;

const byName = (
  a: { lastName: string | null; firstName: string | null },
  b: { lastName: string | null; firstName: string | null },
) =>
  `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(
    `${b.lastName ?? ''} ${b.firstName ?? ''}`,
  );

/** Present-or-late over every session that counted, as a 0-100 percent. */
export function tally(records: { status: AttendanceStatus }[]): AttendanceTally {
  const t = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const r of records) t[r.status]++;
  const counted = records.length - t.excused;
  return {
    ...t,
    rate:
      counted > 0
        ? Math.round(((t.present + t.late) / counted) * 1000) / 10
        : null,
  };
}

/**
 * Course attendance: a teacher opens a short session, students check
 * themselves in with the code shown in the room (and from close enough, when
 * asked), and whoever has not when it closes is marked absent.
 *
 * Finalising is idempotent and happens three ways: the teacher closes early,
 * the background sweep finds an expired session, or any read of an expired
 * session notices it first.
 */
@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceService.name);
  private sweepTimer?: ReturnType<typeof setInterval>;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly push: PushService,
    private readonly realtime: AttendanceRealtime,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  // ── loading ───────────────────────────────────────────────────────────────

  private async loadSession(
    courseId: string,
    sessionId: string,
  ): Promise<SessionRow> {
    const data = await this.prisma.attendance_session.findFirst({
      where: { id: sessionId, course_id: courseId },
      select: SESSION_SELECT,
    });
    if (!data) throw new NotFoundException('Attendance session not found');
    return toSessionRow(data);
  }

  private async findSession(sessionId: string): Promise<SessionRow | null> {
    const data = await this.prisma.attendance_session.findUnique({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
    return data ? toSessionRow(data) : null;
  }

  private async students(ids: string[]): Promise<StudentRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.student.findMany({
      where: { id: { in: ids } },
      select: STUDENT_SELECT,
    });
  }

  /** Students actively enrolled in the course right now. */
  private async activeStudents(courseId: string): Promise<StudentRow[]> {
    const rows = await this.prisma.course_student.findMany({
      where: { course_id: courseId, status: 'active' },
      select: { student_id: true },
    });
    return this.students(rows.map((r) => r.student_id));
  }

  private async recordsFor(sessionIds: string[]): Promise<RecordRow[]> {
    if (sessionIds.length === 0) return [];
    const rows = await this.prisma.course_attendance_record.findMany({
      where: { session_id: { in: sessionIds } },
      select: RECORD_SELECT,
    });
    return rows.map(toRecordRow);
  }

  // ── shaping ───────────────────────────────────────────────────────────────

  private counts(
    session: SessionRow,
    records: RecordRow[],
    activeIds: string[],
  ): AttendanceCounts {
    const c: AttendanceCounts = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      pending: 0,
    };
    const seen = new Set<string>();
    for (const r of records) {
      c[r.status]++;
      seen.add(r.student_id);
    }
    // Only an open session has anyone still to check in; once it is
    // finalised everyone active then has a record.
    if (isOpen(session)) {
      c.pending = activeIds.filter((id) => !seen.has(id)).length;
    }
    return c;
  }

  private toSession(
    s: SessionRow,
    records: RecordRow[],
    activeIds: string[],
  ): AttendanceSession {
    const hasLocation =
      s.latitude !== null && s.longitude !== null && s.radius_m !== null;
    return {
      id: s.id,
      courseId: s.course_id,
      title: s.title,
      openedBy: s.opened_by,
      openedAt: s.opened_at,
      closesAt: s.closes_at,
      closedAt: s.closed_at,
      isOpen: isOpen(s),
      checkInCode: s.check_in_code,
      requiresCode: s.check_in_code !== null,
      lateAfterMinutes: s.late_after_minutes,
      location: hasLocation
        ? {
            latitude: s.latitude!,
            longitude: s.longitude!,
            radiusM: s.radius_m!,
          }
        : null,
      counts: this.counts(s, records, activeIds),
    };
  }

  private toEntry(
    student: StudentRow | undefined,
    studentId: string,
    record: RecordRow | undefined,
  ): AttendanceRosterEntry {
    return {
      studentId,
      firstName: student?.first_name ?? null,
      lastName: student?.last_name ?? null,
      hasAccount: !!student?.user_profile_id,
      status: record?.status ?? null,
      method: record?.method ?? null,
      checkedInAt: record?.checked_in_at ?? null,
      distanceM: record?.distance_m ?? null,
      note: record?.note ?? null,
    };
  }

  private toPortalOpen(
    s: SessionRow,
    courseName: string,
    myStatus: AttendanceStatus | null,
  ): PortalOpenAttendance {
    return {
      sessionId: s.id,
      courseId: s.course_id,
      courseName,
      title: s.title,
      openedAt: s.opened_at,
      closesAt: s.closes_at,
      requiresCode: s.check_in_code !== null,
      requiresLocation: s.latitude !== null,
      myStatus,
    };
  }

  private async detailOf(s: SessionRow): Promise<AttendanceSessionDetail> {
    const [records, active] = await Promise.all([
      this.recordsFor([s.id]),
      this.activeStudents(s.course_id),
    ]);
    const activeIds = active.map((a) => a.id);
    const byStudent = new Map(records.map((r) => [r.student_id, r]));
    const known = new Map(active.map((a) => [a.id, a]));

    // A student dropped after being marked keeps their record on the roster.
    const missing = records
      .map((r) => r.student_id)
      .filter((id) => !known.has(id));
    for (const row of await this.students(missing)) known.set(row.id, row);

    // Open: everyone active, filled in as they arrive. Closed: whoever has a
    // record, so someone enrolled afterwards is not shown as unmarked.
    const ids = isOpen(s)
      ? [...new Set([...activeIds, ...records.map((r) => r.student_id)])]
      : records.map((r) => r.student_id);

    return {
      ...this.toSession(s, records, activeIds),
      roster: ids
        .map((id) => this.toEntry(known.get(id), id, byStudent.get(id)))
        .sort(byName),
    };
  }

  // ── finalising ────────────────────────────────────────────────────────────

  /**
   * Record every active student without a record as absent, then mark the
   * session closed. Safe to run any number of times, from any replica: the
   * absentee insert skips existing records, and only the call that actually
   * flips `closed_at` announces it.
   */
  async finalize(session: SessionRow, closedAt?: string): Promise<SessionRow> {
    if (session.closed_at) return session;
    const active = await this.activeStudents(session.course_id);

    if (active.length > 0) {
      const now = new Date();
      try {
        await this.prisma.course_attendance_record.createMany({
          data: active.map((st) => ({
            session_id: session.id,
            course_id: session.course_id,
            student_id: st.id,
            status: 'absent' as const,
            method: 'auto' as const,
            created_at: now,
            updated_at: now,
          })),
          skipDuplicates: true,
        });
      } catch (err) {
        this.logger.error(
          `Failed to record absentees: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to close attendance');
      }
    }

    // An expired session closed when its window did; an early close is now.
    const stamp =
      closedAt ??
      new Date(Math.min(Date.now(), Date.parse(session.closes_at))).toISOString();

    let updated: SessionDbRow[];
    try {
      updated = await this.prisma.attendance_session.updateManyAndReturn({
        where: { id: session.id, closed_at: null },
        data: { closed_at: new Date(stamp) },
        select: SESSION_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to close attendance: ${(err as Error).message}`);
      throw new BadRequestException('Failed to close attendance');
    }

    if (updated.length === 0) {
      // Someone else finalised it first; they announce it.
      return (await this.findSession(session.id)) ?? session;
    }

    const closed = toSessionRow(updated[0]);
    void this.announceClosed(closed, active);
    return closed;
  }

  private async announceClosed(session: SessionRow, active: StudentRow[]) {
    try {
      const records = await this.recordsFor([session.id]);
      await Promise.all([
        this.realtime.publishStaff(session.id, {
          type: 'attendance.closed',
          data: this.toSession(
            session,
            records,
            active.map((a) => a.id),
          ),
        }),
        this.realtime.publishPortal(
          active.map((a) => a.user_profile_id ?? ''),
          {
            type: 'attendance.closed',
            data: { sessionId: session.id, courseId: session.course_id },
          },
        ),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to announce closed attendance: ${(err as Error).message}`,
      );
    }
  }

  /** Finalise every session past its window, in one course or everywhere. */
  async finalizeExpired(courseId?: string): Promise<number> {
    let data: SessionRow[];
    try {
      const rows = await this.prisma.attendance_session.findMany({
        where: {
          closed_at: null,
          closes_at: { lte: new Date() },
          ...(courseId ? { course_id: courseId } : {}),
        },
        select: SESSION_SELECT,
      });
      data = rows.map(toSessionRow);
    } catch (err) {
      this.logger.error(
        `Failed to find expired attendance: ${(err as Error).message}`,
      );
      return 0;
    }

    let done = 0;
    for (const s of data) {
      if (!isExpired(s)) continue;
      try {
        await this.finalize(s);
        done++;
      } catch (err) {
        this.logger.error(
          `Failed to finalise attendance ${s.id}: ${(err as Error).message}`,
        );
      }
    }
    return done;
  }

  /** The background sweep; never overlaps itself. */
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.finalizeExpired();
    } catch (err) {
      this.logger.error(`Attendance sweep failed: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async current(session: SessionRow) {
    return isExpired(session) ? this.finalize(session) : session;
  }

  // ── staff ─────────────────────────────────────────────────────────────────

  async list(userId: string, courseId: string): Promise<AttendanceSession[]> {
    await this.access.require(userId, courseId, STAFF_ROLES);
    await this.finalizeExpired(courseId);

    let sessions: SessionRow[];
    try {
      const rows = await this.prisma.attendance_session.findMany({
        where: { course_id: courseId },
        orderBy: { opened_at: 'desc' },
        select: SESSION_SELECT,
      });
      sessions = rows.map(toSessionRow);
    } catch (err) {
      this.logger.error(`Failed to list attendance: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load attendance');
    }
    const [records, active] = await Promise.all([
      this.recordsFor(sessions.map((s) => s.id)),
      this.activeStudents(courseId),
    ]);
    const activeIds = active.map((a) => a.id);
    const bySession = new Map<string, RecordRow[]>();
    for (const r of records) {
      const list = bySession.get(r.session_id) ?? [];
      list.push(r);
      bySession.set(r.session_id, list);
    }

    return sessions.map((s) =>
      this.toSession(s, bySession.get(s.id) ?? [], activeIds),
    );
  }

  /**
   * Open a session. The code is random per session; a second open while one
   * is running is refused by the one-open-per-course index.
   */
  async open(
    userId: string,
    courseId: string,
    input: OpenAttendanceInput,
  ): Promise<AttendanceSessionDetail> {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    if (course.status !== 'published') {
      throw new ConflictException(
        'Publish the course before taking attendance',
      );
    }

    // An expired session nobody has finalised yet would hold the index.
    await this.finalizeExpired(courseId);

    const duration = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const openedAt = new Date();
    const closesAt = new Date(openedAt.getTime() + duration * 60_000);
    const code =
      input.requireCode === false
        ? null
        : String(randomInt(0, 10_000)).padStart(4, '0');

    let data: SessionDbRow;
    try {
      data = await this.prisma.attendance_session.create({
        data: {
        course_id: courseId,
        title: input.title?.trim() || null,
        opened_by: userId,
        opened_at: openedAt,
        closes_at: closesAt,
        check_in_code: code,
        qr_secret: newQrSecret(),
        late_after_minutes: input.lateAfterMinutes ?? null,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        radius_m: input.location
          ? (input.location.radiusM ?? DEFAULT_RADIUS_M)
          : null,
        },
        select: SESSION_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Attendance is already open in this course',
        );
      }
      this.logger.error(`Failed to open attendance: ${(err as Error).message}`);
      throw new BadRequestException('Failed to open attendance');
    }

    const session = toSessionRow(data);
    // Fire and forget: opening never waits on pushes or the bus.
    void this.announceOpened(course, session);
    return this.detailOf(session);
  }

  private async announceOpened(course: CourseRow, session: SessionRow) {
    try {
      const active = await this.activeStudents(course.id);
      const userIds = active
        .map((a) => a.user_profile_id)
        .filter((id): id is string => !!id);
      if (userIds.length === 0) return;

      await Promise.all([
        this.push.sendToUsers(userIds, {
          title: 'Attendance is open',
          body: `${course.name}: tap to check in`,
          channelId: 'attendance',
          data: {
            type: 'attendance.opened',
            sessionId: session.id,
            courseId: course.id,
          },
        }),
        this.realtime.publishPortal(userIds, {
          type: 'attendance.opened',
          data: this.toPortalOpen(session, course.name, null),
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to announce attendance: ${(err as Error).message}`,
      );
    }
  }

  async detail(
    userId: string,
    courseId: string,
    sessionId: string,
  ): Promise<AttendanceSessionDetail> {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const session = await this.current(
      await this.loadSession(courseId, sessionId),
    );
    return this.detailOf(session);
  }

  /** For the live stream: the caller must be staff and the session real. */
  async assertSession(userId: string, courseId: string, sessionId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    await this.loadSession(courseId, sessionId);
  }

  /** Close early. Closing a closed session just returns it. */
  async close(
    userId: string,
    courseId: string,
    sessionId: string,
  ): Promise<AttendanceSessionDetail> {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const session = await this.loadSession(courseId, sessionId);
    const closed = isOpen(session)
      ? await this.finalize(session, new Date().toISOString())
      : await this.current(session);
    return this.detailOf(closed);
  }

  async remove(userId: string, courseId: string, sessionId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const session = await this.loadSession(courseId, sessionId);

    try {
      await this.prisma.attendance_session.deleteMany({
        where: { id: sessionId, course_id: courseId },
      });
    } catch (err) {
      this.logger.error(
        `Failed to delete attendance: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete the attendance session');
    }

    // Take the banner down for anyone still looking at it.
    if (isOpen(session)) {
      try {
        const active = await this.activeStudents(courseId);
        await this.realtime.publishPortal(
          active.map((a) => a.user_profile_id ?? ''),
          { type: 'attendance.closed', data: { sessionId, courseId } },
        );
      } catch (err) {
        this.logger.error(
          `Failed to announce deleted attendance: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Staff set any student's status, open or closed. */
  async setRecord(
    userId: string,
    courseId: string,
    sessionId: string,
    studentId: string,
    input: { status: AttendanceStatus; note?: string | null },
  ): Promise<AttendanceRosterEntry> {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const session = await this.current(
      await this.loadSession(courseId, sessionId),
    );
    const enrollment = await this.prisma.course_student.findFirst({
      where: { course_id: courseId, student_id: studentId },
      select: { status: true },
    });
    if (!enrollment) {
      throw new NotFoundException('Student not found in this course');
    }

    const changes = {
      status: input.status,
      method: 'teacher' as const,
      updated_by: userId,
      updated_at: new Date(),
      ...(input.note !== undefined
        ? { note: input.note?.trim() || null }
        : {}),
    };

    let data: RecordRow;
    try {
      data = toRecordRow(
        await this.prisma.course_attendance_record.upsert({
          where: {
            session_id_student_id: {
              session_id: session.id,
              student_id: studentId,
            },
          },
          create: {
            session_id: session.id,
            course_id: courseId,
            student_id: studentId,
            ...changes,
          },
          update: { course_id: courseId, ...changes },
          select: RECORD_SELECT,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to set attendance: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update attendance');
    }

    const [student] = await this.students([studentId]);
    const entry = this.toEntry(student, studentId, data);
    void this.realtime.publishStaff(session.id, {
      type: 'attendance.record',
      data: entry,
    });
    return entry;
  }

  private async courseSheet(courseId: string) {
    await this.finalizeExpired(courseId);
    const sessions = (
      await this.prisma.attendance_session.findMany({
        where: { course_id: courseId },
        orderBy: { opened_at: 'asc' },
        select: SESSION_SELECT,
      })
    ).map(toSessionRow);

    const recordData = await this.prisma.course_attendance_record.findMany({
      where: { course_id: courseId },
      select: RECORD_SELECT,
    });
    const sessionIds = new Set(sessions.map((s) => s.id));
    const records = recordData.map(toRecordRow).filter((r) =>
      sessionIds.has(r.session_id),
    );

    const students = (await this.activeStudents(courseId))
      .map((s) => ({
        row: s,
        firstName: s.first_name,
        lastName: s.last_name,
      }))
      .sort(byName);

    const byStudent = new Map<string, RecordRow[]>();
    for (const r of records) {
      const list = byStudent.get(r.student_id) ?? [];
      list.push(r);
      byStudent.set(r.student_id, list);
    }
    return { sessions, students, byStudent };
  }

  /**
   * Each active student's tally. A student is only counted for the sessions
   * they have a record in, so joining mid-term does not count as absences.
   */
  async summary(
    userId: string,
    courseId: string,
  ): Promise<AttendanceCourseSummary> {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const { sessions, students, byStudent } = await this.courseSheet(courseId);

    return {
      sessionCount: sessions.length,
      students: students.map(({ row }) => ({
        studentId: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        ...tally(byStudent.get(row.id) ?? []),
      })),
    };
  }

  /** One row per student, one column per session, then totals and rate. */
  async exportCsv(userId: string, courseId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const { sessions, students, byStudent } = await this.courseSheet(courseId);

    const label = (s: SessionRow) => {
      const when = `${new Date(s.opened_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      return s.title ? `${s.title} (${when})` : when;
    };
    const word: Record<AttendanceStatus, string> = {
      present: 'Present',
      late: 'Late',
      absent: 'Absent',
      excused: 'Excused',
    };

    const lines: string[][] = [
      [
        'Last name',
        'First name',
        ...sessions.map(label),
        'Present',
        'Late',
        'Absent',
        'Excused',
        'Rate %',
      ],
    ];
    for (const { row } of students) {
      const mine = byStudent.get(row.id) ?? [];
      const bySession = new Map(mine.map((r) => [r.session_id, r.status]));
      const t = tally(mine);
      lines.push([
        row.last_name ?? '',
        row.first_name ?? '',
        ...sessions.map((s) => {
          const status = bySession.get(s.id);
          return status ? word[status] : '';
        }),
        String(t.present),
        String(t.late),
        String(t.absent),
        String(t.excused),
        t.rate === null ? '' : String(t.rate),
      ]);
    }

    const csv = lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const base = (course.code || course.name || 'course')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return {
      csv: csv + '\r\n',
      filename: `${base || 'course'}-attendance.csv`,
    };
  }

  // ── student portal ────────────────────────────────────────────────────────

  /** Open sessions in the student's active, published courses. No codes. */
  async openForStudent(studentId: string): Promise<PortalOpenAttendance[]> {
    const enrollments = await this.prisma.course_student.findMany({
      where: { student_id: studentId, status: 'active' },
      select: { course_id: true },
    });
    const courseIds = enrollments.map((e) => e.course_id);
    if (courseIds.length === 0) return [];

    const sessionData = await this.prisma.attendance_session.findMany({
      where: {
        course_id: { in: courseIds },
        closed_at: null,
        closes_at: { gt: new Date() },
      },
      orderBy: { closes_at: 'asc' },
      select: SESSION_SELECT,
    });
    const sessions = sessionData.map(toSessionRow).filter(
      (s) => courseIds.includes(s.course_id) && isOpen(s),
    );
    if (sessions.length === 0) return [];

    const [courses, mine] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: [...new Set(sessions.map((s) => s.course_id))] } },
        select: { id: true, name: true, status: true },
      }),
      this.prisma.course_attendance_record.findMany({
        where: {
          student_id: studentId,
          session_id: { in: sessions.map((s) => s.id) },
        },
        select: { session_id: true, status: true },
      }),
    ]);

    const published = new Map(
      courses
        .filter((c) => c.status === 'published')
        .map((c) => [c.id, c.name]),
    );
    const myStatus = new Map(
      mine.map((r) => [r.session_id, r.status]),
    );

    return sessions
      .filter((s) => published.has(s.course_id))
      .map((s) =>
        this.toPortalOpen(
          s,
          published.get(s.course_id)!,
          myStatus.get(s.id) ?? null,
        ),
      );
  }

  /** The secret behind a session's QR codes; never selected with the rest. */
  private async qrSecretOf(sessionId: string): Promise<string | null> {
    const data = await this.prisma.attendance_session.findUnique({
      where: { id: sessionId },
      select: { qr_secret: true },
    });
    return data?.qr_secret ?? null;
  }

  /**
   * The QR frame to show right now. The screen asks again at `rotatesAt`; a
   * frame stays valid one window past that, so a scan mid-rotation works.
   */
  async qr(userId: string, courseId: string, sessionId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const session = await this.loadSession(courseId, sessionId);
    const now = Date.now();
    if (!isOpen(session, now)) {
      throw new ConflictException('Attendance has closed');
    }

    const secret = await this.qrSecretOf(sessionId);
    if (!secret) {
      throw new ConflictException('This session was opened without a QR code');
    }

    const window = qrWindow(now);
    const token = qrToken(secret, window);
    const params = new URLSearchParams({ s: sessionId, t: token });
    return {
      token,
      url: `${primaryOrigin()}/scan?${params.toString()}`,
      rotatesAt: new Date((window + 1) * QR_WINDOW_MS).toISOString(),
      windowMs: QR_WINDOW_MS,
    };
  }

  /**
   * Swap a live QR token for a claim that outlasts signing in. Public: the
   * scan page calls it before it knows who the student is, and all it proves
   * is that someone saw the screen in the last few seconds.
   */
  async scanClaim(sessionId: string, token: string) {
    const data = await this.findSession(sessionId);
    const now = Date.now();
    if (!data || !isOpen(data, now)) {
      throw new ConflictException('Attendance has closed');
    }

    const secret = await this.qrSecretOf(sessionId);
    if (!secret || !verifyQrToken(secret, token, now)) {
      throw new ConflictException(
        'That QR code has expired. Scan the one on screen again',
      );
    }

    const { claim, expiresAt } = qrClaim(secret, sessionId, now);
    return { claim, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Check the caller in to an open session. */
  async checkIn(
    studentId: string,
    sessionId: string,
    input: CheckInInput,
  ): Promise<PortalOpenAttendance> {
    const session = await this.findSession(sessionId);
    if (!session) throw new NotFoundException('Attendance session not found');

    // Only an active student of a published course; anything else looks
    // like a session that does not exist.
    const course = await this.access.requireStudent(
      studentId,
      session.course_id,
      { allowArchived: false },
    );
    const enrollment = await this.prisma.course_student.findFirst({
      where: { course_id: session.course_id, student_id: studentId },
      select: { status: true },
    });
    if (enrollment?.status !== 'active') {
      throw new NotFoundException('Attendance session not found');
    }

    const now = Date.now();
    if (!isOpen(session, now)) {
      if (isExpired(session, now)) void this.finalize(session).catch(() => {});
      throw new ConflictException('Attendance has closed');
    }

    const existing = await this.prisma.course_attendance_record.findUnique({
      where: {
        session_id_student_id: { session_id: session.id, student_id: studentId },
      },
      select: { status: true },
    });
    if (existing) throw new ConflictException('You have already checked in');

    // A valid QR frame proves the student is looking at the screen in the
    // room, which is all the code proves, so it stands in for the code.
    let viaQr = false;
    if (input.qrToken || input.qrClaim) {
      const secret = await this.qrSecretOf(session.id);
      const valid =
        !!secret &&
        (input.qrToken
          ? verifyQrToken(secret, input.qrToken, now)
          : verifyQrClaim(secret, session.id, input.qrClaim!, now));
      if (!valid) {
        throw new ConflictException(
          'That QR code has expired. Scan the one on screen again',
        );
      }
      viaQr = true;
    } else if (session.check_in_code !== null) {
      await this.checkCode(session, studentId, input.code);
    }

    let distanceM: number | null = null;
    if (
      session.latitude !== null &&
      session.longitude !== null &&
      session.radius_m !== null
    ) {
      if (!input.location) {
        throw new BadRequestException('Share your location to check in');
      }
      const fence = withinGeofence(
        { latitude: session.latitude, longitude: session.longitude },
        session.radius_m,
        input.location,
      );
      distanceM = Math.round(fence.distanceM);
      if (!fence.ok) {
        throw new ForbiddenException(
          'You are too far from the classroom to check in',
        );
      }
    }

    const lateAt =
      session.late_after_minutes === null
        ? null
        : Date.parse(session.opened_at) + session.late_after_minutes * 60_000;
    const status: AttendanceStatus =
      lateAt !== null && now > lateAt ? 'late' : 'present';
    const stamp = new Date(now);

    let record: RecordRow;
    try {
      record = toRecordRow(
        await this.prisma.course_attendance_record.create({
          data: {
            session_id: session.id,
            course_id: session.course_id,
            student_id: studentId,
            status,
            method: viaQr ? 'qr' : 'self',
            checked_in_at: stamp,
            distance_m: distanceM,
            created_at: stamp,
            updated_at: stamp,
          },
          select: RECORD_SELECT,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Lost a race with the close (marked absent) or a double tap.
        const fresh = await this.prisma.attendance_session.findUnique({
          where: { id: session.id },
          select: { closed_at: true },
        });
        throw new ConflictException(
          fresh?.closed_at
            ? 'Attendance has closed'
            : 'You have already checked in',
        );
      }
      this.logger.error(`Failed to check in: ${(err as Error).message}`);
      throw new BadRequestException('Failed to check in');
    }

    const [student] = await this.students([studentId]);
    void this.realtime.publishStaff(session.id, {
      type: 'attendance.record',
      data: this.toEntry(student, studentId, record),
    });

    return this.toPortalOpen(session, course.name, status);
  }

  private async checkCode(
    session: SessionRow,
    studentId: string,
    code: string | undefined,
  ) {
    const key = `attendance:wrong-code:${session.id}:${studentId}`;
    const wrong = Number((await this.cache.get(key)) ?? 0) || 0;
    if (wrong >= MAX_WRONG_CODES) {
      throw new HttpException(
        'Too many wrong codes. Ask your teacher to mark you in',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const given = code?.trim();
    if (!given) {
      throw new BadRequestException('Enter the code shown in the room');
    }

    if (given !== session.check_in_code) {
      const lengthS = Math.ceil(
        (Date.parse(session.closes_at) - Date.parse(session.opened_at)) / 1000,
      );
      await this.cache.set(key, wrong + 1, lengthS + WRONG_CODE_TTL_MARGIN_S);
      throw new ConflictException('That code is not right');
    }
  }

  /** The student's own attendance in one course. */
  async courseForStudent(
    studentId: string,
    courseId: string,
  ): Promise<PortalCourseAttendance> {
    await this.access.requireStudent(studentId, courseId);
    await this.finalizeExpired(courseId);
    const [sessionData, mineData] = await Promise.all([
      this.prisma.attendance_session.findMany({
        where: { course_id: courseId },
        orderBy: { opened_at: 'desc' },
        select: SESSION_SELECT,
      }),
      this.prisma.course_attendance_record.findMany({
        where: { course_id: courseId, student_id: studentId },
        select: RECORD_SELECT,
      }),
    ]);

    const sessions = sessionData.map(toSessionRow);
    const mine = mineData.map(toRecordRow).filter(
      (r) => r.student_id === studentId,
    );
    const bySession = new Map(mine.map((r) => [r.session_id, r]));

    return {
      summary: tally(mine),
      // Sessions from before they joined are not theirs to see.
      records: sessions
        .filter((s) => bySession.has(s.id) || isOpen(s))
        .map((s) => {
          const r = bySession.get(s.id);
          return {
            sessionId: s.id,
            title: s.title,
            openedAt: s.opened_at,
            status: r?.status ?? null,
            checkedInAt: r?.checked_in_at ?? null,
          };
        }),
    };
  }
}
