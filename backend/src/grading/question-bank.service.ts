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
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
  type CourseRole,
} from '@/course/access/course-access.service';
import { ts } from './activity.mapper';
import {
  createQuestion,
  loadQuestions,
  questionAudit,
  QUESTION_SELECT,
  updateQuestionRow,
  type QuestionInput,
  type QuestionPatch,
} from './question-write';

const MAX_DRAWS = 20;

/**
 * Question banks: a course's reusable pools of quiz questions. A quiz draws
 * a number of random questions from a bank for each student
 * (grading.quiz_bank_draw); the draw is made, and stored, when the
 * student's attempt starts (SubmissionService.startQuizAttempt).
 *
 * A bank question that some attempt has been given is frozen, like a
 * published quiz's own questions: changing it would silently rescore work
 * already handed in. A bank is kept while any attempt used one of its
 * questions, or a published quiz draws from it.
 */
@Injectable()
export class QuestionBankService {
  private readonly logger = new Logger(QuestionBankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  private async requireBank(
    userId: string,
    bankId: string,
    roles: readonly CourseRole[] = MANAGE_ROLES,
  ) {
    const bank = await this.prisma.question_bank.findUnique({
      where: { id: bankId },
      select: { id: true, course_id: true, title: true, created_at: true, updated_at: true },
    });
    if (!bank) throw new NotFoundException('Question bank not found');
    const { course } = await this.access.require(userId, bank.course_id, roles);
    return { ...bank, school_id: course.school_id };
  }

  private toBank(
    row: { id: string; course_id: string; title: string; created_at: Date; updated_at: Date },
    questionCount: number,
  ) {
    return {
      id: row.id,
      courseId: row.course_id,
      title: row.title,
      questionCount,
      createdAt: ts(row.created_at) as string,
      updatedAt: ts(row.updated_at) as string,
    };
  }

  /** The course's banks, with how many questions each holds. */
  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const banks = await this.prisma.question_bank.findMany({
      where: { course_id: courseId },
      select: {
        id: true,
        course_id: true,
        title: true,
        created_at: true,
        updated_at: true,
        _count: { select: { quiz_question: true } },
      },
      orderBy: { title: 'asc' },
    });
    return (banks ?? []).map((b) => this.toBank(b, b._count?.quiz_question ?? 0));
  }

