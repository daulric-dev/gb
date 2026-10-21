import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';

/** What the portal resolves once per request and scopes every query to. */
export interface StudentContext {
  studentId: string;
  schoolId: string;
}

export interface StudentRequest {
  user?: { id: string };
  student?: StudentContext;
}

const CONTEXT_TTL = 60 * 60; // seconds

/**
 * Resolves the caller's linked student record and pins it to the request.
 *
 * This is the whole security model of the portal: handlers never accept a
 * student id from the client, they read `req.student.studentId`. Scoping is
 * structural rather than a filter someone can forget, which is why students
 * hold no catalog permissions at all.
 */
@Injectable()
export class StudentGuard implements CanActivate {
  private readonly logger = new Logger(StudentGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: StudentRequest = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      // AuthGuard runs first and populates this; fail closed if it did not.
      throw new ForbiddenException('Authentication required');
    }

    const cacheKey = `student-context:${userId}`;
    const cached = (await this.cache.get(cacheKey)) as StudentContext | null;

    if (cached?.studentId) {
      request.student = cached;
      return true;
    }

    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true, is_active: true },
    });

    if (profile?.account_type !== 'student') {
      throw new ForbiddenException('This area is for student accounts');
    }

    if (profile.is_active === false) {
      throw new ForbiddenException('Account is deactivated');
    }

    const student = await this.prisma.student.findFirst({
      where: { user_profile_id: userId },
      select: { id: true, school_id: true, is_active: true },
    });

    if (!student?.id || !student.school_id) {
      // Onboarded as a student but never redeemed a claim code.
      throw new ForbiddenException('No student record is linked to this account');
    }

    if (student.is_active === false) {
      throw new ForbiddenException('This student record is inactive');
    }

    const resolved: StudentContext = {
      studentId: student.id,
      schoolId: student.school_id,
    };

    await this.cache.set(cacheKey, resolved, CONTEXT_TTL);
    request.student = resolved;
    return true;
  }
}
