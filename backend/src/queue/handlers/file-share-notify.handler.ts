import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import type { ShareNotifyJobData } from '../queue.constants';

@Injectable()
export class FileShareNotifyHandler {
  private readonly logger = new Logger(FileShareNotifyHandler.name);

  constructor(private readonly supabase: SupabaseService) {}

  async run(data: ShareNotifyJobData): Promise<void> {
    const client = this.supabase.getServiceClient();

    const { data: share } = await client
      .schema('file_manager')
      .from('file_share')
      .select(
        'id, file_id, school_id, principal_type, principal_id, can_download',
      )
      .eq('id', data.shareId)
      .maybeSingle();

    if (!share) {
      this.logger.warn(`Share-notify skipped: share ${data.shareId} not found`);
      return;
    }

    const { data: file } = await client
      .schema('file_manager')
      .from('file')
      .select('id, name, owner_id')
      .eq('id', share.file_id)
      .maybeSingle();

    if (!file) {
      this.logger.warn(`Share-notify skipped: file ${share.file_id} gone`);
      return;
    }

    const recipients = await this.resolveRecipients(
      share.principal_type,
      share.principal_id,
      share.school_id,
    );

    // Never notify the owner about their own share.
    const targets = recipients.filter((id) => id !== file.owner_id);
    await this.deliver(targets, {
      schoolId: share.school_id,
      shareId: share.id,
      fileId: file.id,
      fileName: file.name,
      canDownload: share.can_download,
    });
  }

  private async resolveRecipients(
    principalType: 'user' | 'role' | 'group',
    principalId: string,
    schoolId: string,
  ): Promise<string[]> {
    const client = this.supabase.getServiceClient();

    if (principalType === 'user') {
      return [principalId];
    }

    if (principalType === 'role') {
      // Everyone whose school membership is assigned this custom role.
      const { data: assignments } = await client
        .from('school_management_role')
        .select('school_management:school_management_id(user_id, school_id)')
        .eq('school_role_id', principalId);

      const userIds: string[] = [];
      for (const a of (assignments ?? []) as any[]) {
        // The embedded to-one resource may arrive as an object or a 1-element
        // array depending on the generated types; normalise both.
        const m = Array.isArray(a.school_management)
          ? a.school_management[0]
          : a.school_management;
        if (m?.school_id === schoolId && m?.user_id) {
          userIds.push(m.user_id as string);
        }
      }
      return userIds;
    }

    // group: every teacher assigned to the class/group.
    const { data: assignments } = await client
      .schema('staff')
      .from('teacher_group_assignment')
      .select('user_profile_id')
      .eq('student_group_id', principalId);

    return (assignments ?? []).map(
      (a: { user_profile_id: string }) => a.user_profile_id,
    );
  }

  /**
   * Persist one in-app notification per recipient. Idempotent on
   * (user_id, share_id): a retried job or a re-share upserts the same rows
   * without creating duplicates or resurrecting a read notification.
   */
  private async deliver(
    recipientIds: string[],
    payload: {
      schoolId: string;
      shareId: string;
      fileId: string;
      fileName: string;
      canDownload: boolean;
    },
  ): Promise<void> {
    if (recipientIds.length === 0) {
      this.logger.log(`Share ${payload.fileId}: no recipients to notify`);
      return;
    }

    const rows = recipientIds.map((userId) => ({
      school_id: payload.schoolId,
      user_id: userId,
      file_id: payload.fileId,
      share_id: payload.shareId,
      type: 'file_share',
      title: `"${payload.fileName}" was shared with you`,
      body: payload.canDownload
        ? 'You can view and download this file.'
        : 'You can view this file.',
      can_download: payload.canDownload,
    }));

    const { error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('notification')
      .upsert(rows, {
        onConflict: 'user_id,share_id',
        ignoreDuplicates: true,
      });

    if (error) {
      this.logger.error(
        `Failed to write notifications for share ${payload.shareId}: ${error.message}`,
      );
      throw new Error(error.message);
    }

    this.logger.log(
      `Notified ${recipientIds.length} user(s) of shared file "${payload.fileName}"`,
    );
  }
}
