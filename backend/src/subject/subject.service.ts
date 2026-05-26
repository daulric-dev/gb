import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ReorderSubjectsDto } from './dto/reorder-subjects.dto';

const SUBJECT_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class SubjectService {
  private readonly logger = new Logger(SubjectService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async create(userId: string, dto: CreateSubjectDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.school_id) {
      this.logger.error(
        `Failed to get school for user ${userId}: ${profileError?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }

    const { data: subject, error } = await supabase
      .from('subject')
      .insert({
        school_id: profile.school_id,
        name: dto.name,
        code: dto.code || null,
        is_graded: dto.isGraded ?? true,
        sort_order: dto.sortOrder ?? 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Subject already exists in this school');
      }
      this.logger.error(`Failed to create subject: ${error.message}`);
      throw new BadRequestException('Failed to create subject');
    }

    await this.cache.update<any[]>(
      `subjects:${profile.school_id}`,
      (list) =>
        [...list, subject].sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        ),
      SUBJECT_TTL,
    );
    return subject;
  }

  async findAll(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.school_id) {
      this.logger.error(
        `Failed to get school for user ${userId}: ${profileError?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }

    const cacheKey = `subjects:${profile.school_id}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('subject')
      .select('*')
      .eq('school_id', profile.school_id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch subjects: ${error.message}`);
      throw new BadRequestException('Failed to fetch subjects');
    }

    const result = data ?? [];
    await this.cache.set(cacheKey, result, SUBJECT_TTL);
    return result;
  }

  async findOne(userId: string, subjectId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    const { data, error } = await supabase
      .from('subject')
      .select('*')
      .eq('id', subjectId)
      .eq('school_id', schoolId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Subject not found');
    }

    return data;
  }

  async update(userId: string, subjectId: string, dto: UpdateSubjectDto) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.isGraded !== undefined) updateData.is_graded = dto.isGraded;
    if (dto.sortOrder !== undefined) updateData.sort_order = dto.sortOrder;

    const { data, error } = await supabase
      .from('subject')
      .update(updateData)
      .eq('id', subjectId)
      .eq('school_id', schoolId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Subject already exists in this school');
      }
      this.logger.error(`Failed to update subject: ${error.message}`);
      throw new BadRequestException('Failed to update subject');
    }

    if (!data) {
      throw new NotFoundException('Subject not found');
    }

    await this.cache.update<any[]>(
      `subjects:${data.school_id}`,
      (list) => list.map((s) => (s.id === subjectId ? data : s)),
      SUBJECT_TTL,
    );
    return data;
  }

  async reorder(userId: string, dto: ReorderSubjectsDto) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    for (const item of dto.items) {
      const { error } = await supabase
        .from('subject')
        .update({ sort_order: item.sortOrder })
        .eq('id', item.id)
        .eq('school_id', schoolId);

      if (error) {
        this.logger.error(
          `Failed to update sort_order for subject ${item.id}: ${error.message}`,
        );
        throw new BadRequestException('Failed to reorder subjects');
      }
    }

    await this.cache.delete(`subjects:${schoolId}`);
    return { message: 'Subjects reordered' };
  }

  async delete(userId: string, subjectId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const schoolId = await this.supabaseService.getUserSchoolId(userId);

    const { error } = await supabase
      .from('subject')
      .delete()
      .eq('id', subjectId)
      .eq('school_id', schoolId);

    if (error) {
      if (error.code === '23503') {
        throw new ConflictException(
          'Cannot delete subject - it has existing grades or assignments',
        );
      }
      this.logger.error(`Failed to delete subject: ${error.message}`);
      throw new BadRequestException('Failed to delete subject');
    }

    await this.cache.delete(`subjects:${schoolId}`);
    return { message: 'Subject deleted' };
  }
}
