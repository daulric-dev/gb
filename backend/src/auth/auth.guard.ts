import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '@/account/session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FastifyReply, FastifyRequest } from 'fastify';

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email?: string;
    /** The session making this request (Signed-in devices marks it "This device"). */
    sessionId?: string;
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
        // AUTH_DEBUG=true: say why a request was turned away (never the token).
        if (process.env.AUTH_DEBUG === 'true') {
          const h = request.headers ?? {};
          this.logger.warn(
            `401 ${request.method} ${request.url} cookie=${!!request.cookies?.gb_session} ` +
              `bearer=${/^Bearer\s/i.test(String(h.authorization ?? ''))} ` +
              `client=${String(h['x-gradebook-client'] ?? '-')} ua=${String(h['user-agent'] ?? '-').slice(0, 60)}`,
          );
        }
        throw new UnauthorizedException('Invalid or expired session');
      }
      const user = { id: session.userId, email: session.email };

      // A lookup failure fails closed: it falls through to the 503 below,
      // never letting a possibly deactivated account through.
      const profile = await this.prisma.user_profile.findUnique({
        where: { id: user.id },
        select: { is_active: true },
      });

      if (profile && profile.is_active === false) {
        // End the session too, so the cookie goes with the 401 and clients
        // that only check for its presence stop treating this as signed in.
        await this.sessions.revoke(request, reply, 'deactivated');
        throw new UnauthorizedException('Account is deactivated');
      }

      request.user = {
        id: user.id,
        email: user.email,
        sessionId: session.sessionId,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Not a verdict on the session: the database or cache couldn't be
      // reached. A 401 here made clients drop a perfectly good session (the
      // app cleared its token and signed out) whenever Postgres was down, so
      // answer 503 and let them retry.
      this.logger.error(`Unexpected error in AuthGuard: ${String(err)}`);
      throw new ServiceUnavailableException(
        'GradeBook is temporarily unavailable. Please try again in a moment.',
      );
    }
  }
}
