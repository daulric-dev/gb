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
import { toTimestamp, ts } from './activity.mapper';
import { refreshLateness } from './lateness';

const EXTENSION_SELECT = {
  id: true,
  activity_id: true,
  student_id: true,
  due_at: true,
  reason: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.activity_extensionSelect;

type ExtensionRow = Prisma.activity_extensionGetPayload<{
  select: typeof EXTENSION_SELECT;
}>;

/** The `ActivityExtension` contract. */
export function toExtension(row: ExtensionRow) {
  return {
    id: row.id,
    activityId: row.activity_id,
    studentId: row.student_id,
    dueAt: ts(row.due_at) as string,
    reason: row.reason ?? null,
    createdBy: row.created_by ?? null,
    createdAt: ts(row.created_at) as string,
    updatedAt: ts(row.updated_at) as string,
  };
}

export type ExtensionDto = ReturnType<typeof toExtension>;

/**
 * A quiz with no time limit ends when it is due: the attempt's expiry is the
 * student's due date (or, for an attempt started in the late window, the
 * date late work closes), so the expiry sweep submits it then. When those
 * dates move (an extension set or removed, the activity's dates changed),
 * attempts still running follow them. Attempts already over are left alone so
 * a later date cannot reopen one that has ended.
 */
export async function syncUntimedQuizAttempts(
  tx: Prisma.TransactionClient,
  activity: { id: string; kind: string; time_limit_minutes: number | null },
  where: Prisma.submissionWhereInput,
  dueAt: Date | null,
  closeAt: Date | null = dueAt,
) {
  if (activity.kind !== 'quiz' || activity.time_limit_minutes) return;
  const now = new Date();
  const running = {
    ...where,
    activity_id: activity.id,
    quiz_started_at: { not: null },
    OR: [{ quiz_expires_at: null }, { quiz_expires_at: { gt: now } }],
  } satisfies Prisma.submissionWhereInput;
  if (!dueAt || !closeAt || closeAt.getTime() === dueAt.getTime()) {
    await tx.submission.updateMany({
      where: running,
      data: { quiz_expires_at: dueAt, updated_at: now },
    });
    return;
  }
  // Started on time: ends at the due date. Started late: at the close.
  await tx.submission.updateMany({
    where: { AND: [running, { quiz_started_at: { lt: dueAt } }] },
    data: { quiz_expires_at: dueAt, updated_at: now },
  });
  await tx.submission.updateMany({
    where: { AND: [running, { quiz_started_at: { gte: dueAt } }] },
    data: { quiz_expires_at: closeAt, updated_at: now },
  });
}

/**
 * Per-student due date extensions. Staff who can mark the work (teachers,
 * TAs, course admins) can give a student more time; the student's effective
 * due date is then their extension's.
 */
@Injectable()
export class ExtensionService {
  private readonly logger = new Logger(ExtensionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** The activity, for a caller who can mark it. */
  private async requireStaffActivity(userId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        course_id: true,
        kind: true,
        due_at: true,
        late_until: true,
        time_limit_minutes: true,
      },
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

  /** Every extension on an activity. */
  async list(userId: string, activityId: string) {
    await this.requireStaffActivity(userId, activityId);
    const rows = await this.prisma.activity_extension.findMany({
      where: { activity_id: activityId },
      select: EXTENSION_SELECT,
      orderBy: { due_at: 'asc' },
    });
    return rows.map(toExtension);
  }

  /** Give a student a new due date, replacing any extension they had. */
  async set(
    userId: string,
    activityId: string,
    studentId: string,
    input: { dueAt: string; reason?: string },
  ) {
    const activity = await this.requireStaffActivity(userId, activityId);
    if (activity.kind === 'offline') {
      throw new BadRequestException(
        'This is marked offline; there is no due date to extend',
      );
    }

    const dueAt = toTimestamp(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException('Choose a valid due date');
    }
    if (dueAt.getTime() <= Date.now()) {
      throw new BadRequestException('The new due date must be in the future');
    }
    await this.requireEnrolled(activity.course_id, studentId);

    const reason = input.reason?.trim() || null;
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const before = await tx.activity_extension.findUnique({
          where: {
            activity_id_student_id: {
              activity_id: activityId,
              student_id: studentId,
            },
          },
          select: EXTENSION_SELECT,
        });
        const now = new Date();
        const row = await tx.activity_extension.upsert({
          where: {
            activity_id_student_id: {
              activity_id: activityId,
              student_id: studentId,
            },
          },
          create: {
            activity_id: activityId,
            student_id: studentId,
            due_at: dueAt,
            reason,
            created_by: userId,
          },
          update: {
            due_at: dueAt,
            reason,
            created_by: userId,
            updated_at: now,
          },
          select: EXTENSION_SELECT,
        });
        await syncUntimedQuizAttempts(
          tx,
          activity,
          { student_id: studentId },
          dueAt,
        );
        // Handed in before the new date: no longer late.
        await refreshLateness(tx, activityId, [studentId]);
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'activity_extension',
            entityId: row.id,
            action: before ? 'update' : 'create',
            changes: auditChanges(
              before ? this.auditFields(before) : null,
              this.auditFields(row),
            ),
          },
        );
        return row;
      });
      return toExtension(saved);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to save the extension: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to save the extension');
    }
  }

  /** Take a student's extension away; they are due when everyone else is. */
  async remove(userId: string, activityId: string, studentId: string) {
    const activity = await this.requireStaffActivity(userId, activityId);
    const existing = await this.prisma.activity_extension.findUnique({
      where: {
        activity_id_student_id: {
          activity_id: activityId,
          student_id: studentId,
        },
      },
      select: EXTENSION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('This student has no extension');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.activity_extension.delete({ where: { id: existing.id } });
      await syncUntimedQuizAttempts(
        tx,
        activity,
        { student_id: studentId },
        activity.due_at,
        activity.late_until ?? activity.due_at,
      );
      await refreshLateness(tx, activityId, [studentId]);
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'activity_extension',
          entityId: existing.id,
          action: 'delete',
          changes: auditChanges(this.auditFields(existing), null),
        },
      );
    });
  }

  /**
   * The student must be enrolled (active or completed, not dropped): an
   * extension is more time to hand in, which a dropped student cannot do.
   */
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

  private auditFields(row: ExtensionRow) {
    return {
      activityId: row.activity_id,
      studentId: row.student_id,
      dueAt: row.due_at,
      reason: row.reason,
    };
  }
}
