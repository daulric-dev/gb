import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { toActivityRef, WebhookEvents } from '@/integrations/events';
import type { Prisma } from '@/generated/prisma/client';
import {
  CourseAccessService,
  CourseRole,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import {
  ACTIVITY_ORDER,
  ACTIVITY_SELECT,
  ActivityKind,
  toActivity,
  toTimestamp,
} from './activity.mapper';
import { CourseNotificationService } from '@/course-notification/course-notification.service';
import { syncUntimedQuizAttempts } from './extension.service';
import { rescoreQuizFromAnswers } from './quiz-rescore';
import { refreshLateness } from './lateness';
import { refreshOutcomeEvidence } from '@/mastery/outcome-evidence';
import { latePolicyColumns, type LatePenaltyMode } from './late-policy';
import {
  createQuestion,
  loadQuestions,
  OPTION_SELECT,
  questionAudit,
  QUESTION_SELECT,
  updateQuestionRow,
  type QuestionInput,
  type QuestionPatch,
} from './question-write';

/** The text of an activity copy, replacing the source's in the same order (see `sourceForCopy`). */
export interface ActivityCopyText {
  title: string;
  instructions: string | null;
  questions: { prompt: string; options: { label: string; matchLabel: string | null }[] }[];
}

export type ActivityCopySource = Awaited<ReturnType<ActivityService['sourceForCopy']>>;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quizzes, assignments and offline work inside a course.
 *
 * Every method starts from the course: either the one in the route, or the
 * one the activity belongs to. Course roles decide the rest - teachers (and
 * school admins) build and change work, TAs read it - so a teacher runs their
 * own course without any school-wide grant.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly notices?: CourseNotificationService,
    @Optional() private readonly webhooks?: WebhookEvents,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Load an activity and prove the caller holds one of `roles` in its
   * course. An activity in a course they cannot see is reported as missing.
   */
  private async requireActivity(
    userId: string,
    activityId: string,
    roles: readonly CourseRole[] = MANAGE_ROLES,
  ) {
    const data = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: ACTIVITY_SELECT,
    });

    if (!data?.course_id) {
      throw new NotFoundException('Activity not found');
    }

    const { course } = await this.access.require(userId, data.course_id, roles);
    return {
      ...data,
      course_id: data.course_id,
      school_id: course.school_id,
    };
  }

  /**
   * A group named on an activity must be one of this course's own, or the
   * activity would count toward a total it does not belong to.
   */
  private async requireGroupInCourse(courseId: string, groupId: string) {
    const data = await this.prisma.assignment_group.findFirst({
      where: { id: groupId, course_id: courseId },
      select: { id: true },
    });

    if (!data) throw new NotFoundException('Assignment group not found');
  }

  /** Every activity in a course, drafts included; soonest due first. */
  async listForCourse(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);

    let data;
    try {
      data = await this.prisma.activity.findMany({
        where: { course_id: courseId },
        select: ACTIVITY_SELECT,
        orderBy: ACTIVITY_ORDER,
      });
    } catch (error) {
      this.logger.error(
        `Failed to list activities: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to load activities');
    }

    return data.map((a) => toActivity(a));
  }

  /**
   * One activity, with its questions (and, on a quiz, the question banks it
   * draws from) when it is a quiz.
   */
  async get(userId: string, activityId: string, includeAnswers = true) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      STAFF_ROLES,
    );

    if (activity.kind !== 'quiz') {
      return { ...toActivity(activity), questions: [], bankDraws: [] };
    }

    const [questions, draws] = await Promise.all([
      loadQuestions(this.prisma, { activity_id: activityId }, includeAnswers),
      this.prisma.quiz_bank_draw.findMany({
        where: { activity_id: activityId },
        select: {
          id: true,
          bank_id: true,
          draw_count: true,
          question_bank: { select: { title: true } },
        },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      }),
    ]);

    return {
      ...toActivity(activity),
      questions,
      bankDraws: (draws ?? []).map((d) => ({
        id: d.id,
        bankId: d.bank_id,
        bankTitle: d.question_bank?.title ?? '',
        count: d.draw_count,
      })),
    };
  }

  async create(
    userId: string,
    courseId: string,
    input: {
      kind: ActivityKind;
      title: string;
      instructions?: string;
      points: number;
      dueAt?: string;
      assignmentGroupId?: string;
      allowFile?: boolean;
      allowMultipleFiles?: boolean;
      allowText?: boolean;
      maxAttempts?: number;
      timeLimitMinutes?: number | null;
      lockdownBrowser?: boolean;
      shuffleQuestions?: boolean;
      shuffleOptions?: boolean;
      lateUntil?: string | null;
      latePenaltyMode?: LatePenaltyMode;
      latePenaltyValue?: number | null;
      latePenaltyCap?: number | null;
    },
  ) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );

    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the activity a title');

    // The database rejects an assignment accepting nothing, but saying so here
    // is more use than a constraint name.
    if (input.kind === 'assignment' && !input.allowFile && !input.allowText) {
      throw new BadRequestException(
        'An assignment must accept a file, text, or both',
      );
    }
    if (input.kind !== 'quiz' && input.timeLimitMinutes != null) {
      throw new BadRequestException('Only quizzes can have a time limit');
    }
    if (input.kind !== 'quiz' && input.lockdownBrowser) {
      throw new BadRequestException('Only quizzes can require lockdown browser');
    }
    if (input.kind !== 'quiz' && (input.shuffleQuestions || input.shuffleOptions)) {
      throw new BadRequestException('Only quizzes can be shuffled');
    }
    if (
      input.timeLimitMinutes != null &&
      (!Number.isInteger(input.timeLimitMinutes) ||
        input.timeLimitMinutes < 1 ||
        input.timeLimitMinutes > 1440)
    ) {
      throw new BadRequestException(
        'Time limit must be between 1 and 1440 minutes',
      );
    }
    if (input.allowMultipleFiles && !input.allowFile) {
      throw new BadRequestException(
        'Multiple files can only be allowed when file uploads are enabled',
      );
    }

    if (input.assignmentGroupId) {
      await this.requireGroupInCourse(courseId, input.assignmentGroupId);
    }
    const late = latePolicyColumns(input.kind, {
      dueAt: toTimestamp(input.dueAt ?? null),
      lateUntil: toTimestamp(input.lateUntil ?? null),
      mode: input.latePenaltyMode,
      value: input.latePenaltyValue,
      cap: input.latePenaltyCap,
    });

    // Offline work is never handed in online, so it accepts nothing.
    const online = input.kind === 'assignment';

    let data;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const created = await tx.activity.create({
          data: {
            course_id: courseId,
            assignment_group_id: input.assignmentGroupId ?? null,
            max_attempts:
              input.maxAttempts === 0 ? null : (input.maxAttempts ?? 1),
            time_limit_minutes:
              input.kind === 'quiz'
                ? (input.timeLimitMinutes ?? null)
                : null,
            lockdown_browser:
              input.kind === 'quiz' ? (input.lockdownBrowser ?? false) : false,
            shuffle_questions:
              input.kind === 'quiz' ? (input.shuffleQuestions ?? false) : false,
            shuffle_options:
              input.kind === 'quiz' ? (input.shuffleOptions ?? false) : false,
            kind: input.kind,
            title,
            instructions: input.instructions ?? null,
            points: input.points,
            due_at: toTimestamp(input.dueAt ?? null),
            allow_file: online ? (input.allowFile ?? false) : false,
            allow_multiple_files:
              online && input.allowFile
                ? (input.allowMultipleFiles ?? false)
                : false,
            allow_text: online ? (input.allowText ?? false) : false,
            ...late,
            created_by: userId,
          },
          select: ACTIVITY_SELECT,
        });
        await this.auditLog?.record(
          tx,
          course.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: created.id,
            action: 'create',
            changes: auditChanges(null, this.activityAuditFields(created)),
          },
        );
        return created;
      });
    } catch (error) {
      this.logger.error(
        `Failed to create activity: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to create activity');
    }

    return toActivity(data);
  }

  /**
   * An activity of this course with its own quiz questions (and options)
   * and bank draws, for making a copy. Course teachers and admins only
   * (MANAGE_ROLES); an activity of another course is reported as missing.
   */
  async sourceForCopy(userId: string, courseId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);
    if (activity.course_id !== courseId) {
      throw new NotFoundException('Activity not found');
    }
    const quiz = activity.kind === 'quiz';
    const [questions, draws] = await Promise.all([
      quiz
        ? this.prisma.quiz_question.findMany({
            where: { activity_id: activityId },
            select: {
              ...QUESTION_SELECT,
              quiz_option: { select: OPTION_SELECT, orderBy: { sort_order: 'asc' } },
            },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
          })
        : Promise.resolve([]),
      quiz
        ? this.prisma.quiz_bank_draw.findMany({
            where: { activity_id: activityId },
            select: { bank_id: true, draw_count: true, sort_order: true },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
          })
        : Promise.resolve([]),
    ]);
    return { activity, questions: questions ?? [], draws: draws ?? [] };
  }

  /**
   * A new draft copy of `source` in the same course with `text` in place of
   * its title, instructions, question prompts and option labels. Settings,
   * points, dates, assignment group, rubric, answer keys and bank draws are
   * copied as they are. Never submissions, marks, extensions,
   * accommodations, peer review, outcome alignments or module placement.
   * Returns the copy as `get` does.
   */
  async createCopy(userId: string, source: ActivityCopySource, text: ActivityCopyText) {
    const a = source.activity;
    if (text.questions.length !== source.questions.length) {
      throw new BadRequestException('The copy does not match its source');
    }
    const title = text.title.trim().slice(0, 200) || a.title;
    const id = randomUUID();
    const questions: Prisma.quiz_questionCreateManyInput[] = [];
    const options: Prisma.quiz_optionCreateManyInput[] = [];
    source.questions.forEach((q, qi) => {
      const questionId = randomUUID();
      const t = text.questions[qi];
      questions.push({
        id: questionId,
        activity_id: id,
        prompt: t.prompt.trim() || q.prompt,
        kind: q.kind,
        points: q.points,
        sort_order: q.sort_order,
        numeric_answer: q.numeric_answer,
        numeric_tolerance: q.numeric_tolerance,
        partial_credit: q.partial_credit,
        rubric_id: q.rubric_id,
        file_types: q.file_types,
        file_max_mb: q.file_max_mb,
      });
      q.quiz_option.forEach((o, oi) => {
        const ot = t.options[oi];
        options.push({
          question_id: questionId,
          label: ot?.label.trim() ? ot.label : o.label,
          is_correct: o.is_correct,
          sort_order: o.sort_order,
          match_label: o.match_label === null ? null : ot?.matchLabel?.trim() ? ot.matchLabel : o.match_label,
        });
      });
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.activity.create({
          data: {
            id,
            course_id: a.course_id,
            assignment_group_id: a.assignment_group_id,
            kind: a.kind,
            title,
            instructions: text.instructions ?? a.instructions,
            points: a.points,
            due_at: a.due_at,
            status: 'draft',
            allow_file: a.allow_file,
            allow_multiple_files: a.allow_multiple_files,
            allow_text: a.allow_text,
            max_attempts: a.max_attempts,
            time_limit_minutes: a.time_limit_minutes,
            lockdown_browser: a.lockdown_browser,
            shuffle_questions: a.shuffle_questions,
            shuffle_options: a.shuffle_options,
            omit_from_final_grade: a.omit_from_final_grade,
            rubric_id: a.rubric_id,
            late_until: a.late_until,
            late_penalty_mode: a.late_penalty_mode,
            late_penalty_value: a.late_penalty_value,
            late_penalty_cap: a.late_penalty_cap,
            created_by: userId,
          },
          select: ACTIVITY_SELECT,
        });
        if (questions.length) await tx.quiz_question.createMany({ data: questions });
        if (options.length) await tx.quiz_option.createMany({ data: options });
        if (source.draws.length) {
          await tx.quiz_bank_draw.createMany({
            data: source.draws.map((d) => ({
              activity_id: id,
              bank_id: d.bank_id,
              draw_count: d.draw_count,
              sort_order: d.sort_order,
            })),
          });
        }
        await this.auditLog?.record(
          tx,
          a.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: id,
            action: 'create',
            changes: auditChanges(null, {
              ...this.activityAuditFields(created),
              copiedFrom: a.id,
            }),
          },
        );
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to copy activity: ${(error as Error).message}`);
      throw new BadRequestException('Failed to copy activity');
    }

    return this.get(userId, id);
  }

  async update(
    userId: string,
    activityId: string,
    patch: {
      title?: string;
      instructions?: string | null;
      points?: number;
      dueAt?: string | null;
      assignmentGroupId?: string | null;
      omitFromFinalGrade?: boolean;
      allowFile?: boolean;
      allowMultipleFiles?: boolean;
      allowText?: boolean;
      maxAttempts?: number | null;
      timeLimitMinutes?: number | null;
      lockdownBrowser?: boolean;
      shuffleQuestions?: boolean;
      shuffleOptions?: boolean;
      lateUntil?: string | null;
      latePenaltyMode?: LatePenaltyMode;
      latePenaltyValue?: number | null;
      latePenaltyCap?: number | null;
    },
  ) {
    const activity = await this.requireActivity(userId, activityId);

    const changes: Prisma.activityUncheckedUpdateInput = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Give the activity a title');
      changes.title = title;
    }
    if (patch.instructions !== undefined)
      changes.instructions = patch.instructions;
    // Checked against the marks, and quiz scores rescaled, inside the update
    // below.
    if (patch.points !== undefined) changes.points = patch.points;
    if (patch.dueAt !== undefined) changes.due_at = toTimestamp(patch.dueAt);
    if (patch.assignmentGroupId !== undefined) {
      if (patch.assignmentGroupId) {
        await this.requireGroupInCourse(
          activity.course_id,
          patch.assignmentGroupId,
        );
      }
      changes.assignment_group_id = patch.assignmentGroupId;
    }
    if (patch.omitFromFinalGrade !== undefined) {
      changes.omit_from_final_grade = patch.omitFromFinalGrade;
    }
    if (activity.kind === 'assignment') {
      if (patch.allowFile !== undefined) changes.allow_file = patch.allowFile;
      if (patch.allowMultipleFiles !== undefined) {
        if (
          patch.allowMultipleFiles &&
          (patch.allowFile === false || !activity.allow_file)
        ) {
          throw new BadRequestException(
            'Multiple files can only be allowed when file uploads are enabled',
          );
        }
        changes.allow_multiple_files = patch.allowMultipleFiles;
      } else if (patch.allowFile === false) {
        changes.allow_multiple_files = false;
      }
      if (patch.allowText !== undefined) changes.allow_text = patch.allowText;
    }
    if (patch.maxAttempts !== undefined) {
      changes.max_attempts = patch.maxAttempts || null;
    }
    if (patch.timeLimitMinutes !== undefined) {
      if (activity.kind !== 'quiz' && patch.timeLimitMinutes !== null) {
        throw new BadRequestException('Only quizzes can have a time limit');
      }
      if (
        patch.timeLimitMinutes !== null &&
        (!Number.isInteger(patch.timeLimitMinutes) ||
          patch.timeLimitMinutes < 1 ||
          patch.timeLimitMinutes > 1440)
      ) {
        throw new BadRequestException(
          'Time limit must be between 1 and 1440 minutes',
        );
      }
      changes.time_limit_minutes = patch.timeLimitMinutes;
    }
    if (patch.lockdownBrowser !== undefined) {
      if (activity.kind !== 'quiz' && patch.lockdownBrowser) {
        throw new BadRequestException('Only quizzes can require lockdown browser');
      }
      changes.lockdown_browser = patch.lockdownBrowser;
    }
    for (const [key, column] of [
      ['shuffleQuestions', 'shuffle_questions'],
      ['shuffleOptions', 'shuffle_options'],
    ] as const) {
      if (patch[key] === undefined) continue;
      if (activity.kind !== 'quiz' && patch[key]) {
        throw new BadRequestException('Only quizzes can be shuffled');
      }
      // Each attempt's order is fixed when it starts, so a change applies to
      // attempts started afterwards.
      changes[column] = patch[key];
    }

    // The late policy is checked as a whole against the dates it will have.
    const lateTouched =
      patch.lateUntil !== undefined ||
      patch.latePenaltyMode !== undefined ||
      patch.latePenaltyValue !== undefined ||
      patch.latePenaltyCap !== undefined;
    if (lateTouched || patch.dueAt !== undefined) {
      const mode =
        patch.latePenaltyMode ??
        (activity.late_penalty_mode);
      const keepNumbers = patch.latePenaltyMode === undefined;
      Object.assign(
        changes,
        latePolicyColumns(activity.kind, {
          dueAt:
            patch.dueAt !== undefined
              ? toTimestamp(patch.dueAt)
              : activity.due_at,
          lateUntil:
            patch.lateUntil !== undefined
              ? toTimestamp(patch.lateUntil)
              : activity.late_until,
          mode,
          value:
            patch.latePenaltyValue !== undefined || !keepNumbers
              ? (patch.latePenaltyValue ?? null)
              : numberOrNull(activity.late_penalty_value),
          cap:
            patch.latePenaltyCap !== undefined || !keepNumbers
              ? (patch.latePenaltyCap ?? null)
              : numberOrNull(activity.late_penalty_cap),
        }),
      );
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date();

    let data;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        if (patch.points !== undefined) {
          await this.changePoints(tx, activityId, patch.points);
        }
        const updated = await tx.activity.update({
          where: { id: activityId },
          data: changes,
          select: ACTIVITY_SELECT,
        });
        if (patch.dueAt !== undefined || patch.lateUntil !== undefined) {
          // Untimed attempts end at the due date (or, started late, when
          // late work closes); students with their own extension keep theirs.
          await syncUntimedQuizAttempts(
            tx,
            updated,
            {
              student: {
                activity_extension: { none: { activity_id: activityId } },
              },
            },
            updated.due_at,
            updated.late_until ?? updated.due_at,
          );
        }
        if (lateTouched || patch.dueAt !== undefined || patch.points !== undefined) {
          // Lateness and penalties follow the new dates and policy.
          await refreshLateness(tx, activityId);
        }
        if (patch.points !== undefined) {
          // Whole-activity evidence is the mark over the points.
          await refreshOutcomeEvidence(tx, activityId);
        }
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: activityId,
            action: 'update',
            changes: auditChanges(
              this.activityAuditFields(activity),
              this.activityAuditFields(updated),
            ),
          },
        );
        return updated;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to update activity: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to update activity');
    }

    return toActivity(data);
  }

  private activityAuditFields(activity: any) {
    return {
      assignmentGroupId: activity.assignment_group_id,
      kind: activity.kind,
      title: activity.title,
      instructions: activity.instructions,
      points: Number(activity.points),
      dueAt: activity.due_at,
      status: activity.status,
      allowFile: activity.allow_file,
      allowMultipleFiles: activity.allow_multiple_files,
      allowText: activity.allow_text,
      maxAttempts: activity.max_attempts,
      timeLimitMinutes: activity.time_limit_minutes,
      lockdownBrowser: activity.lockdown_browser,
      shuffleQuestions: activity.shuffle_questions,
      shuffleOptions: activity.shuffle_options,
      omitFromFinalGrade: activity.omit_from_final_grade,
      rubricId: activity.rubric_id,
      lateUntil: activity.late_until ?? null,
      latePenaltyMode: activity.late_penalty_mode ?? 'none',
      latePenaltyValue: numberOrNull(activity.late_penalty_value),
      latePenaltyCap: numberOrNull(activity.late_penalty_cap),
    };
  }

  /**
   * Make way for new points, in the transaction that saves them.
   *
   * The activity row is locked first; marking takes a share lock on it
   * (SubmissionService.grade), so no mark can be written against the old
   * points between the check here and the commit.
   *
   * submit_quiz stores a quiz's automatic score already scaled to the points,
   * so those scores are rescaled by new/old to stay the same fraction. From 0
   * points there is no fraction to keep (every automatic score is 0), so
   * they are scored again from their stored answers instead, by submit_quiz's
   * rules (rescoreQuizFromAnswers). A mark a teacher entered or imported
   * (graded_by set) is theirs and is left as it is, which is why it must
   * still fit under the new points.
   */
  private async changePoints(
    tx: Prisma.TransactionClient,
    activityId: string,
    points: number,
  ) {
    const [locked] = await tx.$queryRaw<
      { kind: string; points: Prisma.Decimal | number }[]
    >`
      select kind, points from grading.activity
      where id = ${activityId}::uuid
      for update
    `;
    if (!locked) throw new NotFoundException('Activity not found');

    const old = Number(locked.points);
    // Automatic quiz scores follow the points: rescaled, or (from 0) rescored.
    const autoScored = locked.kind === 'quiz' && old !== points;
    const rescale = autoScored && old > 0;

    // A mark above the new total would read as over 100% everywhere.
    const over = await tx.submission.findFirst({
      where: {
        activity_id: activityId,
        score: { gt: points },
        ...(autoScored ? { graded_by: { not: null } } : {}),
      },
      select: { id: true },
    });
    if (over) {
      throw new BadRequestException(
        `Some marks are above ${points} points; change them before lowering the points`,
      );
    }

    if (rescale) {
      await tx.$executeRaw`
        update grading.submission
        set score = score * ${points}::numeric / ${old}::numeric,
            raw_score = raw_score * ${points}::numeric / ${old}::numeric,
            updated_at = now()
        where activity_id = ${activityId}::uuid
          and graded_by is null
          and score is not null
      `;
    } else if (autoScored) {
      await rescoreQuizFromAnswers(tx, activityId, points);
    }
  }

  /**
   * Open the activity to students. The submission is the mark now, so there
   * is no gradebook row to create first - publishing is just the status.
   */
  async publish(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);

    if (activity.status === 'published') {
      throw new ConflictException('This activity is already published');
    }

    if (activity.kind === 'quiz') {
      const [count, draws] = await Promise.all([
        this.prisma.quiz_question.count({ where: { activity_id: activityId } }),
        this.prisma.quiz_bank_draw.count({ where: { activity_id: activityId } }),
      ]);

      if ((count ?? 0) === 0 && (draws ?? 0) === 0) {
        throw new BadRequestException(
          'Add a question, or draw from a question bank, before publishing',
        );
      }
    }

    const now = new Date();
    let data;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.activity.update({
          where: { id: activityId },
          data: {
            status: 'published',
            // Reopening closed work keeps the date it first went out.
            published_at: activity.published_at ?? now,
            updated_at: now,
          },
          select: ACTIVITY_SELECT,
        });
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: activityId,
            action: 'update',
            changes: auditChanges(
              { status: activity.status },
              { status: updated.status },
            ),
          },
        );
        return updated;
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish activity: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to publish activity');
    }

    // Fire and forget: publishing never waits on notices or pushes.
    void this.notices?.activityPublished(activity.course_id, {
      id: activityId,
      title: data.title,
      kind: data.kind,
    });
    const published = data as {
      id: string;
      title: string;
      kind: string;
      points: unknown;
      due_at: Date | string | null;
    };
    void this.webhooks?.emitForCourse(
      activity.course_id,
      'activity.published',
      (course) => ({
        activity: {
          ...toActivityRef(published),
          dueAt: published.due_at
            ? new Date(published.due_at).toISOString()
            : null,
        },
        course,
      }),
    );

    return toActivity(data);
  }

  /** Stop accepting submissions without hiding what was already set. */
  async close(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);

    let data;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.activity.update({
          where: { id: activityId },
          data: { status: 'closed', updated_at: new Date() },
          select: ACTIVITY_SELECT,
        });
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: activityId,
            action: 'update',
            changes: auditChanges(
              { status: activity.status },
              { status: updated.status },
            ),
          },
        );
        return updated;
      });
    } catch {
      throw new BadRequestException('Failed to close activity');
    }
    return toActivity(data);
  }

  /**
   * Deleting takes the submissions - and so the marks - with it, so an
   * activity with work against it is refused; closing it, or omitting it from
   * the final grade, is what a teacher usually wants.
   */
  async remove(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const count = await tx.submission.count({
          where: { activity_id: activityId },
        });
        if (count > 0) {
          throw new ConflictException(
            'Students have work or marks on this; close it instead of deleting',
          );
        }
        await tx.activity.deleteMany({ where: { id: activityId } });
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'activity',
            entityId: activityId,
            action: 'delete',
            changes: auditChanges(this.activityAuditFields(activity), null),
          },
        );
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('Failed to delete activity');
    }
  }

  // ── quiz questions ────────────────────────────────────────────────────────

  /**
   * The quiz a question belongs to, checked to be the caller's and still a
   * draft.
   *
   * Questions stop being editable at publish: submit_quiz scores an answer
   * against the option the student picked, so changing prompts, points or the
   * answer key afterwards would silently rescore work already handed in.
   */
  private async requireDraftQuiz(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);

    if (activity.kind !== 'quiz') {
      throw new BadRequestException('Only quizzes have questions');
    }
    if (activity.status !== 'draft') {
      throw new ConflictException(
        'This quiz is published; questions can only change while it is a draft',
      );
    }

    return activity;
  }

  async addQuestion(
    userId: string,
    activityId: string,
    input: QuestionInput,
  ) {
    const activity = await this.requireDraftQuiz(userId, activityId);

    // One transaction: a question left with no options would make the quiz
    // unanswerable, so a failed option insert takes the question with it.
    let question;
    try {
      question = await this.prisma.$transaction(async (tx) => {
        const created = await createQuestion(
          tx,
          { activityId },
          activity.course_id,
          input,
        );
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'quiz_question',
            entityId: created.id,
            action: 'create',
            changes: auditChanges(null, questionAudit(created)),
          },
        );
        return created;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to add question: ${(error as Error).message}`);
      throw new BadRequestException('Failed to add question');
    }
    return question;
  }

  /**
   * Edit a question in place. Options are replaced wholesale rather than
   * patched one by one: the editor hands back the whole list, and a draft has
   * no answers pointing at the old rows.
   */
  async updateQuestion(
    userId: string,
    activityId: string,
    questionId: string,
    patch: QuestionPatch,
  ) {
    const activity = await this.requireDraftQuiz(userId, activityId);

    const existing = await this.prisma.quiz_question.findFirst({
      where: { id: questionId, activity_id: activityId },
      select: QUESTION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('Question not found');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const { before, after } = await updateQuestionRow(
          tx,
          existing,
          activity.course_id,
          patch,
        );
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'quiz_question',
            entityId: questionId,
            action: 'update',
            changes: auditChanges(questionAudit(before), questionAudit(after)),
          },
        );
        return after;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to update question: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to save the question');
    }
  }

  async removeQuestion(userId: string, activityId: string, questionId: string) {
    const activity = await this.requireDraftQuiz(userId, activityId);

    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.quiz_question.findFirst({
          where: { id: questionId, activity_id: activityId },
          select: { id: true, prompt: true, kind: true, points: true },
        });
        if (!before) return;
        const options = await tx.quiz_option.findMany({
          where: { question_id: questionId },
          select: { label: true, is_correct: true, sort_order: true },
          orderBy: { sort_order: 'asc' },
        });
        await tx.quiz_question.deleteMany({
          where: { id: questionId, activity_id: activityId },
        });
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'quiz_question',
            entityId: questionId,
            action: 'delete',
            changes: auditChanges(
              {
                prompt: before.prompt,
                kind: before.kind,
                points: Number(before.points),
                options: options.map((option) => ({
                  label: option.label,
                  isCorrect: option.is_correct,
                  sortOrder: option.sort_order,
                })),
              },
              null,
            ),
          },
        );
      });
    } catch {
      throw new BadRequestException('Failed to remove question');
    }
  }
}
