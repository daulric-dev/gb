import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('Admin access required');
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('role, is_active, school_id')
      .eq('id', userId)
      .single();

    if (profile?.role === 'admin' && profile?.is_active && profile.school_id) {
      // The profile role is a denormalised copy; the membership in the active
      // school is the source of truth.
      const { data: membership } = await supabase
        .from('school_management')
        .select('id')
        .eq('user_id', userId)
        .eq('school_id', profile.school_id)
        .eq('role', 'admin')
        .maybeSingle();

      if (membership) return true;
    }

    this.logger.warn(`User ${userId} denied admin access`);
    throw new ForbiddenException('Admin access required');
  }
}
