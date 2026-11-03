import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { PermissionGuard } from '@/permission/permission.guard';
import { FeatureService } from '@/features/feature.service';

export const CHAT_STAFF_ONLY = 'chat_staff_only';

/** A chat route students may never use (channels). */
export const ChatStaffOnly = () => SetMetadata(CHAT_STAFF_ONLY, true);

/**
 * Who may use chat routes. Staff: PermissionGuard with the route's chat:*
 * permission, as before. Students hold no catalog permissions; they pass
 * when their school has `student_messaging` on (else 403 FEATURE_DISABLED),
 * and never on `@ChatStaffOnly()` routes. What a student may then do (only
 * their teachers, never another student) is decided in ChatService. Runs
 * after AuthGuard and FeatureGuard (`messaging`).
 */
@Injectable()
export class ChatAccessGuard implements CanActivate {
  private readonly staffGuard: PermissionGuard;

  constructor(
    private readonly reflector: Reflector,
    cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {
    this.staffGuard = new PermissionGuard(reflector, cache, prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');

    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true, is_active: true },
    });
    if (profile?.account_type !== 'student') {
      return this.staffGuard.canActivate(context);
    }

    if (profile.is_active === false) {
      throw new ForbiddenException('Account is deactivated');
    }
    const staffOnly = this.reflector.getAllAndOverride<boolean>(
      CHAT_STAFF_ONLY,
      [context.getHandler(), context.getClass()],
    );
    if (staffOnly) throw new ForbiddenException('Channels are for staff');

    // As StudentGuard: the linked student record must exist and be active
    // (deactivating a student only flips student.is_active).
    const student = await this.prisma.student.findFirst({
      where: { user_profile_id: userId },
      select: { id: true, is_active: true },
    });
    if (!student?.id) {
      throw new ForbiddenException('No student record is linked to this account');
    }
    if (student.is_active === false) {
      throw new ForbiddenException('This student record is inactive');
    }

    const schoolId = await this.features.schoolOfUser(userId);
    if (!schoolId) {
      throw new ForbiddenException('No student record is linked to this account');
    }
    await this.features.assertEnabled(schoolId, 'student_messaging');
    return true;
  }
}
