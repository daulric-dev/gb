import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import {
  COURSE_COLUMNS,
  CourseAccessService,
  CourseRole,
  CourseRow,
  MANAGE_ROLES,
} from './access/course-access.service';
import type { CourseStatus } from './dto/course.dto';

// No 0/O, 1/I/L: join codes get read off a board and typed on a phone.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

@Injectable()
export class CourseService {
  private readonly logger = new Logger(CourseService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
  ) {}

  private async requireSchool(userId: string): Promise<string> {
    const schoolId = await this.supabaseService.getUserSchoolId(userId);
    if (!schoolId) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return schoolId;
  }

  /**
   * A year, term or grade scale named on a course must be the school's own;
   * a term must also sit inside the year when both are given.
   */
  private async validateLinks(
    schoolId: string,
    links: {
      academicYearId?: string | null;
      termId?: string | null;
      gradeScaleId?: string | null;
    },
  ): Promise<{ academicYearId?: string | null }> {
    const supabase = this.supabaseService.getServiceClient();
    let academicYearId = links.academicYearId;

    if (links.academicYearId) {
      const { data } = await supabase
        .from('academic_year')
        .select('id')
        .eq('id', links.academicYearId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!data) throw new NotFoundException('Academic year not found');
    }

    if (links.termId) {
      const { data } = await supabase
        .from('term')
        .select('id, academic_year:academic_year_id(id, school_id)')
        .eq('id', links.termId)
        .maybeSingle();
      const year = data?.academic_year as
        | { id?: string; school_id?: string }
        | null
        | undefined;
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
      const { data } = await supabase
        .schema('grading')
        .from('grade_scale')
        .select('id')
        .eq('id', links.gradeScaleId)
        .eq('school_id', schoolId)
        .maybeSingle();
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
    filters: { status?: CourseStatus; termId?: string; academicYearId?: string },
  ) {
    const schoolId = await this.requireSchool(userId);
    const supabase = this.supabaseService.getServiceClient();

    const effective = await loadEffectivePermissions(
      this.supabaseService,
      this.cache,
      userId,
      schoolId,
    );
    const seesAll = effective.keys.includes('course:update');

    const { data: staffRows } = await supabase
      .schema('course')
      .from('course_staff')
      .select('course_id, role')
      .eq('user_profile_id', userId);

    const myRoles = new Map<string, CourseRole>(
      (staffRows ?? []).map((r: any) => [r.course_id as string, r.role]),
    );

    if (!seesAll && myRoles.size === 0) return [];

    let query = supabase
      .schema('course')
      .from('course')
      .select(COURSE_COLUMNS)
      .eq('school_id', schoolId)
      .order('name', { ascending: true });

    if (!seesAll) query = query.in('id', [...myRoles.keys()]);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.termId) query = query.eq('term_id', filters.termId);
    if (filters.academicYearId) {
      query = query.eq('academic_year_id', filters.academicYearId);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to list courses: ${error.message}`);
      throw new BadRequestException('Failed to load courses');
    }

    const courses = (data ?? []) as CourseRow[];
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

    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_student')
      .select('course_id')
      .in('course_id', courseIds)
      .eq('status', 'active');

    for (const row of data ?? []) {
      const id = row.course_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
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
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('course')
      .from('course')
      .insert({
        school_id: schoolId,
        academic_year_id: academicYearId ?? null,
        term_id: input.termId ?? null,
        name,
        code: input.code?.trim() || null,
        description: input.description?.trim() || null,
        created_by: userId,
      })
      .select(COURSE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create course: ${error?.message}`);
      throw new BadRequestException('Failed to create course');
    }

    const { error: staffError } = await supabase
      .schema('course')
      .from('course_staff')
      .insert({ course_id: data.id, user_profile_id: userId, role: 'teacher' });

