import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isNotFound, isoDate } from '@/common/db-values';
import { parseDateOnly } from '@/academic-year/academic-year.rows';
import { CacheService } from '@/cache/cache.service';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '@/pagination/pagination.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

import { serializeStudent, type StudentRow } from './student.rows';

const STUDENT_TTL = 60 * 60 * 24 * 30;
const DEFAULT_PAGE_SIZE = 20;

/** Columns a client may page by (cursor mode), with how to read the cursor. */
const CURSOR_COLUMNS: Record<string, (raw: string) => unknown> = {
  id: (raw) => raw,
  school_id: (raw) => raw,
  user_profile_id: (raw) => raw,
  first_name: (raw) => raw,
  last_name: (raw) => raw,
  gender: (raw) => raw,
  date_of_birth: (raw) => parseDateOnly(raw),
  enrollment_date: (raw) => parseDateOnly(raw),
  is_active: (raw) => raw === 'true',
};

const STUDENT_ORDER: Prisma.studentOrderByWithRelationInput[] = [
  { last_name: 'asc' },
  { first_name: 'asc' },
];

// The search term is matched as a substring. `%` and `_` are wildcards in
// LIKE, and the other characters were filter syntax in the old query
// builder; they are still stripped so search results do not change.
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
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async findAll(userId: string, search?: string) {
    const schoolId = await this.schoolForUser(userId);

    const cacheKey = `students:${schoolId}`;
    if (!search) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let result: StudentRow[];
    try {
      const rows = await this.prisma.student.findMany({
        where: this.listWhere(schoolId, search),
        orderBy: STUDENT_ORDER,
      });
      result = rows.map(serializeStudent);
    } catch (err) {
      this.logger.error(`Failed to fetch students: ${(err as Error).message}`);
      throw new BadRequestException('Failed to fetch students');
    }

    if (!search) {
      await this.cache.set(cacheKey, result, STUDENT_TTL);
    }
    return result;
  }

  /**
   * One page of the roster, by page number (offset mode) or after a cursor
   * value of `cursorColumn` (cursor mode), sorted by name.
   */
  async findAllPaginated(
    userId: string,
    pagination: PaginationQueryDto,
    search?: string,
  ): Promise<PaginatedResult<any>> {
    const schoolId = await this.schoolForUser(userId);
    const where = this.listWhere(schoolId, search);
    const pageSize = pagination.pageSize ?? DEFAULT_PAGE_SIZE;

    if (pagination.cursor === undefined) {
      const page = pagination.page ?? 1;
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.student.findMany({
          where,
          orderBy: STUDENT_ORDER,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.student.count({ where }),
      ]);
      const pageCount = Math.ceil(total / pageSize);
      return {
        data: rows.map(serializeStudent),
        meta: {
          total,
          page,
          pageSize,
          pageCount,
          nextCursor: null,
          hasMore: page < pageCount,
        },
      };
    }

    const column = pagination.cursorColumn ?? 'id';
    // Own keys only: `constructor` and friends must not pass as columns.
    const readCursor = Object.hasOwn(CURSOR_COLUMNS, column)
      ? CURSOR_COLUMNS[column]
      : undefined;
    if (!readCursor) {
      throw new BadRequestException(
        `cursorColumn must be one of: ${Object.keys(CURSOR_COLUMNS).join(', ')}`,
      );
    }
    const direction = pagination.cursorDirection ?? 'asc';

    const pageWhere: Prisma.studentWhereInput = pagination.cursor
      ? {
          AND: [
            where,
            {
              [column]: {
                [direction === 'asc' ? 'gt' : 'lt']: readCursor(
                  pagination.cursor,
                ),
              },
            },
          ],
        }
      : where;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where: pageWhere,
        orderBy: [...STUDENT_ORDER, { [column]: direction }],
        take: pageSize + 1,
      }),
      this.prisma.student.count({ where: pageWhere }),
    ]);

    const hasMore = rows.length > pageSize;
    const pageData = (hasMore ? rows.slice(0, pageSize) : rows).map(
      serializeStudent,
    );
    const lastItem = pageData[pageData.length - 1] as
      | Record<string, unknown>
      | undefined;
    const nextCursor = hasMore && lastItem ? String(lastItem[column]) : null;

    return {
      data: pageData,
      meta: {
        total,
        page: null,
        pageSize,
        pageCount: null,
        nextCursor,
        hasMore,
      },
    };
  }

  async findOne(userId: string, studentId: string) {
    const schoolId = await this.requireSchoolId(userId);

    const data = await this.prisma.student
      .findFirst({ where: { id: studentId, school_id: schoolId } })
      .catch(() => null);

    if (!data) {
      throw new NotFoundException('Student not found');
    }

    return serializeStudent(data);
  }

  /**
   * Everything about one student on a single screen: who they are, the
   * courses they are enrolled in, the login attached to them and the people
   * linked as guardians.
   *
   * Courses are listed active-first, then by name, so where the student is
   * now comes before what they finished or dropped.
   */
  async profile(userId: string, studentId: string) {
    const student = await this.findOne(userId, studentId);

    const [enrolments, account, links] = await Promise.all([
      this.prisma.course_student.findMany({
        where: { student_id: studentId },
        select: {
          status: true,
          enrolled_at: true,
          course: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              term_id: true,
              academic_year_id: true,
            },
          },
        },
      }),
      student.user_profile_id
        ? this.prisma.user_profile.findUnique({
            where: { id: student.user_profile_id },
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              is_active: true,
              account_type: true,
            },
          })
        : null,
      this.prisma.parent_student_link.findMany({
        where: { student_id: studentId },
        select: {
          user_profile_id: true,
          relationship: true,
          user_profile: {
            select: { id: true, first_name: true, last_name: true, email: true },
          },
        },
      }),
    ]);

    const statusRank = { active: 0, completed: 1, dropped: 2 } as const;
    const courses = enrolments
      .map((e) => ({
        id: e.course.id,
        name: e.course.name,
        code: e.course.code ?? null,
        status: e.course.status,
        termId: e.course.term_id ?? null,
        academicYearId: e.course.academic_year_id ?? null,
        enrollmentStatus: e.status,
        enrolledAt: isoDate(e.enrolled_at),
      }))
      .sort(
        (a, b) =>
          statusRank[a.enrollmentStatus] - statusRank[b.enrollmentStatus] ||
          a.name.localeCompare(b.name),
      );

    // One entry per guardian, whatever number of links they have.
    const relationshipById = new Map(
      links.map((l) => [l.user_profile_id, l.relationship ?? null]),
    );
    const guardians = new Map<
      string,
      { id: string; first_name: string | null; last_name: string | null; email: string | null }
    >();
    for (const l of links) {
      if (l.user_profile) guardians.set(l.user_profile.id, l.user_profile);
    }

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
      guardians: [...guardians.values()].map((g) => ({
        id: g.id,
        name: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim(),
        email: g.email,
        relationship: relationshipById.get(g.id) ?? null,
      })),
    };
  }

  async update(userId: string, studentId: string, dto: UpdateStudentDto) {
    const schoolId = await this.requireSchoolId(userId);

    const updateData: Prisma.studentUpdateManyMutationInput = {};
    if (dto.firstName !== undefined) updateData.first_name = dto.firstName;
    if (dto.lastName !== undefined) updateData.last_name = dto.lastName;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.dateOfBirth !== undefined)
      updateData.date_of_birth = dto.dateOfBirth
        ? parseDateOnly(dto.dateOfBirth)
        : null;
    if (dto.enrollementDate !== undefined)
      updateData.enrollment_date = dto.enrollementDate
        ? parseDateOnly(dto.enrollementDate)
        : null;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    let data: StudentRow;
    try {
      data = serializeStudent(
        await this.prisma.student.update({
          where: { id: studentId, school_id: schoolId },
          data: updateData,
        }),
      );
    } catch (err) {
      if (isNotFound(err)) {
        throw new NotFoundException('Student not found');
      }
      this.logger.error(`Failed to update student: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update student');
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

  // --- helpers -------------------------------------------------------------

  /** Roster filter: the school, optionally narrowed by a name search. */
  private listWhere(
    schoolId: string,
    search?: string,
  ): Prisma.studentWhereInput {
    const safe = search ? sanitizeSearchTerm(search) : '';
    if (!safe) return { school_id: schoolId };
    return {
      school_id: schoolId,
      OR: [
        { first_name: { contains: safe, mode: 'insensitive' } },
        { last_name: { contains: safe, mode: 'insensitive' } },
      ],
    };
  }

  /** The caller's school for roster work, or 400. */
  private async schoolForUser(userId: string): Promise<string> {
    let schoolId: string | null = null;
    let message: string | undefined;
    try {
      schoolId = await userSchoolId(this.prisma, userId);
    } catch (err) {
      message = (err as Error).message;
    }
    if (!schoolId) {
      this.logger.error(`Failed to get school for user ${userId}: ${message}`);
      throw new BadRequestException('Could not determine your school');
    }
    return schoolId;
  }

  /** The caller's school; a user without one is a server error, as before. */
  private async requireSchoolId(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return schoolId;
  }
}
