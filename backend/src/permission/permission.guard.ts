import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@/cache/cache.service';
import {
  PERMISSION_KEY,
  PERMISSION_SCOPE_KEY,
  type PermissionScope,
} from './require-permission.decorator';
import { PermissionKey } from './permission.catalog';
import { loadEffectivePermissions } from './permission.effective';
import { PrismaService } from '@/prisma/prisma.service';

/** What this guard reads off a request; anything else is the handler's. */
interface GuardedRequest {
  method?: string;
  url?: string;
  params?: Record<string, unknown>;
  user?: { id?: unknown };
}

/** A route or user id as a non-empty string, or undefined. */
function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

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

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const userId = idOf(request.user?.id);

    if (!userId) {
      // AuthGuard should have populated request.user; if not, fail closed.
      throw new ForbiddenException('Authentication required');
    }

    const scope = this.reflector.getAllAndOverride<PermissionScope>(
      PERMISSION_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const schoolId = await this.resolveSchoolContext(request, scope, context);
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

  /**
   * The school to check the permission in.
   *
   * With a scope declared (`@RequirePermission(..., 'param' | 'course' |
   * 'active')`) only that source is read, so the school the permission is
   * checked in is the school the route states it works in.
   *
   * With none declared the old order applies - route `:schoolId`, then the
   * school owning `:courseId`, then the caller's active school - and the guard
   * says so in the log. A handler that takes a resource id from the body and
   * resolves its own school is the case to watch for: the implicit fallback
   * checks the permission in the active school while the work happens
   * elsewhere, and only the service's own scoping stops that mattering.
   */
  private async resolveSchoolContext(
    request: GuardedRequest,
    scope: PermissionScope | undefined,
    context: ExecutionContext,
  ): Promise<string | undefined> {
    const schoolParam = idOf(request.params?.schoolId);
    const courseParam = idOf(request.params?.courseId);
    const userId = idOf(request.user?.id);

    if (scope === 'param') return schoolParam;
    if (scope === 'course') return this.schoolOfCourse(courseParam);
    if (scope === 'active') return this.activeSchool(userId);

    this.logger.warn(
      `${request.method ?? '?'} ${request.url ?? '?'} ` +
        `(${context.getClass().name}.${context.getHandler().name}) ` +
        'resolves its school implicitly; declare a scope on @RequirePermission',
    );

    if (schoolParam) return schoolParam;
    const fromCourse = await this.schoolOfCourse(courseParam);
    if (fromCourse) return fromCourse;
    return this.activeSchool(userId);
  }

  private async schoolOfCourse(
    courseId: string | undefined,
  ): Promise<string | undefined> {
    if (!courseId) return undefined;
    // A malformed id fails the lookup rather than throwing.
    const course = await this.prisma.course
      .findUnique({ where: { id: courseId }, select: { school_id: true } })
      .catch(() => null);
    return course?.school_id ?? undefined;
  }

  /** The caller's active school (denormalised single current school). */
  private async activeSchool(
    userId: string | undefined,
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const profile = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null);
    return profile?.school_id ?? undefined;
  }
}
