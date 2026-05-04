import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ExcludeDto } from './dto/exclude.dto';

@Injectable()
export class AssessmentService {
  private readonly logger = new Logger(AssessmentService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async invalidateCalcCaches() {
    await this.cache.deleteByPrefix('calc:');
  }

  async create(userId: string, dto: CreateAssessmentDto, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const { data, error } = await supabase
      .from('assessment')
      .insert({
        term_id: dto.termId,
        subject_id: dto.subjectId,
        title: dto.title,
        assessment_type: dto.assessmentType,
        assessment_date: dto.assessmentDate || null,
        max_score: dto.maxScore,
        weight: dto.weight ?? 1,
        sort_order: dto.sortOrder ?? 0,
      })
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to create assessments for this subject in this class',
        );
      }
      this.logger.error(`Failed to create assessment: ${error.message}`);
      throw new BadRequestException('Failed to create assessment');
    }

    await this.invalidateCalcCaches();
    return data;
  }

  async findByTermAndSubject(termId: string, subjectId: string, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const { data, error } = await supabase
      .from('assessment')
      .select('*')
      .eq('term_id', termId)
      .eq('subject_id', subjectId)
      .order('sort_order', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list assessments: ${error.message}`);
      throw new BadRequestException('Failed to list assessments');
    }

    return data ?? [];
  }

  async findOne(assessmentId: string, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const { data, error } = await supabase
      .from('assessment')
      .select('*')
      .eq('id', assessmentId)
      .single();

    if (error || !data) {
      if (error?.code === 'PGRST116') {
        throw new NotFoundException('Assessment not found');
      }
      this.logger.error(`Failed to find assessment: ${error?.message}`);
      throw new BadRequestException('Failed to find assessment');
    }

    return data;
  }

  async update(assessmentId: string, dto: UpdateAssessmentDto, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const updateData: Record<string, unknown> = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.assessmentDate !== undefined)
      updateData.assessment_date = dto.assessmentDate;
    if (dto.maxScore !== undefined) updateData.max_score = dto.maxScore;
    if (dto.weight !== undefined) updateData.weight = dto.weight;
    if (dto.sortOrder !== undefined) updateData.sort_order = dto.sortOrder;

    const { data, error } = await supabase
      .from('assessment')
      .update(updateData)
      .eq('id', assessmentId)
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to update this assessment',
        );
      }
      this.logger.error(`Failed to update assessment: ${error.message}`);
      throw new BadRequestException('Failed to update assessment');
    }

    await this.invalidateCalcCaches();
    return data;
  }

  async exclude(assessmentId: string, dto: ExcludeDto, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const { data, error } = await supabase
      .from('assessment')
      .update({
        is_excluded: dto.isExcluded,
        exclusion_reason: dto.isExcluded ? dto.exclusionReason : null,
      })
      .eq('id', assessmentId)
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to update this assessment',
        );
      }
      this.logger.error(`Failed to exclude assessment: ${error.message}`);
      throw new BadRequestException('Failed to exclude assessment');
    }

    await this.invalidateCalcCaches();
    return data;
  }

  async delete(assessmentId: string, req: FastifyRequest, reply: FastifyReply) {
    const supabase = this.supabaseService.createUserClient(req, reply, 'grading');

    const { error } = await supabase
      .from('assessment')
      .delete()
      .eq('id', assessmentId);

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to delete this assessment',
        );
      }
      this.logger.error(`Failed to delete assessment: ${error.message}`);
      throw new BadRequestException('Failed to delete assessment');
    }

    await this.invalidateCalcCaches();
    return { message: 'Assessment deleted' };
  }
}
