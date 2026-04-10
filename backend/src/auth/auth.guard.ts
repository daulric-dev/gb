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
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.split(' ')[1];

    try {
      const supabase = this.supabaseService.getServiceClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        this.logger.warn(`Invalid token: ${error?.message}`);
        throw new UnauthorizedException('Invalid or expired token');
      }

      request.user = {
        id: data.user.id,
        email: data.user.email,
        access_token: token,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error in AuthGuard: ${err}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
