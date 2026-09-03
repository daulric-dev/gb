import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async summary(userId: string) {
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
