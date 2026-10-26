import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import {
  COURSE_SELECT,
  CourseAccessService,
  CourseRow,
  MANAGE_ROLES,
  toCourseRow,
} from './access/course-access.service';
import { CourseService } from './course.service';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How due dates move into the copy; see `CopyDatesDto`. */
export interface CopyDates {
  shiftDays?: number;
  sourceStartDate?: string;
  targetStartDate?: string;
  clearDueDates?: boolean;
}

/** What one copy wrote, so the caller can show it and the smoke test check it. */
export interface CopyCounts {
  assignmentGroups: number;
  rubrics: number;
  activities: number;
  quizQuestions: number;
  pages: number;
  modules: number;
  moduleItems: number;
  discussionTopics: number;
}

/** Content can be large; the default 5s interactive transaction is not enough. */
const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/**
 * Course copy, import and templates.
 *
 * A copy carries a course's *design* - grade setup, rubrics, activities,
 * pages, modules and discussion prompts - into a fresh draft course, and
 * leaves every trace of the class behind: students, submissions, marks,
 * attendance, announcements and replies. The copier teaches the new course.
 *
 * Everything is re-created with new ids inside one transaction, and every
 * pointer (an item's page or activity, an activity's group or rubric) is
 * repointed at the copy, so the two courses never share a row. Files are the
 * exception: a file item keeps the same file, which the source course already
 * offered, and the portal serves it through the new course's module item.
 * Content only moves within one school, and a file item is only carried over
 * while its file is live and belongs to the target's school.
 */
@Injectable()
export class CourseCopyService {
  private readonly logger = new Logger(CourseCopyService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly prisma: PrismaService,
  ) {}

  // ── templates ─────────────────────────────────────────────────────────────

  /** The school's templates, for anyone who may create a course. */
  async listTemplates(userId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const data = await this.prisma.course.findMany({
      where: { school_id: schoolId, is_template: true },
      select: {
        ...COURSE_SELECT,
        _count: { select: { module: true, activity: true, page: true } },
      },
      orderBy: { name: 'asc' },
    });

    return data.map(({ _count, ...c }) => ({
      ...this.courses.toCourse(toCourseRow(c)),
      moduleCount: _count.module,
      activityCount: _count.activity,
      pageCount: _count.page,
    }));
  }

  /**
   * A course the caller may copy content out of: one they teach or run, or a
   * template in their own school when they may create courses. A TA's course
   * is forbidden; anything else is not found.
   */
  private async requireSource(
    userId: string,
    sourceId: string,
  ): Promise<CourseRow> {
    const found = await this.prisma.course.findUnique({
      where: { id: sourceId },
      select: COURSE_SELECT,
    });
    if (!found) throw new NotFoundException('Course not found');
    const course = toCourseRow(found);

    const role = await this.access.roleIn(userId, course);
    if (role && MANAGE_ROLES.includes(role)) return course;

    if (course.is_template) {
      const effective = await loadEffectivePermissions(
        this.prisma,
        this.cache,
        userId,
        course.school_id,
      );
      if (effective.member && effective.keys.includes('course:create')) {
        return course;
      }
    }

    if (role) {
      throw new ForbiddenException(
        'Only the course teacher can copy this course',
      );
    }
    throw new NotFoundException('Course not found');
  }

  // ── dates ─────────────────────────────────────────────────────────────────

