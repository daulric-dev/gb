import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('Admin access required');
    }

    const profile = await this.prisma.user_profile
      .findUnique({
        where: { id: userId },
        select: { role: true, is_active: true, school_id: true },
      })
      .catch(() => null);

    if (profile?.role === 'admin' && profile?.is_active && profile.school_id) {
      // The profile role is a denormalised copy; the membership in the active
      // school is the source of truth.
      const membership = await this.prisma.school_management
        .findFirst({
          where: {
            user_id: userId,
            school_id: profile.school_id,
            role: 'admin',
          },
          select: { id: true },
        })
        .catch(() => null);

      if (membership) return true;
    }

    this.logger.warn(`User ${userId} denied admin access`);
    throw new ForbiddenException('Admin access required');
  }
}
