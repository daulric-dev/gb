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

  async getEnrolledStudents(classId: string, userId?: string, subjectId?: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: allEnrolled, error } = await supabase
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

    if (!allEnrolled?.length) return [];

    const academicYearId = await this.getAcademicYearId(classId);
    const allStudentIds = allEnrolled.map((e: any) => e.student.id);

    let filtered = allEnrolled;

    if (subjectId) {
      const { data: profiles } = await supabase
        .schema('student')
        .from('student_subject_profile')
        .select('student_id')
        .in('student_id', allStudentIds)
        .eq('subject_id', subjectId)
        .eq('academic_year_id', academicYearId);

      const assignedIds = new Set((profiles ?? []).map((p) => p.student_id));
      filtered = filtered.filter((e: any) => assignedIds.has(e.student.id));
    }

    if (!userId) return this.attachSubjects(supabase, filtered, academicYearId);

    const { data: profile } = await supabase
      .from('user_profile')
      .select('role')
      .eq('id', userId)
      .single();

    if (profile?.role === 'admin') return this.attachSubjects(supabase, filtered, academicYearId);

    const { data: groupAssignment } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('is_class_teacher')
      .eq('user_profile_id', userId)
      .eq('student_group_id', classId)
      .single();

    if (groupAssignment?.is_class_teacher) return this.attachSubjects(supabase, filtered, academicYearId);

    const { data: subjectAssignments } = await supabase
      .schema('staff')
      .from('teacher_subject_assignment')
      .select('subject_id')
      .eq('user_profile_id', userId)
      .eq('student_group_id', classId);

    if (!subjectAssignments?.length) return [];

    const teacherSubjectIds = subjectAssignments.map((sa) => sa.subject_id);
    const studentIds = filtered.map((e: any) => e.student.id);

    const { data: profiles } = await supabase
      .schema('student')
      .from('student_subject_profile')
      .select('student_id, subject_id')
      .in('student_id', studentIds)
      .in('subject_id', teacherSubjectIds)
      .eq('academic_year_id', academicYearId);

    const studentIdsWithSubject = new Set(
      (profiles ?? []).map((p) => p.student_id),
    );

    const result = filtered.filter((e: any) => studentIdsWithSubject.has(e.student.id));
    return this.attachSubjects(supabase, result, academicYearId, teacherSubjectIds);
  }

  private async attachSubjects(
    supabase: any,
    enrolled: any[],
    academicYearId: string,
    limitToSubjectIds?: string[],
  ) {
    if (!enrolled.length) return enrolled;

    const studentIds = enrolled.map((e: any) => e.student.id);

    let query = supabase
      .schema('student')
      .from('student_subject_profile')
      .select('student_id, subject_id')
      .in('student_id', studentIds)
      .eq('academic_year_id', academicYearId);

    if (limitToSubjectIds?.length) {
      query = query.in('subject_id', limitToSubjectIds);
    }

    const { data: profiles } = await query;

    const subjectIds = [...new Set((profiles ?? []).map((p: any) => p.subject_id))];
    let subjectMap = new Map<string, { id: string; name: string; code: string }>();

    if (subjectIds.length) {
      const { data: subjects } = await supabase
        .from('subject')
        .select('id, name, code')
        .in('id', subjectIds)
        .order('sort_order')
        .order('name');

      subjectMap = new Map((subjects ?? []).map((s: any) => [s.id, s]));
    }

    const subjectsByStudent = new Map<string, { id: string; name: string; code: string }[]>();
    for (const p of profiles ?? []) {
      const subj = subjectMap.get(p.subject_id);
      if (!subj) continue;
      const list = subjectsByStudent.get(p.student_id) ?? [];
      list.push(subj);
      subjectsByStudent.set(p.student_id, list);
    }

    return enrolled.map((e: any) => ({
      ...e,
      subjects: subjectsByStudent.get(e.student.id) ?? [],
    }));
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
