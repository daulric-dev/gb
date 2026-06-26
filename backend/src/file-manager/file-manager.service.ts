import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { SupabaseService } from '@/supabase/supabase.service';
import { FileQueueService } from '@/queue/file-queue.service';
import { FileAccessService } from './file-access.service';
import { FileShareService } from './file-share.service';
import { FileListFilter } from './dto/list-files.query.dto';
import type { ShareTargetDto } from './dto/share-file.dto';

const BUCKET = 'file-manager';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const FILE_COLUMNS =
  'id, school_id, owner_id, name, bucket, storage_path, content_type, size_bytes, source, source_ref, status, scan_detail, created_at, updated_at';

interface FileRecord {
  id: string;
  school_id: string;
  owner_id: string;
  name: string;
  bucket: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  source: string;
  source_ref: string | null;
  status: string;
  scan_detail: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class FileManagerService {
  private readonly logger = new Logger(FileManagerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly queue: FileQueueService,
    private readonly access: FileAccessService,
    private readonly shares: FileShareService,
  ) {}

  // ── Listing ──────────────────────────────────────────────────────────────

  async list(userId: string, filter: FileListFilter = FileListFilter.All) {
    const schoolId = await this.supabase.getUserSchoolId(userId);
    const client = this.supabase.getServiceClient();
    const out: Array<FileRecord & { access: 'owner' | 'shared' }> = [];

    if (filter === FileListFilter.Own || filter === FileListFilter.All) {
      const { data } = await client
        .schema('file_manager')
        .from('file')
        .select(FILE_COLUMNS)
        .eq('owner_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      for (const f of (data ?? []) as FileRecord[]) {
        out.push({ ...f, access: 'owner' });
      }
    }

    if (filter === FileListFilter.Shared || filter === FileListFilter.All) {
      const sharedIds = await this.access.sharedFileIds(userId, schoolId);
      if (sharedIds.length > 0) {
        const { data } = await client
          .schema('file_manager')
          .from('file')
          .select(FILE_COLUMNS)
          .in('id', sharedIds)
          .neq('owner_id', userId) // exclude anything I own (already listed)
          .eq('status', 'ready') // recipients only see ready files
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        for (const f of (data ?? []) as FileRecord[]) {
          out.push({ ...f, access: 'shared' });
        }
      }
    }

    // canDownload is resolved per-file so the client knows which affordances
    // to show. Owners always can; recipients depend on their share.
    return Promise.all(
      out.map(async (f) => {
        const access = await this.access.accessFor(userId, schoolId, f);
        return this.present(f, access.canDownload);
      }),
    );
  }

  async getMetadata(userId: string, fileId: string) {
    const { file, access } = await this.loadViewable(userId, fileId);
    return {
      ...this.present(file, access.canDownload),
      shareable: access.isOwner,
    };
  }

  // ── Manual upload ──────────────────────────────────────────────────────────

  async uploadManual(
    userId: string,
    file: MultipartFile,
    displayName?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) {
      throw new BadRequestException('File is empty');
    }
    if (buffer.byteLength > MAX_UPLOAD_SIZE) {
      throw new BadRequestException(
        `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
      );
    }

    const schoolId = await this.supabase.getUserSchoolId(userId);
    const id = crypto.randomUUID();
    const name = (displayName?.trim() || file.filename || 'untitled').slice(
      0,
      255,
    );
    const contentType = file.mimetype || 'application/octet-stream';
    const storagePath = `${schoolId}/${userId}/${id}-${this.slug(name)}`;

    const uploaded = await this.supabase.uploadFile(
      BUCKET,
      storagePath,
      buffer,
      contentType,
    );
    if (!uploaded) {
      throw new BadRequestException('Failed to store file');
    }

    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .insert({
        id,
        school_id: schoolId,
        owner_id: userId,
        name,
        bucket: BUCKET,
        storage_path: storagePath,
        content_type: contentType,
        size_bytes: buffer.byteLength,
        source: 'upload',
        status: 'pending',
      })
      .select(FILE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to record uploaded file: ${error?.message}`);
      throw new BadRequestException('Failed to record file');
    }

    // Validate + scan out of band; the file becomes viewable once ready.
    await this.queue.enqueueScan({ fileId: id });

    return this.present(data, true);
  }