  async create(userId: string, courseId: string, input: { title: string }) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the bank a title');
    const bank = await this.prisma.$transaction(async (tx) => {
      const created = await tx.question_bank.create({
        data: { course_id: courseId, title, created_by: userId },
        select: { id: true, course_id: true, title: true, created_at: true, updated_at: true },
      });
      await this.auditLog?.record(tx, course.school_id, { id: userId }, {
        entity: 'question_bank',
        entityId: created.id,
        action: 'create',
        changes: auditChanges(null, { title }),
      });
      return created;
    });
    return this.toBank(bank, 0);
  }

  /** One bank with its questions, answer key included (staff only). */
  async get(userId: string, bankId: string) {
    const bank = await this.requireBank(userId, bankId, STAFF_ROLES);
    const questions = await loadQuestions(this.prisma, { bank_id: bankId });
    const used = await this.usedQuestionIds(questions.map((q) => q.id));
    return {
      ...this.toBank(bank, questions.length),
      questions: questions.map((q) => ({ ...q, locked: used.has(q.id) })),
    };
  }

  async rename(userId: string, bankId: string, input: { title: string }) {
    const bank = await this.requireBank(userId, bankId);
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the bank a title');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.question_bank.update({
        where: { id: bankId },
        data: { title, updated_at: new Date() },
        select: { id: true, course_id: true, title: true, created_at: true, updated_at: true },
      });
      await this.auditLog?.record(tx, bank.school_id, { id: userId }, {
        entity: 'question_bank',
        entityId: bankId,
        action: 'update',
        changes: auditChanges({ title: bank.title }, { title }),
      });
      return row;
    });
    const count = await this.prisma.quiz_question.count({ where: { bank_id: bankId } });
    return this.toBank(updated, count ?? 0);
  }

  async remove(userId: string, bankId: string) {
    const bank = await this.requireBank(userId, bankId);
    const [drawn, published] = await Promise.all([
      this.prisma.quiz_attempt_question.count({
        where: { quiz_question: { bank_id: bankId } },
      }),
      this.prisma.quiz_bank_draw.count({
        where: { bank_id: bankId, activity: { status: { not: 'draft' } } },
      }),
    ]);
    if ((drawn ?? 0) > 0 || (published ?? 0) > 0) {
      throw new ConflictException(
        'Students have been given questions from this bank, so it is kept',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.question_bank.delete({ where: { id: bankId } });
      await this.auditLog?.record(tx, bank.school_id, { id: userId }, {
        entity: 'question_bank',
        entityId: bankId,
        action: 'delete',
        changes: auditChanges({ title: bank.title }, null),
      });
    });
  }

  /** Bank questions some attempt has been given. */
  private async usedQuestionIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.quiz_attempt_question.findMany({
      where: { question_id: { in: ids } },
      select: { question_id: true },
      distinct: ['question_id'],
    });
    return new Set((rows ?? []).map((r) => r.question_id));
  }

  private async requireEditableQuestion(bankId: string, questionId: string) {
    const question = await this.prisma.quiz_question.findFirst({
      where: { id: questionId, bank_id: bankId },
      select: QUESTION_SELECT,
    });
    if (!question) throw new NotFoundException('Question not found');
    if ((await this.usedQuestionIds([questionId])).size > 0) {
      throw new ConflictException(
        'Students have been given this question, so it can no longer change; add a new one instead',
      );
    }
    return question;
  }

  async addQuestion(userId: string, bankId: string, input: QuestionInput) {
    const bank = await this.requireBank(userId, bankId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await createQuestion(tx, { bankId }, bank.course_id, input);
        await this.auditLog?.record(tx, bank.school_id, { id: userId }, {
          entity: 'quiz_question',
          entityId: created.id,
          action: 'create',
          changes: auditChanges(null, { bankId, ...questionAudit(created) }),
        });
        return { ...created, locked: false };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to add bank question: ${(error as Error).message}`);
      throw new BadRequestException('Failed to add question');
    }
  }

  async updateQuestion(
    userId: string,
    bankId: string,
    questionId: string,
    patch: QuestionPatch,
  ) {
    const bank = await this.requireBank(userId, bankId);
    const existing = await this.requireEditableQuestion(bankId, questionId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { before, after } = await updateQuestionRow(tx, existing, bank.course_id, patch);
        await this.auditLog?.record(tx, bank.school_id, { id: userId }, {
          entity: 'quiz_question',
          entityId: questionId,
          action: 'update',
          changes: auditChanges(questionAudit(before), questionAudit(after)),
        });
        return { ...after, locked: false };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to update bank question: ${(error as Error).message}`);
      throw new BadRequestException('Failed to save the question');
    }
  }

  async removeQuestion(userId: string, bankId: string, questionId: string) {
    const bank = await this.requireBank(userId, bankId);
    const existing = await this.requireEditableQuestion(bankId, questionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.quiz_question.delete({ where: { id: questionId } });
      await this.auditLog?.record(tx, bank.school_id, { id: userId }, {
        entity: 'quiz_question',
        entityId: questionId,
        action: 'delete',
        changes: auditChanges(
          { bankId, prompt: existing.prompt, kind: existing.kind, points: Number(existing.points) },
          null,
        ),
      });
    });
  }

  /**
   * Replace a draft quiz's bank draws: `count` random questions from each
   * bank, per student. Banks must be in the quiz's course and hold at least
   * `count` questions; a bank appears once.
   */
  async setDraws(
    userId: string,
    activityId: string,
    draws: { bankId: string; count: number }[],
  ) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, kind: true, status: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(userId, activity.course_id, MANAGE_ROLES);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('Only quizzes draw from question banks');
    }
    if (activity.status !== 'draft') {
      throw new ConflictException(
        'This quiz is published; its questions can only change while it is a draft',
      );
    }
    if (draws.length > MAX_DRAWS) {
      throw new BadRequestException(`A quiz can draw from at most ${MAX_DRAWS} banks`);
    }
    const ids = draws.map((d) => d.bankId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Draw from each bank once');
    }
    const banks = ids.length
      ? await this.prisma.question_bank.findMany({
          where: { id: { in: ids }, course_id: activity.course_id },
          select: { id: true, title: true, _count: { select: { quiz_question: true } } },
        })
      : [];
    const bankOf = new Map((banks ?? []).map((b) => [b.id, b]));
    for (const d of draws) {
      const bank = bankOf.get(d.bankId);
      if (!bank) throw new NotFoundException('Question bank not found');
      if (!Number.isInteger(d.count) || d.count < 1) {
        throw new BadRequestException('Draw at least one question');
      }
      if (d.count > (bank._count?.quiz_question ?? 0)) {
        throw new BadRequestException(
          `"${bank.title}" has only ${bank._count?.quiz_question ?? 0} questions`,
        );
      }
    }

    const before = await this.prisma.quiz_bank_draw.findMany({
      where: { activity_id: activityId },
      select: { bank_id: true, draw_count: true },
      orderBy: { sort_order: 'asc' },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.quiz_bank_draw.deleteMany({ where: { activity_id: activityId } });
      if (draws.length) {
        await tx.quiz_bank_draw.createMany({
          data: draws.map((d, i) => ({
            activity_id: activityId,
            bank_id: d.bankId,
            draw_count: d.count,
            sort_order: i,
          })),
        });
      }
      await this.auditLog?.record(tx, course.school_id, { id: userId }, {
        entity: 'activity',
        entityId: activityId,
        action: 'update',
        changes: auditChanges(
          { bankDraws: (before ?? []).map((d) => ({ bankId: d.bank_id, count: d.draw_count })) },
          { bankDraws: draws },
        ),
      });
    });
    return draws.map((d) => ({
      bankId: d.bankId,
      bankTitle: bankOf.get(d.bankId)?.title ?? '',
      count: d.count,
    }));
  }
}
