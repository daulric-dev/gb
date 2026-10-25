import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { billingEnabled } from './billing.config';
import { PlatformService } from './platform.service';

/**
 * Billing and platform routes do not exist on a deployment without billing
 * (self-hosted): 404, before authentication is even looked at.
 */
@Injectable()
export class BillingEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!billingEnabled()) throw new NotFoundException();
    return true;
  }
}

/** Platform routes answer 404 to anyone who is not a platform admin. Runs after AuthGuard. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly platform: PlatformService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!billingEnabled()) throw new NotFoundException();
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    if (!(await this.platform.isPlatformAdmin(request.user?.id))) {
      throw new NotFoundException();
    }
    return true;
  }
}
