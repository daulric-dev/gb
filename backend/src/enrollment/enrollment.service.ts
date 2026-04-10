import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { BulkEnrollDto } from './dto/bulk-enroll.dto';
import { AssignSubjectsDto } from './dto/assign-subjects.dto';
import { BulkAssignSubjectsDto } from './dto/bulk-assign-subjects.dto';

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async enroll(classId: string, dto: EnrollStudentDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .insert({
        student_id: dto.studentId,
        student_group_id: classId,
        enrolled_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Student is already enrolled in this class',
        );
      }
      this.logger.error(`Failed to enroll student: ${error.message}`);
      throw new BadRequestException('Failed to enroll student');
    }

    return data;
  }

  async bulkEnroll(classId: string, dto: BulkEnrollDto) {
    const supabase = this.supabaseService.getServiceClient();

    const rows = dto.studentIds.map((studentId) => ({
      student_id: studentId,
      student_group_id: classId,
      enrolled_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .insert(rows)
      .select();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'One or more students are already enrolled in this class',
        );
      }
      this.logger.error(`Failed to bulk enroll: ${error.message}`);
      throw new BadRequestException('Failed to enroll students');
    }

    return { enrolled: data?.length ?? 0, message: 'Students enrolled' };
  }

  async getEnrolledStudents(classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select(
        `
        id,
        enrolled_at,
        student:student_id (
          id,
          first_name,
          last_name,
          gender,
          date_of_birth,
          is_active
        )
      `,
      )
      .eq('student_group_id', classId)
      .order('enrolled_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to get enrolled students: ${error.message}`);
      throw new BadRequestException('Failed to get enrolled students');
    }

    return data ?? [];
  }

  async unenroll(classId: string, studentId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { error: unenrollError } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .delete()
      .eq('student_id', studentId)
      .eq('student_group_id', classId);

    if (unenrollError) {
      this.logger.error(`Failed to unenroll student: ${unenrollError.message}`);
      throw new BadRequestException('Failed to unenroll student');
    }

    const { data: group } = await supabase
      .from('student_group')
      .select('academic_year_id')
      .eq('id', classId)
      .single();

    if (group?.academic_year_id) {
      await supabase
        .schema('student')
        .from('student_subject_profile')
        .delete()
        .eq('student_id', studentId)
        .eq('academic_year_id', group.academic_year_id);
    }

    return { message: 'Student unenrolled' };
  }

  private async getAcademicYearId(classId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('student_group')
      .select('academic_year_id')
      .eq('id', classId)
      .single();

    if (error || !data?.academic_year_id) {
      throw new BadRequestException(
        'Could not determine academic year for this class',
      );
    }

    return data.academic_year_id;
  }

  async assignSubjects(classId: string, dto: AssignSubjectsDto) {
    const academicYearId = await this.getAcademicYearId(classId);
    const supabase = this.supabaseService.getServiceClient();

    const rows = dto.subjectIds.map((subjectId) => ({
      student_id: dto.studentId,
      subject_id: subjectId,
      academic_year_id: academicYearId,
    }));

    const { data, error } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .insert(rows)
      .select();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'One or more subjects are already assigned to this student',
        );
      }
      this.logger.error(`Failed to assign subjects: ${error.message}`);
      throw new BadRequestException('Failed to assign subjects');
    }

    return { assigned: data?.length ?? 0, message: 'Subjects assigned' };
  }

  async bulkAssignSubjects(classId: string, dto: BulkAssignSubjectsDto) {
    const academicYearId = await this.getAcademicYearId(classId);
    const supabase = this.supabaseService.getServiceClient();

    const rows: {
      student_id: string;
      subject_id: string;
      academic_year_id: string;
    }[] = [];
    for (const studentId of dto.studentIds) {
      for (const subjectId of dto.subjectIds) {
        rows.push({
          student_id: studentId,
          subject_id: subjectId,
          academic_year_id: academicYearId,
        });
      }
    }

    const { data, error } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .insert(rows)
      .select();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'One or more subjects are already assigned to these students',
        );
      }
      this.logger.error(`Failed to bulk assign subjects: ${error.message}`);
      throw new BadRequestException('Failed to assign subjects to students');
    }

    return {
      assigned: data?.length ?? 0,
      message: 'Subjects assigned to students',
    };
  }

  async getStudentSubjects(classId: string, studentId: string) {
    const academicYearId = await this.getAcademicYearId(classId);
    const supabase = this.supabaseService.getServiceClient();

    const { data: profiles, error: profileError } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .select('id, subject_id')
      .eq('student_id', studentId)
      .eq('academic_year_id', academicYearId);

    if (profileError) {
      this.logger.error(
        `Failed to get student subject profiles: ${profileError.message}`,
      );
      throw new BadRequestException('Failed to get student subjects');
    }

    if (!profiles?.length) return [];

    const subjectIds = profiles.map((p) => p.subject_id).filter(Boolean);
    if (!subjectIds.length) return [];

    const { data: subjects, error: subjectError } = await supabase
      .from('subject')
      .select('id, name, code, is_graded, sort_order')
      .in('id', subjectIds)
      .order('sort_order')
      .order('name');

    if (subjectError) {
      this.logger.error(`Failed to get subjects: ${subjectError.message}`);
      throw new BadRequestException('Failed to get student subjects');
    }

    const subjectMap = new Map((subjects ?? []).map((s) => [s.id, s]));

    return profiles.map((p) => ({
      id: p.id,
      subject: subjectMap.get(p.subject_id) ?? null,
    }));
  }

  async removeSubject(classId: string, studentId: string, subjectId: string) {
    const academicYearId = await this.getAcademicYearId(classId);
    const supabase = this.supabaseService.getServiceClient();

    const { error } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .delete()
      .eq('student_id', studentId)
      .eq('subject_id', subjectId)
      .eq('academic_year_id', academicYearId);

    if (error) {
      if (error.code === '23503') {
        throw new ConflictException(
          'Cannot remove subject - student has existing grades for this subject',
        );
      }
      this.logger.error(`Failed to remove subject: ${error.message}`);
      throw new BadRequestException('Failed to remove subject');
    }

    return { message: 'Subject removed from student' };
  }
}
