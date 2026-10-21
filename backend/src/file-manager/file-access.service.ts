import { Injectable } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

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
  constructor(private readonly supabase: SupabaseService) {}

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
    const client = this.supabase.getServiceClient();

    const [{ data: staffRows }, { data: student }] = await Promise.all([
      client
        .schema('course')
        .from('course_staff')
        .select('course_id')
        .eq('user_profile_id', userId),
      client
        .schema('student')
        .from('student')
        .select('id')
        .eq('user_profile_id', userId)
        .eq('school_id', schoolId)
        .maybeSingle(),
    ]);

    // course_staff rows outlive removal from the school, so they only count
    // while the user is still a member of it.
    const ids = new Set(
      isMember
        ? (staffRows ?? []).map((r: { course_id: string }) => r.course_id)
        : [],
    );

    if (student?.id) {
      const { data: enrolled } = await client
        .schema('course')
        .from('course_student')
        .select('course_id')
        .eq('student_id', student.id)
        .eq('status', 'active');
      for (const r of enrolled ?? []) ids.add((r).course_id);
    }

    if (ids.size === 0) return [];

    // Staff rows are not school-scoped; keep only this school's courses.
    const { data: courses } = await client
      .schema('course')
      .from('course')
      .select('id')
      .eq('school_id', schoolId)
      .in('id', [...ids]);
    return (courses ?? []).map((c: { id: string }) => c.id);
  }

  /** Role ids and course ids the user matches in the given school. */
  async principalsFor(
    userId: string,
    schoolId: string,
  ): Promise<UserPrincipals> {
    const client = this.supabase.getServiceClient();

    const { data: membership } = await client
      .from('school_management')
      .select('id')
      .eq('user_id', userId)
      .eq('school_id', schoolId)
      .maybeSingle();

    let roleIds: string[] = [];
    if (membership?.id) {
      const { data: roles } = await client
        .from('school_management_role')
        .select('school_role_id')
        .eq('school_management_id', membership.id);
      roleIds = (roles ?? []).map(
        (r: { school_role_id: string }) => r.school_role_id,
      );
    }

    const courseIds = await this.courseIdsFor(userId, schoolId, !!membership?.id);

    return { userId, roleIds, courseIds };
  }

  private async bestShare(
    fileId: string,
    principals: UserPrincipals,
  ): Promise<{ canDownload: boolean } | null> {
    const client = this.supabase.getServiceClient();

    const { data: shares } = await client
      .schema('file_manager')
      .from('file_share')
      .select('principal_type, principal_id, can_download')
      .eq('file_id', fileId);

    if (!shares || shares.length === 0) return null;

    let matched = false;
    let canDownload = false;
    for (const s of shares as Array<{
      principal_type: PrincipalType;
      principal_id: string;
      can_download: boolean;
    }>) {
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
    const client = this.supabase.getServiceClient();

    const orClauses = [
      `and(principal_type.eq.user,principal_id.eq.${principals.userId})`,
    ];
    if (principals.roleIds.length > 0) {
      orClauses.push(
        `and(principal_type.eq.role,principal_id.in.(${principals.roleIds.join(',')}))`,
      );
    }
    if (principals.courseIds.length > 0) {
      orClauses.push(
        `and(principal_type.eq.course,principal_id.in.(${principals.courseIds.join(',')}))`,
      );
    }

    const { data: shares } = await client
      .schema('file_manager')
      .from('file_share')
      .select('file_id')
      .eq('school_id', schoolId)
      .or(orClauses.join(','));

    return [
      ...new Set((shares ?? []).map((s: { file_id: string }) => s.file_id)),
    ] as string[];
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

    const { data: shares } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file_share')
      .select('file_id, principal_type, principal_id, can_download')
      .in('file_id', fileIds);

    for (const s of (shares ?? []) as Array<{
      file_id: string;
      principal_type: PrincipalType;
      principal_id: string;
      can_download: boolean;
    }>) {
      const isMatch = matches(s, principals);
      if (!isMatch) continue;
      // Most permissive wins: OR can_download across all matching shares.
      flags.set(s.file_id, (flags.get(s.file_id) ?? false) || s.can_download);
    }

    return flags;
  }
}
