import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';

export const STEP_UP_KEY = 'require_step_up';
export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';
export const STEP_UP_MESSAGE = "Confirm it's you to change single sign-on or integration settings.";

/** The 403 a route answers until the session is confirmed. Clients key off `code`. */
export function stepUpRequired(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: STEP_UP_REQUIRED,
    message: STEP_UP_MESSAGE,
  });
}

/**
 * Step-up: the session making the request must have confirmed an emailed code
 * (`POST /auth/step-up/send`, then `/auth/step-up/verify`) within the last
 * ten minutes (`account.session.elevated_until`, see SessionService.elevate).
 * Runs after the route's own guards, so who may act is decided first and
 * this only asks them to confirm. AuthGuard puts `elevatedUntil` on the
 * request from the session lookup, whose cache `elevate` clears.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { sessionId?: string; elevatedUntil?: number | null } }>();
    const until = request.user?.elevatedUntil;
    if (request.user?.sessionId && typeof until === 'number' && until > Date.now()) {
      return true;
    }
    throw stepUpRequired();
  }
}

/**
 * For routes that change single sign-on or integration (webhook) settings: 403
 * `{ code: 'STEP_UP_REQUIRED' }` unless the session confirmed it's them
 * recently. Not for reads.
 */
export const RequireStepUp = () =>
  applyDecorators(SetMetadata(STEP_UP_KEY, true), UseGuards(StepUpGuard));
