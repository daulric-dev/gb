import { Injectable } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/** The principals a user matches when resolving shares in a given school. */
export interface UserPrincipals {
  userId: string;
  roleIds: string[];
  /** Courses the user is on as staff, or (through their student record) as an active student. */
  courseIds: string[];
}

type PrincipalType = 'user' | 'role' | 'course' | 'group';

/**
 * Whether a share row names one of the user's principals.
 *
 * `group` shares (the old class shares) no longer match anyone: classes are
 * gone, and an owner who still wants those students to see a file shares it
 * with the course that replaced the class.
 */
function matches(
  share: { principal_type: PrincipalType; principal_id: string },
  principals: UserPrincipals,
): boolean {
  switch (share.principal_type) {
    case 'user':
      return share.principal_id === principals.userId;
    case 'role':
      return principals.roleIds.includes(share.principal_id);
    case 'course':
      return principals.courseIds.includes(share.principal_id);
    default:
      return false;
  }
}

export interface FileAccess {
  isOwner: boolean;
  canView: boolean;
  canDownload: boolean;
}

interface FileRow {
  id: string;
  owner_id: string;
  status: string;
}

@Injectable()
export class FileAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Courses in the school a file shared "with the course" reaches this user
   * through: ones they teach or assist in, and ones their linked student
   * record is actively enrolled in (a dropped student loses access).
   */
  private async courseIdsFor(
    userId: string,
    schoolId: string,
    isMember: boolean,
  ): Promise<string[]> {
    const [staffRows, student] = await Promise.all([
      this.prisma.course_staff.findMany({
        where: { user_profile_id: userId },
        select: { course_id: true },
      }),
      this.prisma.student.findFirst({
        where: { user_profile_id: userId, school_id: schoolId },
        select: { id: true },
      }),
    ]);

    // course_staff rows outlive removal from the school, so they only count
    // while the user is still a member of it.
    const ids = new Set(
      isMember ? (staffRows ?? []).map((r) => r.course_id) : [],
    );

    if (student?.id) {
      const enrolled = await this.prisma.course_student.findMany({
        where: { student_id: student.id, status: 'active' },
        select: { course_id: true },
      });
      for (const r of enrolled ?? []) ids.add(r.course_id);
    }

    if (ids.size === 0) return [];

    // Staff rows are not school-scoped; keep only this school's courses.
    const courses = await this.prisma.course.findMany({
      where: { school_id: schoolId, id: { in: [...ids] } },
      select: { id: true },
    });
    return (courses ?? []).map((c) => c.id);
  }

  /** Role ids and course ids the user matches in the given school. */
  async principalsFor(
    userId: string,
    schoolId: string,
  ): Promise<UserPrincipals> {
    const membership = await this.prisma.school_management.findFirst({
      where: { user_id: userId, school_id: schoolId },
      select: { id: true },
    });

    let roleIds: string[] = [];
    if (membership?.id) {
      const roles = await this.prisma.school_management_role.findMany({
        where: { school_management_id: membership.id },
        select: { school_role_id: true },
      });
      roleIds = (roles ?? []).map((r) => r.school_role_id);
    }

    const courseIds = await this.courseIdsFor(
      userId,
      schoolId,
      !!membership?.id,
    );

    return { userId, roleIds, courseIds };
  }

  private async bestShare(
    fileId: string,
    principals: UserPrincipals,
  ): Promise<{ canDownload: boolean } | null> {
    const shares = await this.prisma.file_share.findMany({
      where: { file_id: fileId },
      select: { principal_type: true, principal_id: true, can_download: true },
    });

    if (!shares || shares.length === 0) return null;

    let matched = false;
    let canDownload = false;
    for (const s of shares) {
      const isMatch = matches(s, principals);
      if (isMatch) {
        matched = true;
        canDownload = canDownload || s.can_download;
      }
    }

    return matched ? { canDownload } : null;
  }

  /** Resolve access for a loaded file row. */
  async accessFor(
    userId: string,
    schoolId: string,
    file: FileRow,
  ): Promise<FileAccess> {
    if (file.owner_id === userId) {
      return { isOwner: true, canView: true, canDownload: true };
    }

    const principals = await this.principalsFor(userId, schoolId);
    const share = await this.bestShare(file.id, principals);
    if (!share) {
      return { isOwner: false, canView: false, canDownload: false };
    }

    // Recipients can only ever touch a file once it has passed scanning.
    const ready = file.status === 'ready';
    return {
      isOwner: false,
      canView: ready,
      canDownload: ready && share.canDownload,
    };
  }

  async sharedFileIdsFor(
    principals: UserPrincipals,
    schoolId: string,
  ): Promise<string[]> {
    const or: Prisma.file_shareWhereInput[] = [
      { principal_type: 'user', principal_id: principals.userId },
    ];
    if (principals.roleIds.length > 0) {
      or.push({
        principal_type: 'role',
        principal_id: { in: principals.roleIds },
      });
    }
    if (principals.courseIds.length > 0) {
      or.push({
        principal_type: 'course',
        principal_id: { in: principals.courseIds },
      });
    }

    const shares = await this.prisma.file_share.findMany({
      where: { school_id: schoolId, OR: or },
      select: { file_id: true },
    });

    return [...new Set((shares ?? []).map((s) => s.file_id))];
  }

  /** Convenience wrapper that resolves principals then the shared ids. */
  async sharedFileIds(userId: string, schoolId: string): Promise<string[]> {
    const principals = await this.principalsFor(userId, schoolId);
    return this.sharedFileIdsFor(principals, schoolId);
  }

  async downloadFlagsFor(
    fileIds: string[],
    principals: UserPrincipals,
  ): Promise<Map<string, boolean>> {
    const flags = new Map<string, boolean>();
    if (fileIds.length === 0) return flags;

    const shares = await this.prisma.file_share.findMany({
      where: { file_id: { in: fileIds } },
      select: {
        file_id: true,
        principal_type: true,
        principal_id: true,
        can_download: true,
      },
    });

    for (const s of shares ?? []) {
      const isMatch = matches(s, principals);
      if (!isMatch) continue;
      // Most permissive wins: OR can_download across all matching shares.
      flags.set(s.file_id, (flags.get(s.file_id) ?? false) || s.can_download);
    }

    return flags;
  }
}
