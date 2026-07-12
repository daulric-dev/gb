import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import type { IngestJobData } from '../queue.constants';

/**
 * Creates a file-manager record for an already-stored object (e.g. a generated
 * report PDF). The bytes are trusted internal output, so the record is marked
 * `ready` straight away — no virus scan. Idempotent: a retry that finds the
 * same (bucket, path) already ingested is a no-op.
 */
@Injectable()
export class FileIngestHandler {
  private readonly logger = new Logger(FileIngestHandler.name);

  constructor(private readonly supabase: SupabaseService) {}

  async run(data: IngestJobData): Promise<void> {
    const client = this.supabase.getServiceClient();

    const { data: existing } = await client
      .schema('file_manager')
      .from('file')
      .select('id')
      .eq('bucket', data.bucket)
      .eq('storage_path', data.storagePath)
      .maybeSingle();

    if (existing) {
      this.logger.log(
        `Ingest skipped: ${data.bucket}/${data.storagePath} already a file (${existing.id})`,
      );
      return;
    }

    // File the report under its owner's system folder path (e.g.
    // Reports/2026-07-12), creating the folders on demand.
    const folderId = data.folderPath?.length
      ? await this.resolveSystemFolder(
          data.ownerId,
          data.schoolId,
          data.folderPath,
        )
      : null;

    const { error } = await client
      .schema('file_manager')
      .from('file')
      .insert({
        school_id: data.schoolId,
        owner_id: data.ownerId,
        name: data.name,
        bucket: data.bucket,
        storage_path: data.storagePath,
        content_type: data.contentType,
        size_bytes: data.sizeBytes,
        source: 'report',
        source_ref: data.sourceRef ?? null,
        folder_id: folderId,
        status: 'ready',
      });

    if (error) {
      this.logger.error(
        `Ingest failed for ${data.storagePath}: ${error.message}`,
      );
      throw new Error(error.message);
    }

    this.logger.log(
      `Ingested report file for owner ${data.ownerId}: ${data.name}`,
    );
  }

  /**
   * Find-or-create a nested path of `is_system` folders for an owner and return
   * the leaf id. Kept here (rather than reusing FolderService) so the queue
   * module stays independent of the file-manager module. Idempotent via the
   * unique folder indexes; a lost insert race is recovered by re-reading.
   */
  private async resolveSystemFolder(
    ownerId: string,
    schoolId: string,
    path: string[],
  ): Promise<string | null> {
    const client = this.supabase.getServiceClient();
    let parentId: string | null = null;

    for (const raw of path) {
      const name = raw.trim().replace(/[/\\]/g, '-').slice(0, 120);
      if (!name) continue;

      const find = () => {
        const q = client
          .schema('file_manager')
          .from('folder')
          .select('id')
          .eq('owner_id', ownerId)
          .eq('name', name)
          .is('deleted_at', null);
        return (
          parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null)
        ).maybeSingle();
      };

      const { data: existing } = await find();
      if (existing?.id) {
        parentId = existing.id;
        continue;
      }

      const { data: created, error } = await client
        .schema('file_manager')
        .from('folder')
        .insert({
          school_id: schoolId,
          owner_id: ownerId,
          parent_id: parentId,
          name,
          is_system: true,
        })
        .select('id')
        .single();

      if (created?.id) {
        parentId = created.id;
        continue;
      }

      const { data: raced } = await find();
      if (!raced?.id) {
        this.logger.warn(
          `Could not resolve report folder "${name}": ${error?.message}`,
        );
        return parentId;
      }
      parentId = raced.id;
    }

    return parentId;
  }
}
