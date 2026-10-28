import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { roundScore, scoreOrNull } from './round';
import { ts } from './activity.mapper';

/** What callers may hand in for a rubric's structure. */
export interface RubricInput {
  title: string;
  criteria: {
    title: string;
    description?: string | null;
    points: number;
    ratings: { label: string; description?: string | null; points: number }[];
  }[];
}

export interface AssessmentInput {
  criterionId: string;
  ratingId?: string | null;
  points?: number;
  comment?: string | null;
}

const RUBRIC_INCLUDE = {
  rubric_criterion: {
    orderBy: { position: 'asc' },
    include: { rubric_rating: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.rubricInclude;

type RubricRow = Prisma.rubricGetPayload<{ include: typeof RUBRIC_INCLUDE }>;

/** The `Rubric` contract. */
export function toRubric(r: RubricRow, assessed = false) {
  const criteria = r.rubric_criterion.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description ?? null,
    points: roundScore(Number(c.points)),
    ratings: c.rubric_rating.map((x) => ({
      id: x.id,
      label: x.label,
      description: x.description ?? null,
      points: roundScore(Number(x.points)),
    })),
  }));
  return {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    pointsPossible: roundScore(
      r.rubric_criterion.reduce((sum, c) => sum + Number(c.points), 0),
    ),
    criteria,
    // Used to mark someone: its criteria can no longer be changed.
    assessed,
    updatedAt: ts(r.updated_at),
  };
}

export type RubricDto = ReturnType<typeof toRubric>;

/** The `RubricAssessment` contract: one criterion's mark. */
function toAssessment(a: any) {
  return {
    criterionId: a.criterion_id as string,
    ratingId: (a.rating_id as string | null) ?? null,
    points: scoreOrNull(a.points) ?? 0,
    comment: (a.comment as string | null) ?? null,
  };
}

export type RubricAssessmentDto = ReturnType<typeof toAssessment>;

/**
 * Read one rubric with its criteria and levels. Exported for the portal's
 * work page, which reads it without the staff access checks below.
 */
export async function loadRubric(
  prisma: PrismaService,
  rubricId: string | null | undefined,
): Promise<RubricDto | null> {
  if (!rubricId) return null;
  const row = await prisma.rubric.findUnique({
    where: { id: rubricId },
    include: RUBRIC_INCLUDE,
  });
  return row ? toRubric(row) : null;
}

/** A submission's criterion marks against the given rubric. */
export async function loadAssessments(
  prisma: PrismaService,
  submissionIds: string[],
  rubric: RubricDto,
): Promise<Map<string, RubricAssessmentDto[]>> {
  const out = new Map<string, RubricAssessmentDto[]>();
  const ids = submissionIds.filter(Boolean);
  if (ids.length === 0) return out;

  // Only the current rubric's criteria: switching rubrics leaves the old
  // marks in place (they are history) but they no longer apply.
  const rows = await prisma.rubric_assessment.findMany({
    where: {
      submission_id: { in: ids },
      criterion_id: { in: rubric.criteria.map((c) => c.id) },
    },
    select: {
      submission_id: true,
      criterion_id: true,
      rating_id: true,
      points: true,
      comment: true,
    },
  });
  for (const row of rows) {
    const list = out.get(row.submission_id) ?? [];
    list.push(toAssessment(row));
    out.set(row.submission_id, list);
  }
  return out;
}

/**
 * Rubrics: reusable marking grids, owned by a course and attached to any of
 * its assignments or offline work.
 *
 * A rubric assessment is a record of how a mark was reached, not a second
 * mark: marking with a rubric writes the total to the submission's score,
 * which stays the single number every total reads. A teacher may override
 * that total, and the per-criterion record is kept alongside.
 */
@Injectable()
export class RubricService {
  private readonly logger = new Logger(RubricService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  /** Rubric ids in `ids` that have marked someone. */
  private async assessedIds(
    ids: string[],
    db: Pick<Prisma.TransactionClient, 'rubric_criterion'> = this.prisma,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await db.rubric_criterion.findMany({
      where: { rubric_id: { in: ids }, rubric_assessment: { some: {} } },
      select: { rubric_id: true },
    });
    return new Set(rows.map((r) => r.rubric_id));
  }

  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const rows = await this.prisma.rubric.findMany({
      where: { course_id: courseId },
      include: RUBRIC_INCLUDE,
      orderBy: [{ title: 'asc' }, { created_at: 'asc' }],
    });
    const assessed = await this.assessedIds(rows.map((r) => r.id));
    return rows.map((r) => toRubric(r, assessed.has(r.id)));
  }

  private async requireRubric(courseId: string, rubricId: string) {
    const row = await this.prisma.rubric.findFirst({
      where: { id: rubricId, course_id: courseId },
      include: RUBRIC_INCLUDE,
    });
    if (!row) throw new NotFoundException('Rubric not found');
    return row;
  }

  async get(userId: string, courseId: string, rubricId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    const row = await this.requireRubric(courseId, rubricId);
    const assessed = await this.assessedIds([row.id]);
    return toRubric(row, assessed.has(row.id));
  }

