import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import {
  computeEffectivePermissions,
  loadEffectivePermissions,
} from '@/permission/permission.effective';
import {
  canSeeSensitive,
  scopedStudentWhere,
  studentScope,
} from '@/permission/student-access';
import {
  openText,
  sealOptionalText,
  type SensitiveField,
} from '@/account/sensitive-text';
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

const ACTIVITY_FIELD: SensitiveField = 'activity_accommodation.reason';
const STUDENT_FIELD: SensitiveField = 'student_accommodation.reason';

/**
 * `reason` is decrypted for callers holding student:sensitive. Without it
 * the field is left out of the response altogether (not null), so a client
 * can tell "hidden" from "none".
 */
function common(
  row: StudentAccommodationRow,
  field: SensitiveField,
  sensitive: boolean,
) {
  return {
    id: row.id,
    studentId: row.student_id,
    timeMultiplier:
      row.time_multiplier === null ? null : Number(row.time_multiplier),
    extraMinutes: row.extra_minutes ?? null,
    lockdownExempt: row.lockdown_exempt,
    ...(sensitive ? { reason: openText(field, row.id, row.reason ?? null) } : {}),
    createdBy: row.created_by ?? null,
    createdAt: ts(row.created_at) as string,
    updatedAt: ts(row.updated_at) as string,
  };
}

/** The `ActivityAccommodation` contract. */
export function toActivityAccommodation(
  row: ActivityAccommodationRow,
  sensitive = false,
) {
  return {
    ...common(row, ACTIVITY_FIELD, sensitive),
    activityId: row.activity_id,
  };
}

/** The `StudentAccommodation` contract (the school-wide default). */
export function toStudentAccommodation(
  row: StudentAccommodationRow,
  sensitive = false,
) {
  return common(row, STUDENT_FIELD, sensitive);
}

/**
 * What the audit log keeps: never the reason (it is health or SEN detail),
 * only whether there is one; `auditChanges` turns a different `hasReason`
 * or `reasonChanged` into an entry.
 */
function auditFields(
  row: StudentAccommodationRow & { activity_id?: string },
  reasonChanged = false,
) {
  return {
    ...(row.activity_id ? { activityId: row.activity_id } : {}),
    studentId: row.student_id,
    timeMultiplier:
      row.time_multiplier === null ? null : Number(row.time_multiplier),
    extraMinutes: row.extra_minutes,
    lockdownExempt: row.lockdown_exempt,
    hasReason: row.reason !== null && row.reason !== undefined,
    ...(reasonChanged ? { reasonChanged: true } : {}),
  };
}

/**
 * The reason to store. With student:sensitive, as before: the input
 * replaces it, and leaving it out clears it. Without it the caller cannot
 * see the current reason, so cannot replace or clear one they were never
 * shown: their input only fills an empty reason.
 */
