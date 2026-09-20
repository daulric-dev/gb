import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
/**
 * Reading the gradebook's assessments.
 *
 * Authoring moved to Work: publishing a quiz or an assignment creates the
 * assessment behind it, and the activity endpoints own its lifecycle. Nothing
 * writes an assessment through this service any more.
 */
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

  async findByTermAndSubject(
    termId: string,
    subjectId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'grading',
    );

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

  async findOne(
    assessmentId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const supabase = this.supabaseService.createUserClient(
      req,
      reply,
      'grading',
    );

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
}
