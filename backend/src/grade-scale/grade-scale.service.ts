import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { isoDate, isUniqueViolation, num } from '@/common/db-values';
import { CacheService } from '@/cache/cache.service';
import {
  CreateGradeScaleDto,
  GradeScaleType,
} from './dto/create-grade-scale.dto';
import { UpdateGradeScaleDto } from './dto/update-grade-scale.dto';
import { ReplaceBandsDto } from './dto/replace-bands.dto';
import { BandInputDto } from './dto/band-input.dto';
import type {
  GradeScaleBand,
  GradeScaleDetail,
  GradeScaleSummary,
} from './transformer';

const SCALE_CACHE_TTL = 60 * 60 * 24;

interface ScaleRow {
  id: string;
  school_id: string;
  name: string;
  scale_type: GradeScaleType;
  is_default: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}

interface BandRow {
  id: string;
  grade_scale_id: string;
  label: string;
  min_percentage: Prisma.Decimal | number;
  max_percentage: Prisma.Decimal | number;
  gpa_points: Prisma.Decimal | number | null;
  is_pass: boolean;
  sort_order: number;
}

type Db = Prisma.TransactionClient;

@Injectable()
export class GradeScaleService {
  private readonly logger = new Logger(GradeScaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(userId: string): Promise<GradeScaleSummary[]> {
    const schoolId = await this.resolveSchoolId(userId);

    try {
      const rows = await this.prisma.grade_scale.findMany({
        where: { school_id: schoolId },
        orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
      });
      return (rows as ScaleRow[]).map((r) => this.toSummary(r));
    } catch (err) {
      this.logger.error(
        `Failed to list grade scales: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to list grade scales');
    }
  }

  async getDefault(userId: string): Promise<GradeScaleDetail | null> {
    const schoolId = await this.resolveSchoolId(userId);
    const cacheKey = `grade-scale:default:${schoolId}`;
    const cached = (await this.cache.get(cacheKey)) as GradeScaleDetail | null;
    if (cached) return cached;

    const scale = await this.prisma.grade_scale
      .findFirst({ where: { school_id: schoolId, is_default: true } })
      .catch(() => null);

    if (!scale) return null;
    const detail = await this.attachBands(scale);
    await this.cache.set(cacheKey, detail, SCALE_CACHE_TTL);
    return detail;
  }

  async get(id: string, userId: string): Promise<GradeScaleDetail> {
    const scale = await this.assertScaleInUserSchool(id, userId);
    return this.attachBands(scale);
  }

  async create(
    userId: string,
    dto: CreateGradeScaleDto,
  ): Promise<GradeScaleDetail> {
    this.validateBands(dto.bands);
    const schoolId = await this.resolveSchoolId(userId);

    // The scale and its bands land together or not at all.
    const scale = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await this.clearCurrentDefault(tx, schoolId);
      }

      let created: ScaleRow;
      try {
        created = (await tx.grade_scale.create({
          data: {
            school_id: schoolId,
            name: dto.name,
            scale_type: dto.scaleType,
            is_default: dto.isDefault ?? false,
            created_by: userId,
            updated_by: userId,
          },
        }));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            'A default scale already exists for this school',
          );
        }
        this.logger.error(
          `Failed to create grade scale: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to create grade scale');
      }

      await this.insertBands(tx, created.id, dto.bands);
      return created;
    });

    await this.invalidateSchool(schoolId);
    return this.attachBands(scale);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateGradeScaleDto,
  ): Promise<GradeScaleDetail> {
    const existing = await this.assertScaleInUserSchool(id, userId);

    const patch: Prisma.grade_scaleUncheckedUpdateInput = {
      updated_by: userId,
      updated_at: new Date(),
    };
    if (dto.name !== undefined) patch.name = dto.name;
    const makeDefault = dto.isDefault === true && !existing.is_default;
    if (makeDefault) {
      patch.is_default = true;
    } else if (dto.isDefault === false && existing.is_default) {
      patch.is_default = false;
    }

    const data = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await this.clearCurrentDefault(tx, existing.school_id);
      try {
        return (await tx.grade_scale.update({
          where: { id },
          data: patch,
        }));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            'A default scale already exists for this school',
          );
        }
        this.logger.error(
          `Failed to update grade scale: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to update grade scale');
      }
    });

    await this.invalidateSchool(existing.school_id);
    return this.attachBands(data);
  }

  async replaceBands(
    id: string,
    userId: string,
    dto: ReplaceBandsDto,
  ): Promise<GradeScaleDetail> {
    this.validateBands(dto.bands);
    const scale = await this.assertScaleInUserSchool(id, userId);

    // Clear and refill atomically so a failed insert keeps the old bands.
    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.grade_scale_band.deleteMany({ where: { grade_scale_id: id } });
      } catch (err) {
        this.logger.error(`Failed to clear bands: ${(err as Error).message}`);
        throw new BadRequestException('Failed to replace bands');
      }

      await this.insertBands(tx, id, dto.bands);
      await tx.grade_scale.updateMany({
        where: { id },
        data: { updated_by: userId, updated_at: new Date() },
      });
    });

    await this.invalidateSchool(scale.school_id);
    return this.attachBands(scale);
  }

  async setDefault(id: string, userId: string): Promise<GradeScaleDetail> {
    const scale = await this.assertScaleInUserSchool(id, userId);
    if (scale.is_default) {
      return this.attachBands(scale);
    }

    const data = await this.prisma.$transaction(async (tx) => {
      await this.clearCurrentDefault(tx, scale.school_id);
      try {
        return (await tx.grade_scale.update({
          where: { id },
          data: {
            is_default: true,
            updated_by: userId,
            updated_at: new Date(),
          },
        }));
      } catch (err) {
        this.logger.error(
          `Failed to set default scale: ${(err as Error).message}`,
        );
        throw new BadRequestException('Failed to set default scale');
      }
    });

    await this.invalidateSchool(scale.school_id);
    return this.attachBands(data);
  }

  convertScore(
    scale: GradeScaleDetail | null,
    score: number | null,
    maxScore: number | null | undefined,
  ): { label: string; gpaPoints: number | null; isPass: boolean } | null {
    if (!scale || score == null || !maxScore || maxScore <= 0) return null;
    const percentage = (score / maxScore) * 100;
    const band = scale.bands.find(
      (b) => percentage >= b.minPercentage && percentage <= b.maxPercentage,
    );
    if (!band) return null;
    return {
      label: band.label,
      gpaPoints: band.gpaPoints,
      isPass: band.isPass,
    };
  }

  async delete(id: string, userId: string) {
    const scale = await this.assertScaleInUserSchool(id, userId);

    try {
      await this.prisma.grade_scale.deleteMany({ where: { id } });
    } catch (err) {
      this.logger.error(
        `Failed to delete grade scale: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete grade scale');
    }