function nextReason(
  input: string | null | undefined,
  current: string | null,
  sensitive: boolean,
): { plain: string | null; keep: boolean } {
  if (!sensitive && (current !== null || !input?.trim())) {
    return { plain: null, keep: true };
  }
  return { plain: input?.trim() || null, keep: false };
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
    @Optional() private readonly cache?: CacheService,
  ) {}

  private effective(userId: string, schoolId: string) {
    return this.cache
      ? loadEffectivePermissions(this.prisma, this.cache, userId, schoolId)
      : computeEffectivePermissions(this.prisma, userId, schoolId);
  }

  /** student:sensitive in the school: may see accommodation reasons. */
  private async sensitive(userId: string, schoolId: string) {
    return canSeeSensitive(await this.effective(userId, schoolId));
  }

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
    const activity = await this.requireStaffActivity(userId, activityId);
    const sensitive = await this.sensitive(userId, activity.school_id);
    const rows = await this.prisma.activity_accommodation.findMany({
      where: { activity_id: activityId },
      select: ACTIVITY_ACCOMMODATION_SELECT,
      orderBy: { created_at: 'asc' },
    });
    return rows.map((row) => toActivityAccommodation(row, sensitive));
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
    const { reason: _reason, ...columns } = accommodationColumns(input);
    await this.requireEnrolled(activity.course_id, studentId);
    const sensitive = await this.sensitive(userId, activity.school_id);

    const key = {
      activity_id_student_id: { activity_id: activityId, student_id: studentId },
    };
    let reasonChanged = false;
    const saved = await this.save('accommodation', async (tx) => {
      const before = await tx.activity_accommodation.findUnique({
        where: key,
        select: ACTIVITY_ACCOMMODATION_SELECT,
      });
      // The id is chosen here: the reason is encrypted against it.
      const id = before?.id ?? randomUUID();
      const reason = nextReason(input.reason, before?.reason ?? null, sensitive);
      reasonChanged = !reason.keep && !!(before?.reason || reason.plain);
      const sealed = reason.keep
        ? {}
        : { reason: sealOptionalText(ACTIVITY_FIELD, id, reason.plain) };
      const row = await tx.activity_accommodation.upsert({
        where: key,
        create: {
          id,
          activity_id: activityId,
          student_id: studentId,
          ...columns,
          reason: null,
          ...sealed,
          created_by: userId,
        },
        update: { ...columns, ...sealed, created_by: userId, updated_at: new Date() },
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
            auditFields(row, reasonChanged),
          ),
        },
      );
      return row;
    });
    return toActivityAccommodation(saved, sensitive);
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

  /**
   * The student, in the caller's school and within the students they may
   * see (student-access.ts), or a 404. Returns whether the caller holds
   * student:sensitive.
   */
  private async requireSchoolStudent(userId: string, studentId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new NotFoundException('Student not found');
    const effective = await this.effective(userId, schoolId);
    const student = await this.prisma.student.findFirst({
      where: scopedStudentWhere(studentScope(effective, userId, schoolId), {
        id: studentId,
        school_id: schoolId,
      }),
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return { schoolId, sensitive: canSeeSensitive(effective) };
  }

  /** A student's default, or null when they have none. */
  async getForStudent(userId: string, studentId: string) {
    const { sensitive } = await this.requireSchoolStudent(userId, studentId);
    const row = await this.prisma.student_accommodation.findUnique({
      where: { student_id: studentId },
      select: STUDENT_ACCOMMODATION_SELECT,
    });
    return row ? toStudentAccommodation(row, sensitive) : null;
  }

  async setForStudent(
    userId: string,
    studentId: string,
    input: AccommodationInput,
  ) {
    const { schoolId, sensitive } = await this.requireSchoolStudent(
      userId,
      studentId,
    );
    const { reason: _reason, ...columns } = accommodationColumns(input);
    let reasonChanged = false;
    const saved = await this.save('default accommodation', async (tx) => {
      const before = await tx.student_accommodation.findUnique({
        where: { student_id: studentId },
        select: STUDENT_ACCOMMODATION_SELECT,
      });
      const id = before?.id ?? randomUUID();
      const reason = nextReason(input.reason, before?.reason ?? null, sensitive);
      reasonChanged = !reason.keep && !!(before?.reason || reason.plain);
      const sealed = reason.keep
        ? {}
        : { reason: sealOptionalText(STUDENT_FIELD, id, reason.plain) };
      const row = await tx.student_accommodation.upsert({
        where: { student_id: studentId },
        create: {
          id,
          student_id: studentId,
          ...columns,
          reason: null,
          ...sealed,
          created_by: userId,
        },
        update: { ...columns, ...sealed, created_by: userId, updated_at: new Date() },
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
            auditFields(row, reasonChanged),
          ),
        },
      );
      return row;
    });
    return toStudentAccommodation(saved, sensitive);
  }

  async removeForStudent(userId: string, studentId: string) {
    const { schoolId } = await this.requireSchoolStudent(userId, studentId);
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
