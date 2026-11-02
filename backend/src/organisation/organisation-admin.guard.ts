import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isOrgAdmin } from './org-admin';

/**
 * Organisation routes: 403 for anyone who is not an organisation admin (a
 * row in public.organisation_admin, or a verified email in
 * ORG_ADMIN_EMAILS). Runs after AuthGuard, which sets `req.user`.
 */
@Injectable()
export class OrganisationAdminGuard implements CanActivate {
  private readonly logger = new Logger(OrganisationAdminGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id;
    // A lookup failure fails closed.
    const allowed = await isOrgAdmin(this.prisma, userId).catch(() => false);
    if (!allowed) {
      this.logger.warn(`User ${userId ?? '-'} denied organisation admin access`);
      throw new ForbiddenException('Organisation admin access required');
    }
    return true;
  }
}
