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
      let accessToken = this.supabaseService.extractAccessToken(request);

      if (!accessToken) {
        accessToken = await this.refreshFromCookie(request, reply);
      }

      if (!accessToken) {
        throw new UnauthorizedException('No session token found');
      }

      const { data, error } = await this.supabaseService
        .getServiceClient()
        .auth.getUser(accessToken);

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

  private async refreshFromCookie(
    request: any,
    reply: any,
  ): Promise<string | null> {
    const refreshToken = this.supabaseService.extractRefreshToken(request);
    if (!refreshToken) return null;

    const session = await this.supabaseService.refreshSession(refreshToken);

    if (!session) {
      this.logger.warn('Refresh failed');
      return null;
    }

    this.supabaseService.setSessionCookies(reply, session);
    return session.access_token;
  }
}
