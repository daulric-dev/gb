import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import { verifyContent } from '@/file-manager/file-content';
import type { IngestJobData } from '../queue.constants';

/**
 * Creates a file-manager record for an already-stored object (e.g. a generated
 * report PDF), filed under optional system folders, and marks it `ready`. The
 * object must exist and its bytes must match the declared type. Idempotent: a
 * retry that finds the same (bucket, path) already ingested is a no-op.
 */
@Injectable()
export class FileIngestHandler {
  private readonly logger = new Logger(FileIngestHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async run(data: IngestJobData): Promise<void> {
    const existing = await this.prisma.file.findFirst({
      where: { bucket: data.bucket, storage_path: data.storagePath },
      select: { id: true },
    });

    if (existing) {
      this.logger.log(
        `Ingest skipped: ${data.bucket}/${data.storagePath} already a file (${existing.id})`,
      );
      return;
    }

    const key = objectKey(data.bucket, data.storagePath);
    const buffer = await this.storage.getBuffer(key);
    if (!buffer) {
      // Thrown so the queue retries: the writer may not have finished yet.
      throw new Error(`Ingest: object ${key} not found`);
    }
    const check = verifyContent(buffer, data.contentType);
    if (!check.ok) {
      this.logger.error(`Ingest rejected ${key}: ${check.reason}`);
      return;
    }

    const folderId = await this.ensureFolders(data);

    const file = await this.prisma.file.create({
      data: {
        school_id: data.schoolId,
        owner_id: data.ownerId,
        name: data.name,
        bucket: data.bucket,
        storage_path: data.storagePath,
        content_type: data.contentType,
        size_bytes: buffer.byteLength,
        source: 'report',
        source_ref: data.sourceRef ?? null,
        folder_id: folderId,
        status: 'ready',
      },
      select: { id: true },
    });
    this.logger.log(`Ingested ${key} as file ${file.id}`);
  }

  /** Find or create each system folder on the path; the innermost id. */
  private async ensureFolders(data: IngestJobData): Promise<string | null> {
    let parentId: string | null = null;
    for (const raw of data.folderPath ?? []) {
      const name = String(raw).trim().replace(/[\\/]/g, '-').slice(0, 120);
      if (!name) continue;

      const found: { id: string } | null = await this.prisma.folder.findFirst({
        where: {
          owner_id: data.ownerId,
          parent_id: parentId,
          name,
          deleted_at: null,
        },
        select: { id: true },
      });
      if (found) {
        parentId = found.id;
        continue;
      }

      const created: { id: string } = await this.prisma.folder.create({
        data: {
          school_id: data.schoolId,
          owner_id: data.ownerId,
          parent_id: parentId,
          name,
          is_system: true,
        },
        select: { id: true },
      });
      parentId = created.id;
    }
    return parentId;
  }
}
