import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async summary(userId: string) {
    // School-wide numbers are a staff view; students have the portal.
    const { data: profile } = await this.supabase
      .getServiceClient()
      .from('user_profile')
      .select('account_type')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.account_type === 'student') {
      throw new ForbiddenException('Staff only');
    }

    const { data, error } = await this.supabase
      .getServiceClient()
      .functions.invoke('dashboard-summary', { body: { userId } });

    if (error || !data) {
      this.logger.error(
        `Dashboard summary failed: ${error?.message ?? 'empty response'}`,
      );
      throw new BadRequestException('Failed to load dashboard summary');
    }
    return data;
  }
}
