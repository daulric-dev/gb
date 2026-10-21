import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@/cache/cache.service';
import { PERMISSION_KEY } from './require-permission.decorator';
import { PermissionKey } from './permission.catalog';
import { loadEffectivePermissions } from './permission.effective';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Unannotated route: this guard does not apply.
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string = request.user?.id;

    if (!userId) {
      // AuthGuard should have populated request.user; if not, fail closed.
      throw new ForbiddenException('Authentication required');
    }

    const schoolId = await this.resolveSchoolContext(request);
    if (!schoolId) {
      throw new ForbiddenException('Could not resolve school context');
    }

    const effective = await loadEffectivePermissions(
      this.prisma,
      this.cache,
      userId,
      schoolId,
    );

    if (!effective.member) {
      this.logger.warn(
        `User ${userId} is not a member of school ${schoolId} (needs ${required})`,
      );
      throw new ForbiddenException('You are not a member of this school');
    }

    if (effective.keys.includes(required)) {
      return true;
    }

    this.logger.warn(
      `User ${userId} denied: missing permission ${required} in school ${schoolId}`,
    );
    throw new ForbiddenException(`Missing permission: ${required}`);
  }

  private async resolveSchoolContext(
    request: any,
  ): Promise<string | undefined> {
    if (request.params?.schoolId) return request.params.schoolId;

    const courseId = request.params?.courseId ?? undefined;

    if (courseId) {
      // A malformed id fails the lookup; fall through to the active school.
      const course = await this.prisma.course
        .findUnique({ where: { id: courseId }, select: { school_id: true } })
        .catch(() => null);

      if (course?.school_id) return course.school_id;
    }

    // Fallback: the user's active school (denormalized single current school).
    const profile = await this.prisma.user_profile
      .findUnique({
        where: { id: request.user.id },
        select: { school_id: true },
      })
      .catch(() => null);

    return profile?.school_id ?? undefined;
  }
}
