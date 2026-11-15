import {
  CanActivate,
  ForbiddenException,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService } from '@/account/session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { MfaService } from '@/mfa/mfa.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from './public.decorator';

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email?: string;
    /** The session making this request (Signed-in devices marks it "This device"). */
    sessionId?: string;
    /** Step-up: ms epoch until which the session may change SSO settings (StepUpGuard). */
    elevatedUntil?: number | null;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    // Global (src/mfa); optional only so unit tests can leave it out.
    @Optional() private readonly mfa?: MfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // This guard is global (APP_GUARD): every route is authenticated unless
    // it is marked @Public(). See auth/public.decorator.ts.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

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

      // A lookup *failure* fails closed: it throws, falls through to the 503
      // below, and never lets a possibly deactivated account through.
      //
      // A missing row is a different thing and is allowed: a user has no
      // profile between their first sign-in and onboarding. It is not a way
      // for a deleted account to keep a session, because the only code that
      // deletes a profile (erasure/account-erasure.ts) revokes every session
      // first and deletes the app_user row in the same transaction, and
      // SessionService.resolve already refuses a session whose app_user is
      // gone or carries disabled_at. Any future path that removes a profile
      // on its own must revoke the sessions with it.
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
        elevatedUntil: session.elevatedUntil,
      };

      // A session limited to setting up an authenticator app: 403
      // MFA_ENROLMENT_REQUIRED outside those routes (src/mfa).
      if (this.mfa) await this.mfa.assertSessionAllowed(request);

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
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
