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
import { ChatSystemService } from '@/chat/chat-system.service';
import { FileAccessService } from './file-access.service';
import { FileShareService } from './file-share.service';
import { FolderService } from './folder.service';
import { FileListFilter } from './dto/list-files.filter';
import type { ShareTargetDto } from './dto/share-file.dto';
import { verifyContent, ALLOWED_CONTENT_TYPES } from './file-content';
import { mintUploadToken } from '@/supabase/upload-token';

const BUCKET = 'file-manager';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Storage's TUS implementation requires exactly this chunk size. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** Long enough to start a 10MB upload, short enough to be worth little. */
const UPLOAD_TOKEN_TTL_SECONDS = 30 * 60;

const FILE_COLUMNS =
  'id, school_id, owner_id, name, bucket, storage_path, content_type, size_bytes, source, source_ref, status, scan_detail, folder_id, created_at, updated_at';

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
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class FileManagerService {
  private readonly logger = new Logger(FileManagerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly access: FileAccessService,
    private readonly shares: FileShareService,
    private readonly chatSystem: ChatSystemService,
    private readonly folders: FolderService,
  ) {}

  // ── Listing ──────────────────────────────────────────────────────────────

  /**
   * List the files a user can see. Returns a bare array by default; pass
   * `page` to get a paginated envelope instead (backward-compatible).
   *
   * Access is resolved without an N+1: principals are resolved once, then the
   * download flag for every non-owned row on the page is resolved in a single
   * batched query.
   */
  async list(
    userId: string,
    filter: FileListFilter = FileListFilter.All,
    pagination?: { page?: number; pageSize?: number },
  ) {
    const schoolId = await this.supabase.getUserSchoolId(userId);
    const client = this.supabase.getServiceClient();
    const principals = await this.access.principalsFor(userId, schoolId);

    const paginated = pagination?.page !== undefined;
    const pageSize = Math.min(pagination?.pageSize ?? 20, 100);
    const page = pagination?.page ?? 1;

    let query = client
      .schema('file_manager')
      .from('file')
      .select(FILE_COLUMNS, paginated ? { count: 'exact' } : undefined)
      .is('deleted_at', null);

    // A shared row is only visible once 'ready'; an owned row is always
    // visible to its owner. `all` unions both in one query so it can paginate.
    if (filter === FileListFilter.Own) {
      query = query.eq('owner_id', userId);
    } else {
      const sharedIds = await this.access.sharedFileIdsFor(
        principals,
        schoolId,
      );
      if (filter === FileListFilter.Shared) {
        if (sharedIds.length === 0)
          return this.emptyList(paginated, page, pageSize);
        query = query
          .in('id', sharedIds)
          .neq('owner_id', userId)
          .eq('status', 'ready');
      } else {
        query =
          sharedIds.length === 0
            ? query.eq('owner_id', userId)
            : query.or(
                `owner_id.eq.${userId},and(id.in.(${sharedIds.join(',')}),status.eq.ready)`,
              );
      }
    }

    query = query.order('created_at', { ascending: false });
    if (paginated) {
      const from = (page - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);
    }

    const { data, count } = await query;
    const rows = (data ?? []) as FileRecord[];

    const nonOwnedIds = rows
      .filter((f) => f.owner_id !== userId)
      .map((f) => f.id);
    const dlFlags = await this.access.downloadFlagsFor(nonOwnedIds, principals);

    const items = rows.map((f) =>
      this.present(
        f,
        f.owner_id === userId ? true : (dlFlags.get(f.id) ?? false),
      ),
    );

    if (!paginated) return items;

    const total = count ?? 0;
    return {
      data: items,
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        hasMore: page * pageSize < total,
      },
    };
  }

  private emptyList(paginated: boolean, page: number, pageSize: number) {
    if (!paginated) return [];
    return {
      data: [],
      meta: { total: 0, page, pageSize, pageCount: 0, hasMore: false },
    };
  }

  async getMetadata(userId: string, fileId: string) {
    const { file, access } = await this.loadViewable(userId, fileId);
    return {
      ...this.present(file, access.canDownload),
      shareable: access.isOwner,
    };
  }

  // ── Folder browsing ────────────────────────────────────────────────────────

  /**
   * Browse one folder of the caller's own tree: its subfolders, the files
   * directly inside it, and the breadcrumb path. `folderId` null is the root
   * ("My files"), which holds files with no folder_id.
   */
  async browseFolder(userId: string, folderId: string | null) {
    // A non-root folder must exist and belong to the caller.
    const current = folderId
      ? await this.folders.getOwned(userId, folderId)
      : null;

    const [folders, breadcrumb] = await Promise.all([
      this.folders.listChildren(userId, folderId),
      this.folders.breadcrumb(userId, folderId),
    ]);

    let query = this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .select(FILE_COLUMNS)
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    query = folderId
      ? query.eq('folder_id', folderId)
      : query.is('folder_id', null);

    const { data } = await query;
    const files = ((data ?? []) as FileRecord[]).map((f) =>
      this.present(f, true),
    );

    return {
      folder: current
        ? { id: current.id, name: current.name, parentId: current.parent_id }
        : null,
      breadcrumb,
      folders,
      files,
    };
  }

  /** Move an owned file into a folder (or to the root with folderId null). */
  async move(userId: string, fileId: string, folderId: string | null) {
    await this.loadOwned(userId, fileId);
    if (folderId) await this.folders.getOwned(userId, folderId);

    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .update({ folder_id: folderId, updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .select(FILE_COLUMNS)
      .single();
    if (error || !data) throw new BadRequestException('Failed to move file');
    return this.present(data, true);
  }

  async createUploadTicket(
    userId: string,
    input: {
      name: string;
      sizeBytes: number;
      contentType: string;
      folderId?: string;
    },
  ) {
    if (input.folderId) await this.folders.getOwned(userId, input.folderId);

    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException('File is empty');
    }
    if (input.sizeBytes > MAX_UPLOAD_SIZE) {
      throw new BadRequestException(
        `File too large (${(input.sizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
      );
    }

    const contentType = input.contentType || 'application/octet-stream';
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(`${contentType} files are not accepted`);
    }

    const schoolId = await this.supabase.getUserSchoolId(userId);
    const id = crypto.randomUUID();
    const name = (input.name?.trim() || 'untitled').slice(0, 255);
    const storagePath = `${schoolId}/${userId}/${id}-${this.slug(name)}`;

    const { error } = await this.supabase
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
        size_bytes: input.sizeBytes,
        source: 'upload',
        folder_id: input.folderId ?? null,
        status: 'pending',
      });

    if (error) {
      this.logger.error(`Failed to reserve upload: ${error.message}`);
      throw new BadRequestException('Failed to start the upload');
    }

    const { token, expiresAt } = mintUploadToken({
      userId,
      ttlSeconds: UPLOAD_TOKEN_TTL_SECONDS,
      secret: process.env.SUPABASE_JWT_SECRET ?? '',
    });

    return {
      fileId: id,
      endpoint: `${process.env.SUPABASE_URL}/storage/v1/upload/resumable`,
      token,
      expiresAt,
      bucket: BUCKET,
      objectName: storagePath,
      contentType,
      // Storage's TUS implementation only supports this chunk size.
      chunkSize: TUS_CHUNK_SIZE,
    };
  }

  async finaliseUpload(userId: string, fileId: string) {
    const client = this.supabase.getServiceClient();

    const { data: file } = await client
      .schema('file_manager')
      .from('file')
      .select(FILE_COLUMNS)
      .eq('id', fileId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!file) throw new NotFoundException('File not found');

    const record = file;
    if (record.status === 'ready') return this.present(record, true);
    if (record.status !== 'pending') {
      throw new BadRequestException('This upload already failed');
    }

    const { data: blob, error: downloadError } = await client.storage
      .from(record.bucket)
      .download(record.storage_path);

    if (downloadError || !blob) {
      await this.failUpload(fileId, 'failed', 'Upload did not complete');
      throw new BadRequestException('The upload did not complete');
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    if (buffer.byteLength === 0) {
      await this.discardUpload(record, 'failed', 'Uploaded file was empty');
      throw new BadRequestException('File is empty');
    }
    if (buffer.byteLength > MAX_UPLOAD_SIZE) {
      await this.discardUpload(record, 'failed', 'Uploaded file was too large');
      throw new BadRequestException('File too large. Maximum is 10MB.');
    }

    const check = verifyContent(buffer, record.content_type);
    if (!check.ok) {
      await this.discardUpload(record, 'failed', check.reason);
      throw new BadRequestException(check.reason);
    }

    try {
      await this.supabase.scanOrThrow(
        buffer,
        `${record.bucket}/${record.storage_path}`,
      );
    } catch (err) {
      await this.discardUpload(
        record,
        'infected',
        err instanceof Error ? err.message : 'Failed virus scan',
      );
      throw err;
    }

    const { data: updated, error } = await client
      .schema('file_manager')
      .from('file')
      .update({
        status: 'ready',
        size_bytes: buffer.byteLength,
        scan_detail: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId)
      .select(FILE_COLUMNS)
      .single();

    if (error || !updated) {
      this.logger.error(`Failed to release upload: ${error?.message}`);
      throw new BadRequestException('Failed to record file');
    }

    return this.present(updated, true);
  }

  /** Mark a reserved row as failed without touching Storage. */
  private async failUpload(fileId: string, status: string, detail: string) {
    await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .update({ status, scan_detail: detail })
      .eq('id', fileId);
  }

  /** Remove the rejected object, then record why it was rejected. */
  private async discardUpload(
    file: FileRecord,
    status: string,
    detail: string,
  ) {
    const { error } = await this.supabase
      .getServiceClient()
      .storage.from(file.bucket)
      .remove([file.storage_path]);

    if (error) {
      this.logger.error(
        `Rejected upload ${file.bucket}/${file.storage_path} could not be removed: ${error.message}`,
      );
    }

    await this.failUpload(file.id, status, detail);
  }

  // ── Manual upload ──────────────────────────────────────────────────────────

  async uploadManual(
    userId: string,
    file: MultipartFile,
    displayName?: string,
    folderId?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    // A target folder must be one of the caller's own folders.
    if (folderId) await this.folders.getOwned(userId, folderId);

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) {
      throw new BadRequestException('File is empty');
    }
    if (buffer.byteLength > MAX_UPLOAD_SIZE) {
      throw new BadRequestException(
        `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
      );
    }

    // Reject unsupported or mislabelled files up front (the async scan repeats
    // this as defence in depth). The declared MIME type is not trusted alone:
    // for fingerprintable formats the leading bytes must match.
    const contentType = file.mimetype || 'application/octet-stream';
    const check = verifyContent(buffer, contentType);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const schoolId = await this.supabase.getUserSchoolId(userId);
    const id = crypto.randomUUID();
    const name = (displayName?.trim() || file.filename || 'untitled').slice(
      0,
      255,
    );
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
        folder_id: folderId ?? null,
        // Bytes were virus-scanned synchronously in uploadFile above, so the
        // file is immediately viewable — no async scan step.
        status: 'ready',
      })
      .select(FILE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to record uploaded file: ${error?.message}`);
      throw new BadRequestException('Failed to record file');
    }

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
    const created = await this.shares.share(
      fileId,
      file.school_id,
      userId,
      targets,
    );
    // Drop a "file shared with you" chat message (with an accept+view action)
    // into each direct-user share's DM. Best-effort; never blocks the share.
    await this.chatSystem.notifyFileShares(
      userId,
      { id: file.id, name: file.name, school_id: file.school_id },
      created,
    );
    return created;
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

  /**
   * Bytes for a caller who has already been authorised by something other than
   * file sharing - a teacher reading work handed in to their own class, where
   * the student owns the file and no share exists. The caller must do that
   * check; this deliberately does none.
   */
  async readContentForAuthorisedCaller(fileId: string) {
    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .select('*')
      .eq('id', fileId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('File not found');
    }

    return this.downloadBytes(data as FileRecord);
  }

  private async downloadBytes(file: FileRecord) {
    if (file.status !== 'ready') {
      throw new NotFoundException('File is not available');
    }

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
      folderId: f.folder_id,
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
