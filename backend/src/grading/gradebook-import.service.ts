import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { toActivityRef, WebhookEvents } from '@/integrations/events';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import {
  ImportCurrent,
  ImportPlan,
  planImport,
} from './gradebook-import';

/**
 * Bulk marking from a CSV: a preview that changes nothing, then an apply
 * that re-reads the same file and writes every change in one transaction.
 *
 * Apply is stateless on purpose - it plans again from the current marks
 * rather than trusting a preview the client kept, so marks entered in the
 * meantime are compared against, not overwritten blind. Any error in the
 * file refuses the whole import.
 */
@Injectable()
export class GradebookImportService {
  private readonly logger = new Logger(GradebookImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly webhooks?: WebhookEvents,
  ) {}

  private async plan(courseId: string, csv: string): Promise<ImportPlan> {
    // Only published and closed work is in the export, and drafts cannot be
    // marked anyway.
    const [activities, roster] = await Promise.all([
      this.prisma.activity.findMany({
        where: { course_id: courseId, status: { in: ['published', 'closed'] } },
        select: { id: true, title: true, points: true, kind: true },
      }),
      // The gradebook's own roster: dropped students are not on the sheet.
      this.prisma.course_student.findMany({
        where: { course_id: courseId, status: { in: ['active', 'completed'] } },
        select: { student_id: true },
      }),
    ]);

    const studentIds = roster.map((r) => r.student_id);
    const [students, submissions] = await Promise.all([
      studentIds.length
        ? this.prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: {
              id: true,
              first_name: true,
              last_name: true,
              user_profile: { select: { email: true } },
            },
          })
        : Promise.resolve([]),
      studentIds.length && activities.length
        ? this.prisma.submission.findMany({
            where: {
              activity_id: { in: activities.map((a) => a.id) },
              student_id: { in: studentIds },
            },
            select: {
              activity_id: true,
              student_id: true,
              score: true,
              excused: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const current = new Map<string, ImportCurrent>();
    for (const s of submissions) {
      current.set(`${s.student_id}:${s.activity_id}`, {
        score: s.score === null ? null : Number(s.score),
        excused: !!s.excused,
      });
    }

    return planImport(
      csv,
      activities.map((a) => ({
        id: a.id,
        title: a.title,
        points: Number(a.points),
        kind: a.kind,
      })),
      students.map((s) => ({
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        email: s.user_profile?.email ?? null,
      })),
      current,
    );
  }

  /** What importing the sheet would change, without changing anything. */
  async preview(userId: string, courseId: string, csv: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    return this.plan(courseId, csv);
  }

  /** Write the sheet's changes, all or nothing. */
  async apply(userId: string, courseId: string, csv: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const plan = await this.plan(courseId, csv);

    if (plan.errors.length > 0) {
      throw new BadRequestException({
        message: 'Fix the errors in the file before importing',
        errors: plan.errors,
      });
    }

    const now = new Date();
    let written: { id: string }[];
    try {
      written = await this.prisma.$transaction(
        plan.changes.map((c) => {
          // A number marks and lifts any excuse; EX excuses and keeps the
          // score. Feedback and the student's own work are left alone.
          const fields = c.to.excused
            ? { excused: true, updated_at: now }
            : {
                status: 'graded' as const,
                score: c.to.score,
                excused: false,
                excused_reason: null,
                graded_at: now,
                graded_by: userId,
                updated_at: now,
              };
          return this.prisma.submission.upsert({
            where: {
              activity_id_student_id: {
                activity_id: c.activityId,
                student_id: c.studentId,
              },
            },
            create: {
              activity_id: c.activityId,
              student_id: c.studentId,
              status: 'graded',
              graded_at: now,
              graded_by: userId,
              ...fields,
            },
            update: fields,
            select: { id: true },
          });
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to import marks: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to import the marks');
    }

    this.emitGrades(userId, courseId, plan.changes, written);
    return { applied: plan.changes.length, unchanged: plan.unchanged };
  }

  /** grade.recorded for every mark the import changed; fire and forget. */
  private emitGrades(
    userId: string,
    courseId: string,
    changes: ImportPlan['changes'],
    written: { id: string }[],
  ) {
    const webhooks = this.webhooks;
    if (!webhooks || changes.length === 0) return;
    const activityIds = [...new Set(changes.map((c) => c.activityId))];
    changes.forEach((c, i) => {
      void webhooks.emitForCourse(courseId, 'grade.recorded', async (course) => {
        const activities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: { id: true, title: true, kind: true, points: true },
        });
        const activity = activities.find((a) => a.id === c.activityId);
        if (!activity) return null;
        const ref = toActivityRef(activity);
        return {
          submission: { id: written[i]?.id ?? null },
          activity: ref,
          course,
          student: await webhooks.student(c.studentId),
          grade: {
            score: c.to.excused ? (c.from?.score ?? null) : c.to.score,
            points: ref.points,
            status: 'graded',
            excused: c.to.excused,
          },
          gradedBy: await webhooks.staffOrNull(userId),
          source: 'import',
        };
      });
    });
  }
}