  /** Every level must fit inside its criterion. */
  private validate(input: RubricInput['criteria']) {
    for (const c of input) {
      for (const r of c.ratings) {
        if (r.points > c.points) {
          throw new BadRequestException(
            `"${r.label}" on "${c.title}" is worth more than the criterion (${c.points})`,
          );
        }
      }
    }
  }

  private async writeCriteria(
    tx: Prisma.TransactionClient,
    rubricId: string,
    criteria: RubricInput['criteria'],
  ) {
    for (const [i, c] of criteria.entries()) {
      await tx.rubric_criterion.create({
        data: {
          rubric_id: rubricId,
          title: c.title.trim(),
          description: c.description?.trim() || null,
          points: c.points,
          position: i,
          rubric_rating: {
            create: c.ratings.map((r, j) => ({
              label: r.label.trim(),
              description: r.description?.trim() || null,
              points: r.points,
              position: j,
            })),
          },
        },
      });
    }
  }

  async create(userId: string, courseId: string, input: RubricInput) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the rubric a title');
    this.validate(input.criteria);

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.rubric.create({
          data: { course_id: courseId, title, created_by: userId },
          select: { id: true },
        });
        await this.writeCriteria(tx, row.id, input.criteria);
        return row.id;
      });
    } catch (error) {
      this.logger.error(`Failed to create rubric: ${(error as Error).message}`);
      throw new BadRequestException('Failed to save the rubric');
    }
    return toRubric(await this.requireRubric(courseId, id));
  }

  /**
   * Rename, or replace the criteria. Criteria are swapped wholesale, so
   * once a rubric has marked anyone its structure is frozen: changing it
   * would leave those marks pointing at levels that no longer say what the
   * student was given.
   */
  async update(
    userId: string,
    courseId: string,
    rubricId: string,
    patch: Partial<RubricInput>,
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.requireRubric(courseId, rubricId);

    const title = patch.title?.trim();
    if (patch.title !== undefined && !title) {
      throw new BadRequestException('Give the rubric a title');
    }
    if (patch.title === undefined && patch.criteria === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    if (patch.criteria) this.validate(patch.criteria);

    try {
      await this.prisma.$transaction(async (tx) => {
        // The row lock orders this against assess(), which takes a share lock
        // on the same row: either its marks are visible to the check below,
        // or it waits and then finds these criteria gone.
        await tx.$queryRaw`
          select 1 from grading.rubric where id = ${rubricId}::uuid for update
        `;
        if (
          patch.criteria &&
          (await this.assessedIds([rubricId], tx)).size > 0
        ) {
          throw new ConflictException(
            'This rubric has been used for marking. Copy it to make changes.',
          );
        }
        await tx.rubric.update({
          where: { id: rubricId },
          data: { ...(title ? { title } : {}), updated_at: new Date() },
        });
        if (patch.criteria) {
          await tx.rubric_criterion.deleteMany({
            where: { rubric_id: rubricId },
          });
          await this.writeCriteria(tx, rubricId, patch.criteria);
        }
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.error(`Failed to update rubric: ${(error as Error).message}`);
      throw new BadRequestException('Failed to save the rubric');
    }
    return this.get(userId, courseId, rubricId);
  }

  /** A fresh, unassessed copy - the way to change a rubric already in use. */
  async copy(userId: string, courseId: string, rubricId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const source = toRubric(await this.requireRubric(courseId, rubricId));
    return this.create(userId, courseId, {
      title: `${source.title} (copy)`.slice(0, 200),
      criteria: source.criteria,
    });
  }

  /**
   * Activities using it are detached and its criterion marks go with it;
   * the scores those marks produced stay on the submissions.
   */
  async remove(userId: string, courseId: string, rubricId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const { count } = await this.prisma.rubric.deleteMany({
      where: { id: rubricId, course_id: courseId },
    });
    if (count === 0) throw new NotFoundException('Rubric not found');
  }

  private async requireActivity(
    userId: string,
    activityId: string,
    roles: typeof STAFF_ROLES,
  ) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        course_id: true,
        kind: true,
        points: true,
        status: true,
        rubric_id: true,
      },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.access.require(userId, activity.course_id, roles);
    return activity;
  }

  /** Attach a course rubric to an assignment or offline work, or detach. */
  async attach(userId: string, activityId: string, rubricId: string | null) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      MANAGE_ROLES,
    );
    if (rubricId && activity.kind === 'quiz') {
      throw new BadRequestException(
        'Quizzes are marked by their questions, not a rubric',
      );
    }
    if (rubricId) await this.requireRubric(activity.course_id, rubricId);

    await this.prisma.activity.update({
      where: { id: activityId },
      data: { rubric_id: rubricId, updated_at: new Date() },
    });
    return this.forActivity(userId, activityId);
  }

  /**
   * The marking screen's view: the activity's rubric and every student's
   * criterion marks, keyed by student id.
   */
  async forActivity(userId: string, activityId: string) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      STAFF_ROLES,
    );
    const rubric = await loadRubric(this.prisma, activity.rubric_id);
    const assessments: Record<string, RubricAssessmentDto[]> = {};
    if (!rubric) return { rubric, assessments };

    const submissions = await this.prisma.submission.findMany({
      where: { activity_id: activityId },
      select: { id: true, student_id: true },
    });
    const bySubmission = await loadAssessments(
      this.prisma,
      submissions.map((s) => s.id),
      rubric,
    );
    for (const s of submissions) {
      const list = bySubmission.get(s.id);
      if (list?.length) assessments[s.student_id] = list;
    }
    return { rubric, assessments };
  }

  /**
   * Mark one student with the activity's rubric. Each criterion gets a
   * level (its points by default) or bare points, and the score is their
   * sum unless the teacher overrides it. The submission and its criterion
   * marks are written together, replacing any earlier rubric marking.
   */
  async assess(
    userId: string,
    activityId: string,
    studentId: string,
    input: {
      assessments: AssessmentInput[];
      score?: number;
      feedback?: string;
    },
  ) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      STAFF_ROLES,
    );
    if (activity.status === 'draft') {
      throw new ConflictException('Publish this before marking it');
    }
    const rubric = await loadRubric(this.prisma, activity.rubric_id);
    if (!rubric) {
      throw new BadRequestException('This activity has no rubric');
    }

    const onRoster = await this.prisma.course_student.findFirst({
      where: { course_id: activity.course_id, student_id: studentId },
      select: { student_id: true },
    });
    if (!onRoster) {
      throw new NotFoundException('That student is not in this course');
    }

    const criteria = new Map(rubric.criteria.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const rows: {
      criterion_id: string;
      rating_id: string | null;
      points: number;
      comment: string | null;
    }[] = [];

    for (const a of input.assessments) {
      const criterion = criteria.get(a.criterionId);
      if (!criterion) {
        throw new BadRequestException('That criterion is not on this rubric');
      }
      if (seen.has(a.criterionId)) {
        throw new BadRequestException(
          `"${criterion.title}" is marked more than once`,
        );
      }
      seen.add(a.criterionId);

      const rating = a.ratingId
        ? criterion.ratings.find((r) => r.id === a.ratingId)
        : undefined;
      if (a.ratingId && !rating) {
        throw new BadRequestException(
          `That level is not one of "${criterion.title}"'s`,
        );
      }
      const points = a.points ?? rating?.points;
      if (points === undefined) {
        throw new BadRequestException(
          `Pick a level or give points for "${criterion.title}"`,
        );
      }
      if (points < 0 || points > criterion.points) {
        throw new BadRequestException(
          `"${criterion.title}" must be between 0 and ${criterion.points}`,
        );
      }
      rows.push({
        criterion_id: criterion.id,
        rating_id: rating?.id ?? null,
        points,
        comment: a.comment?.trim() || null,
      });
    }

    const max = Number(activity.points);
    const sum = roundScore(rows.reduce((s, r) => s + r.points, 0));
    const score = input.score ?? sum;
    if (score < 0 || score > max) {
      throw new BadRequestException(
        input.score === undefined
          ? `The rubric adds up to ${sum}, more than this is worth (${max}). Give a score to override it.`
          : `Score must be between 0 and ${max}`,
      );
    }

    const now = new Date();
    let marked;
    try {
      marked = await this.prisma.$transaction(async (tx) => {
        // Pairs with the lock in update(): the rubric's criteria cannot be
        // replaced while these marks are being written against them.
        await tx.$queryRaw`
          select 1 from grading.rubric where id = ${rubric.id}::uuid for share
        `;
        const fields = {
          status: 'graded' as const,
          score,
          feedback: input.feedback ?? null,
          graded_at: now,
          graded_by: userId,
          updated_at: now,
        };
        const submission = await tx.submission.upsert({
          where: {
            activity_id_student_id: {
              activity_id: activityId,
              student_id: studentId,
            },
          },
          create: { activity_id: activityId, student_id: studentId, ...fields },
          update: fields,
          select: {
            id: true,
            student_id: true,
            status: true,
            score: true,
            feedback: true,
            excused: true,
            excused_reason: true,
            graded_at: true,
          },
        });
        await tx.rubric_assessment.deleteMany({
          where: {
            submission_id: submission.id,
            criterion_id: { in: [...criteria.keys()] },
          },
        });
        if (rows.length) {
          await tx.rubric_assessment.createMany({
            data: rows.map((r) => ({ ...r, submission_id: submission.id })),
          });
        }
        return submission;
      });
    } catch (error) {
      this.logger.error(
        `Failed to save rubric marks: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to save the mark');
    }

    return {
      submission: {
        id: marked.id,
        studentId: marked.student_id,
        status: marked.status,
        score: scoreOrNull(marked.score),
        feedback: marked.feedback ?? null,
        excused: !!marked.excused,
        excusedReason: marked.excused_reason ?? null,
        gradedAt: ts(marked.graded_at),
      },
      assessments: rows.map((r) => ({
        criterionId: r.criterion_id,
        ratingId: r.rating_id,
        points: roundScore(r.points),
        comment: r.comment,
      })),
      rubricTotal: sum,
    };
  }
}
