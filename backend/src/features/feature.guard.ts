import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from './feature.service';
import { FEATURE_KEY } from './require-feature.decorator';
import type { FeatureKey } from './feature.catalog';

interface FeatureRequest {
  user?: { id: string };
  student?: { schoolId: string };
  /** Set by ParentGuard: the linked child's school. */
  parent?: { schoolId: string | null };
  params?: Record<string, string | undefined>;
}

/**
 * Refuses routes whose `@RequireFeature` keys are off for the caller's
 * school with 403 FEATURE_DISABLED. The school is resolved like
 * PermissionGuard and StudentGuard do: the student StudentGuard pinned (or
 * the child ParentGuard checked), the
 * route's `:schoolId`, the `:courseId`'s school, then the caller's active
 * school (a student's own school). No school at all checks the
 * organisation's settings. Runs after AuthGuard (and StudentGuard).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = this.reflector.getAllAndOverride<FeatureKey[] | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!keys?.length) return true;

    const request = context.switchToHttp().getRequest<FeatureRequest>();
    const schoolId = await this.resolveSchool(request);
    for (const key of keys) await this.features.assertEnabled(schoolId, key);
    return true;
  }

  private async resolveSchool(request: FeatureRequest): Promise<string | null> {
    if (request.student?.schoolId) return request.student.schoolId;
    if (request.parent?.schoolId) return request.parent.schoolId;
    if (request.params?.schoolId) return request.params.schoolId;

    const courseId = request.params?.courseId;
    if (courseId) {
      // A malformed id fails the lookup; fall through to the caller's school.
      const course = await this.prisma.course
        .findUnique({ where: { id: courseId }, select: { school_id: true } })
        .catch(() => null);
      if (course?.school_id) return course.school_id;
    }

    const userId = request.user?.id;
    return userId ? this.features.schoolOfUser(userId) : null;
  }
}
