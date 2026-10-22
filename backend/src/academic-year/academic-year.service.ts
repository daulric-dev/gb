import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { parseDateOnly, serializeAcademicYear } from './academic-year.rows';
import { CacheService } from '@/cache/cache.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

const YEAR_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class AcademicYearService {
  private readonly logger = new Logger(AcademicYearService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async getSchoolId(userId: string): Promise<string> {
    let data: { school_id: string | null } | null = null;
    let message: string | undefined;
    try {
      data = await this.prisma.user_profile.findUnique({
        where: { id: userId },
        select: { school_id: true },
      });
    } catch (err) {
      message = (err as Error).message;
    }

    if (!data?.school_id) {
      this.logger.error(
        `Failed to get school_id for user ${userId}: ${message}`,
      );
      throw new BadRequestException('Could not determine school');
    }

    return data.school_id;
  }

  async create(userId: string, dto: CreateAcademicYearDto) {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    const schoolId = await this.getSchoolId(userId);
    let data;
    try {
      data = serializeAcademicYear(
        await this.prisma.academic_year.create({
          data: {
            school_id: schoolId,
            name: dto.name,
            start_date: parseDateOnly(dto.startDate),
            end_date: parseDateOnly(dto.endDate),
            is_active: false,
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to create academic year: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to create academic year');
    }

    await this.cache.update<any[]>(
      `academic-years:${schoolId}`,
      (list) => [data, ...list],
      YEAR_TTL,
    );
    return data;
  }

  async findAll(userId: string) {
    const schoolId = await this.getSchoolId(userId);

    const cacheKey = `academic-years:${schoolId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    let data;
    try {
      const rows = await this.prisma.academic_year.findMany({
        where: { school_id: schoolId },
        orderBy: { start_date: 'desc' },
      });
      data = rows.map(serializeAcademicYear);
    } catch (err) {
      this.logger.error(
        `Failed to fetch academic years: ${(err as Error).message}`,
      );
      return [];
    }

    await this.cache.set(cacheKey, data, YEAR_TTL);
    return data;
  }

  async findActive(userId: string) {
    const schoolId = await this.getSchoolId(userId);

    const cacheKey = `academic-year-active:${schoolId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    let data;
    try {
      // maybeSingle semantics: more than one active year is an error.
      const rows = await this.prisma.academic_year.findMany({
        where: { school_id: schoolId, is_active: true },
        take: 2,
      });
      if (rows.length > 1) {
        throw new Error('Multiple active academic years');
      }
      data = rows[0] ? serializeAcademicYear(rows[0]) : null;
    } catch (err) {
      this.logger.error(
        `Failed to fetch active academic year: ${(err as Error).message}`,
      );
      return null;
    }

    if (data) await this.cache.set(cacheKey, data, YEAR_TTL);
    return data;
  }

  async findOne(userId: string, yearId: string) {
    const schoolId = await this.getSchoolId(userId);

    let data;
    let message: string | undefined;
    try {
      data = await this.prisma.academic_year.findFirst({
        where: { id: yearId, school_id: schoolId },
      });
    } catch (err) {
      message = (err as Error).message;
    }

    if (!data) {
      this.logger.error(`Academic year not found ${yearId}: ${message}`);
      throw new NotFoundException('Academic year not found');
    }

    return serializeAcademicYear(data as typeof serializeAcademicYear extends (row: infer R) => any ? R : never);
  }

  async update(userId: string, yearId: string, dto: UpdateAcademicYearDto) {
    const schoolId = await this.getSchoolId(userId);

    const updateData: Prisma.academic_yearUpdateManyMutationInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.startDate !== undefined)
      updateData.start_date = parseDateOnly(dto.startDate);
    if (dto.endDate !== undefined)
      updateData.end_date = parseDateOnly(dto.endDate);

    let data;
    try {
      data = serializeAcademicYear(
        await this.prisma.academic_year.update({
          where: { id: yearId, school_id: schoolId },
          data: updateData,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to update academic year ${yearId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update academic year');
    }

    await this.cache.update<any[]>(
      `academic-years:${data.school_id}`,
      (list) => list.map((y) => (y.id === yearId ? data : y)),
      YEAR_TTL,
    );
    await this.cache.update(
      `academic-year-active:${data.school_id}`,
      (active: any) => (active?.id === yearId ? data : active),
      YEAR_TTL,
    );
    return data;
  }

  async setActive(userId: string, yearId: string) {
    const schoolId = await this.getSchoolId(userId);

    // One active year per school: switch atomically.
    let data;
    try {
      data = serializeAcademicYear(
        await this.prisma.$transaction(async (tx) => {
          await tx.academic_year.updateMany({
            where: { school_id: schoolId },
            data: { is_active: false },
          });
          return tx.academic_year.update({
            where: { id: yearId, school_id: schoolId },
            data: { is_active: true },
          });
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to activate academic year ${yearId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to activate academic year');
    }

    await this.cache.deleteByPrefix(`academic-year`);
    return data;
  }

  async deactivate(userId: string, yearId: string) {
    const schoolId = await this.getSchoolId(userId);

    let data;
    try {
      data = serializeAcademicYear(
        await this.prisma.academic_year.update({
          where: { id: yearId, school_id: schoolId },
          data: { is_active: false },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to deactivate academic year ${yearId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to deactivate academic year');
    }

    await this.cache.deleteByPrefix(`academic-year`);
    return data;
  }
}
