import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { BulkGradeDto } from './dto/bulk-grade.dto';
import { ExcludeDto } from './dto/exclude.dto';

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(userId: string, dto: CreateGradeDto, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const { data, error } = await supabase
      .from('grade')
      .insert({
        assessment_id: dto.assessmentId,
        student_id: dto.studentId,
        score: dto.score,
        remarks: dto.remarks || null,
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Grade already exists for this student and assessment',
        );
      }
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to enter grades for this subject',
        );
      }
      this.logger.error(`Failed to create grade: ${error.message}`);
      throw new BadRequestException('Failed to create grade');
    }

    return data;
  }

  async bulkCreate(userId: string, dto: BulkGradeDto, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const rows = dto.grades.map((entry) => ({
      assessment_id: dto.assessmentId,
      student_id: entry.studentId,
      score: entry.score,
      remarks: entry.remarks || null,
      created_by: userId,
      updated_by: userId,
    }));

    const { error } = await supabase
      .from('grade')
      .upsert(rows, { onConflict: 'assessment_id, student_id' });

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to enter grades for this subject',
        );
      }
      this.logger.error(`Failed to bulk create grades: ${error.message}`);
      throw new BadRequestException('Failed to save grades');
    }

    return { graded: dto.grades.length, message: 'Grades saved' };
  }

  async findByAssessment(assessmentId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const { data: grades, error } = await supabase
      .from('grade')
      .select(
        'id, assessment_id, student_id, score, letter_grade, remarks, is_excluded, exclusion_reason, created_at, updated_at',
      )
      .eq('assessment_id', assessmentId);

    if (error) {
      this.logger.error(`Failed to list grades: ${error.message}`);
      throw new BadRequestException('Failed to list grades');
    }

    if (!grades?.length) return [];

    const studentIds = [...new Set(grades.map((g) => g.student_id))];
    const serviceClient = this.supabaseService.getServiceClient();

    const { data: students } = await serviceClient
      .schema('student')
      .from('student')
      .select('id, first_name, last_name')
      .in('id', studentIds);

    const studentMap = new Map((students ?? []).map((s) => [s.id, s]));

    return grades
      .map((g) => ({
        ...g,
        student: studentMap.get(g.student_id) ?? null,
      }))
      .sort((a, b) => {
        const aName = a.student?.last_name ?? '';
        const bName = b.student?.last_name ?? '';
        return aName.localeCompare(bName);
      });
  }

  async findByTermAndSubject(termId: string, subjectId: string, token: string) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const { data: assessments, error: aErr } = await supabase
      .from('assessment')
      .select(
        'id, title, max_score, assessment_type, weight, is_excluded, sort_order',
      )
      .eq('term_id', termId)
      .eq('subject_id', subjectId)
      .order('sort_order');

    if (aErr) {
      this.logger.error(`Failed to list assessments: ${aErr.message}`);
      throw new BadRequestException('Failed to list assessments');
    }

    if (!assessments?.length) return [];

    const assessmentIds = assessments.map((a) => a.id);

    const { data: grades, error: gErr } = await supabase
      .from('grade')
      .select('id, assessment_id, student_id, score, remarks, is_excluded')
      .in('assessment_id', assessmentIds);

    if (gErr) {
      this.logger.error(`Failed to list grades: ${gErr.message}`);
      throw new BadRequestException('Failed to list grades');
    }

    const studentIds = [...new Set((grades ?? []).map((g) => g.student_id))];
    let studentMap = new Map<
      string,
      { id: string; first_name: string; last_name: string }
    >();

    if (studentIds.length > 0) {
      const serviceClient = this.supabaseService.getServiceClient();
      const { data: students } = await serviceClient
        .schema('student')
        .from('student')
        .select('id, first_name, last_name')
        .in('id', studentIds);

      studentMap = new Map((students ?? []).map((s) => [s.id, s]));
    }

    const gradesByAssessment = new Map<string, typeof grades>();
    for (const g of grades ?? []) {
      const list = gradesByAssessment.get(g.assessment_id) ?? [];
      list.push(g);
      gradesByAssessment.set(g.assessment_id, list);
    }

    return assessments.map((a) => ({
      ...a,
      grades: (gradesByAssessment.get(a.id) ?? []).map((g) => ({
        ...g,
        student: studentMap.get(g.student_id) ?? null,
      })),
    }));
  }

  async update(
    gradeId: string,
    userId: string,
    dto: UpdateGradeDto,
    token: string,
  ) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const updateData: Record<string, unknown> = { updated_by: userId };
    if (dto.score !== undefined) updateData.score = dto.score;
    if (dto.remarks !== undefined) updateData.remarks = dto.remarks;

    const { data, error } = await supabase
      .from('grade')
      .update(updateData)
      .eq('id', gradeId)
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to update grades for this subject',
        );
      }
      this.logger.error(`Failed to update grade: ${error.message}`);
      throw new BadRequestException('Failed to update grade');
    }

    return data;
  }

  async exclude(
    gradeId: string,
    userId: string,
    dto: ExcludeDto,
    token: string,
  ) {
    const supabase = this.supabaseService.createUserClient(token, 'grading');

    const { data, error } = await supabase
      .from('grade')
      .update({
        is_excluded: dto.isExcluded,
        exclusion_reason: dto.isExcluded ? dto.exclusionReason : null,
        updated_by: userId,
      })
      .eq('id', gradeId)
      .select()
      .single();

    if (error) {
      if (
        error.code === '42501' ||
        error.message?.includes('row-level security')
      ) {
        throw new ForbiddenException(
          'You are not assigned to update grades for this subject',
        );
      }
      this.logger.error(`Failed to exclude grade: ${error.message}`);
      throw new BadRequestException('Failed to exclude grade');
    }

    return data;
  }
}