    await this.invalidateSchool(scale.school_id);
    return { message: 'Grade scale deleted' };
  }

  private async insertBands(db: Db, scaleId: string, bands: BandInputDto[]) {
    const rows = bands.map((b, i) => ({
      grade_scale_id: scaleId,
      label: b.label,
      min_percentage: b.minPercentage,
      max_percentage: b.maxPercentage,
      gpa_points: b.gpaPoints ?? null,
      is_pass: b.isPass,
      sort_order: b.sortOrder ?? i,
    }));

    try {
      await db.grade_scale_band.createMany({ data: rows });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Band labels must be unique within a scale',
        );
      }
      this.logger.error(`Failed to insert bands: ${(err as Error).message}`);
      throw new BadRequestException('Failed to insert bands');
    }
  }

  private async clearCurrentDefault(db: Db, schoolId: string) {
    try {
      await db.grade_scale.updateMany({
        where: { school_id: schoolId, is_default: true },
        data: { is_default: false },
      });
    } catch (err) {
      this.logger.error(
        `Failed to clear default scale: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update default scale');
    }
  }

  private async attachBands(scale: ScaleRow): Promise<GradeScaleDetail> {
    let bands: BandRow[];
    try {
      bands = await this.prisma.grade_scale_band.findMany({
        where: { grade_scale_id: scale.id },
        orderBy: { sort_order: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Failed to load bands: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load grade scale bands');
    }

    return {
      ...this.toSummary(scale),
      bands: bands.map((b) => this.toBand(b)),
    };
  }

  private async assertScaleInUserSchool(
    id: string,
    userId: string,
  ): Promise<ScaleRow> {
    const schoolId = await this.resolveSchoolId(userId);
    let data: ScaleRow | null;
    try {
      data = (await this.prisma.grade_scale.findUnique({
        where: { id },
      }));
    } catch (err) {
      this.logger.error(`Failed to load grade scale: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load grade scale');
    }
    if (!data) {
      throw new NotFoundException('Grade scale not found');
    }
    if (data.school_id !== schoolId) {
      throw new NotFoundException('Grade scale not found');
    }
    return data;
  }

  private async resolveSchoolId(userId: string): Promise<string> {
    const profile = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null);

    if (!profile?.school_id) {
      throw new BadRequestException('User is not associated with a school');
    }
    return profile.school_id;
  }

  // Bands may not overlap (a single score must map to at most one band).
  // Gaps are intentionally allowed -- a school can leave 0-39% unscored
  // and the convert-on-read layer will return null for those scores.
  private validateBands(bands: BandInputDto[]) {
    const sorted = [...bands].sort((a, b) => a.minPercentage - b.minPercentage);
    for (const b of sorted) {
      if (b.minPercentage > b.maxPercentage) {
        throw new BadRequestException(`Band "${b.label}" has min > max`);
      }
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (cur.maxPercentage >= next.minPercentage) {
        throw new BadRequestException(
          `Bands "${cur.label}" and "${next.label}" overlap`,
        );
      }
    }
    const labels = new Set<string>();
    for (const b of bands) {
      if (labels.has(b.label)) {
        throw new BadRequestException(`Duplicate band label "${b.label}"`);
      }
      labels.add(b.label);
    }
  }

  private async invalidateSchool(schoolId: string) {
    await this.cache.delete(`grade-scale:default:${schoolId}`);
  }

  private toSummary(row: ScaleRow): GradeScaleSummary {
    return {
      id: row.id,
      schoolId: row.school_id,
      name: row.name,
      scaleType: row.scale_type,
      isDefault: row.is_default,
      createdAt: isoDate(row.created_at),
      updatedAt: isoDate(row.updated_at),
    };
  }

  private toBand(row: BandRow): GradeScaleBand {
    return {
      id: row.id,
      label: row.label,
      minPercentage: num(row.min_percentage) as number,
      maxPercentage: num(row.max_percentage) as number,
      gpaPoints: num(row.gpa_points),
      isPass: row.is_pass,
      sortOrder: row.sort_order,
    };
  }
}