  // ── Rename / delete ────────────────────────────────────────────────────────

  async rename(userId: string, fileId: string, name: string) {
    await this.loadOwned(userId, fileId);
    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .update({
        name: name.slice(0, 255),
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId)
      .select(FILE_COLUMNS)
      .single();
    if (error || !data) throw new BadRequestException('Failed to rename file');
    return this.present(data, true);
  }

  async softDelete(userId: string, fileId: string) {
    await this.loadOwned(userId, fileId);
    const { error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', fileId);
    if (error) throw new BadRequestException('Failed to delete file');
    return { id: fileId, deleted: true };
  }

  // ── Content delivery ────────────────────────────────────────────────────────

  /** Bytes for the inline viewer. Requires view access (owner or share). */
  async getViewContent(userId: string, fileId: string) {
    const { file } = await this.loadViewable(userId, fileId);
    return this.downloadBytes(file);
  }

  /** Bytes for download. Requires download access (owner or downloadable share). */
  async getDownloadContent(userId: string, fileId: string) {
    const { file, access } = await this.loadViewable(userId, fileId);
    if (!access.canDownload) {
      throw new ForbiddenException(
        'You do not have permission to download this file',
      );
    }
    return this.downloadBytes(file);
  }

  // ── Shares (owner only) ─────────────────────────────────────────────────────

  async listShares(userId: string, fileId: string) {
    await this.loadOwned(userId, fileId);
    return this.shares.list(fileId);
  }

  async share(userId: string, fileId: string, targets: ShareTargetDto[]) {
    const file = await this.loadOwned(userId, fileId);
    return this.shares.share(fileId, file.school_id, userId, targets);
  }

  async updateShare(
    userId: string,
    fileId: string,
    shareId: string,
    canDownload: boolean,
  ) {
    await this.loadOwned(userId, fileId);
    return this.shares.updateDownload(fileId, shareId, canDownload);
  }

  async revokeShare(userId: string, fileId: string, shareId: string) {
    await this.loadOwned(userId, fileId);
    return this.shares.revoke(fileId, shareId);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async loadFile(fileId: string): Promise<FileRecord> {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .select(FILE_COLUMNS)
      .eq('id', fileId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) throw new NotFoundException('File not found');
    return data;
  }

  /** Load a file the user owns, or throw 403/404. */
  private async loadOwned(userId: string, fileId: string): Promise<FileRecord> {
    const file = await this.loadFile(fileId);
    if (file.owner_id !== userId) {
      throw new ForbiddenException('You do not own this file');
    }
    return file;
  }

  /** Load a file the user may at least view, returning the resolved access. */
  private async loadViewable(userId: string, fileId: string) {
    const file = await this.loadFile(fileId);
    const access = await this.access.accessFor(userId, file.school_id, file);
    if (!access.canView) {
      throw new ForbiddenException('You do not have access to this file');
    }
    return { file, access };
  }

  private async downloadBytes(file: FileRecord) {
    const { data, error } = await this.supabase
      .getServiceClient()
      .storage.from(file.bucket)
      .download(file.storage_path);
    if (error || !data) {
      this.logger.error(
        `Failed to read ${file.bucket}/${file.storage_path}: ${error?.message}`,
      );
      throw new NotFoundException('File content unavailable');
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: file.content_type,
      filename: file.name,
    };
  }

  private present(f: FileRecord, canDownload: boolean) {
    return {
      id: f.id,
      name: f.name,
      contentType: f.content_type,
      sizeBytes: f.size_bytes,
      source: f.source,
      sourceRef: f.source_ref,
      status: f.status,
      ownerId: f.owner_id,
      canDownload,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    };
  }

  private slug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'file'
    );
  }
}
