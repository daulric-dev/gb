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
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';

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
    private readonly auditLog?: AuditLogService,
  ) {}

  async create(userId: string, dto: CreateTermDto) {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the term a name');

    await this.assertYearInUserSchool(userId, dto.academicYearId);
    const schoolId = await this.requireSchoolId(userId);

    const sortOrder =
      dto.sortOrder ??
      LEGACY_SORT_ORDER[name.toLowerCase()] ??
      (await this.nextSortOrder(dto.academicYearId));

    let term: TermRow;
    try {
      term = serializeTerm(
        await this.prisma.$transaction(async (tx) => {
          const created = await tx.term.create({
            data: {
              academic_year_id: dto.academicYearId,
              name,
              start_date: parseDateOnly(dto.startDate),
              end_date: parseDateOnly(dto.endDate),
              sort_order: sortOrder,
            },
          });
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: userId },
            {
              entity: 'term',
              entityId: created.id,
              action: 'create',
              changes: auditChanges(null, {
                name: created.name,
                start_date: created.start_date,
                end_date: created.end_date,
                sort_order: created.sort_order,
              }),
            },
          );
          return created;
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
    const schoolId = await this.requireSchoolId(userId);

    // Check the dates as they will be after the update, so moving only one
    // end cannot cross the other.
    const start = dto.startDate ?? current.start_date;
    const end = dto.endDate ?? current.end_date;
    if (
      (dto.startDate !== undefined || dto.endDate !== undefined) &&
      start &&
      end &&
      parseDateOnly(start) >= parseDateOnly(end)
    ) {
      throw new BadRequestException('Start date must be before end date');
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
    if (dto.sortOrder !== undefined) updateData.sort_order = dto.sortOrder;

    let data: TermRow;
    try {
      data = serializeTerm(
        await this.prisma.$transaction(async (tx) => {
          const before = await tx.term.findUniqueOrThrow({
            where: { id: termId },
          });
          const updated = await tx.term.update({
            where: { id: termId },
            data: updateData,
          });
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: userId },
            {
              entity: 'term',
              entityId: termId,
              action: 'update',
              changes: auditChanges(
                {
                  name: before.name,
                  start_date: before.start_date,
                  end_date: before.end_date,
                  sort_order: before.sort_order,
                },
                {
                  name: updated.name,
                  start_date: updated.start_date,
                  end_date: updated.end_date,
                  sort_order: updated.sort_order,
                },
              ),
            },
          );
          return updated;
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
      const schoolId = await this.requireSchoolId(userId);
      await this.prisma.$transaction(async (tx) => {
        await tx.term.deleteMany({ where: { id: termId } });
        await this.auditLog?.record(
          tx,
          schoolId,
          { id: userId },
          {
            entity: 'term',
            entityId: termId,
            action: 'delete',
            changes: auditChanges(
              {
                name: current.name,
                start_date: current.start_date,
                end_date: current.end_date,
                sort_order: current.sort_order,
              },
              null,
            ),
          },
        );
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new ConflictException(
          'Cannot delete term - courses still use it',
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
