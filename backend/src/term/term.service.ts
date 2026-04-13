import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

const TERM_TTL = 300;

@Injectable()
export class TermService {
  private readonly logger = new Logger(TermService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
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

    const defaultSortOrder = { michaelmas: 1, hilary: 2, trinity: 3 };
    const sortOrder = dto.sortOrder ?? defaultSortOrder[dto.name];

    const supabase = this.supabaseService.getServiceClient();

    const { data: term, error } = await supabase
      .from('term')
      .insert({
        academic_year_id: dto.academicYearId,
        name: dto.name,
        start_date: dto.startDate,
        end_date: dto.endDate,
        exam_weight: dto.examWeight,
        coursework_weight: dto.courseworkWeight,
        is_ministry_reporting: dto.isMinistryReporting ?? false,
        sort_order: sortOrder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'This term already exists for the selected academic year',
        );
      }
      this.logger.error(`Failed to create term: ${error.message}`);
      throw new BadRequestException('Failed to create term');
    }

    await this.cache.delete(`terms:${dto.academicYearId}`);
    return term;
  }

  async findByYear(academicYearId: string) {
    const cacheKey = `terms:${academicYearId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('term')
      .select('*')
      .eq('academic_year_id', academicYearId)
      .order('sort_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch terms: ${error.message}`);
      throw new BadRequestException('Failed to fetch terms');
    }

    const result = data ?? [];
    await this.cache.set(cacheKey, result, TERM_TTL);
    return result;
  }

  async findOne(termId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('term')
      .select('*')
      .eq('id', termId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Term not found');
    }

    return data;
  }

  async update(termId: string, dto: UpdateTermDto) {
    const supabase = this.supabaseService.getServiceClient();

    if (dto.examWeight !== undefined || dto.courseworkWeight !== undefined) {
      const current = await this.findOne(termId);
      const examW = dto.examWeight ?? current.exam_weight;
      const courseworkW = dto.courseworkWeight ?? current.coursework_weight;
      if (examW + courseworkW !== 100) {
        throw new BadRequestException(
          'Exam weight and coursework weight must add up to 100',
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.startDate !== undefined) updateData.start_date = dto.startDate;
    if (dto.endDate !== undefined) updateData.end_date = dto.endDate;
    if (dto.examWeight !== undefined) updateData.exam_weight = dto.examWeight;
    if (dto.courseworkWeight !== undefined)
      updateData.coursework_weight = dto.courseworkWeight;
    if (dto.isMinistryReporting !== undefined)
      updateData.is_ministry_reporting = dto.isMinistryReporting;
    if (dto.sortOrder !== undefined) updateData.sort_order = dto.sortOrder;

    const { data, error } = await supabase
      .from('term')
      .update(updateData)
      .eq('id', termId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update term: ${error.message}`);
      throw new BadRequestException('Failed to update term');
    }

    if (!data) {
      throw new NotFoundException('Term not found');
    }

    await this.cache.deleteByPrefix('terms:');
    return data;
  }

  async delete(termId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { error } = await supabase.from('term').delete().eq('id', termId);

    if (error) {
      if (error.code === '23503') {
        throw new ConflictException(
          'Cannot delete term - it has existing assessments or grades',
        );
      }
      this.logger.error(`Failed to delete term: ${error.message}`);
      throw new BadRequestException('Failed to delete term');
    }

    await this.cache.deleteByPrefix('terms:');
    return { message: 'Term deleted' };
  }
}
