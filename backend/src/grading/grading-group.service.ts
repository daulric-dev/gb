import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';

export interface GradingGroupRow {
  id: string;
  name: string;
  weight: number;
  sortOrder: number;
  isExam: boolean;
}

export interface ResolvedScheme {
  /** The groups in force, whether inherited or this subject's own. */
  groups: GradingGroupRow[];
  /** False when these are the term-wide defaults rather than a subject scheme. */
  isSubjectSpecific: boolean;
  /** Weights need not total 100; the engine renormalises. Surfaced so the UI can say so. */
  totalWeight: number;
}

/**
 * Teacher-facing management of weighted grading groups - Assignments 20%,
 * Quizzes 20%, Exam 60%, or whatever a school uses.
 *
 * Weights are not forced to total 100. The calculation engine renormalises
 * over the groups that actually have marks, so a scheme totalling 90 or 110
 * still produces sensible grades; the total is returned instead so the editor
 * can point it out rather than blocking the teacher mid-edit.
 */
@Injectable()
export class GradingGroupService {
  private readonly logger = new Logger(GradingGroupService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  /** Grades depend on the scheme, so cached calculations must go with it. */
  private async invalidate(termId: string): Promise<void> {
    await this.cache.deleteByPrefix('calc:');
    await this.cache.deleteByPrefix(`term:${termId}`);
  }

  private async requireSchool(userId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();
    const { data } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .maybeSingle();

    if (!data?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return data.school_id;
  }

  /** A term the caller's school owns; anything else is not theirs to configure. */
  private async requireTerm(userId: string, termId: string): Promise<void> {
    const schoolId = await this.requireSchool(userId);
    const supabase = this.supabaseService.getServiceClient();

    const { data } = await supabase
      .from('term')
      .select('id, academic_year:academic_year_id(school_id)')
      .eq('id', termId)
      .maybeSingle();

    const owner = (data?.academic_year as { school_id?: string } | null)
      ?.school_id;

    if (!data || owner !== schoolId) {
      throw new NotFoundException('Term not found');
    }
  }

  /** The scheme in force: this subject's own groups, or the term defaults. */
  async resolve(
    userId: string,
    termId: string,
    subjectId?: string,
  ): Promise<ResolvedScheme> {
    await this.requireTerm(userId, termId);
    const supabase = this.supabaseService.getServiceClient();

    if (!subjectId) {
      const { data } = await supabase
        .schema('grading')
        .from('grading_group')
        .select('id, name, weight, sort_order, is_exam')
        .eq('term_id', termId)
        .is('subject_id', null)
        .order('sort_order', { ascending: true });

      return this.toScheme((data ?? []) as any[], false);
    }

    const { data, error } = await supabase
      .schema('grading')
      .rpc('resolve_grading_groups', {
        p_term_id: termId,
        p_subject_id: subjectId,
      });

    if (error) {
      this.logger.error(`Failed to resolve scheme: ${error.message}`);
      throw new BadRequestException('Failed to load grading scheme');
    }

    const rows = (data ?? []) as any[];
    return this.toScheme(rows, rows.some((r) => r.is_subject_specific));
  }

  private toScheme(rows: any[], isSubjectSpecific: boolean): ResolvedScheme {
    const groups = rows.map((r) => ({
      id: r.id,
      name: r.name,
      weight: Number(r.weight),
      sortOrder: r.sort_order,
      isExam: r.is_exam,
    }));

    return {
      groups,
      isSubjectSpecific,
      totalWeight: groups.reduce((sum, g) => sum + g.weight, 0),
    };
  }

  /**
   * Adding the first group for a subject would otherwise replace the whole
   * inherited scheme with that one group, because resolution prefers any
   * subject-specific rows. Copy the term defaults first so customising starts
   * from what was already in force.
   */
  private async materialiseInheritedScheme(
    termId: string,
    subjectId: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getServiceClient();

    const { count } = await supabase
      .schema('grading')
      .from('grading_group')
      .select('id', { count: 'exact', head: true })
      .eq('term_id', termId)
      .eq('subject_id', subjectId);

    if ((count ?? 0) > 0) return;

    const { data: defaults } = await supabase
      .schema('grading')
      .from('grading_group')
      .select('name, weight, sort_order, is_exam')
      .eq('term_id', termId)
      .is('subject_id', null);

    if (!defaults || defaults.length === 0) return;

    await supabase
      .schema('grading')
      .from('grading_group')
      .insert(
        defaults.map((d) => ({
          term_id: termId,
          subject_id: subjectId,
          name: d.name,
          weight: d.weight,
          sort_order: d.sort_order,
          is_exam: d.is_exam,
        })),
      );
  }

  async create(
    userId: string,
    input: {
      termId: string;
      subjectId?: string;
      name: string;
      weight: number;
      isExam?: boolean;
    },
  ): Promise<GradingGroupRow> {
    await this.requireTerm(userId, input.termId);

    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('Give the group a name');
    }

    if (input.subjectId) {
      await this.materialiseInheritedScheme(input.termId, input.subjectId);
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data: siblings } = await supabase
      .schema('grading')
      .from('grading_group')
      .select('sort_order')
      .eq('term_id', input.termId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = ((siblings?.[0]?.sort_order as number) ?? -1) + 1;

    const { data, error } = await supabase
      .schema('grading')
      .from('grading_group')
      .insert({
        term_id: input.termId,
        subject_id: input.subjectId ?? null,
        name,
        weight: input.weight,
        is_exam: input.isExam ?? false,
        sort_order: nextOrder,
      })
      .select('id, name, weight, sort_order, is_exam')
      .single();

    if (error) {
      throw this.translate(error, name);
    }

    await this.invalidate(input.termId);

    return {
      id: data.id,
      name: data.name,
      weight: Number(data.weight),
      sortOrder: data.sort_order,
      isExam: data.is_exam,
    };
  }

  async update(
    userId: string,
    groupId: string,
    patch: {
      name?: string;
      weight?: number;
      isExam?: boolean;
      sortOrder?: number;
    },
  ): Promise<GradingGroupRow> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: existing } = await supabase
      .schema('grading')
      .from('grading_group')
      .select('id, term_id, name')
      .eq('id', groupId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('Grading group not found');
    }
    await this.requireTerm(userId, existing.term_id as string);

    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Give the group a name');
      changes.name = name;
    }
    if (patch.weight !== undefined) changes.weight = patch.weight;
    if (patch.isExam !== undefined) changes.is_exam = patch.isExam;
    if (patch.sortOrder !== undefined) changes.sort_order = patch.sortOrder;

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const { data, error } = await supabase
      .schema('grading')
      .from('grading_group')
      .update(changes)
      .eq('id', groupId)
      .select('id, name, weight, sort_order, is_exam')
      .single();

