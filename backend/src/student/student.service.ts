import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const STUDENT_TTL = 60 * 60 * 24 * 30;

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async create(userId: string, dto: CreateStudentDto) {
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

    const { data: existing } = await supabase
      .schema('student')
      .from('student')
      .select('id')
      .eq('school_id', profile.school_id)
      .ilike('first_name', dto.firstName)
      .ilike('last_name', dto.lastName)
      .limit(1)
      .maybeSingle();

    if (existing) {
      throw new ConflictException(
        'A student with the same first and last name already exists in this school',
      );
    }

    const { data: student, error } = await supabase
      .schema('student')
      .from('student')
      .insert({
        school_id: profile.school_id,
        first_name: dto.firstName,
        last_name: dto.lastName,
        gender: dto.gender,
        date_of_birth: dto.dateOfBirth || null,
        enrollement_date: dto.enrollementDate || null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create student: ${error.message}`);
      throw new BadRequestException('Failed to create student');
    }

    await this.cache.update<any[]>(
      `students:${profile.school_id}`,
      (list) =>
        [...list, student].sort(
          (a, b) =>
            a.last_name.localeCompare(b.last_name) ||
            a.first_name.localeCompare(b.first_name),
        ),
      STUDENT_TTL,
    );
    return student;
  }

  async findAll(userId: string, search?: string) {
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

    const cacheKey = `students:${profile.school_id}`;
    if (!search) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let query = supabase
      .schema('student')
      .from('student')
      .select('*')
      .eq('school_id', profile.school_id);

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
      );
    }

    const { data, error } = await query
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch students: ${error.message}`);
      throw new BadRequestException('Failed to fetch students');
    }

    const result = data ?? [];
    if (!search) {
      await this.cache.set(cacheKey, result, STUDENT_TTL);
    }
    return result;
  }

  async findOne(studentId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('student')
      .from('student')
      .select('*')
      .eq('id', studentId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Student not found');
    }

    return data;
  }

  async update(studentId: string, dto: UpdateStudentDto) {
    const supabase = this.supabaseService.getServiceClient();

    const updateData: Record<string, unknown> = {};
    if (dto.firstName !== undefined) updateData.first_name = dto.firstName;
    if (dto.lastName !== undefined) updateData.last_name = dto.lastName;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.dateOfBirth !== undefined)
      updateData.date_of_birth = dto.dateOfBirth;
    if (dto.enrollementDate !== undefined)
      updateData.enrollement_date = dto.enrollementDate;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    const { data, error } = await supabase
      .schema('student')
      .from('student')
      .update(updateData)
      .eq('id', studentId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update student: ${error.message}`);
      throw new BadRequestException('Failed to update student');
    }

    if (!data) {
      throw new NotFoundException('Student not found');
    }

    await this.cache.update<any[]>(
      `students:${data.school_id}`,
      (list) => list.map((s) => (s.id === studentId ? data : s)),
      STUDENT_TTL,
    );
    return data;
  }
}
