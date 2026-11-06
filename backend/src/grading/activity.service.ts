import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
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

type QuestionKind = 'multiple_choice' | 'true_false' | 'short_answer';

const QUESTION_SELECT = {
  id: true,
  prompt: true,
  kind: true,
  points: true,
  sort_order: true,
} satisfies Prisma.quiz_questionSelect;

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

  /** One activity, with its questions when it is a quiz. */
  async get(userId: string, activityId: string, includeAnswers = true) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      STAFF_ROLES,
    );

    if (activity.kind !== 'quiz') {
      return { ...toActivity(activity), questions: [] };
    }

    const questions = await this.prisma.quiz_question.findMany({
      where: { activity_id: activityId },
      select: QUESTION_SELECT,
      orderBy: { sort_order: 'asc' },
    });

    const questionIds = questions.map((q) => q.id);

    const options = questionIds.length
      ? await this.prisma.quiz_option.findMany({
          where: { question_id: { in: questionIds } },
          select: {
            id: true,
            question_id: true,
            label: true,
            is_correct: true,
            sort_order: true,
          },
          orderBy: { sort_order: 'asc' },
        })
      : [];

    return {
      ...toActivity(activity),
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        points: Number(q.points),
        sortOrder: q.sort_order,
        options: options
          .filter((o) => o.question_id === q.id)
          .map((o) => ({
            id: o.id,
            label: o.label,
            sortOrder: o.sort_order,
            ...(includeAnswers ? { isCorrect: o.is_correct } : {}),
          })),
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
        if (patch.dueAt !== undefined) {
          // Untimed attempts end at the due date; students with their own
          // extension keep theirs.
          await syncUntimedQuizAttempts(
            tx,
            updated,
            {
              student: {
                activity_extension: { none: { activity_id: activityId } },
              },
            },
            updated.due_at,
          );
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
      omitFromFinalGrade: activity.omit_from_final_grade,
      rubricId: activity.rubric_id,
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
      const count = await this.prisma.quiz_question.count({
        where: { activity_id: activityId },
      });

      if ((count ?? 0) === 0) {
        throw new BadRequestException('Add a question before publishing');
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

  /**
   * Shared by adding and editing. What counts as valid depends on the kind:
   * the choice kinds need several options with exactly one right, while a
   * short answer needs at least one accepted wording and every one of them
   * counts as right.
   */
  private validateOptions(
    kind: QuestionKind,
    options: { label: string; isCorrect: boolean }[],
  ) {
    if (options.some((o) => !o.label.trim())) {
      throw new BadRequestException('Give every option a label');
    }

    if (kind === 'short_answer') {
      if (options.length < 1) {
        throw new BadRequestException('Add at least one accepted answer');
      }
      return;
    }

    if (options.length < 2) {
      throw new BadRequestException('A question needs at least two options');
    }
    if (!options.some((o) => o.isCorrect)) {
      throw new BadRequestException('Mark one option as correct');
    }
    // Auto-grading picks a single option, so several correct ones would make
    // the score ambiguous rather than generous.
    if (options.filter((o) => o.isCorrect).length > 1) {
      throw new BadRequestException('Only one option can be correct');
    }
  }

  async addQuestion(
    userId: string,
    activityId: string,
    input: {
      prompt: string;
      kind: QuestionKind;
      points?: number;
      options: { label: string; isCorrect: boolean }[];
    },
  ) {
    const activity = await this.requireDraftQuiz(userId, activityId);

    const prompt = input.prompt.trim();
    if (!prompt) throw new BadRequestException('Give the question a prompt');

    // Every accepted wording of a short answer is a right answer, so the
    // editor need not flag them one by one.
    const options =
      input.kind === 'short_answer'
        ? input.options.map((o) => ({ ...o, isCorrect: true }))
        : input.options;

    this.validateOptions(input.kind, options);

    const last = await this.prisma.quiz_question.findFirst({
      where: { activity_id: activityId },
      select: { sort_order: true },
      orderBy: { sort_order: 'desc' },
    });

    // One transaction: a question left with no options would make the quiz
    // unanswerable, so a failed option insert takes the question with it.
    const question = await this.prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.quiz_question.create({
          data: {
            activity_id: activityId,
            prompt,
            kind: input.kind,
            points: input.points ?? 1,
            sort_order: (last?.sort_order ?? -1) + 1,
          },
          select: QUESTION_SELECT,
        });
      } catch (error) {
        this.logger.error(
          `Failed to add question: ${(error as Error).message}`,
        );
        throw new BadRequestException('Failed to add question');
      }

      try {
        await tx.quiz_option.createMany({
          data: options.map((o, i) => ({
            question_id: created.id,
            label: o.label,
            is_correct: o.isCorrect,
            sort_order: i,
          })),
        });
      } catch {
        throw new BadRequestException('Failed to add question options');
      }
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'quiz_question',
          entityId: created.id,
          action: 'create',
          changes: auditChanges(null, {
            prompt: created.prompt,
            kind: created.kind,
            points: Number(created.points),
            options: options.map((option, i) => ({
              label: option.label.trim(),
              isCorrect: option.isCorrect,
              sortOrder: i,
            })),
          }),
        },
      );

      return created;
    });

    return {
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      points: Number(question.points),
      sortOrder: question.sort_order,
    };
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
    patch: {
      prompt?: string;
      points?: number;
      options?: { label: string; isCorrect: boolean }[];
    },
  ) {
    const activity = await this.requireDraftQuiz(userId, activityId);

    const existing = await this.prisma.quiz_question.findFirst({
      where: { id: questionId, activity_id: activityId },
      select: QUESTION_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Question not found');
    }

    const changes: Prisma.quiz_questionUncheckedUpdateInput = {};
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw new BadRequestException('Give the question a prompt');
      changes.prompt = prompt;
    }
    if (patch.points !== undefined) changes.points = patch.points;

    const kind = existing.kind;
    const options =
      patch.options && kind === 'short_answer'
        ? patch.options.map((o) => ({ ...o, isCorrect: true }))
        : patch.options;

    if (options) {
      this.validateOptions(kind, options);
    }

    if (Object.keys(changes).length === 0 && !options) {
      throw new BadRequestException('Nothing to update');
    }

    // One transaction, so a failed option insert cannot leave the question
    // with no options (unanswerable) or half-edited.
    await this.prisma.$transaction(async (tx) => {
      const oldOptions = await tx.quiz_option.findMany({
        where: { question_id: questionId },
        select: { label: true, is_correct: true, sort_order: true },
        orderBy: { sort_order: 'asc' },
      });
      if (Object.keys(changes).length > 0) {
        try {
          await tx.quiz_question.update({
            where: { id: questionId },
            data: changes,
          });
        } catch (error) {
          this.logger.error(
            `Failed to update question: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to save the question');
        }
      }

      if (options) {
        try {
          await tx.quiz_option.deleteMany({
            where: { question_id: questionId },
          });
        } catch (error) {
          this.logger.error(
            `Failed to clear options: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to save the options');
        }

        try {
          await tx.quiz_option.createMany({
            data: options.map((o, i) => ({
              question_id: questionId,
              label: o.label.trim(),
              is_correct: o.isCorrect,
              sort_order: i,
            })),
          });
        } catch (error) {
          this.logger.error(
            `Failed to save options for question ${questionId}: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to save the options');
        }
      }
      const nextOptions = options
        ? options.map((option, i) => ({
            label: option.label.trim(),
            isCorrect: option.isCorrect,
            sortOrder: i,
          }))
        : oldOptions.map((option) => ({
            label: option.label,
            isCorrect: option.is_correct,
            sortOrder: option.sort_order,
          }));
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'quiz_question',
          entityId: questionId,
          action: 'update',
          changes: auditChanges(
            {
              prompt: existing.prompt,
              points: Number(existing.points),
              options: oldOptions.map((option) => ({
                label: option.label,
                isCorrect: option.is_correct,
                sortOrder: option.sort_order,
              })),
            },
            {
              prompt: changes.prompt ?? existing.prompt,
              points: changes.points ?? Number(existing.points),
              options: nextOptions,
            },
          ),
        },
      );
    });

    return this.getQuestion(activityId, questionId);
  }

  /** One question with its options, as the editor redraws it after a save. */
  private async getQuestion(activityId: string, questionId: string) {
    const question = await this.prisma.quiz_question.findFirst({
      where: { id: questionId, activity_id: activityId },
      select: QUESTION_SELECT,
    });

    const options = await this.prisma.quiz_option.findMany({
      where: { question_id: questionId },
      select: { id: true, label: true, is_correct: true, sort_order: true },
      orderBy: { sort_order: 'asc' },
    });

    return {
      id: question!.id,
      prompt: question!.prompt,
      kind: question!.kind,
      points: Number(question!.points),
      sortOrder: question!.sort_order,
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        isCorrect: o.is_correct,
      })),
    };
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