    if (error) {
      throw this.translate(error, (changes.name as string) ?? existing.name);
    }

    await this.invalidate(existing.term_id as string);

    return {
      id: data.id,
      name: data.name,
      weight: Number(data.weight),
      sortOrder: data.sort_order,
      isExam: data.is_exam,
    };
  }

  /**
   * Assessments pointing at a deleted group fall back to their old
   * exam/coursework type rather than vanishing from the calculation, because
   * the foreign key nulls them rather than cascading.
   */
  async remove(userId: string, groupId: string): Promise<void> {
    const supabase = this.supabaseService.getServiceClient();

    const { data: existing } = await supabase
      .schema('grading')
      .from('grading_group')
      .select('id, term_id')
      .eq('id', groupId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('Grading group not found');
    }
    await this.requireTerm(userId, existing.term_id as string);

    const { error } = await supabase
      .schema('grading')
      .from('grading_group')
      .delete()
      .eq('id', groupId);

    if (error) {
      this.logger.error(`Failed to delete group ${groupId}: ${error.message}`);
      throw new BadRequestException('Failed to delete grading group');
    }

    await this.invalidate(existing.term_id as string);
  }

  /** Turn the database's constraint names into something a teacher can act on. */
  private translate(error: { code?: string; message?: string }, name: string) {
    const detail = `${error.code ?? ''} ${error.message ?? ''}`;

    if (detail.includes('idx_grading_group_term_default_name')
      || detail.includes('idx_grading_group_term_subject_name')) {
      return new ConflictException(`A group called "${name}" already exists`);
    }
    if (detail.includes('idx_grading_group_one_exam')) {
      return new ConflictException(
        'Only one group can be the exam; unmark the current one first',
      );
    }
    if (detail.includes('grading_group_weight_range')) {
      return new BadRequestException('Weight must be between 0 and 100');
    }

    this.logger.error(`Grading group write failed: ${error.message}`);
    return new BadRequestException('Failed to save grading group');
  }
}
