import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AddTeacherDto } from './dto/add-teacher.dto';

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createClass(userId: string, dto: CreateClassDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: group, error: groupError } = await supabase
      .from('student_group')
      .insert({
        name: dto.name,
        academic_year_id: dto.academicYearId,
        created_by: userId,
      })
      .select()
      .single();

    if (groupError || !group) {
      this.logger.error(`Failed to create class: ${groupError?.message}`);
      throw new BadRequestException('Failed to create class');
    }

    const { error: assignmentError } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .insert({
        user_profile_id: userId,
        student_group_id: group.id,
        academic_year_id: dto.academicYearId,
        is_class_teacher: true,
      });

    if (assignmentError) {
      this.logger.error(
        `Class ${group.id} created but teacher assignment failed: ${assignmentError.message}`,
      );
    }

    if (dto.subjectIds?.length) {
      const subjectRows = dto.subjectIds.map((subjectId) => ({
        user_profile_id: userId,
        subject_id: subjectId,
        student_group_id: group.id,
        academic_year_id: dto.academicYearId,
      }));

      const { error: subjectError } = await supabase
        .schema('staff')
        .from('teacher_subject_assignment')
        .insert(subjectRows);

      if (subjectError) {
        this.logger.error(
          `Class ${group.id} created but subject assignment failed: ${subjectError.message}`,
        );
      }
    }

    return group;
  }

  async getMyClasses(userId: string, academicYearId?: string) {
    const supabase = this.supabaseService.getServiceClient();

    let query = supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('id, student_group_id, academic_year_id, is_class_teacher')
      .eq('user_profile_id', userId);

    if (academicYearId) {
      query = query.eq('academic_year_id', academicYearId);
    }

    const { data: assignments, error } = await query;

    if (error) {
      this.logger.error(
        `Failed to fetch classes for ${userId}: ${error.message}`,
      );
      return [];
    }

    if (!assignments || assignments.length === 0) {
      return [];
    }

    const groupIds = assignments.map((a: any) => a.student_group_id);
    const { data: groups } = await supabase
      .from('student_group')
      .select('*')
      .in('id', groupIds);

    const groupMap = new Map((groups || []).map((g: any) => [g.id, g]));

    return assignments.map((row: any) => {
      const group = groupMap.get(row.student_group_id);
      return {
        id: row.student_group_id,
        name: group?.name ?? null,
        academicYearId: row.academic_year_id,
        isClassTeacher: row.is_class_teacher,
        createdAt: group?.created_at ?? null,
      };
    });
  }

  async getClassById(classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('student_group')
      .select('*')
      .eq('id', classId)
      .single();

    if (error || !data) {
      this.logger.error(`Class not found ${classId}: ${error?.message}`);
      throw new NotFoundException('Class not found');
    }

    return data;
  }

  async updateClass(classId: string, dto: UpdateClassDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .from('student_group')
      .update({ name: dto.name })
      .eq('id', classId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update class ${classId}: ${error?.message}`);
      throw new BadRequestException('Failed to update class');
    }

    return data;
  }

  async deleteClass(classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { error } = await supabase
      .from('student_group')
      .delete()
      .eq('id', classId);

    if (error) {
      this.logger.error(`Failed to delete class ${classId}: ${error.message}`);
      throw new BadRequestException('Failed to delete class');
    }

    return 'Class deleted';
  }

  async getMySubjectsForClass(userId: string, classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('role')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.role === 'admin';

    let isClassTeacher = false;
    if (!isAdmin) {
      const { data: groupAssignment } = await supabase
        .schema('staff')
        .from('teacher_group_assignment')
        .select('is_class_teacher')
        .eq('user_profile_id', userId)
        .eq('student_group_id', classId)
        .single();

      isClassTeacher = !!groupAssignment?.is_class_teacher;
    }

    if (isAdmin || isClassTeacher) {
      const { data: subjects } = await supabase
        .from('subject')
        .select('id, name, code, is_graded, sort_order')
        .order('sort_order')
        .order('name');

      return subjects ?? [];
    }

    const { data: subjectAssignments } = await supabase
      .schema('staff')
      .from('teacher_subject_assignment')
      .select('subject_id')
      .eq('user_profile_id', userId)
      .eq('student_group_id', classId);

    if (!subjectAssignments?.length) return [];

    const subjectIds = subjectAssignments.map((sa) => sa.subject_id);

    const { data: subjects } = await supabase
      .from('subject')
      .select('id, name, code, is_graded, sort_order')
      .in('id', subjectIds)
      .order('sort_order')
      .order('name');

    return subjects ?? [];
  }

  async getTeachers(classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: assignments, error: assignError } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('user_profile_id, is_class_teacher')
      .eq('student_group_id', classId);

    if (assignError) {
      this.logger.error(
        `Failed to fetch teachers for class ${classId}: ${assignError.message}`,
      );
      return [];
    }

    if (!assignments?.length) return [];

    const teacherIds = assignments.map((a: any) => a.user_profile_id);

    const { data: profiles } = await supabase
      .from('user_profile')
      .select('id, first_name, last_name')
      .in('id', teacherIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const { data: subjectAssignments } = await supabase
      .schema('staff')
      .from('teacher_subject_assignment')
      .select('user_profile_id, subject_id')
      .eq('student_group_id', classId);

    const subjectIds = [
      ...new Set((subjectAssignments ?? []).map((sa: any) => sa.subject_id)),
    ];
    let subjectMap = new Map<
      string,
      { id: string; name: string; code: string }
    >();

    if (subjectIds.length > 0) {
      const { data: subjects } = await supabase
        .from('subject')
        .select('id, name, code')
        .in('id', subjectIds);
      subjectMap = new Map((subjects ?? []).map((s: any) => [s.id, s]));
    }

    const subjectsByTeacher = new Map<string, any[]>();
    for (const sa of subjectAssignments ?? []) {
      const tid = sa.user_profile_id;
      if (!subjectsByTeacher.has(tid)) subjectsByTeacher.set(tid, []);
      const subject = subjectMap.get(sa.subject_id);
      if (subject) subjectsByTeacher.get(tid)!.push(subject);
    }

    return assignments.map((row: any) => {
      const profile = profileMap.get(row.user_profile_id);
      return {
        teacherId: row.user_profile_id,
        firstName: profile?.first_name ?? null,
        lastName: profile?.last_name ?? null,
        isClassTeacher: row.is_class_teacher,
        subjects: subjectsByTeacher.get(row.user_profile_id) ?? [],
      };
    });
  }

  async getSchoolTeachers(userId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (!profile?.school_id) return [];

    const { data: teachers, error } = await supabase
      .from('user_profile')
      .select('id, first_name, last_name')
      .eq('school_id', profile.school_id);

    if (error) {
      this.logger.error(`Failed to fetch school teachers: ${error.message}`);
      return [];
    }

    return teachers ?? [];
  }

  async addTeacher(classId: string, dto: AddTeacherDto) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: group, error: groupError } = await supabase
      .from('student_group')
      .select('academic_year_id')
      .eq('id', classId)
      .single();

    if (groupError || !group) {
      this.logger.error(
        `Class not found for addTeacher ${classId}: ${groupError?.message}`,
      );
      throw new NotFoundException('Class not found');
    }

    const academicYearId = group.academic_year_id;

    const { data: existingAssignment } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('id')
      .eq('user_profile_id', dto.teacherId)
      .eq('student_group_id', classId)
      .maybeSingle();

    if (!existingAssignment) {
      const { error: assignError } = await supabase
        .schema('staff')
        .from('teacher_group_assignment')
        .insert({
          user_profile_id: dto.teacherId,
          student_group_id: classId,
          academic_year_id: academicYearId,
          is_class_teacher: false,
        });

      if (assignError) {
        this.logger.error(
          `Failed to add teacher ${dto.teacherId} to class ${classId}: ${assignError.message}`,
        );
        throw new BadRequestException('Failed to add teacher to class');
      }
    }

    await supabase
      .schema('staff')
      .from('teacher_subject_assignment')
      .delete()
      .eq('user_profile_id', dto.teacherId)
      .eq('student_group_id', classId);

    if (dto.subjectIds.length > 0) {
      const subjectRows = dto.subjectIds.map((subjectId) => ({
        user_profile_id: dto.teacherId,
        subject_id: subjectId,
        student_group_id: classId,
        academic_year_id: academicYearId,
      }));

      const { error: subjectError } = await supabase
        .schema('staff')
        .from('teacher_subject_assignment')
        .insert(subjectRows);

      if (subjectError) {
        this.logger.error(
          `Teacher added but subject assignment failed: ${subjectError.message}`,
        );
        throw new BadRequestException('Failed to assign subjects');
      }
    }

    return { teacherId: dto.teacherId, classId, subjectIds: dto.subjectIds };
  }

  async removeTeacher(classId: string, teacherId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: assignment } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('is_class_teacher')
      .eq('user_profile_id', teacherId)
      .eq('student_group_id', classId)
      .single();

    if (assignment?.is_class_teacher) {
      throw new ForbiddenException('Cannot remove the class teacher');
    }

    await supabase
      .schema('staff')
      .from('teacher_subject_assignment')
      .delete()
      .eq('user_profile_id', teacherId)
      .eq('student_group_id', classId);

    const { error } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .delete()
      .eq('user_profile_id', teacherId)
      .eq('student_group_id', classId);

    if (error) {
      this.logger.error(
        `Failed to remove teacher ${teacherId} from class ${classId}: ${error.message}`,
      );
      throw new BadRequestException('Failed to remove teacher');
    }

    return 'Teacher removed from class';
  }
}