  /**
   * Milliseconds to move every date by, or null to drop due dates. Start
   * dates are calendar days, so their gap is a whole number of days and a
   * due time keeps its time of day.
   */
  shiftOf(dates: CopyDates): number | null {
    const byDays = dates.shiftDays !== undefined && dates.shiftDays !== null;
    const byStarts = !!dates.sourceStartDate || !!dates.targetStartDate;

    if ([byDays, byStarts, !!dates.clearDueDates].filter(Boolean).length > 1) {
      throw new BadRequestException(
        'Choose one of: shift by days, shift by start dates, or clear due dates',
      );
    }
    if (dates.clearDueDates) return null;
    if (byDays) return dates.shiftDays! * DAY_MS;
    if (byStarts) {
      if (!dates.sourceStartDate || !dates.targetStartDate) {
        throw new BadRequestException(
          'Give both the old and the new start date',
        );
      }
      const from = Date.parse(`${dates.sourceStartDate.slice(0, 10)}T00:00:00Z`);
      const to = Date.parse(`${dates.targetStartDate.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new BadRequestException('Start dates must be YYYY-MM-DD');
      }
      return Math.round((to - from) / DAY_MS) * DAY_MS;
    }
    return 0;
  }

  // ── copy ──────────────────────────────────────────────────────────────────

  /**
   * Copy a course into a new draft course. The caller needs `course:create`
   * (checked by the route) and either runs the source or it is a template.
   */
  async copy(
    userId: string,
    sourceId: string,
    input: CopyDates & {
      name: string;
      code?: string;
      academicYearId?: string;
      termId?: string;
    },
  ) {
    const source = await this.requireSource(userId, sourceId);
    // The copy is created in the source's school, so that must be the school
    // the caller works in (a stale staff row elsewhere does not count).
    const callerSchool = await userSchoolId(this.prisma, userId);
    if (callerSchool !== source.school_id) {
      throw new NotFoundException('Course not found');
    }
    const shift = this.shiftOf(input);

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the course a name');

    const { academicYearId } = await this.courses.validateLinks(
      source.school_id,
      input,
    );

    let created: CourseRow;
    let counts: CopyCounts;
    try {
      [created, counts] = await this.prisma.$transaction(async (tx) => {
        const row = await tx.course.create({
          data: {
            school_id: source.school_id,
            academic_year_id: academicYearId ?? null,
            term_id: input.termId ?? null,
            name,
            code: input.code?.trim() || null,
            description: source.description,
            grade_scale_id: source.grade_scale_id,
            created_by: userId,
          },
          select: COURSE_SELECT,
        });
        await tx.course_staff.create({
          data: {
            course_id: row.id,
            user_profile_id: userId,
            role: 'teacher',
          },
        });

        const setting = await tx.discussion_setting.findUnique({
          where: { course_id: source.id },
          select: { students_can_create_topics: true },
        });
        if (setting) {
          await tx.discussion_setting.create({
            data: {
              course_id: row.id,
              students_can_create_topics: setting.students_can_create_topics,
            },
          });
        }

        const written = await this.copyContent(
          tx,
          source.id,
          row.id,
          userId,
          shift,
          source.school_id,
        );
        return [toCourseRow(row), written] as const;
      }, TX_OPTIONS);
    } catch (error) {
      this.logger.error(`Failed to copy course: ${(error as Error).message}`);
      throw new BadRequestException('Failed to copy the course');
    }

    return {
      ...this.courses.toCourse(created),
      role: 'teacher' as const,
      studentCount: 0,
      copied: counts,
    };
  }

  /**
   * Append another course's content to one the caller runs. Groups with the
   * same name are merged rather than duplicated; modules land after the
   * course's own. The target's settings, roster and grade scale are untouched.
   */
  async importInto(
    userId: string,
    targetId: string,
    input: CopyDates & { sourceCourseId: string },
  ) {
    const { course: target } = await this.access.require(
      userId,
      targetId,
      MANAGE_ROLES,
    );
    if (input.sourceCourseId === targetId) {
      throw new BadRequestException('A course cannot import from itself');
    }
    const source = await this.requireSource(userId, input.sourceCourseId);
    if (source.school_id !== target.school_id) {
      throw new BadRequestException(
        'Content can only be imported from a course in the same school',
      );
    }
    const shift = this.shiftOf(input);

    try {
      const copied = await this.prisma.$transaction(
        (tx) =>
          this.copyContent(
            tx,
            source.id,
            targetId,
            userId,
            shift,
            target.school_id,
          ),
        TX_OPTIONS,
      );
      return { copied };
    } catch (error) {
      this.logger.error(
        `Failed to import course content: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to import the content');
    }
  }

  /**
   * Re-create one course's content inside another. Ids are minted here so
   * each pointer can be repointed before anything is written, and every
   * table goes in with one `createMany`.
   */
  async copyContent(
    tx: Tx,
    sourceId: string,
    targetId: string,
    userId: string,
    shift: number | null,
    targetSchoolId: string,
  ): Promise<CopyCounts> {
    const [groups, rubrics, activities, pages, modules, items, topics] =
      await Promise.all([
        tx.assignment_group.findMany({
          where: { course_id: sourceId },
          orderBy: { position: 'asc' },
        }),
        tx.rubric.findMany({
          where: { course_id: sourceId },
          include: { rubric_criterion: { include: { rubric_rating: true } } },
        }),
        tx.activity.findMany({
          where: { course_id: sourceId },
          include: { quiz_question: { include: { quiz_option: true } } },
          orderBy: { created_at: 'asc' },
        }),
        tx.page.findMany({
          where: { course_id: sourceId },
          orderBy: { created_at: 'asc' },
        }),
        tx.module.findMany({
          where: { course_id: sourceId },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        }),
        tx.module_item.findMany({
          where: { course_id: sourceId },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        }),
        tx.discussion_topic.findMany({
          where: { course_id: sourceId },
          include: { user_profile: { select: { account_type: true } } },
          orderBy: { created_at: 'asc' },
        }),
      ]);

    // Existing target rows, for an import: merge groups by name, and put the
    // imported modules after the course's own.
    const [targetGroups, lastModule, lastGroup] = await Promise.all([
      tx.assignment_group.findMany({
        where: { course_id: targetId },
        select: { id: true, name: true },
      }),
      tx.module.aggregate({
        where: { course_id: targetId },
        _max: { position: true },
      }),
      tx.assignment_group.aggregate({
        where: { course_id: targetId },
        _max: { position: true },
      }),
    ]);
    const moduleOffset =
      lastModule._max.position === null ? 0 : lastModule._max.position + 1;
    const groupOffset =
      lastGroup._max.position === null ? 0 : lastGroup._max.position + 1;

    // source id -> copy id, for every row anything points at; also used to
    // rewrite links to the source course inside page and activity text.
    const ids = new Map<string, string>([[sourceId, targetId]]);
    const mint = (oldId: string) => {
      const id = randomUUID();
      ids.set(oldId, id);
      return id;
    };

    const byName = new Map(
      targetGroups.map((g) => [g.name.trim().toLowerCase(), g.id]),
    );
    const newGroups: Prisma.assignment_groupCreateManyInput[] = [];
    for (const g of groups) {
      const existing = byName.get(g.name.trim().toLowerCase());
      if (existing) {
        ids.set(g.id, existing);
        continue;
      }
      newGroups.push({
        id: mint(g.id),
        course_id: targetId,
        name: g.name,
        weight: g.weight,
        position: g.position + groupOffset,
        drop_lowest: g.drop_lowest,
        drop_highest: g.drop_highest,
      });
    }

    const newRubrics: Prisma.rubricCreateManyInput[] = [];
    const newCriteria: Prisma.rubric_criterionCreateManyInput[] = [];
    const newRatings: Prisma.rubric_ratingCreateManyInput[] = [];
    for (const r of rubrics) {
      const rubricId = mint(r.id);
      newRubrics.push({
        id: rubricId,
        course_id: targetId,
        title: r.title,
        created_by: userId,
      });
      for (const c of r.rubric_criterion) {
        const criterionId = randomUUID();
        newCriteria.push({
          id: criterionId,
          rubric_id: rubricId,
          title: c.title,
          description: c.description,
          points: c.points,
          position: c.position,
        });
        for (const x of c.rubric_rating) {
          newRatings.push({
            criterion_id: criterionId,
            label: x.label,
            description: x.description,
            points: x.points,
            position: x.position,
          });
        }
      }
    }

    // Mint every page and activity id before writing any text, so a link
    // from one page to another copied page can be rewritten either way round.
    for (const a of activities) mint(a.id);
    for (const p of pages) mint(p.id);
    const relink = (text: string) => relinkIds(text, ids);

    // Activities arrive as drafts: due dates moved and everything reviewed
    // before students see it, and publishing then notifies them as usual.
    const newActivities: Prisma.activityCreateManyInput[] = [];
    const newQuestions: Prisma.quiz_questionCreateManyInput[] = [];
    const newOptions: Prisma.quiz_optionCreateManyInput[] = [];
    for (const a of activities) {
      const activityId = ids.get(a.id)!;
      newActivities.push({
        id: activityId,
        course_id: targetId,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions === null ? null : relink(a.instructions),
        points: a.points,
        due_at: shiftDate(a.due_at, shift),
        status: 'draft',
        published_at: null,
        allow_file: a.allow_file,
        allow_text: a.allow_text,
        max_attempts: a.max_attempts,
        assignment_group_id: a.assignment_group_id
          ? (ids.get(a.assignment_group_id) ?? null)
          : null,
        omit_from_final_grade: a.omit_from_final_grade,
        rubric_id: a.rubric_id ? (ids.get(a.rubric_id) ?? null) : null,
        created_by: userId,
      });
      for (const q of a.quiz_question) {
        const questionId = randomUUID();
        newQuestions.push({
          id: questionId,
          activity_id: activityId,
          prompt: q.prompt,
          kind: q.kind,
          points: q.points,
          sort_order: q.sort_order,
        });
        for (const o of q.quiz_option) {
          newOptions.push({
            question_id: questionId,
            label: o.label,
            is_correct: o.is_correct,
            sort_order: o.sort_order,
          });
        }
      }
    }

    // Pages, modules and items keep their published flags: the new course
    // is a draft, so nothing is visible until it is published, and then the
    // structure is as the teacher left it (minus the draft activities).
    const newPages: Prisma.pageCreateManyInput[] = pages.map((p) => ({
      id: ids.get(p.id)!,
      course_id: targetId,
      title: p.title,
      body: relink(p.body),
      is_published: p.is_published,
      created_by: userId,
    }));

    const newModules: Prisma.moduleCreateManyInput[] = modules.map((m) => ({
      id: mint(m.id),
      course_id: targetId,
      title: m.title,
      position: m.position + moduleOffset,
      is_published: m.is_published,
    }));

    // Discussion prompts the staff wrote come along unpublished and empty;
    // topics students started are part of the old class, not the design.
    const newTopics: Prisma.discussion_topicCreateManyInput[] = topics
      .filter((t) => t.user_profile?.account_type !== 'student')
      .map((t) => ({
        id: mint(t.id),
        course_id: targetId,
        author_user_profile_id: userId,
        title: t.title,
        body: relink(t.body),
        is_pinned: t.is_pinned,
        is_locked: t.is_locked,
        is_published: false,
        require_initial_post: t.require_initial_post,
      }));

    // A file item may only keep pointing at a live file of the target's
    // school; anything else (deleted, or another school's) is left behind.
    const fileIds = [
      ...new Set(items.map((i) => i.file_id).filter((id): id is string => !!id)),
    ];
    const usableFiles = new Set(
      fileIds.length === 0
        ? []
        : (
            await tx.file.findMany({
              where: {
                id: { in: fileIds },
                school_id: targetSchoolId,
                deleted_at: null,
              },
              select: { id: true },
            })
          ).map((f) => f.id),
    );

    const newItems: Prisma.module_itemCreateManyInput[] = [];
    for (const i of items) {
      if (i.file_id && !usableFiles.has(i.file_id)) continue;
      const moduleId = ids.get(i.module_id);
      const pageId = i.page_id ? ids.get(i.page_id) : null;
      const activityId = i.activity_id ? ids.get(i.activity_id) : null;
      const topicId = i.discussion_topic_id
        ? ids.get(i.discussion_topic_id)
        : null;
      // An item whose target is gone or was not copied (a topic a student
      // started) would break the item-type check; leave it behind.
      if (
        !moduleId ||
        pageId === undefined ||
        activityId === undefined ||
        topicId === undefined
      ) {
        continue;
      }
      newItems.push({
        module_id: moduleId,
        course_id: targetId,
        position: i.position,
        item_type: i.item_type,
        title: i.title,
        page_id: pageId,
        activity_id: activityId,
        file_id: i.file_id,
        discussion_topic_id: topicId,
        url: i.url,
        indent: i.indent,
        is_published: i.is_published,
      });
    }

    // Parents before children, so every foreign key already exists.
    const writes: [string, unknown[], (rows: any[]) => Promise<unknown>][] = [
      ['groups', newGroups, (data) => tx.assignment_group.createMany({ data })],
      ['rubrics', newRubrics, (data) => tx.rubric.createMany({ data })],
      ['criteria', newCriteria, (data) => tx.rubric_criterion.createMany({ data })],
      ['ratings', newRatings, (data) => tx.rubric_rating.createMany({ data })],
      ['activities', newActivities, (data) => tx.activity.createMany({ data })],
      ['questions', newQuestions, (data) => tx.quiz_question.createMany({ data })],
      ['options', newOptions, (data) => tx.quiz_option.createMany({ data })],
      ['pages', newPages, (data) => tx.page.createMany({ data })],
      ['modules', newModules, (data) => tx.module.createMany({ data })],
      ['topics', newTopics, (data) => tx.discussion_topic.createMany({ data })],
      ['items', newItems, (data) => tx.module_item.createMany({ data })],
    ];
    for (const [, rows, write] of writes) {
      if (rows.length > 0) await write(rows);
    }

    return {
      assignmentGroups: newGroups.length,
      rubrics: newRubrics.length,
      activities: newActivities.length,
      quizQuestions: newQuestions.length,
      pages: newPages.length,
      modules: newModules.length,
      moduleItems: newItems.length,
      discussionTopics: newTopics.length,
    };
  }
}

/** A date moved by `shift` ms; null `shift` clears it. */
export function shiftDate(date: Date | null, shift: number | null) {
  if (!date || shift === null) return null;
  return shift === 0 ? date : new Date(date.getTime() + shift);
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Rewrite ids of copied rows inside text (a link from one page to another
 * page or activity of the same course, or to the course itself), so links in
 * the copy stay inside the copy. Ids that were not copied are left alone.
 */
export function relinkIds(text: string, ids: Map<string, string>) {
  if (!text) return text;
  return text.replace(UUID_RE, (id) => ids.get(id.toLowerCase()) ?? id);
}
