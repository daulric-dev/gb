import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isForeignKeyViolation, isUniqueViolation } from '@/common/db-values';
import { parseDateOnly } from '@/academic-year/academic-year.rows';
import { serializeTerm, type TermRow } from './term.rows';
import { CacheService } from '@/cache/cache.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

const TERM_TTL = 60 * 60 * 24 * 30;

/**
 * Where the old fixed term names sort when no order is given. Any other name
 * goes after the year's existing terms.
 */
const LEGACY_SORT_ORDER: Record<string, number> = {
  michaelmas: 1,
  hilary: 2,
  trinity: 3,
};

@Injectable()
export class TermService {
  private readonly logger = new Logger(TermService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async create(userId: string, dto: CreateTermDto) {
    if (dto.examWeight + dto.courseworkWeight !== 100) {
      throw new BadRequestException(
        'Exam weight and coursework weight must add up to 100',
      );
    }

    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the term a name');

    await this.assertYearInUserSchool(userId, dto.academicYearId);

    const sortOrder =
      dto.sortOrder ??
      LEGACY_SORT_ORDER[name.toLowerCase()] ??
      (await this.nextSortOrder(dto.academicYearId));

    let term: TermRow;
    try {
      term = serializeTerm(
        await this.prisma.term.create({
          data: {
            academic_year_id: dto.academicYearId,
            name,
            start_date: parseDateOnly(dto.startDate),
            end_date: parseDateOnly(dto.endDate),
            exam_weight: dto.examWeight,
            coursework_weight: dto.courseworkWeight,
            is_ministry_reporting: dto.isMinistryReporting ?? false,
            sort_order: sortOrder,
          },
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'This term already exists for the selected academic year',
        );
      }
      this.logger.error(`Failed to create term: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create term');
    }

    await this.cache.update<any[]>(
      `terms:${dto.academicYearId}`,
      (list) => [...list, term].sort((a, b) => a.sort_order - b.sort_order),
      TERM_TTL,
    );
    return term;
  }

  async findByYear(userId: string, academicYearId: string) {
    await this.assertYearInUserSchool(userId, academicYearId);

    const cacheKey = `terms:${academicYearId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    let result: TermRow[];
    try {
      const rows = await this.prisma.term.findMany({
        where: { academic_year_id: academicYearId },
        orderBy: { sort_order: 'asc' },
      });
      result = rows.map(serializeTerm);
    } catch (err) {
      this.logger.error(`Failed to fetch terms: ${(err as Error).message}`);
      throw new BadRequestException('Failed to fetch terms');
    }

    await this.cache.set(cacheKey, result, TERM_TTL);
    return result;
  }

  async findOne(userId: string, termId: string) {
    const schoolId = await this.requireSchoolId(userId);

    // A malformed id finds nothing.
    const data = await this.prisma.term
      .findFirst({
        where: { id: termId, academic_year: { school_id: schoolId } },
      })
      .catch(() => null);

    if (!data) {
      throw new NotFoundException('Term not found');
    }

    return serializeTerm(data);
  }

  async update(userId: string, termId: string, dto: UpdateTermDto) {
    // findOne enforces school scope; if the term isn't in the caller's school,
    // this throws NotFoundException before any write happens.
    const current = await this.findOne(userId, termId);

    if (dto.examWeight !== undefined || dto.courseworkWeight !== undefined) {
      const examW = dto.examWeight ?? current.exam_weight;
      const courseworkW = dto.courseworkWeight ?? current.coursework_weight;
      if ((examW as number) + (courseworkW as number) !== 100) {
        throw new BadRequestException(
          'Exam weight and coursework weight must add up to 100',
        );
      }
    }

    const updateData: Prisma.termUpdateManyMutationInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Give the term a name');
      updateData.name = name;
    }
    if (dto.startDate !== undefined)
      updateData.start_date = parseDateOnly(dto.startDate);
    if (dto.endDate !== undefined)
      updateData.end_date = parseDateOnly(dto.endDate);
    if (dto.examWeight !== undefined) updateData.exam_weight = dto.examWeight;
    if (dto.courseworkWeight !== undefined)
      updateData.coursework_weight = dto.courseworkWeight;
    if (dto.isMinistryReporting !== undefined)
      updateData.is_ministry_reporting = dto.isMinistryReporting;
    if (dto.sortOrder !== undefined) updateData.sort_order = dto.sortOrder;

    let data: TermRow;
    try {
      data = serializeTerm(
        await this.prisma.term.update({
          where: { id: termId },
          data: updateData,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Another term in this academic year already has that name',
        );
      }
      this.logger.error(`Failed to update term: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update term');
    }

    await this.cache.update<any[]>(
      `terms:${data.academic_year_id}`,
      (list) => list.map((t) => (t.id === termId ? data : t)),
      TERM_TTL,
    );
    return data;
  }

  async delete(userId: string, termId: string) {
    // Enforce school scope via findOne before deleting.
    const current = await this.findOne(userId, termId);

    try {
      await this.prisma.term.deleteMany({ where: { id: termId } });
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new ConflictException(
          'Cannot delete term - it has existing assessments or grades',
        );
      }
      this.logger.error(`Failed to delete term: ${(err as Error).message}`);
      throw new BadRequestException('Failed to delete term');
    }

    await this.cache.delete(`terms:${current.academic_year_id}`);
    return { message: 'Term deleted' };
  }

  /** One past the highest sort order in the year, so new terms go last. */
  private async nextSortOrder(academicYearId: string): Promise<number> {
    const top = await this.prisma.term
      .findFirst({
        where: { academic_year_id: academicYearId },
        orderBy: { sort_order: 'desc' },
        select: { sort_order: true },
      })
      .catch(() => null);
    return (top?.sort_order ?? 0) + 1;
  }

  private async assertYearInUserSchool(userId: string, academicYearId: string) {
    const schoolId = await this.requireSchoolId(userId);

    const data = await this.prisma.academic_year
      .findFirst({
        where: { id: academicYearId, school_id: schoolId },
        select: { id: true },
      })
      .catch(() => null);

    if (!data) {
      throw new NotFoundException('Academic year not found');
    }
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
