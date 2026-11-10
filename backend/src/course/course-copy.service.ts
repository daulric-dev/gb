import {
  BadRequestException,
  ForbiddenException,
  HttpException,
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
import { CourseFileCopyService } from './course-file-copy.service';
import {
  readSnapshot,
  writeSnapshot,
  type CourseSnapshot,
  type WriteResult,
} from './course-snapshot';
import { copyOutcomeAlignments } from '@/mastery/outcome-evidence';

export { relinkIds, shiftDate, type CopyCounts } from './course-snapshot';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How due dates move into the copy; see `CopyDatesDto`. */
export interface CopyDates {
  shiftDays?: number;
  sourceStartDate?: string;
  targetStartDate?: string;
  clearDueDates?: boolean;
}

/** Content can be large; the default 5s interactive transaction is not enough. */
export const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

/**
 * Course copy, import and templates.
 *
 * A copy carries a course's *design* (see `course-snapshot.ts`) into a fresh
 * draft course, and leaves every trace of the class behind: students,
 * submissions, marks, attendance, announcements and replies. The copier
 * teaches the new course.
 *
 * Everything is re-created with new ids inside one transaction, and every
 * pointer is repointed at the copy, so the two courses never share a row.
 * Files too: each linked file is copied into the copier's own storage
 * (`CourseFileCopyService`) and the copy's items link those, so copying never
 * gives anyone access to the author's files. Content only moves within one
 * school here; across schools it goes through the template library.
 */
@Injectable()
export class CourseCopyService {
  private readonly logger = new Logger(CourseCopyService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly prisma: PrismaService,
    private readonly files: CourseFileCopyService,
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
    return shiftOf(dates);
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

    const snapshot = await readSnapshot(this.prisma, source);
    let created!: CourseRow;
    const written = await this.withCopiedFiles(
      snapshot,
      userId,
      source.school_id,
      'Failed to copy the course',
      async (tx, write) => {
        const row = await tx.course.create({
          data: {
            school_id: source.school_id,
            academic_year_id: academicYearId ?? null,
            term_id: input.termId ?? null,
            name,
            code: input.code?.trim() || null,
            description: source.description,
            grade_scale_id: source.grade_scale_id,
            // The colour carries over; the cover image does not. Each image
            // object belongs to one course (deleted with it), and the new
            // course's teacher can upload their own.
            banner_color: source.banner_color,
            created_by: userId,
          },
          select: COURSE_SELECT,
        });
        await tx.course_staff.create({
          data: { course_id: row.id, user_profile_id: userId, role: 'teacher' },
        });
        if (snapshot.discussion) {
          await tx.discussion_setting.create({
            data: {
              course_id: row.id,
              students_can_create_topics: snapshot.discussion.studentsCanCreateTopics,
            },
          });
        }
        created = toCourseRow(row);
        return write(row.id, shift);
      },
    );

    this.courses.announceCreated?.(created.id, userId);
    return {
      ...this.courses.toCourse(created),
      role: 'teacher' as const,
      studentCount: 0,
      copied: written.counts,
      notes: written.notes,
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

    const snapshot = await readSnapshot(this.prisma, source);
    const written = await this.withCopiedFiles(
      snapshot,
      userId,
      target.school_id,
      'Failed to import the content',
      (_tx, write) => write(targetId, shift),
    );
    return { copied: written.counts, notes: written.notes };
  }

  /**
   * Run `body` in one transaction with the snapshot's files already copied
   * into the caller's storage: files are checked against the school's upload
   * limit (nothing written if one is too large), reserved, copied, and marked
   * ready in the same transaction as the content. On failure the copies are
   * discarded.
   */
  private async withCopiedFiles(
    snapshot: CourseSnapshot,
    userId: string,
    schoolId: string,
    failure: string,
    body: (
      tx: Tx,
      write: (targetId: string, shift: number | null) => Promise<WriteResult>,
    ) => Promise<WriteResult>,
  ): Promise<WriteResult> {
    await this.files.assertFits(snapshot.files, schoolId);
    const owner = { schoolId, ownerId: userId };
    let fileIds = new Map<string, string>();
    try {
      const tools = snapshot.items
        .map((i) => i.externalTool?.toolId)
        .filter((id): id is string => !!id);
      const lti = await this.files.ltiDeployments(schoolId, tools);
      fileIds = await this.files.reserve(snapshot.files, owner, () => randomUUID());
      await this.files.copyObjects(snapshot.files, fileIds, owner);
      return await this.prisma.$transaction(async (tx) => {
        const result = await body(tx, async (targetId, shift) => {
          const written = await writeSnapshot(tx, snapshot, {
            targetId,
            userId,
            shift,
            fileIds,
            ltiDeployments: lti.deployments,
            toolNames: lti.names,
          });
          // Learning outcomes and their alignments (src/mastery).
          await copyOutcomeAlignments(tx, {
            sourceCourseId: snapshot.sourceCourseId,
            targetCourseId: targetId,
            activityIds: written.ids,
            criterionIds: written.ids,
            questionIds: written.ids,
            userId,
          });
          return written;
        });
        await this.files.markReady(tx, fileIds.values());
        return result;
      }, TX_OPTIONS);
    } catch (error) {
      await this.files.discard(fileIds.values());
      if (error instanceof HttpException) throw error;
      this.logger.error(`${failure}: ${(error as Error).message}`);
      throw new BadRequestException(failure);
    }
  }
}

/**
 * Milliseconds to move every date by, or null to drop due dates. Start
 * dates are calendar days, so their gap is a whole number of days and a
 * due time keeps its time of day.
 */
export function shiftOf(dates: CopyDates): number | null {
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
