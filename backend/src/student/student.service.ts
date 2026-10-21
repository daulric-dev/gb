import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { PaginationService } from '@/pagination/pagination.service';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '@/pagination/pagination.dto';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const STUDENT_TTL = 60 * 60 * 24 * 30;

// PostgREST .or() parses `,`, `(`, `)`, and `*` as syntax. ilike treats
// `%` and `_` as wildcards. Strip all of these so an attacker cannot break
// out of the filter or force a full-table scan with leading wildcards.
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*%_\\]/g, '')
    .trim()
    .slice(0, 64);
}

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly paginationService: PaginationService,
  ) {}

  async create(userId: string, dto: CreateStudentDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.school_id) {
      this.logger.error(
        `Failed to get school for user ${userId}: ${profileError?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }

    const { data: existing } = await supabase
      .schema('student')
      .from('student')
      .select('id')
      .eq('school_id', profile.school_id)
      .ilike('first_name', dto.firstName)
      .ilike('last_name', dto.lastName)
      .limit(1)
      .maybeSingle();

    if (existing) {
      throw new ConflictException(
        'A student with the same first and last name already exists in this school',
      );
    }

    const { data: student, error } = await supabase
      .schema('student')
      .from('student')
      .insert({
        school_id: profile.school_id,
        first_name: dto.firstName,
        last_name: dto.lastName,
        gender: dto.gender,
        date_of_birth: dto.dateOfBirth || null,
        enrollment_date: dto.enrollementDate || null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create student: ${error.message}`);
      throw new BadRequestException('Failed to create student');
    }

    await this.cache.update<any[]>(
      `students:${profile.school_id}`,
      (list) =>
        [...list, student].sort(
          (a, b) =>
            a.last_name.localeCompare(b.last_name) ||
            a.first_name.localeCompare(b.first_name),
        ),
      STUDENT_TTL,
    );
    return student;
  }

  async findAll(userId: string, search?: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.school_id) {
      this.logger.error(
        `Failed to get school for user ${userId}: ${profileError?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }

    const cacheKey = `students:${profile.school_id}`;
    if (!search) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let query = supabase
      .schema('student')
      .from('student')
      .select('*')
      .eq('school_id', profile.school_id);

    if (search) {
      const safe = sanitizeSearchTerm(search);
      if (safe) {
        query = query.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`,
        );
      }
    }

    const { data, error } = await query
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch students: ${error.message}`);
      throw new BadRequestException('Failed to fetch students');
    }

    const result = data ?? [];
    if (!search) {
      await this.cache.set(cacheKey, result, STUDENT_TTL);
    }
    return result;
  }

  async findAllPaginated(
    userId: string,
    pagination: PaginationQueryDto,
    search?: string,
  ): Promise<PaginatedResult<any>> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.school_id) {
      this.logger.error(
        `Failed to get school for user ${userId}: ${profileError?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }

    let query = supabase
      .schema('student')
      .from('student')
      .select('*', { count: 'exact' })
      .eq('school_id', profile.school_id);

    if (search) {
      const safe = sanitizeSearchTerm(search);
      if (safe) {
        query = query.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`,
        );
      }
    }

    query = query
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    return this.paginationService.paginate(query, pagination);
  }

  async findOne(userId: string, studentId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    const { data, error } = await supabase
      .schema('student')
      .from('student')
      .select('*')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Student not found');
    }

    return data;
  }

  /**
   * Everything about one student on a single screen: who they are, the
   * courses they are enrolled in, the login attached to them and the people
   * linked as guardians.
   *
   * Assembled in JS rather than by embedding. The pieces live in several
   * schemas, and PostgREST will not follow a foreign key across a schema
   * boundary however well declared it is, so each piece is fetched and joined
   * here.
   *
   * Courses are listed active-first, then by name, so where the student is
   * now comes before what they finished or dropped.
   */
  async profile(userId: string, studentId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const student = await this.findOne(userId, studentId);

    const { data: enrolments } = await supabase
      .schema('course')
      .from('course_student')
      .select('course_id, status, enrolled_at')
      .eq('student_id', studentId);

    const courseIds = (enrolments ?? []).map((e: any) => e.course_id as string);
    const { data: courseRows } = courseIds.length
      ? await supabase
          .schema('course')
          .from('course')
          .select('id, name, code, status, term_id, academic_year_id')
          .in('id', courseIds)
      : { data: [] as any[] };
    const courseById = new Map(
      (courseRows ?? []).map((c: any) => [c.id as string, c]),
    );

    const statusRank = { active: 0, completed: 1, dropped: 2 } as const;
    const courses = (enrolments ?? [])
      .map((e: any) => {
        const c = courseById.get(e.course_id as string);
        if (!c) return null;
        return {
          id: c.id as string,
          name: c.name as string,
          code: (c.code as string | null) ?? null,
          status: c.status as 'draft' | 'published' | 'archived',
          termId: (c.term_id as string | null) ?? null,
          academicYearId: (c.academic_year_id as string | null) ?? null,
          enrollmentStatus: e.status as keyof typeof statusRank,
          enrolledAt: (e.enrolled_at as string | null) ?? null,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort(
        (a, b) =>
          statusRank[a.enrollmentStatus] - statusRank[b.enrollmentStatus] ||
          a.name.localeCompare(b.name),
      );

    const { data: account } = student.user_profile_id
      ? await supabase
          .from('user_profile')
          .select('id, email, first_name, last_name, is_active, account_type')
          .eq('id', student.user_profile_id as string)
          .maybeSingle()
      : { data: null };

    const { data: links } = await supabase
      .schema('student')
      .from('parent_student_link')
      .select('user_profile_id, relationship')
      .eq('student_id', studentId);

    const guardianIds = (links ?? [])
      .map((l: any) => l.user_profile_id as string | null)
      .filter(Boolean) as string[];

    const { data: guardians } = guardianIds.length
      ? await supabase
          .from('user_profile')
          .select('id, first_name, last_name, email')
          .in('id', guardianIds)
      : { data: [] as any[] };

    const relationshipById = new Map(
      (links ?? []).map((l: any) => [
        l.user_profile_id as string,
        l.relationship as string | null,
      ]),
    );

    return {
      student,
      courses,
      account: account
        ? {
            id: account.id,
            email: account.email,
            name: `${account.first_name ?? ''} ${account.last_name ?? ''}`.trim(),
            isActive: account.is_active,
            accountType: account.account_type,
          }
        : null,
      guardians: (guardians ?? []).map((g: any) => ({
        id: g.id,
        name: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim(),
        email: g.email,
        relationship: relationshipById.get(g.id as string) ?? null,
      })),
    };
  }

  async update(userId: string, studentId: string, dto: UpdateStudentDto) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    const updateData: Record<string, unknown> = {};
    if (dto.firstName !== undefined) updateData.first_name = dto.firstName;
    if (dto.lastName !== undefined) updateData.last_name = dto.lastName;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.dateOfBirth !== undefined)
      updateData.date_of_birth = dto.dateOfBirth;
    if (dto.enrollementDate !== undefined)
      updateData.enrollment_date = dto.enrollementDate;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    const { data, error } = await supabase
      .schema('student')
      .from('student')
      .update(updateData)
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update student: ${error.message}`);
      throw new BadRequestException('Failed to update student');
    }

    if (!data) {
      throw new NotFoundException('Student not found');
    }

    await this.cache.update<any[]>(
      `students:${data.school_id}`,
      (list) => list.map((s) => (s.id === studentId ? data : s)),
      STUDENT_TTL,
    );
    // StudentGuard caches the linked context; deactivation must take effect
    // on the student's next request, not when that cache expires.
    if (dto.isActive !== undefined && data.user_profile_id) {
      await this.cache.delete(`student-context:${data.user_profile_id}`);
    }
    return data;
  }
}
