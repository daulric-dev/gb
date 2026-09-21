import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class ClassTeacherGuard implements CanActivate {
  protected readonly logger = new Logger(ClassTeacherGuard.name);

  /**
   * Whether teaching one subject in the class is enough.
   *
   * Off here: the strict guard protects the actions that belong to whoever
   * owns the class - generating the report book, submitting to the ministry,
   * changing the roster. ClassMemberGuard turns it on for reads.
   */
  protected readonly allowSubjectTeachers: boolean = false;

  constructor(protected readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    let classId =
      request.params?.classId ??
      request.body?.studentGroupId ??
      request.query?.studentGroupId ??
      undefined;

    if (!classId) {
      const url = String(request.url ?? '');
      const isReportScoped =
        url.includes('/reports') && !url.includes('/report-entries/');

      if (isReportScoped) {
        const supabase = this.supabaseService.getServiceClient();

        if (request.params?.id) {
          const { data: report } = await supabase
            .schema('reporting')
            .from('report_book')
            .select('student_group_id')
            .eq('id', request.params.id)
            .maybeSingle();
          classId = report?.student_group_id ?? undefined;
        } else if (request.query?.studentId && request.query?.termId) {
          const { data: report } = await supabase
            .schema('reporting')
            .from('report_book')
            .select('student_group_id')
            .eq('student_id', request.query.studentId)
            .eq('term_id', request.query.termId)
            .maybeSingle();
          classId = report?.student_group_id ?? undefined;
        }
      }
    }

    if (!userId || !classId) {
      throw new ForbiddenException(
        'Only the class teacher can perform this action',
      );
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('role, school_id')
      .eq('id', userId)
      .single();

    if (profile?.role === 'admin') {
      // Admin bypass is scoped to the class's school. Without this check,
      // a platform admin in school A could perform class-teacher actions
      // against a class in school B by guessing/iterating class ids.
      const { data: studentGroup } = await supabase
        .from('student_group')
        .select('academic_year:academic_year_id(school_id)')
        .eq('id', classId)
        .maybeSingle();

      const classSchoolId = (
        studentGroup?.academic_year as { school_id?: string } | null
      )?.school_id;

      if (classSchoolId && classSchoolId === profile.school_id) {
        return true;
      }

      this.logger.warn(
        `Admin ${userId} denied cross-school class teacher access to ${classId}`,
      );
      throw new ForbiddenException(
        'Only the class teacher can perform this action',
      );
    }

    const { data: assignment } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('id')
      .eq('user_profile_id', userId)
      .eq('student_group_id', classId)
      .eq('is_class_teacher', true)
      .maybeSingle();

    if (assignment) return true;

    if (this.allowSubjectTeachers) {
      const { data: subjectAssignment } = await supabase
        .schema('staff')
        .from('teacher_subject_assignment')
        .select('id')
        .eq('user_profile_id', userId)
        .eq('student_group_id', classId)
        .limit(1)
        .maybeSingle();

      if (subjectAssignment) return true;
    }

    this.logger.warn(`User ${userId} denied class access to ${classId}`);
    throw new ForbiddenException(
      this.allowSubjectTeachers
        ? 'You do not teach this class'
        : 'Only the class teacher can perform this action',
    );
  }
}

/**
 * Reading what a class produces: summaries, analytics, report cards.
 *
 * Anyone teaching the class - as its class teacher or in a single subject -
 * needs to see how it is doing. Writing stays with ClassTeacherGuard, so a
 * subject teacher cannot regenerate the report book or send it to the ministry.
 */
@Injectable()
export class ClassMemberGuard extends ClassTeacherGuard {
  protected readonly allowSubjectTeachers = true;
}
