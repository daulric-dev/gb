import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

const YEAR_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class AcademicYearService {
  private readonly logger = new Logger(AcademicYearService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async getSchoolId(userId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (error || !data?.school_id) {
      this.logger.error(
        `Failed to get school_id for user ${userId}: ${error?.message}`,
      );
      throw new BadRequestException('Could not determine school');
    }

    return data.school_id;
  }

  async create(userId: string, dto: CreateAcademicYearDto) {
    const sum = (dto.yearExamWeight ?? 0) + (dto.yearCourseworkWeight ?? 0);
    if (
      dto.yearExamWeight !== undefined ||
      dto.yearCourseworkWeight !== undefined
    ) {
      if (sum !== 100) {
        throw new BadRequestException('Year weights must add up to 100');
      }
    }

    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    const schoolId = await this.getSchoolId(userId);
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('academic_year')
      .insert({
        school_id: schoolId,
        name: dto.name,
        start_date: dto.startDate,
        end_date: dto.endDate,
        is_active: false,
        grading_model: dto.gradingModel,
        year_exam_weight: dto.yearExamWeight ?? null,
        year_coursework_weight: dto.yearCourseworkWeight ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create academic year: ${error?.message}`);
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

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('academic_year')
      .select('*')
      .eq('school_id', schoolId)
      .order('start_date', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch academic years: ${error.message}`);
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

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('academic_year')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to fetch active academic year: ${error.message}`,
      );
      return null;
    }

    if (data) await this.cache.set(cacheKey, data, YEAR_TTL);
    return data;
  }

  async findOne(yearId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('academic_year')
      .select('*')
      .eq('id', yearId)
      .single();

    if (error || !data) {
      this.logger.error(`Academic year not found ${yearId}: ${error?.message}`);
      throw new NotFoundException('Academic year not found');
    }

    return data;
  }

  async update(yearId: string, dto: UpdateAcademicYearDto) {
    const supabase = this.supabaseService.getServiceClient();

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.startDate !== undefined) updateData.start_date = dto.startDate;
    if (dto.endDate !== undefined) updateData.end_date = dto.endDate;
    if (dto.gradingModel !== undefined) {
      updateData.grading_model = dto.gradingModel;
    }
    if (dto.yearExamWeight !== undefined)
      updateData.year_exam_weight = dto.yearExamWeight;
    if (dto.yearCourseworkWeight !== undefined)
      updateData.year_coursework_weight = dto.yearCourseworkWeight;

    if (
      dto.yearExamWeight !== undefined ||
      dto.yearCourseworkWeight !== undefined
    ) {
      const existing = await this.findOne(yearId);
      const examWeight = dto.yearExamWeight ?? existing.year_exam_weight ?? 0;
      const courseworkWeight =
        dto.yearCourseworkWeight ?? existing.year_coursework_weight ?? 0;

      if (examWeight + courseworkWeight !== 100) {
        throw new BadRequestException('Year weights must add up to 100');
      }
    }

    const { data, error } = await supabase
      .from('academic_year')
      .update(updateData)
      .eq('id', yearId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to update academic year ${yearId}: ${error?.message}`,
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
    const supabase = this.supabaseService.getServiceClient();

    await supabase
      .from('academic_year')
      .update({ is_active: false })
      .eq('school_id', schoolId);

    const { data, error } = await supabase
      .from('academic_year')
      .update({ is_active: true })
      .eq('id', yearId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to activate academic year ${yearId}: ${error?.message}`,
      );
      throw new BadRequestException('Failed to activate academic year');
    }

    await this.cache.deleteByPrefix('academic-year');
    return data;
  }

  async deactivate(yearId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('academic_year')
      .update({ is_active: false })
      .eq('id', yearId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to deactivate academic year ${yearId}: ${error?.message}`,
      );
      throw new BadRequestException('Failed to deactivate academic year');
    }

    await this.cache.deleteByPrefix('academic-year');
    return data;
  }
}
