import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ExcludeDto } from './dto/exclude.dto';

@Injectable()
export class AssessmentService {
  private readonly logger = new Logger(AssessmentService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(userId: string, dto: CreateAssessmentDto, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

    return data;
  }

  async findByTermAndSubject(termId: string, subjectId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

  async findOne(assessmentId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

  async update(assessmentId: string, dto: UpdateAssessmentDto, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

    return data;
  }

  async exclude(assessmentId: string, dto: ExcludeDto, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

    return data;
  }

  async delete(assessmentId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

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

    return { message: 'Assessment deleted' };
  }
}
