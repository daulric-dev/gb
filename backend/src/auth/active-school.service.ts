import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { optionalImageUrl } from '@/images/public-url';
import { isOrgAdmin } from '@/organisation/org-admin';
import { userPermCachePrefix } from '@/permission/permission.effective';
import { AuthService } from './auth.service';

/** One school the caller can work in, as `GET /api/me/schools` lists it. */
export interface MySchool {
  id: string;
  name: string | null;
  logoUrl: string | null;
  /** Their membership role there; null without one (or for students). */
  role: string | null;
  /** Reachable only because they are an organisation admin. */
  viaOrganisation: boolean;
  /** Their active school (`user_profile.school_id`). */
  isActive: boolean;
}

const SCHOOL_FIELDS = {
  id: true,
  name: true,
  logo_path: true,
  is_active: true,
} as const;

/** `is_active` is nullable; null has always meant active. */
const isLive = (s: { is_active: boolean | null }) => s.is_active !== false;

/**
 * The schools a user can work in and switching between them. The active
 * school is `user_profile.school_id` (with `role` mirrored beside it), which
 * every school-scoped route reads; switching rewrites that pair.
 */
@Injectable()
export class ActiveSchoolService {
  private readonly logger = new Logger(ActiveSchoolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Staff: their memberships plus, for an organisation admin, every active
   * school of the organisation. Students: just their own school. Inactive
   * schools are left out unless one is the active school.
   */
  async list(userId: string): Promise<MySchool[]> {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true, account_type: true },
    });
    if (!profile) throw new NotFoundException('User profile not found');
    const activeId = profile.school_id;
    // Parents belong to no school; their children are in the parent portal.
    if (profile.account_type === 'parent') return [];

    if (profile.account_type === 'student') {
      if (!activeId) return [];
      const school = await this.prisma.school.findUnique({
        where: { id: activeId },
        select: SCHOOL_FIELDS,
      });
      return school ? [this.row(school, null, false, activeId)] : [];
    }

    const [memberships, orgAdmin] = await Promise.all([
      this.prisma.school_management.findMany({
        where: { user_id: userId },
        select: { role: true, school: { select: SCHOOL_FIELDS } },
      }),
      isOrgAdmin(this.prisma, userId).catch(() => false),
    ]);

    const byId = new Map<string, MySchool>();
    for (const m of memberships) {
      if (!isLive(m.school) && m.school.id !== activeId) continue;
      byId.set(m.school.id, this.row(m.school, m.role, false, activeId));
    }

    if (orgAdmin) {
      const schools = await this.prisma.school.findMany({
        where: { OR: [{ is_active: true }, { is_active: null }] },
        select: SCHOOL_FIELDS,
      });
      for (const s of schools) {
        if (!byId.has(s.id)) byId.set(s.id, this.row(s, null, true, activeId));
      }
    }

    // The active school stays listed even when it is no longer reachable
    // (switched off, or the organisation admin role was removed).
    if (activeId && !byId.has(activeId)) {
      const school = await this.prisma.school.findUnique({
        where: { id: activeId },
        select: SCHOOL_FIELDS,
      });
      if (school) byId.set(school.id, this.row(school, null, false, activeId));
    }

    return [...byId.values()].sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? ''),
    );
  }

  /**
   * Make `schoolId` the caller's active school and return their refreshed
   * profile. Members switch to their own schools (taking their membership
   * role there); an organisation admin to any active school, as 'admin' when
   * they have no membership. Students cannot switch (403), nor can anyone
   * reach a school they have no part in (403) or a switched-off one (400).
   */
  async switch(userId: string, schoolId: string) {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true },
    });
    if (!profile) throw new NotFoundException('User profile not found');
    if (profile.account_type === 'student' || profile.account_type === 'parent') {
      throw new ForbiddenException('Students cannot switch schools');
    }

    const membership = await this.prisma.school_management.findUnique({
      where: { user_id_school_id: { user_id: userId, school_id: schoolId } },
      select: { role: true },
    });
    const orgAdmin =
      !membership && (await isOrgAdmin(this.prisma, userId).catch(() => false));
    if (!membership && !orgAdmin) {
      throw new ForbiddenException('You do not have access to this school');
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, is_active: true },
    });
    if (!school) throw new NotFoundException('School not found');
    if (!isLive(school)) {
      throw new BadRequestException('This school is inactive');
    }

    // The mirrored role is what AdminGuard and the clients read.
    const role = membership ? membership.role : 'admin';
    await this.prisma.user_profile.update({
      where: { id: userId },
      data: { school_id: schoolId, role, updated_at: new Date() },
    });

    await Promise.all([
      this.cache.delete(`profile:${userId}`),
      this.cache.deleteByPrefix(userPermCachePrefix(userId)),
    ]);
    this.logger.log(
      `User ${userId} switched to school ${schoolId}${orgAdmin ? ' (organisation admin)' : ''}`,
    );

    return this.auth.getProfile(userId);
  }

  private row(
    school: { id: string; name: string | null; logo_path: string | null },
    role: string | null,
    viaOrganisation: boolean,
    activeId: string | null,
  ): MySchool {
    return {
      id: school.id,
      name: school.name,
      logoUrl: optionalImageUrl(school.logo_path),
      role,
      viaOrganisation,
      isActive: school.id === activeId,
    };
  }
}
