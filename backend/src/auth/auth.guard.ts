import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '@/account/session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FastifyReply, FastifyRequest } from 'fastify';

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email?: string;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request: AuthenticatedRequest = http.getRequest();
    const reply: FastifyReply = http.getResponse();

    try {
      // With the reply, a dead session clears its cookie on the way out.
      const session = await this.sessions.resolve(request, reply);

      if (!session) {
        throw new UnauthorizedException('Invalid or expired session');
      }
      const user = { id: session.userId, email: session.email };

      // A lookup failure is not a deactivation, as before.
      const profile = await this.prisma.user_profile
        .findUnique({ where: { id: user.id }, select: { is_active: true } })
        .catch(() => null);

      if (profile && profile.is_active === false) {
        // End the session too, so the cookie goes with the 401 and clients
        // that only check for its presence stop treating this as signed in.
        await this.sessions.revoke(request, reply);
        throw new UnauthorizedException('Account is deactivated');
      }

      request.user = {
        id: user.id,
        email: user.email,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Unexpected error in AuthGuard: ${String(err)}`);
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
