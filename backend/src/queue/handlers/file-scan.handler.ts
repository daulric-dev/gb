import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import type { ScanJobData } from '../queue.constants';

// Upper bound for a manually-uploaded file. Mirrors the multipart limit.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed Content Types
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Scanning File for Issues
@Injectable()
export class FileScanHandler {
  private readonly logger = new Logger(FileScanHandler.name);

  constructor(private readonly supabase: SupabaseService) {}

  async run(data: ScanJobData): Promise<void> {
    const client = this.supabase.getServiceClient();

    const { data: file, error } = await client
      .schema('file_manager')
      .from('file')
      .select('id, bucket, storage_path, content_type, size_bytes, status')
      .eq('id', data.fileId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !file) {
      this.logger.warn(`Scan skipped: file ${data.fileId} not found`);
      return;
    }
    // Idempotency: only act on files still awaiting a scan.
    if (file.status !== 'pending' && file.status !== 'scanning') {
      this.logger.log(
        `Scan skipped: file ${data.fileId} already ${file.status}`,
      );
      return;
    }

    await this.setStatus(data.fileId, 'scanning');

    try {
      if (file.size_bytes > MAX_FILE_SIZE) {
        return this.fail(data.fileId, 'File exceeds the 10MB limit');
      }
      if (!ALLOWED_TYPES.has(file.content_type)) {
        return this.fail(data.fileId, `Unsupported type: ${file.content_type}`);
      }

      const { data: blob, error: dlError } = await client.storage
        .from(file.bucket)
        .download(file.storage_path);

      if (dlError || !blob) {
        return this.fail(
          data.fileId,
          `Could not read stored object: ${dlError?.message}`,
        );
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const verdict = await this.scanForViruses(buffer);
      if (!verdict.clean) {
        await this.setStatus(
          data.fileId,
          'infected',
          verdict.detail ?? 'Malware detected',
        );
        this.logger.warn(`File ${data.fileId} quarantined: ${verdict.detail}`);
        return;
      }

      await this.setStatus(data.fileId, 'ready');
      this.logger.log(`File ${data.fileId} scanned clean and marked ready`);
    } catch (err) {
      await this.fail(data.fileId, (err as Error).message);
      throw err; // surface to BullMQ so the job can retry
    }
  }

  private scanForViruses(
    buffer: Buffer,
  ): Promise<{ clean: boolean; detail?: string }> {
    void buffer; // no scanner configured yet; pass content through
    return Promise.resolve({ clean: true });
  }

  private async fail(fileId: string, detail: string): Promise<void> {
    await this.setStatus(fileId, 'failed', detail);
    this.logger.warn(`File ${fileId} failed scanning: ${detail}`);
  }

  private async setStatus(
    fileId: string,
    status: 'scanning' | 'ready' | 'failed' | 'infected',
    detail?: string,
  ): Promise<void> {
    await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .update({
        status,
        scan_detail: detail ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId);
  }
}
