import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { FileQueueService } from '@/queue/file-queue.service';
import type { ShareTargetDto } from './dto/share-file.dto';

/**
 * Manages a file's share list. All methods assume ownership has already been
 * verified by the caller (FileManagerService) — they operate on a known file.
 */
@Injectable()
export class FileShareService {
  private readonly logger = new Logger(FileShareService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queue: FileQueueService,
  ) {}

  async list(fileId: string) {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file_share')
      .select('id, principal_type, principal_id, can_download, created_at')
      .eq('file_id', fileId)
      .order('created_at', { ascending: true });
    return data ?? [];
  }

  async share(
    fileId: string,
    schoolId: string,
    createdBy: string,
    targets: ShareTargetDto[],
  ) {
    const client = this.supabase.getServiceClient();

    const rows = targets.map((t) => ({
      file_id: fileId,
      school_id: schoolId,
      principal_type: t.principalType,
      principal_id: t.principalId,
      can_download: t.canDownload ?? false,
      created_by: createdBy,
    }));

    const { data, error } = await client
      .schema('file_manager')
      .from('file_share')
      .upsert(rows, { onConflict: 'file_id,principal_type,principal_id' })
      .select('id, principal_type, principal_id, can_download, created_at');

    if (error) {
      this.logger.error(
        `Failed to create shares for ${fileId}: ${error.message}`,
      );
      throw error;
    }

    for (const share of data ?? []) {
      await this.queue.enqueueShareNotify({ shareId: share.id });
    }

    return data ?? [];
  }

  async updateDownload(fileId: string, shareId: string, canDownload: boolean) {
    const client = this.supabase.getServiceClient();
    const { data, error } = await client
      .schema('file_manager')
      .from('file_share')
      .update({ can_download: canDownload })
      .eq('id', shareId)
      .eq('file_id', fileId)
      .select('id, principal_type, principal_id, can_download, created_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Share not found');
    return data;
  }

  async revoke(fileId: string, shareId: string) {
    const client = this.supabase.getServiceClient();
    const { error } = await client
      .schema('file_manager')
      .from('file_share')
      .delete()
      .eq('id', shareId)
      .eq('file_id', fileId);
    if (error) throw error;
    return { id: shareId, revoked: true };
  }
}
