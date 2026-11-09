import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { userSchoolId } from '@/common/user-school';
import { ts } from './activity.mapper';
import {
  accommodatedTimeLimit,
  accommodationColumns,
  effectiveAccommodation,
  type AccommodationInput,
  type AccommodationRow,
} from './accommodation';

const ACCOMMODATION_FIELDS = {
  id: true,
  student_id: true,
  time_multiplier: true,
  extra_minutes: true,
  lockdown_exempt: true,
  reason: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

const ACTIVITY_ACCOMMODATION_SELECT = {
  ...ACCOMMODATION_FIELDS,
  activity_id: true,
} satisfies Prisma.activity_accommodationSelect;

const STUDENT_ACCOMMODATION_SELECT =
  ACCOMMODATION_FIELDS satisfies Prisma.student_accommodationSelect;

type StudentAccommodationRow = Prisma.student_accommodationGetPayload<{
  select: typeof STUDENT_ACCOMMODATION_SELECT;
}>;
type ActivityAccommodationRow = Prisma.activity_accommodationGetPayload<{
  select: typeof ACTIVITY_ACCOMMODATION_SELECT;
}>;

function common(row: StudentAccommodationRow) {
  return {
    id: row.id,
    studentId: row.student_id,
    timeMultiplier:
      row.time_multiplier === null ? null : Number(row.time_multiplier),
    extraMinutes: row.extra_minutes ?? null,
    lockdownExempt: row.lockdown_exempt,
    reason: row.reason ?? null,
    createdBy: row.created_by ?? null,
    createdAt: ts(row.created_at) as string,
    updatedAt: ts(row.updated_at) as string,
  };
}

/** The `ActivityAccommodation` contract. */
export function toActivityAccommodation(row: ActivityAccommodationRow) {
  return { ...common(row), activityId: row.activity_id };
}

/** The `StudentAccommodation` contract (the school-wide default). */
export function toStudentAccommodation(row: StudentAccommodationRow) {
  return common(row);
}

function auditFields(row: StudentAccommodationRow & { activity_id?: string }) {
  return {
    ...(row.activity_id ? { activityId: row.activity_id } : {}),
    studentId: row.student_id,
    timeMultiplier:
      row.time_multiplier === null ? null : Number(row.time_multiplier),
    extraMinutes: row.extra_minutes,
    lockdownExempt: row.lockdown_exempt,
    reason: row.reason,
  };
}

/** The accommodation that applies to one student on one activity. */
export async function loadAccommodation(
  prisma: Pick<
    Prisma.TransactionClient,
    'activity_accommodation' | 'student_accommodation'
  >,
  studentId: string,
  activityId: string,
) {
  const [own, fallback] = await Promise.all([
    prisma.activity_accommodation.findUnique({
      where: {
        activity_id_student_id: {
          activity_id: activityId,
          student_id: studentId,
        },
      },
      select: { time_multiplier: true, extra_minutes: true, lockdown_exempt: true },
    }),
    prisma.student_accommodation.findUnique({
      where: { student_id: studentId },
      select: { time_multiplier: true, extra_minutes: true, lockdown_exempt: true },
    }),
  ]);
  return effectiveAccommodation(own, fallback);
}

/**
 * When a student's accommodation changes mid-quiz, their running timed
 * attempts follow it - but only ever later: a running attempt never loses
 * time it was promised, so removing or reducing an accommodation applies
 * from the next attempt. Untimed attempts end at the due date and are left
 * alone.
 */
export async function restampRunningQuizAttempts(
  tx: Prisma.TransactionClient,
  studentId: string,
  activityId?: string,
) {
  const now = new Date();
  const running = await tx.submission.findMany({
    where: {
      student_id: studentId,
      ...(activityId ? { activity_id: activityId } : {}),
      status: 'draft',
      quiz_started_at: { not: null },
      quiz_expires_at: { gt: now },
      activity: { kind: 'quiz', time_limit_minutes: { not: null } },
    },
    select: {
      id: true,
      activity_id: true,
      quiz_started_at: true,
      quiz_expires_at: true,
      activity: { select: { time_limit_minutes: true } },
    },
  });
  if (running.length === 0) return;

  const [own, fallback] = await Promise.all([
    tx.activity_accommodation.findMany({
      where: {
        student_id: studentId,
        activity_id: { in: running.map((r) => r.activity_id) },
      },
      select: {
        activity_id: true,
        time_multiplier: true,
        extra_minutes: true,
        lockdown_exempt: true,
      },
    }),
    tx.student_accommodation.findUnique({
      where: { student_id: studentId },
      select: { time_multiplier: true, extra_minutes: true, lockdown_exempt: true },
    }),
  ]);
  const ownOf = new Map<string, AccommodationRow>(
    own.map((r) => [r.activity_id, r]),
  );

  for (const attempt of running) {
    if (!attempt.quiz_started_at || !attempt.quiz_expires_at) continue;
    const minutes = accommodatedTimeLimit(
      attempt.activity.time_limit_minutes,
      effectiveAccommodation(ownOf.get(attempt.activity_id), fallback),
    );
    if (!minutes) continue;
    const expiresAt = new Date(
      attempt.quiz_started_at.getTime() + minutes * 60_000,
    );
    if (expiresAt.getTime() <= attempt.quiz_expires_at.getTime()) continue;
    await tx.submission.update({
      where: { id: attempt.id },
      data: { quiz_expires_at: expiresAt, updated_at: now },
    });
  }
}

/**
 * Per-student quiz accommodations (extra time, Lockdown exemption).
 *
 * On one activity: the same staff who can extend a due date (teachers, TAs,
 * course admins in the course). The school-wide default: school staff with
 * the student permissions (read to see it, update to change it), checked by
 * the controller's PermissionGuard and scoped here to the caller's school.
 */
@Injectable()
export class AccommodationService {
  private readonly logger = new Logger(AccommodationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // ── on one activity ───────────────────────────────────────────────────────

  private async requireStaffActivity(userId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, kind: true },
    });
    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(
      userId,
      activity.course_id,
      STAFF_ROLES,
    );
    return {
      ...activity,
      course_id: activity.course_id,
      school_id: course.school_id,
    };
  }

  /** Every accommodation on an activity. */
  async listForActivity(userId: string, activityId: string) {
    await this.requireStaffActivity(userId, activityId);
    const rows = await this.prisma.activity_accommodation.findMany({
      where: { activity_id: activityId },
      select: ACTIVITY_ACCOMMODATION_SELECT,
      orderBy: { created_at: 'asc' },
    });
    return rows.map(toActivityAccommodation);
  }

  /** Set or replace one student's accommodation on a quiz. */
  async setForActivity(
    userId: string,
    activityId: string,
    studentId: string,
    input: AccommodationInput,
  ) {
    const activity = await this.requireStaffActivity(userId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('Accommodations apply to quizzes only');
    }
    const columns = accommodationColumns(input);
    await this.requireEnrolled(activity.course_id, studentId);

    const key = {
      activity_id_student_id: { activity_id: activityId, student_id: studentId },
    };
    const saved = await this.save('accommodation', async (tx) => {
      const before = await tx.activity_accommodation.findUnique({
        where: key,
        select: ACTIVITY_ACCOMMODATION_SELECT,
      });
      const row = await tx.activity_accommodation.upsert({
        where: key,
        create: {
          activity_id: activityId,
          student_id: studentId,
          ...columns,
          created_by: userId,
        },
        update: { ...columns, created_by: userId, updated_at: new Date() },
        select: ACTIVITY_ACCOMMODATION_SELECT,
      });
      await restampRunningQuizAttempts(tx, studentId, activityId);
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'activity_accommodation',
          entityId: row.id,
          action: before ? 'update' : 'create',
          changes: auditChanges(
            before ? auditFields(before) : null,
            auditFields(row),
          ),
        },
      );
      return row;
    });
    return toActivityAccommodation(saved);
  }

  /** Remove it; the student's school-wide default (if any) applies again. */
  async removeForActivity(
    userId: string,
    activityId: string,
    studentId: string,
  ) {
    const activity = await this.requireStaffActivity(userId, activityId);
    const existing = await this.prisma.activity_accommodation.findUnique({
      where: {
        activity_id_student_id: {
          activity_id: activityId,
          student_id: studentId,
        },
      },
      select: ACTIVITY_ACCOMMODATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('This student has no accommodation here');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.activity_accommodation.delete({ where: { id: existing.id } });
      // The default may give more time than the row that went.
      await restampRunningQuizAttempts(tx, studentId, activityId);
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'activity_accommodation',
          entityId: existing.id,
          action: 'delete',
          changes: auditChanges(auditFields(existing), null),
        },
      );
    });
  }

  // ── the school-wide default ───────────────────────────────────────────────

  /** The student, in the caller's school, or a 404. */
  private async requireSchoolStudent(userId: string, studentId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new NotFoundException('Student not found');
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, school_id: schoolId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return schoolId;
  }

  /** A student's default, or null when they have none. */
  async getForStudent(userId: string, studentId: string) {
    await this.requireSchoolStudent(userId, studentId);
    const row = await this.prisma.student_accommodation.findUnique({
      where: { student_id: studentId },
      select: STUDENT_ACCOMMODATION_SELECT,
    });
    return row ? toStudentAccommodation(row) : null;
  }

  async setForStudent(
    userId: string,
    studentId: string,
    input: AccommodationInput,
  ) {
    const schoolId = await this.requireSchoolStudent(userId, studentId);
    const columns = accommodationColumns(input);
    const saved = await this.save('default accommodation', async (tx) => {
      const before = await tx.student_accommodation.findUnique({
        where: { student_id: studentId },
        select: STUDENT_ACCOMMODATION_SELECT,
      });
      const row = await tx.student_accommodation.upsert({
        where: { student_id: studentId },
        create: { student_id: studentId, ...columns, created_by: userId },
        update: { ...columns, created_by: userId, updated_at: new Date() },
        select: STUDENT_ACCOMMODATION_SELECT,
      });
      await restampRunningQuizAttempts(tx, studentId);
      await this.auditLog?.record(
        tx,
        schoolId,
        { id: userId },
        {
          entity: 'student_accommodation',
          entityId: row.id,
          action: before ? 'update' : 'create',
          changes: auditChanges(
            before ? auditFields(before) : null,
            auditFields(row),
          ),
        },
      );
      return row;
    });
    return toStudentAccommodation(saved);
  }

  async removeForStudent(userId: string, studentId: string) {
    const schoolId = await this.requireSchoolStudent(userId, studentId);
    const existing = await this.prisma.student_accommodation.findUnique({
      where: { student_id: studentId },
      select: STUDENT_ACCOMMODATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('This student has no default accommodation');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.student_accommodation.delete({ where: { id: existing.id } });
      await this.auditLog?.record(
        tx,
        schoolId,
        { id: userId },
        {
          entity: 'student_accommodation',
          entityId: existing.id,
          action: 'delete',
          changes: auditChanges(auditFields(existing), null),
        },
      );
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async save<T>(
    what: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to save the ${what}: ${(error as Error).message}`);
      throw new BadRequestException(`Failed to save the ${what}`);
    }
  }

  /** Enrolled (active or completed, not dropped), as for extensions. */
  private async requireEnrolled(courseId: string, studentId: string) {
    const enrolment = await this.prisma.course_student.findUnique({
      where: {
        course_id_student_id: { course_id: courseId, student_id: studentId },
      },
      select: { status: true },
    });
    if (!enrolment || enrolment.status === 'dropped') {
      throw new NotFoundException(
        'That student is not enrolled in this course',
      );
    }
  }
}
