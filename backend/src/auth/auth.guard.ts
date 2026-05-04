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

    try {
      const accessToken = this.extractAccessToken(request);

      if (!accessToken) {
        throw new UnauthorizedException('No session token found');
      }

      const supabase = this.supabaseService.getServiceClient();
      const { data, error } = await supabase.auth.getUser(accessToken);

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

  private extractAccessToken(request: any): string | null {
    const cookies = request.cookies ?? {};

    const authCookieEntries = Object.entries(cookies)
      .filter(([name]) => name.startsWith('sb-') && name.includes('auth-token'))
      .sort(([a], [b]) => a.localeCompare(b));

    if (authCookieEntries.length === 0) return null;

    const raw = authCookieEntries.map(([, value]) => value).join('');

    try {
      const session = JSON.parse(raw);
      return session.access_token ?? null;
    } catch {
      return null;
    }
  }
}
