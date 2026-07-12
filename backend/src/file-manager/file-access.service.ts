import { Injectable } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

/** The principals a user matches when resolving shares in a given school. */
export interface UserPrincipals {
  userId: string;
  roleIds: string[];
  groupIds: string[];
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

  /** Role ids and group ids the user matches in the given school. */
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

    const { data: groups } = await client
      .schema('staff')
      .from('teacher_group_assignment')
      .select('student_group_id')
      .eq('user_profile_id', userId);
    const groupIds = (groups ?? []).map(
      (g: { student_group_id: string }) => g.student_group_id,
    );

    return { userId, roleIds, groupIds };
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
      principal_type: 'user' | 'role' | 'group';
      principal_id: string;
      can_download: boolean;
    }>) {
      const isMatch =
        (s.principal_type === 'user' && s.principal_id === principals.userId) ||
        (s.principal_type === 'role' &&
          principals.roleIds.includes(s.principal_id)) ||
        (s.principal_type === 'group' &&
          principals.groupIds.includes(s.principal_id));
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
    if (principals.groupIds.length > 0) {
      orClauses.push(
        `and(principal_type.eq.group,principal_id.in.(${principals.groupIds.join(',')}))`,
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
      principal_type: 'user' | 'role' | 'group';
      principal_id: string;
      can_download: boolean;
    }>) {
      const isMatch =
        (s.principal_type === 'user' && s.principal_id === principals.userId) ||
        (s.principal_type === 'role' &&
          principals.roleIds.includes(s.principal_id)) ||
        (s.principal_type === 'group' &&
          principals.groupIds.includes(s.principal_id));
      if (!isMatch) continue;
      // Most permissive wins: OR can_download across all matching shares.
      flags.set(s.file_id, (flags.get(s.file_id) ?? false) || s.can_download);
    }

    return flags;
  }
}
