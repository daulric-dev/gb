import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma, file_status } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { num } from '@/common/db-values';
import { ChatSystemService } from '@/chat/chat-system.service';
import { FileAccessService } from './file-access.service';
import { FileShareService } from './file-share.service';
import { FolderService } from './folder.service';
import { FileListFilter } from './dto/list-files.filter';
import type { ShareTargetDto } from './dto/share-file.dto';
import { verifyContent, ALLOWED_CONTENT_TYPES } from './file-content';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';

const BUCKET = 'file-manager';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Long enough to send a 10MB file, short enough to be worth little. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const FILE_COLUMNS = {
  id: true,
  school_id: true,
  owner_id: true,
  name: true,
  bucket: true,
  storage_path: true,
  content_type: true,
  size_bytes: true,
  source: true,
  source_ref: true,
  status: true,
  scan_detail: true,
  folder_id: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.fileSelect;

type FileRecord = Prisma.fileGetPayload<{ select: typeof FILE_COLUMNS }>;

/**
 * Ids come straight from the URL. Postgres rejects a malformed uuid, which
 * the API has always reported as "not found" rather than a server error.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID_RE.test(id);

@Injectable()
export class FileManagerService {
  private readonly logger = new Logger(FileManagerService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
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
    const schoolId = await this.schoolIdOf(userId);
    const principals = await this.access.principalsFor(userId, schoolId);

    const paginated = pagination?.page !== undefined;
    const pageSize = Math.min(pagination?.pageSize ?? 20, 100);
    const page = pagination?.page ?? 1;

    const where: Prisma.fileWhereInput = { deleted_at: null };

    // A shared row is only visible once 'ready'; an owned row is always
    // visible to its owner. `all` unions both in one query so it can paginate.
    if (filter === FileListFilter.Own) {
      where.owner_id = userId;
    } else {
      const sharedIds = await this.access.sharedFileIdsFor(
        principals,
        schoolId,
      );
      if (filter === FileListFilter.Shared) {
        if (sharedIds.length === 0)
          return this.emptyList(paginated, page, pageSize);
        where.id = { in: sharedIds };
        where.owner_id = { not: userId };
        where.status = 'ready';
      } else if (sharedIds.length === 0) {
        where.owner_id = userId;
      } else {
        where.OR = [
          { owner_id: userId },
          { id: { in: sharedIds }, status: 'ready' },
        ];
      }
    }

    const [rows, count] = await Promise.all([
      this.prisma.file.findMany({
        where,
        select: FILE_COLUMNS,
        orderBy: { created_at: 'desc' },
        ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      paginated ? this.prisma.file.count({ where }) : Promise.resolve(0),
    ]);

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

    const rows = await this.prisma.file.findMany({
      where: {
        owner_id: userId,
        deleted_at: null,
        folder_id: folderId ?? null,
      },
      select: FILE_COLUMNS,
      orderBy: { created_at: 'desc' },
    });
    const files = rows.map((f) => this.present(f, true));

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

    const data = await this.prisma.file
      .update({
        where: { id: fileId },
        data: { folder_id: folderId, updated_at: new Date() },
        select: FILE_COLUMNS,
      })
      .catch(() => null);
    if (!data) throw new BadRequestException('Failed to move file');
    return this.present(data, true);
  }

  /**
   * Reserve a pending file row and hand back a presigned URL the client PUTs
   * the bytes to, straight into object storage. The client then calls
   * `finaliseUpload`, which checks what actually arrived.
   */
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

    const schoolId = await this.schoolIdOf(userId);
    const id = crypto.randomUUID();
    const name = (input.name?.trim() || 'untitled').slice(0, 255);
    const storagePath = `${schoolId}/${userId}/${id}-${this.slug(name)}`;

    try {
      await this.prisma.file.create({
        data: {
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
        },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error(
        `Failed to reserve upload: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to start the upload');
    }

    const expiresAt = new Date(
      Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
    ).toISOString();
    const uploadUrl = await this.storage.uploadUrl(
      objectKey(BUCKET, storagePath),
      contentType,
      UPLOAD_URL_TTL_SECONDS,
    );

    return {
      fileId: id,
      method: 'PUT' as const,
      uploadUrl,
      // Part of the signature: the PUT must carry exactly this header.
      headers: { 'Content-Type': contentType },
      expiresAt,
      contentType,
      maxBytes: MAX_UPLOAD_SIZE,
    };
  }

  async finaliseUpload(userId: string, fileId: string) {
    const file = !isUuid(fileId)
      ? null
      : await this.prisma.file.findFirst({
          where: { id: fileId, owner_id: userId },
          select: FILE_COLUMNS,
        });

    if (!file) throw new NotFoundException('File not found');

    const record = file;
    if (record.status === 'ready') return this.present(record, true);
    if (record.status !== 'pending') {
      throw new BadRequestException('This upload already failed');
    }

    const key = objectKey(record.bucket, record.storage_path);
    const head = await this.storage.exists(key);
    if (!head) {
      await this.failUpload(fileId, 'failed', 'Upload did not complete');
      throw new BadRequestException('The upload did not complete');
    }

    // A presigned PUT cannot cap the body, so the size is enforced here,
    // before anything is read back.
    if (head.size > MAX_UPLOAD_SIZE) {
      await this.discardUpload(record, 'failed', 'Uploaded file was too large');
      throw new BadRequestException('File too large. Maximum is 10MB.');
    }
    const declared = num(record.size_bytes);
    if (declared && head.size > 0 && head.size !== declared) {
      await this.discardUpload(
        record,
        'failed',
        'Uploaded file does not match the declared size',
      );
      throw new BadRequestException(
        'The uploaded file does not match the declared size',
      );
    }

    const buffer = await this.storage.getBuffer(key);
    if (!buffer) {
      await this.failUpload(fileId, 'failed', 'Upload did not complete');
      throw new BadRequestException('The upload did not complete');
    }

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

    let updated: FileRecord;
    try {
      updated = await this.prisma.file.update({
        where: { id: fileId },
        data: {
          status: 'ready',
          size_bytes: buffer.byteLength,
          scan_detail: null,
          updated_at: new Date(),
        },
        select: FILE_COLUMNS,
      });
    } catch (error) {
      this.logger.error(
        `Failed to release upload: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to record file');
    }

    return this.present(updated, true);
  }

  /** Mark a reserved row as failed without touching storage. */
  private async failUpload(
    fileId: string,
    status: file_status,
    detail: string,
  ) {
    await this.prisma.file
      .updateMany({
        where: { id: fileId },
        data: { status, scan_detail: detail },
      })
      .catch((error: Error) =>
        this.logger.error(`Failed to mark upload ${fileId}: ${error.message}`),
      );
  }

  /** Remove the rejected object, then record why it was rejected. */
  private async discardUpload(
    file: FileRecord,
    status: file_status,
    detail: string,
  ) {
    try {
      await this.storage.delete(objectKey(file.bucket, file.storage_path));
    } catch (error) {
      this.logger.error(
        `Rejected upload ${file.bucket}/${file.storage_path} could not be removed: ${(error as Error).message}`,
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

    const schoolId = await this.schoolIdOf(userId);
    const id = crypto.randomUUID();
    const name = (displayName?.trim() || file.filename || 'untitled').slice(
      0,
      255,
    );
    const storagePath = `${schoolId}/${userId}/${id}-${this.slug(name)}`;

    try {
      await this.storage.put(
        objectKey(BUCKET, storagePath),
        buffer,
        contentType,
      );
    } catch (error) {
      this.logger.error(`Failed to store file: ${(error as Error).message}`);
      throw new BadRequestException('Failed to store file');
    }

    let data: FileRecord;
    try {
      data = await this.prisma.file.create({
        data: {
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
          // The bytes were checked above before being stored, so the file is
          // immediately viewable - no async scan step.
          status: 'ready',
        },
        select: FILE_COLUMNS,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record uploaded file: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to record file');
    }

    return this.present(data, true);
  }

  // ── Rename / delete ────────────────────────────────────────────────────────

  async rename(userId: string, fileId: string, name: string) {
    await this.loadOwned(userId, fileId);
    const data = await this.prisma.file
      .update({
        where: { id: fileId },
        data: { name: name.slice(0, 255), updated_at: new Date() },
        select: FILE_COLUMNS,
      })
      .catch(() => null);
    if (!data) throw new BadRequestException('Failed to rename file');
    return this.present(data, true);
  }

  async softDelete(userId: string, fileId: string) {
    await this.loadOwned(userId, fileId);
    try {
      await this.prisma.file.updateMany({
        where: { id: fileId },
        data: { deleted_at: new Date() },
      });
    } catch {
      throw new BadRequestException('Failed to delete file');
    }
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

  /** The caller's school; a user without one cannot hold files. */
  private async schoolIdOf(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return schoolId;
  }

  private async loadFile(fileId: string): Promise<FileRecord> {
    if (!isUuid(fileId)) throw new NotFoundException('File not found');
    const data = await this.prisma.file.findFirst({
      where: { id: fileId, deleted_at: null },
      select: FILE_COLUMNS,
    });
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
    const data = await this.prisma.file
      .findUnique({ where: { id: fileId }, select: FILE_COLUMNS })
      .catch(() => null);

    if (!data) {
      throw new NotFoundException('File not found');
    }

    return this.downloadBytes(data);
  }

  private async downloadBytes(file: FileRecord) {
    if (file.status !== 'ready') {
      throw new NotFoundException('File is not available');
    }

    let buffer: Buffer | null = null;
    try {
      buffer = await this.storage.getBuffer(
        objectKey(file.bucket, file.storage_path),
      );
    } catch (error) {
      this.logger.error(
        `Failed to read ${file.bucket}/${file.storage_path}: ${(error as Error).message}`,
      );
    }
    if (!buffer) {
      this.logger.error(`Missing object ${file.bucket}/${file.storage_path}`);
      throw new NotFoundException('File content unavailable');
    }
    return {
      buffer,
      contentType: file.content_type,
      filename: file.name,
    };
  }

  private present(f: FileRecord, canDownload: boolean) {
    return {
      id: f.id,
      name: f.name,
      contentType: f.content_type,
      sizeBytes: num(f.size_bytes),
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
