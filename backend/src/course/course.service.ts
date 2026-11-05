import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { WebhookEvents } from '@/integrations/events';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import {
  COURSE_SELECT,
  CourseAccessService,
  CourseRole,
  CourseRow,
  MANAGE_ROLES,
  toCourseRow,
} from './access/course-access.service';
import type { CourseStatus } from './dto/course.dto';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isoDate, isUniqueViolation } from '@/common/db-values';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { plan } from '@/erasure/erasure-plan';
import { optionalImageUrl } from '@/images/public-url';
import type { CourseBannerColor } from './course-appearance';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';

// No 0/O, 1/I/L: join codes get read off a board and typed on a phone.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly prisma: PrismaService,
    private readonly erasure: ErasureLogService,
    @Optional() private readonly webhooks?: WebhookEvents,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** course.created, after the course committed (new or copied). Fire and forget. */
  announceCreated(courseId: string, userId: string | null) {
    void this.webhooks?.emitForCourse(
      courseId,
      'course.created',
      async (course) => ({
        course,
        createdBy: await this.webhooks!.staffOrNull(userId),
      }),
    );
  }

  /** student.enrolled / student.unenrolled for each student. Fire and forget. */
  private announceEnrolment(
    courseId: string,
    studentIds: string[],
    type: 'student.enrolled' | 'student.unenrolled',
    extra: Record<string, unknown>,
  ) {
    const webhooks = this.webhooks;
    if (!webhooks) return;
    for (const studentId of studentIds) {
      void webhooks.emitForCourse(courseId, type, async (course) => ({
        student: await webhooks.student(studentId),
        course,
        ...extra,
      }));
    }
  }

  private async requireSchool(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return schoolId;
  }

  /**
   * A year, term or grade scale named on a course must be the school's own;
   * a term must also sit inside the year when both are given. Course copy
   * checks the new course's year and term the same way.
   */
  async validateLinks(
    schoolId: string,
    links: {
      academicYearId?: string | null;
      termId?: string | null;
      gradeScaleId?: string | null;
    },
  ): Promise<{ academicYearId?: string | null }> {
    let academicYearId = links.academicYearId;

    if (links.academicYearId) {
      const data = await this.prisma.academic_year.findFirst({
        where: { id: links.academicYearId, school_id: schoolId },
        select: { id: true },
      });
      if (!data) throw new NotFoundException('Academic year not found');
    }

    if (links.termId) {
      const data = await this.prisma.term.findUnique({
        where: { id: links.termId },
        select: {
          id: true,
          academic_year: { select: { id: true, school_id: true } },
        },
      });
      const year = data?.academic_year;
      if (!data || year?.school_id !== schoolId) {
        throw new NotFoundException('Term not found');
      }
      if (links.academicYearId && year?.id !== links.academicYearId) {
        throw new BadRequestException('That term is not in the chosen year');
      }
      // A term implies its year, so the course lists under it either way.
      academicYearId = academicYearId ?? year?.id ?? null;
    }

    if (links.gradeScaleId) {
      const data = await this.prisma.grade_scale.findFirst({
        where: { id: links.gradeScaleId, school_id: schoolId },
        select: { id: true },
      });
      if (!data) throw new NotFoundException('Grade scale not found');
    }

    return { academicYearId };
  }

  /**
   * The caller's courses. Anyone who can manage every course in the school
   * (`course:update`) sees all of them; everyone else sees the ones they
   * teach or assist in.
   */
  async list(
    userId: string,
    filters: {
      status?: CourseStatus;
      termId?: string;
      academicYearId?: string;
    },
  ) {
    const schoolId = await this.requireSchool(userId);

    const effective = await loadEffectivePermissions(
      this.prisma,
      this.cache,
      userId,
      schoolId,
    );
    const seesAll = effective.keys.includes('course:update');

    const staffRows = await this.prisma.course_staff.findMany({
      where: { user_profile_id: userId },
      select: { course_id: true, role: true },
    });

    const myRoles = new Map<string, CourseRole>(
      staffRows.map((r) => [r.course_id, r.role]),
    );

    if (!seesAll && myRoles.size === 0) return [];

    const where: Prisma.courseWhereInput = { school_id: schoolId };
    if (!seesAll) where.id = { in: [...myRoles.keys()] };
    if (filters.status) where.status = filters.status;
    if (filters.termId) where.term_id = filters.termId;
    if (filters.academicYearId) where.academic_year_id = filters.academicYearId;

    let courses: CourseRow[];
    try {
      const data = await this.prisma.course.findMany({
        where,
        select: COURSE_SELECT,
        orderBy: { name: 'asc' },
      });
      courses = data.map(toCourseRow);
    } catch (error) {
      this.logger.error(`Failed to list courses: ${(error as Error).message}`);
      throw new BadRequestException('Failed to load courses');
    }

    const counts = await this.studentCounts(courses.map((c) => c.id));

    return courses.map((c) => ({
      ...this.toCourse(c),
      role: seesAll ? ('admin' as const) : myRoles.get(c.id)!,
      studentCount: counts.get(c.id) ?? 0,
    }));
  }

  private async studentCounts(courseIds: string[]) {
    const counts = new Map<string, number>();
    if (courseIds.length === 0) return counts;

    const rows = await this.prisma.course_student.groupBy({
      by: ['course_id'],
      where: { course_id: { in: courseIds }, status: 'active' },
      _count: { _all: true },
    });

    for (const row of rows) counts.set(row.course_id, row._count._all);
    return counts;
  }

  async get(userId: string, courseId: string) {
    const { course, role } = await this.access.require(userId, courseId);
    const counts = await this.studentCounts([course.id]);
    return {
      ...this.toCourse(course),
      role,
      studentCount: counts.get(course.id) ?? 0,
    };
  }

  /** Whoever creates a course teaches it. */
  async create(
    userId: string,
    input: {
      name: string;
      code?: string;
      description?: string;
      academicYearId?: string;
      termId?: string;
    },
  ) {
    const schoolId = await this.requireSchool(userId);

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the course a name');

    const { academicYearId } = await this.validateLinks(schoolId, input);

    // A course nobody teaches is invisible to its creator, so the course and
    // its first teacher are written together or not at all.
    let data: CourseRow;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const created = await tx.course.create({
          data: {
            school_id: schoolId,
            academic_year_id: academicYearId ?? null,
            term_id: input.termId ?? null,
            name,
            code: input.code?.trim() || null,
            description: input.description?.trim() || null,
            created_by: userId,
          },
          select: COURSE_SELECT,
        });
        await tx.course_staff.create({
          data: {
            course_id: created.id,
            user_profile_id: userId,
            role: 'teacher',
          },
        });
        await this.auditLog?.record(
          tx,
          schoolId,
          { id: userId },
          {
            entity: 'course',
            entityId: created.id,
            action: 'create',
            changes: auditChanges(null, {
              name: created.name,
              code: created.code,
              description: created.description,
              academic_year_id: created.academic_year_id,
              term_id: created.term_id,
            }),
          },
        );
        return toCourseRow(created);
      });
    } catch (error) {
      this.logger.error(`Failed to create course: ${(error as Error).message}`);
      throw new BadRequestException('Failed to create course');
    }

    this.announceCreated(data.id, userId);
    return { ...this.toCourse(data), role: 'teacher', studentCount: 0 };
  }

  async update(
    userId: string,
    courseId: string,
    patch: {
      name?: string;
      code?: string | null;
      description?: string | null;
      status?: CourseStatus;
      academicYearId?: string | null;
      termId?: string | null;
      gradeScaleId?: string | null;
      isTemplate?: boolean;
      bannerColor?: CourseBannerColor | null;
    },
  ) {
    const { course, role } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );

    const changes: Prisma.courseUncheckedUpdateInput = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Give the course a name');
      changes.name = name;
    }
    if (patch.code !== undefined) changes.code = patch.code?.trim() || null;
    if (patch.description !== undefined) {
      changes.description = patch.description?.trim() || null;
    }
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.bannerColor !== undefined)
      changes.banner_color = patch.bannerColor;
    if (patch.gradeScaleId !== undefined) {
      changes.grade_scale_id = patch.gradeScaleId;
    }
    if (patch.isTemplate !== undefined) {
      // A template is a starting point, never a class: it takes no students,
      // so one with a roster can't become a template and its code goes.
      if (patch.isTemplate && !course.is_template) {
        const enrolled = await this.prisma.course_student.count({
          where: { course_id: courseId, status: { not: 'dropped' } },
        });
        if (enrolled > 0) {
          throw new ConflictException(
            'Remove the students before making this course a template',
          );
        }
        changes.join_code = null;
      }
      changes.is_template = patch.isTemplate;
    }

    if (patch.academicYearId !== undefined || patch.termId !== undefined) {
      const termId = patch.termId !== undefined ? patch.termId : course.term_id;
      const yearId =
        patch.academicYearId !== undefined
          ? patch.academicYearId
          : course.academic_year_id;
      const { academicYearId } = await this.validateLinks(course.school_id, {
        academicYearId: yearId,
        termId,
      });
      changes.academic_year_id = academicYearId ?? null;
      changes.term_id = termId ?? null;
    }
    if (patch.gradeScaleId) {
      await this.validateLinks(course.school_id, {
        gradeScaleId: patch.gradeScaleId,
      });
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date();

    let data: CourseRow;
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const before = await tx.course.findUnique({
          where: { id: courseId },
          select: COURSE_SELECT,
        });
        const previous = before ?? course;
        const updated = await tx.course.update({
          where: { id: courseId },
          data: changes,
          select: COURSE_SELECT,
        });
        await this.auditLog?.record(
          tx,
          course.school_id,
          { id: userId },
          {
            entity: 'course',
            entityId: updated.id,
            action: 'update',
            changes: auditChanges(
              {
                name: previous.name,
                code: previous.code,
                description: previous.description,
                status: previous.status,
                academic_year_id: previous.academic_year_id,
                term_id: previous.term_id,
                grade_scale_id: previous.grade_scale_id,
                is_template: previous.is_template,
                banner_color: previous.banner_color,
              },
              {
                name: updated.name,
                code: updated.code,
                description: updated.description,
                status: updated.status,
                academic_year_id: updated.academic_year_id,
                term_id: updated.term_id,
                grade_scale_id: updated.grade_scale_id,
                is_template: updated.is_template,
                banner_color: updated.banner_color,
              },
            ),
          },
        );
        return toCourseRow(updated);
      });
    } catch (error) {
      this.logger.error(`Failed to update course: ${(error as Error).message}`);
      throw new BadRequestException('Failed to update course');
    }

    if (patch.status === 'archived' && course.status !== 'archived') {
      void this.webhooks?.emitForCourse(courseId, 'course.archived', (ref) => ({
        course: ref,
      }));
    }

    const counts = await this.studentCounts([courseId]);
    return {
      ...this.toCourse(data),
      role,
      studentCount: counts.get(courseId) ?? 0,
    };
  }

  /**
   * Deleting takes every submission and mark with it, so a course students
   * have handed work into must be archived first - archiving is usually what
   * a teacher actually wants, and makes the delete a deliberate second step.
   */
  async remove(userId: string, courseId: string) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    if (course.status !== 'archived') {
      const count = await this.prisma.submission.count({
        where: { activity: { course_id: courseId } },
      });

      if (count > 0) {
        throw new ConflictException(
          'Students have handed in work here; archive the course before deleting it',
        );
      }
    }

    // Enrolments, attendance, submissions and discussions cascade with the
    // course, so this is an erasure of students' data: log it with it.
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.course.findUnique({
          where: { id: courseId },
          select: COURSE_SELECT,
        });
        const { count } = await tx.course.deleteMany({
          where: { id: courseId },
        });
        if (count > 0 && before) {
          await this.auditLog?.record(
            tx,
            course.school_id,
            { id: userId },
            {
              entity: 'course',
              entityId: courseId,
              action: 'delete',
              changes: auditChanges(
                {
                  name: before.name,
                  code: before.code,
                  description: before.description,
                  status: before.status,
                  academic_year_id: before.academic_year_id,
                  term_id: before.term_id,
                  grade_scale_id: before.grade_scale_id,
                  is_template: before.is_template,
                  banner_color: before.banner_color,
                },
                null,
              ),
            },
          );
        }
        await this.erasure.record(tx, {
          kind: 'course',
          subjectTable: 'course.course',
          subjectIds: [courseId],
          schoolId: course.school_id,
          actor: userId,
          reason: 'admin',
          replay: plan.of(
            plan.del('course.course', { id: [courseId] }),
            plan.prefixes([courseBannerPrefix(courseId)]),
          ),
        });
      });
    } catch (error) {
      this.logger.error(`Failed to delete course: ${(error as Error).message}`);
      throw new BadRequestException('Failed to delete course');
    }
    // The cover image (and any left by an earlier replace that failed to
    // clean up) goes after the commit; a failure is logged and replay finishes it.
    await this.erasure.removeObjects([], [courseBannerPrefix(courseId)]);
  }

  // ── join codes ────────────────────────────────────────────────────────────

  private generateJoinCode(): string {
    let code = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
    }
    return code;
  }

  /** Issue a fresh join code; the old one stops working at once. */
  async regenerateJoinCode(userId: string, courseId: string) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    if (course.is_template) {
      throw new BadRequestException('A template does not take students');
    }

    // Codes are unique across every school, so a clash is possible if rare;
    // a few retries makes it practically impossible.
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = this.generateJoinCode();
      try {
        await this.prisma.course.updateMany({
          where: { id: courseId },
          data: { join_code: joinCode, updated_at: new Date() },
        });
        return { joinCode };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          this.logger.error(
            `Failed to set join code: ${(error as Error).message}`,
          );
          break;
        }
      }
    }

    throw new BadRequestException('Failed to create a join code');
  }

  async disableJoinCode(userId: string, courseId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    try {
      await this.prisma.course.updateMany({
        where: { id: courseId },
        data: { join_code: null, updated_at: new Date() },
      });
    } catch {
      throw new BadRequestException('Failed to turn off the join code');
    }
  }

  /**
   * A student enrols themselves with a code. Only a published course in the
   * student's own school accepts one. A student their teacher removed
   * (dropped) cannot use the code to undo that; the teacher re-adds them.
   */
  async joinByCode(studentId: string, schoolId: string, joinCode: string) {
    const code = joinCode.trim().toUpperCase();

    const found = await this.prisma.course.findFirst({
      where: {
        school_id: schoolId,
        join_code: code,
        status: 'published',
        is_template: false,
      },
      select: COURSE_SELECT,
    });

    if (!found) {
      throw new NotFoundException('No open course uses that code');
    }
    const course = toCourseRow(found);

    const key = { course_id: course.id, student_id: studentId };
    const wasActive = await this.prisma.course_student
      .findUnique({
        where: { course_id_student_id: key },
        select: { status: true },
      })
      .then((r) => r?.status === 'active')
      .catch(() => false);
    try {
      // The status filter leaves a dropped row unmatched, so the upsert falls
      // through to create and hits the unique key instead of reactivating it.
      await this.prisma.course_student.upsert({
        where: { course_id_student_id: key, status: { not: 'dropped' } },
        create: { ...key, status: 'active' },
        update: { status: 'active' },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        this.logger.error(`Failed to join course: ${(error as Error).message}`);
        throw new BadRequestException('Failed to join the course');
      }
      const existing = await this.prisma.course_student.findUnique({
        where: { course_id_student_id: key },
        select: { status: true },
      });
      if (existing?.status === 'dropped') {
        throw new ForbiddenException(
          'You were removed from this course. Ask your teacher to re-add you.',
        );
      }
      // Otherwise a double tap raced us to the same enrolment; it stands.
    }

    if (!wasActive) {
      this.announceEnrolment(course.id, [studentId], 'student.enrolled', {
        via: 'join_code',
      });
    }
    return this.toCourse(course);
  }

  // ── people ────────────────────────────────────────────────────────────────

  async people(userId: string, courseId: string) {
    await this.access.require(userId, courseId);

    const [staff, students] = await Promise.all([
      this.prisma.course_staff.findMany({
        where: { course_id: courseId },
        select: {
          user_profile_id: true,
          role: true,
          user_profile: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              avatar_url: true,
            },
          },
        },
      }),
      this.prisma.course_student.findMany({
        where: { course_id: courseId },
        select: {
          student_id: true,
          status: true,
          enrolled_at: true,
          student: {
            select: {
              first_name: true,
              last_name: true,
              user_profile_id: true,
            },
          },
        },
      }),
    ]);

    return {
      staff: staff
        .map((s) => {
          const p = s.user_profile;
          return {
            userProfileId: s.user_profile_id,
            role: s.role,
            firstName: p?.first_name ?? null,
            lastName: p?.last_name ?? null,
            email: p?.email ?? null,
            avatarUrl: p?.avatar_url ?? null,
          };
        })
        .sort((a, b) =>
          a.role === b.role ? 0 : a.role === 'teacher' ? -1 : 1,
        ),
      students: students
        .map((s) => {
          const r = s.student;
          return {
            studentId: s.student_id,
            status: s.status,
            enrolledAt: isoDate(s.enrolled_at)!,
            firstName: r?.first_name ?? null,
            lastName: r?.last_name ?? null,
            hasAccount: !!r?.user_profile_id,
          };
        })
        .sort((a, b) =>
          `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(
            `${b.lastName ?? ''} ${b.firstName ?? ''}`,
          ),
        ),
    };
  }

  /** Staff must already belong to the course's school as staff. */
  async addStaff(
    userId: string,
    courseId: string,
    input: { userProfileId: string; role: 'teacher' | 'ta' },
  ) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );

    const [membership, profile] = await Promise.all([
      this.prisma.school_management.findFirst({
        where: { school_id: course.school_id, user_id: input.userProfileId },
        select: { id: true },
      }),
      this.prisma.user_profile.findUnique({
        where: { id: input.userProfileId },
        select: { account_type: true },
      }),
    ]);

    if (!membership || profile?.account_type === 'student') {
      throw new NotFoundException('Staff member not found in this school');
    }

    try {
      await this.prisma.course_staff.upsert({
        where: {
          course_id_user_profile_id: {
            course_id: courseId,
            user_profile_id: input.userProfileId,
          },
        },
        create: {
          course_id: courseId,
          user_profile_id: input.userProfileId,
          role: input.role,
        },
        update: { role: input.role },
      });
    } catch (error) {
      this.logger.error(
        `Failed to add course staff: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to add to the course');
    }
  }

  async updateStaff(
    userId: string,
    courseId: string,
    userProfileId: string,
    role: 'teacher' | 'ta',
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    if (role === 'ta') await this.assertNotLastTeacher(courseId, userProfileId);

    let count: number;
    try {
      ({ count } = await this.prisma.course_staff.updateMany({
        where: { course_id: courseId, user_profile_id: userProfileId },
        data: { role },
      }));
    } catch {
      throw new BadRequestException('Failed to change the role');
    }
    if (count === 0) throw new NotFoundException('Not on this course');
  }

  async removeStaff(userId: string, courseId: string, userProfileId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.assertNotLastTeacher(courseId, userProfileId);

    try {
      await this.prisma.course_staff.deleteMany({
        where: { course_id: courseId, user_profile_id: userProfileId },
      });
    } catch {
      throw new BadRequestException('Failed to remove from the course');
    }
  }

  /** A course with no teacher can only be reached by an admin. */
  private async assertNotLastTeacher(courseId: string, userProfileId: string) {
    const data = await this.prisma.course_staff.findMany({
      where: { course_id: courseId, role: 'teacher' },
      select: { user_profile_id: true },
    });

    const teachers = data.map((r) => r.user_profile_id);
    if (teachers.length === 1 && teachers[0] === userProfileId) {
      throw new ConflictException('A course needs at least one teacher');
    }
  }

  /** Enrol students from the school roster; re-enrolling revives a drop. */
  async enrollStudents(userId: string, courseId: string, studentIds: string[]) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    if (course.is_template) {
      throw new BadRequestException('A template does not take students');
    }
    const unique = [...new Set(studentIds)];

    const records = await this.prisma.student.findMany({
      where: { school_id: course.school_id, id: { in: unique } },
      select: { id: true },
    });

    const valid = records.map((r) => r.id);
    if (valid.length !== unique.length) {
      throw new NotFoundException(
        'One or more students are not in this school',
      );
    }

    const alreadyActive = new Set(
      (
        await this.prisma.course_student.findMany({
          where: {
            course_id: courseId,
            student_id: { in: valid },
            status: 'active',
          },
          select: { student_id: true },
        })
      ).map((r) => r.student_id),
    );

    // Upsert: revive existing enrolments, add the rest.
    try {
      await this.prisma.$transaction([
        this.prisma.course_student.updateMany({
          where: { course_id: courseId, student_id: { in: valid } },
          data: { status: 'active' },
        }),
        this.prisma.course_student.createMany({
          data: valid.map((id) => ({
            course_id: courseId,
            student_id: id,
            status: 'active' as const,
          })),
          skipDuplicates: true,
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to enrol students: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to enrol students');
    }

    this.announceEnrolment(
      courseId,
      valid.filter((id) => !alreadyActive.has(id)),
      'student.enrolled',
      { via: 'staff' },
    );
    return { enrolled: valid.length };
  }

  /**
   * A student with work in the course is dropped rather than deleted, so
   * their marks survive and re-enrolling brings them back.
   */
  async removeStudent(userId: string, courseId: string, studentId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const count = await this.prisma.submission.count({
      where: { student_id: studentId, activity: { course_id: courseId } },
    });
    const hasWork = count > 0;

    const where = { course_id: courseId, student_id: studentId };
    let changed: number;
    try {
      if (hasWork) {
        changed = (
          await this.prisma.course_student.updateMany({
            where,
            data: { status: 'dropped' },
          })
        ).count;
      } else {
        changed = (await this.prisma.course_student.deleteMany({ where }))
          .count;
      }
    } catch {
      throw new BadRequestException('Failed to remove the student');
    }
    if (changed > 0) {
      this.announceEnrolment(courseId, [studentId], 'student.unenrolled', {
        dropped: hasWork,
      });
    }
  }

  toCourse(c: CourseRow) {
    return {
      id: c.id,
      schoolId: c.school_id,
      academicYearId: c.academic_year_id,
      termId: c.term_id,
      name: c.name,
      code: c.code,
      description: c.description,
      status: c.status,
      joinCode: c.join_code,
      gradeScaleId: c.grade_scale_id,
      isTemplate: c.is_template,
      bannerColor: c.banner_color,
      bannerImageUrl: optionalImageUrl(c.banner_image_path),
      createdBy: c.created_by,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }
}

/** Every cover image object a course has, for erasure. */
function courseBannerPrefix(courseId: string): string {
  return `images/course-banners/${courseId}-`;
}
