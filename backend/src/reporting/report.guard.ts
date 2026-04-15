import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class ReportGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const reportId = request.params?.id as string | undefined;
    const entryId = request.params?.entryId as string | undefined;

    const serviceClient = this.supabaseService.getServiceClient();
    let targetReportId: string | undefined = reportId;

    if (!targetReportId && entryId) {
      const { data: entry } = await serviceClient
        .schema('reporting')
        .from('report_book_entry')
        .select('report_book_id')
        .eq('id', entryId)
        .maybeSingle();

      targetReportId = entry?.report_book_id ?? undefined;
    }

    if (!targetReportId) {
      return true;
    }

    const { data: report } = await serviceClient
      .schema('reporting')
      .from('report_book')
      .select('status')
      .eq('id', targetReportId)
      .maybeSingle();

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (report.status === 'sent_to_ministry') {
      throw new ForbiddenException(
        'Report has been sent to the ministry and is locked for editing',
      );
    }

    return true;
  }
}
