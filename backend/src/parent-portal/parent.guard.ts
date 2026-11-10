import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { excludedByAge, parseParentSettings } from './parent-settings';

/** What ParentGuard pins to the request. */
export interface ParentContext {
  userId: string;
  /** The child the route is about (`:studentId`), after the link was checked. */
  studentId?: string;
  /**
   * The school FeatureGuard checks: the child's school, or, on routes
   * without a child, a linked child's school (one with the parent portal
   * on when there is one). Null for a parent with no linked children.
   */
  schoolId: string | null;
}

export interface ParentRequest {
  user?: { id: string; email?: string };
  parent?: ParentContext;
  params?: Record<string, string | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The parent portal's security model, like StudentGuard is the student
 * portal's. Only `account_type = 'parent'` profiles pass, and a route with a
 * `:studentId` passes only when `student.parent_student_link` links that
 * child to the caller (and the child is active, and not left out by the
 * school's age limit). Anything else about a child is a 404, so ids cannot
 * be probed. Handlers read `req.parent.studentId`, never the raw param.
 *
 * Parents hold no school membership, catalog permission, course role or
 * student record, so every staff and student guard already turns them away;
 * this guard is the only way in. Runs after AuthGuard and before
 * FeatureGuard (which reads `req.parent.schoolId`).
 */
@Injectable()
export class ParentGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ParentRequest>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');

    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true, is_active: true },
    });
    if (profile?.account_type !== 'parent') {
      throw new ForbiddenException('This area is for parent accounts');
    }
    if (profile.is_active === false) {
      throw new ForbiddenException('Account is deactivated');
    }

    const studentId = request.params?.studentId;
    if (studentId !== undefined) {
      request.parent = { userId, ...(await this.child(userId, studentId)) };
      return true;
    }

    request.parent = { userId, schoolId: await this.anySchool(userId) };
    return true;
  }

  /** The linked child, or 404. */
  private async child(userId: string, studentId: string) {
    const notFound = () => new NotFoundException('Child not found');
    if (!UUID.test(studentId)) throw notFound();

    const link = await this.prisma.parent_student_link.findFirst({
      where: { user_profile_id: userId, student_id: studentId },
      select: {
        student: {
          select: {
            id: true,
            school_id: true,
            is_active: true,
            date_of_birth: true,
            school: { select: { parent_settings: true, is_active: true } },
          },
        },
      },
    });
    const student = link?.student;
    if (!student?.school_id || student.is_active === false || student.school?.is_active === false) {
      throw notFound();
    }
    const settings = parseParentSettings(student.school?.parent_settings);
    if (excludedByAge(settings, student.date_of_birth)) throw notFound();

    return { studentId: student.id, schoolId: student.school_id };
  }

  /** A linked child's school: one with the parent portal on if any. */
  private async anySchool(userId: string): Promise<string | null> {
    const links = await this.prisma.parent_student_link.findMany({
      where: { user_profile_id: userId },
      select: { student: { select: { school_id: true } } },
      orderBy: { created_at: 'asc' },
    });
    const schools = [
      ...new Set(links.map((l) => l.student?.school_id).filter((s): s is string => !!s)),
    ];
    for (const schoolId of schools) {
      if (await this.features.isEnabled(schoolId, 'parent_portal')) return schoolId;
    }
    return schools[0] ?? null;
  }
}
