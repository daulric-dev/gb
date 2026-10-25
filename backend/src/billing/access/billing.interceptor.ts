import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { billingEnabled } from '../config/billing.config';
import { SubscriptionService } from '../subscriptions/subscription.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Mutations that stay open while a school is read-only. */
const ALLOWED_PREFIXES = [
  '/api/auth/',
  '/api/billing/',
  '/api/platform/',
  '/api/notifications/devices',
  '/health',
];

/** Read markers: marking things read is not "using" the platform. */
const READ_MARKER = /\/(read|read-all|mark-read)$/;

export const SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED';

export function isExempt(method: string, url: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const path = url.split('?')[0];
  if (path === '/' || path === '/api' || path === '/api/') return true;
  return ALLOWED_PREFIXES.some((p) => path.startsWith(p)) || READ_MARKER.test(path);
}

export function subscriptionRequired(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.PAYMENT_REQUIRED,
      code: SUBSCRIPTION_REQUIRED,
      message:
        "Your school's subscription has lapsed - the platform is read-only until it is renewed",
    },
    HttpStatus.PAYMENT_REQUIRED,
  );
}

/**
 * Refuses mutations (402) from members of a school whose subscription has
 * lapsed. An interceptor rather than a guard because Nest runs interceptors
 * after every guard: by then the route's AuthGuard has identified the user.
 * Requests without a user, or from users without a school, are not tied to
 * a school and pass. With billing off it is a single env check.
 */
@Injectable()
export class BillingEntitlementInterceptor implements NestInterceptor {
  constructor(private readonly subscriptions: SubscriptionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!billingEnabled() || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      user?: { id: string };
    }>();
    if (isExempt(req.method, req.url) || !req.user?.id) return next.handle();
    const userId = req.user.id;
    return from(this.assertWritable(userId)).pipe(mergeMap(() => next.handle()));
  }

  private async assertWritable(userId: string): Promise<void> {
    const schoolId = await this.subscriptions.schoolOfUser(userId);
    if (!schoolId) return;
    const ent = await this.subscriptions.entitlement(schoolId);
    if (ent.readOnly) throw subscriptionRequired();
  }
}