    if (staffError) {
      // A course nobody teaches is invisible to its creator; undo it.
      await supabase.schema('course').from('course').delete().eq('id', data.id);
      this.logger.error(`Failed to add course teacher: ${staffError.message}`);
      throw new BadRequestException('Failed to create course');
    }

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
    },
  ) {
    const { course, role } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );

    const changes: Record<string, unknown> = {};
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
    if (patch.gradeScaleId !== undefined) {
      changes.grade_scale_id = patch.gradeScaleId;
    }

    if (patch.academicYearId !== undefined || patch.termId !== undefined) {
      const termId =
        patch.termId !== undefined ? patch.termId : course.term_id;
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
    changes.updated_at = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course')
      .update(changes)
      .eq('id', courseId)
      .select(COURSE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update course: ${error?.message}`);
      throw new BadRequestException('Failed to update course');
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
    const supabase = this.supabaseService.getServiceClient();

    if (course.status !== 'archived') {
      const { data: activities } = await supabase
        .schema('grading')
        .from('activity')
        .select('id')
        .eq('course_id', courseId);

      const ids = (activities ?? []).map((a: any) => a.id as string);
      if (ids.length > 0) {
        const { count } = await supabase
          .schema('grading')
          .from('submission')
          .select('id', { count: 'exact', head: true })
          .in('activity_id', ids);

        if ((count ?? 0) > 0) {
          throw new ConflictException(
            'Students have handed in work here; archive the course before deleting it',
          );
        }
      }
    }

    const { error } = await supabase
      .schema('course')
      .from('course')
      .delete()
      .eq('id', courseId);

    if (error) {
      this.logger.error(`Failed to delete course: ${error.message}`);
      throw new BadRequestException('Failed to delete course');
    }
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
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const supabase = this.supabaseService.getServiceClient();

    // Codes are unique across every school, so a clash is possible if rare;
    // a few retries makes it practically impossible.
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = this.generateJoinCode();
      const { error } = await supabase
        .schema('course')
        .from('course')
        .update({ join_code: joinCode, updated_at: new Date().toISOString() })
        .eq('id', courseId);

      if (!error) return { joinCode };
      if (error.code !== '23505') {
        this.logger.error(`Failed to set join code: ${error.message}`);
        break;
      }
    }

    throw new BadRequestException('Failed to create a join code');
  }

  async disableJoinCode(userId: string, courseId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const { error } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course')
      .update({ join_code: null, updated_at: new Date().toISOString() })
      .eq('id', courseId);

    if (error) throw new BadRequestException('Failed to turn off the join code');
  }

  /**
   * A student enrols themselves with a code. Only a published course in the
   * student's own school accepts one, and a student who had been dropped is
   * brought back rather than refused.
   */
  async joinByCode(studentId: string, schoolId: string, joinCode: string) {
    const code = joinCode.trim().toUpperCase();
    const supabase = this.supabaseService.getServiceClient();

    const { data: course } = await supabase
      .schema('course')
      .from('course')
      .select(COURSE_COLUMNS)
      .eq('school_id', schoolId)
      .eq('join_code', code)
      .eq('status', 'published')
      .maybeSingle();

    if (!course) {
      throw new NotFoundException('No open course uses that code');
    }

    const { error } = await supabase
      .schema('course')
      .from('course_student')
      .upsert(
        { course_id: course.id, student_id: studentId, status: 'active' },
        { onConflict: 'course_id,student_id' },
      );

    if (error) {
      this.logger.error(`Failed to join course: ${error.message}`);
      throw new BadRequestException('Failed to join the course');
    }

    return this.toCourse(course);
  }

  // ── people ────────────────────────────────────────────────────────────────

  async people(userId: string, courseId: string) {
    await this.access.require(userId, courseId);
    const supabase = this.supabaseService.getServiceClient();

    const [{ data: staff }, { data: students }] = await Promise.all([
      supabase
        .schema('course')
        .from('course_staff')
        .select('user_profile_id, role, created_at')
        .eq('course_id', courseId),
      supabase
        .schema('course')
        .from('course_student')
        .select('student_id, status, enrolled_at')
        .eq('course_id', courseId),
    ]);

    const profileIds = (staff ?? []).map((s: any) => s.user_profile_id);
    const studentIds = (students ?? []).map((s: any) => s.student_id);

    const [{ data: profiles }, { data: records }] = await Promise.all([
      profileIds.length
        ? supabase
            .from('user_profile')
            .select('id, first_name, last_name, email, avatar_url')
            .in('id', profileIds)
        : Promise.resolve({ data: [] as any[] }),
      studentIds.length
        ? supabase
            .schema('student')
            .from('student')
            .select('id, first_name, last_name, user_profile_id')
            .in('id', studentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const recordById = new Map((records ?? []).map((r: any) => [r.id, r]));

    return {
      staff: (staff ?? [])
        .map((s: any) => {
          const p = profileById.get(s.user_profile_id);
          return {
            userProfileId: s.user_profile_id as string,
            role: s.role as 'teacher' | 'ta',
            firstName: p?.first_name ?? null,
            lastName: p?.last_name ?? null,
            email: p?.email ?? null,
            avatarUrl: p?.avatar_url ?? null,
          };
        })
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'teacher' ? -1 : 1)),
      students: (students ?? [])
        .map((s: any) => {
          const r = recordById.get(s.student_id);
          return {
            studentId: s.student_id as string,
            status: s.status as 'active' | 'dropped' | 'completed',
            enrolledAt: s.enrolled_at as string,
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
    const supabase = this.supabaseService.getServiceClient();

    const [{ data: membership }, { data: profile }] = await Promise.all([
      supabase
        .from('school_management')
        .select('id')
        .eq('school_id', course.school_id)
        .eq('user_id', input.userProfileId)
        .maybeSingle(),
      supabase
        .from('user_profile')
        .select('account_type')
        .eq('id', input.userProfileId)
        .maybeSingle(),
    ]);

    if (!membership || profile?.account_type === 'student') {
      throw new NotFoundException('Staff member not found in this school');
    }

    const { error } = await supabase
      .schema('course')
      .from('course_staff')
      .upsert(
        {
          course_id: courseId,
          user_profile_id: input.userProfileId,
          role: input.role,
        },
        { onConflict: 'course_id,user_profile_id' },
      );

    if (error) {
      this.logger.error(`Failed to add course staff: ${error.message}`);
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

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_staff')
      .update({ role })
      .eq('course_id', courseId)
      .eq('user_profile_id', userProfileId)
      .select('id')
      .maybeSingle();

    if (error) throw new BadRequestException('Failed to change the role');
    if (!data) throw new NotFoundException('Not on this course');
  }

  async removeStaff(userId: string, courseId: string, userProfileId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.assertNotLastTeacher(courseId, userProfileId);

    const { error } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_staff')
      .delete()
      .eq('course_id', courseId)
      .eq('user_profile_id', userProfileId);

    if (error) throw new BadRequestException('Failed to remove from the course');
  }

  /** A course with no teacher can only be reached by an admin. */
  private async assertNotLastTeacher(courseId: string, userProfileId: string) {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_staff')
      .select('user_profile_id')
      .eq('course_id', courseId)
      .eq('role', 'teacher');

    const teachers = (data ?? []).map((r: any) => r.user_profile_id as string);
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
    const supabase = this.supabaseService.getServiceClient();
    const unique = [...new Set(studentIds)];

    const { data: records } = await supabase
      .schema('student')
      .from('student')
      .select('id')
      .eq('school_id', course.school_id)
      .in('id', unique);

    const valid = (records ?? []).map((r: any) => r.id as string);
    if (valid.length !== unique.length) {
      throw new NotFoundException('One or more students are not in this school');
    }

    const { error } = await supabase
      .schema('course')
      .from('course_student')
      .upsert(
        valid.map((id) => ({
          course_id: courseId,
          student_id: id,
          status: 'active',
        })),
        { onConflict: 'course_id,student_id' },
      );

    if (error) {
      this.logger.error(`Failed to enrol students: ${error.message}`);
      throw new BadRequestException('Failed to enrol students');
    }

    return { enrolled: valid.length };
  }

  /**
   * A student with work in the course is dropped rather than deleted, so
   * their marks survive and re-enrolling brings them back.
   */
  async removeStudent(userId: string, courseId: string, studentId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const supabase = this.supabaseService.getServiceClient();

    const { data: activities } = await supabase
      .schema('grading')
      .from('activity')
      .select('id')
      .eq('course_id', courseId);

    const ids = (activities ?? []).map((a: any) => a.id as string);
    let hasWork = false;
    if (ids.length > 0) {
      const { count } = await supabase
        .schema('grading')
        .from('submission')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .in('activity_id', ids);
      hasWork = (count ?? 0) > 0;
    }

    const base = supabase.schema('course').from('course_student');
    const { error } = hasWork
      ? await base
          .update({ status: 'dropped' })
          .eq('course_id', courseId)
          .eq('student_id', studentId)
      : await base
          .delete()
          .eq('course_id', courseId)
          .eq('student_id', studentId);

    if (error) throw new BadRequestException('Failed to remove the student');
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
      createdBy: c.created_by,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }
}
