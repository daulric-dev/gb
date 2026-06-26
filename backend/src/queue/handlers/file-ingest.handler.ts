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
}
