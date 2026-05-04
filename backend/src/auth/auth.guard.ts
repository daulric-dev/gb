import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();

    try {
      const supabase = this.supabaseService.createUserClient(
        request,
        reply,
        'public',
      );

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        this.logger.warn(`Invalid session: ${error?.message}`);
        throw new UnauthorizedException('Invalid or expired session');
      }

      request.user = {
        id: data.user.id,
        email: data.user.email,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error in AuthGuard: ${String(err)}`);
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
