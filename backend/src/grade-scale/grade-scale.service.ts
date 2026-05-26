import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
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
  created_at: string | null;
  updated_at: string | null;
}

interface BandRow {
  id: string;
  grade_scale_id: string;
  label: string;
  min_percentage: number | string;
  max_percentage: number | string;
  gpa_points: number | string | null;
  is_pass: boolean;
  sort_order: number;
}

@Injectable()
export class GradeScaleService {
  private readonly logger = new Logger(GradeScaleService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async list(userId: string): Promise<GradeScaleSummary[]> {
    const schoolId = await this.resolveSchoolId(userId);
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .select('*')
      .eq('school_id', schoolId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list grade scales: ${error.message}`);
      throw new BadRequestException('Failed to list grade scales');
    }
    return ((data ?? []) as ScaleRow[]).map((r) => this.toSummary(r));
  }

  async getDefault(userId: string): Promise<GradeScaleDetail | null> {
    const schoolId = await this.resolveSchoolId(userId);
    const cacheKey = `grade-scale:default:${schoolId}`;
    const cached = (await this.cache.get(cacheKey)) as GradeScaleDetail | null;
    if (cached) return cached;

    const supabase = this.supabaseService.getServiceClient();
    const { data: scale } = await supabase
      .schema('grading')
      .from('grade_scale')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_default', true)
      .maybeSingle();

    if (!scale) return null;
    const detail = await this.attachBands(scale as ScaleRow);
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
    const supabase = this.supabaseService.getServiceClient();

    if (dto.isDefault) {
      await this.clearCurrentDefault(schoolId);
    }

    const { data: scale, error: scaleErr } = await supabase
      .schema('grading')
      .from('grade_scale')
      .insert({
        school_id: schoolId,
        name: dto.name,
        scale_type: dto.scaleType,
        is_default: dto.isDefault ?? false,
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();

    if (scaleErr || !scale) {
      if (scaleErr?.code === '23505') {
        throw new ConflictException(
          'A default scale already exists for this school',
        );
      }
      this.logger.error(`Failed to create grade scale: ${scaleErr?.message}`);
      throw new BadRequestException('Failed to create grade scale');
    }

    await this.insertBands((scale as ScaleRow).id, dto.bands);
    await this.invalidateSchool(schoolId);
    return this.attachBands(scale as ScaleRow);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateGradeScaleDto,
  ): Promise<GradeScaleDetail> {
    const existing = await this.assertScaleInUserSchool(id, userId);

    const patch: Record<string, unknown> = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isDefault === true && !existing.is_default) {
      await this.clearCurrentDefault(existing.school_id);
      patch.is_default = true;
    } else if (dto.isDefault === false && existing.is_default) {
      patch.is_default = false;
    }

    const supabase = this.supabaseService.getServiceClient();
    const { data, error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictException(
          'A default scale already exists for this school',
        );
      }
      this.logger.error(`Failed to update grade scale: ${error?.message}`);
      throw new BadRequestException('Failed to update grade scale');
    }

    await this.invalidateSchool(existing.school_id);
    return this.attachBands(data as ScaleRow);
  }

  async replaceBands(
    id: string,
    userId: string,
    dto: ReplaceBandsDto,
  ): Promise<GradeScaleDetail> {
    this.validateBands(dto.bands);
    const scale = await this.assertScaleInUserSchool(id, userId);

    const supabase = this.supabaseService.getServiceClient();
    const { error: delErr } = await supabase
      .schema('grading')
      .from('grade_scale_band')
      .delete()
      .eq('grade_scale_id', id);

    if (delErr) {
      this.logger.error(`Failed to clear bands: ${delErr.message}`);
      throw new BadRequestException('Failed to replace bands');
    }

    await this.insertBands(id, dto.bands);
    await supabase
      .schema('grading')
      .from('grade_scale')
      .update({ updated_by: userId, updated_at: new Date().toISOString() })
      .eq('id', id);

    await this.invalidateSchool(scale.school_id);
    return this.attachBands(scale);
  }

  async setDefault(id: string, userId: string): Promise<GradeScaleDetail> {
    const scale = await this.assertScaleInUserSchool(id, userId);
    if (scale.is_default) {
      return this.attachBands(scale);
    }
    await this.clearCurrentDefault(scale.school_id);

    const supabase = this.supabaseService.getServiceClient();
    const { data, error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .update({
        is_default: true,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to set default scale: ${error?.message}`);
      throw new BadRequestException('Failed to set default scale');
    }

    await this.invalidateSchool(scale.school_id);
    return this.attachBands(data as ScaleRow);
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

    const supabase = this.supabaseService.getServiceClient();
    const { error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete grade scale: ${error.message}`);
      throw new BadRequestException('Failed to delete grade scale');
    }

    await this.invalidateSchool(scale.school_id);
    return { message: 'Grade scale deleted' };
  }

  private async insertBands(scaleId: string, bands: BandInputDto[]) {
    const supabase = this.supabaseService.getServiceClient();
    const rows = bands.map((b, i) => ({
      grade_scale_id: scaleId,
      label: b.label,
      min_percentage: b.minPercentage,
      max_percentage: b.maxPercentage,
      gpa_points: b.gpaPoints ?? null,
      is_pass: b.isPass,
      sort_order: b.sortOrder ?? i,
    }));

    const { error } = await supabase
      .schema('grading')
      .from('grade_scale_band')
      .insert(rows);

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Band labels must be unique within a scale',
        );
      }
      this.logger.error(`Failed to insert bands: ${error.message}`);
      throw new BadRequestException('Failed to insert bands');
    }
  }

  private async clearCurrentDefault(schoolId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const { error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .update({ is_default: false })
      .eq('school_id', schoolId)
      .eq('is_default', true);

    if (error) {
      this.logger.error(`Failed to clear default scale: ${error.message}`);
      throw new BadRequestException('Failed to update default scale');
    }
  }

  private async attachBands(scale: ScaleRow): Promise<GradeScaleDetail> {
    const supabase = this.supabaseService.getServiceClient();
    const { data, error } = await supabase
      .schema('grading')
      .from('grade_scale_band')
      .select('*')
      .eq('grade_scale_id', scale.id)
      .order('sort_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to load bands: ${error.message}`);
      throw new BadRequestException('Failed to load grade scale bands');
    }

    return {
      ...this.toSummary(scale),
      bands: ((data ?? []) as BandRow[]).map((b) => this.toBand(b)),
    };
  }

  private async assertScaleInUserSchool(
    id: string,
    userId: string,
  ): Promise<ScaleRow> {
    const schoolId = await this.resolveSchoolId(userId);
    const supabase = this.supabaseService.getServiceClient();
    const { data, error } = await supabase
      .schema('grading')
      .from('grade_scale')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to load grade scale: ${error.message}`);
      throw new BadRequestException('Failed to load grade scale');
    }
    if (!data) {
      throw new NotFoundException('Grade scale not found');
    }
    const row = data as ScaleRow;
    if (row.school_id !== schoolId) {
      throw new NotFoundException('Grade scale not found');
    }
    return row;
  }

  private async resolveSchoolId(userId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();
    const { data, error } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (error || !data?.school_id) {
      throw new BadRequestException('User is not associated with a school');
    }
    return data.school_id;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toBand(row: BandRow): GradeScaleBand {
    return {
      id: row.id,
      label: row.label,
      minPercentage: Number(row.min_percentage),
      maxPercentage: Number(row.max_percentage),
      gpaPoints: row.gpa_points == null ? null : Number(row.gpa_points),
      isPass: row.is_pass,
      sortOrder: row.sort_order,
    };
  }
}
