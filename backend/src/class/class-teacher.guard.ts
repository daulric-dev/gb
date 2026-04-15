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
  private readonly logger = new Logger(ClassTeacherGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    let classId =
      request.params?.classId
      ?? request.body?.studentGroupId
      ?? request.query?.studentGroupId
      ?? undefined;

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
      .select('role')
      .eq('id', userId)
      .single();

    if (profile?.role === 'admin') {
      return true;
    }

    const { data: assignment, error } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('id')
      .eq('user_profile_id', userId)
      .eq('student_group_id', classId)
      .eq('is_class_teacher', true)
      .single();

    if (error || !assignment) {
      this.logger.warn(
        `User ${userId} denied class teacher access to ${classId}`,
      );
      throw new ForbiddenException(
        'Only the class teacher can perform this action',
      );
    }

    return true;
  }
}
