import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import crypto from 'node:crypto';
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
import {
  normalizeSubmissionContentType,
  verifyContent,
  verifySubmissionContent,
  inspectsBytes,
  ALLOWED_CONTENT_TYPES,
  type ContentCheck,
} from './file-content';
import {
  ObjectTooLargeError,
  StorageService,
} from '@/storage/storage.service';
import { ByteBudget, ByteBudgetTimeoutError } from '@/storage/byte-budget';
import { objectKey, UPLOAD_STAGING_PREFIX } from '@/storage/keys';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { OCCURRED_AT, plan } from '@/erasure/erasure-plan';
import { UploadLimitService } from './upload-limit.service';
import { MB } from './upload-limit.config';

const BUCKET = 'file-manager';
const toMb = (bytes: number) => Math.floor(bytes / MB);

/** How long a completion waits for room in the verify budget before a 503. */
export const VERIFY_BUDGET_WAIT_MS = 10_000;

/** Long enough to send a large file, short enough to be worth little. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** Live (unexpired) upload tickets one user may hold at once. */
export const MAX_PENDING_UPLOADS = 20;

/** Where a staged upload is served from once it has been verified. */
export function finalStoragePath(stagedPath: string): string {
  return stagedPath.startsWith(UPLOAD_STAGING_PREFIX)
    ? stagedPath.slice(UPLOAD_STAGING_PREFIX.length)
    : stagedPath;
}

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
    private readonly erasure: ErasureLogService,
    private readonly verifyBudget: ByteBudget,
    private readonly uploadLimits: UploadLimitService,
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
    return this.createUploadTicketInternal(userId, input, false);
  }

  /**
   * `limitSchoolId` is the course's school, whose upload limit applies to a
   * hand-in; without it, the uploader's active school's limit does.
   */
  async createSubmissionUploadTicket(
    userId: string,
    input: { name: string; sizeBytes: number; contentType: string },
    limitSchoolId?: string,
  ) {
    return this.createUploadTicketInternal(userId, input, true, limitSchoolId);
  }

  private async createUploadTicketInternal(
    userId: string,
    input: {
      name: string;
      sizeBytes: number;
      contentType: string;
      folderId?: string;
    },
    allowAnyContentType: boolean,
    limitSchoolId?: string,
  ) {
    if (input.folderId) await this.folders.getOwned(userId, input.folderId);

    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException('File is empty');
    }

    const schoolId = await this.schoolIdOf(userId);
    // The limit is checked here, once, against the declared size. Finalising
    // only checks the bytes match that size (the URL signs it too), so an
    // admin lowering the limit does not fail a ticket already issued.
    const maxBytes = await this.uploadLimits.bytesForSchool(
      limitSchoolId ?? schoolId,
    );
    if (input.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `File too large (${(input.sizeBytes / MB).toFixed(1)}MB). Your school's limit is ${toMb(maxBytes)}MB.`,
      );
    }

    const contentType = allowAnyContentType
      ? normalizeSubmissionContentType(input.contentType)
      : input.contentType || 'application/octet-stream';
    if (!allowAnyContentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(`${contentType} files are not accepted`);
    }
    // Types whose content is checked are read whole into memory on completion,
    // so they can be no bigger than the verify budget (UPLOAD_VERIFY_MEMORY_MB),
    // whatever the school allows. Other types are copied in storage, unread.
    if (inspectsBytes(contentType) && input.sizeBytes > this.verifyBudget.total) {
      throw new BadRequestException(
        `PDFs, images and Office files are checked on upload and can be at most ${toMb(this.verifyBudget.total)}MB.`,
      );
    }

    // Every ticket reserves a row (and, until it is purged, an object), so cap
    // how many unexpired ones a user can hold.
    const live = await this.prisma.file.count({
      where: {
        owner_id: userId,
        status: 'pending',
        deleted_at: null,
        created_at: {
          gte: new Date(Date.now() - UPLOAD_URL_TTL_SECONDS * 1000),
        },
      },
    });
    if (live >= MAX_PENDING_UPLOADS) {
      throw new HttpException(
        'Too many uploads in progress. Finish or wait for some before starting more.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const id = crypto.randomUUID();
    const name = (input.name?.trim() || 'untitled').slice(0, 255);
    const storagePath = `${UPLOAD_STAGING_PREFIX}${schoolId}/${userId}/${id}-${this.slug(name)}`;

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
    // The declared size is signed too: the PUT must carry exactly that many
    // bytes.
    const uploadUrl = await this.storage.uploadUrl(
      objectKey(BUCKET, storagePath),
      contentType,
      UPLOAD_URL_TTL_SECONDS,
      input.sizeBytes,
    );

    return {
      fileId: id,
      method: 'PUT' as const,
      uploadUrl,
      // Part of the signature: the PUT must carry exactly this header.
      headers: { 'Content-Type': contentType },
      expiresAt,
      contentType,
      maxBytes,
    };
  }

  async finaliseUpload(userId: string, fileId: string) {
    return this.finaliseUploadInternal(userId, fileId, false);
  }

  async finaliseSubmissionUpload(userId: string, fileId: string) {
    return this.finaliseUploadInternal(userId, fileId, true);
  }

  private async finaliseUploadInternal(
    userId: string,
    fileId: string,
    allowAnyContentType: boolean,
  ) {
    const file = !isUuid(fileId)
      ? null
      : await this.prisma.file.findFirst({
          where: { id: fileId, owner_id: userId, deleted_at: null },
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

    // The school's limit was applied to the declared size when the ticket
    // was issued; here the bytes must match that size. The platform ceiling
    // is a backstop for a row with no declared size, checked before anything
    // is read back.
    const ceiling = this.uploadLimits.config.maxMb * MB;
    if (head.size > ceiling) {
      await this.discardUpload(record, 'failed', 'Uploaded file was too large');
      throw new BadRequestException(
        `File too large. Maximum is ${toMb(ceiling)}MB.`,
      );
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

    if (head.size === 0) {
      await this.discardUpload(record, 'failed', 'Uploaded file was empty');
      throw new BadRequestException('File is empty');
    }

    const check = (buffer: Buffer) =>
      allowAnyContentType
        ? verifySubmissionContent(buffer, record.content_type)
        : verifyContent(buffer, record.content_type);
    const finalPath = finalStoragePath(record.storage_path);
    const finalKey = objectKey(record.bucket, finalPath);
    let sizeBytes = head.size;

    if (!inspectsBytes(record.content_type)) {
      // The verdict for this type does not depend on the bytes, so they are
      // never fetched: the object is copied inside the store. The upload URL
      // signs the length, so a re-PUT before the copy cannot change the size
      // checked above, and swapping bytes nobody inspects changes nothing.
      const verdict = check(Buffer.alloc(0));
      if (!verdict.ok) {
        await this.discardUpload(record, 'failed', verdict.reason);
        throw new BadRequestException(verdict.reason);
      }
      if (finalPath !== record.storage_path) {
        try {
          await this.storage.copy(key, finalKey, record.content_type);
        } catch (error) {
          this.logger.error(
            `Failed to store upload ${fileId}: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to record file');
        }
      }
    } else {
      sizeBytes = await this.verifyAndStore(record, key, finalKey, head.size, check);
    }

    let updated: FileRecord;
    try {
      updated = await this.prisma.file.update({
        where: { id: fileId },
        data: {
          status: 'ready',
          storage_path: finalPath,
          size_bytes: sizeBytes,
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

    if (finalPath !== record.storage_path) {
      await this.storage.delete(key).catch((error: Error) =>
        this.logger.error(
          `Staged upload ${key} could not be removed: ${error.message}`,
        ),
      );
    }

    return this.present(updated, true);
  }

  /**
   * Read the staged object, check it, and write the checked bytes to
   * `finalKey`. Buffers are drawn from the process-wide verify budget, so
   * parallel completions cannot pin unbounded memory; when it stays full the
   * row is left `pending` and the client may retry. Returns the stored size.
   */
  private async verifyAndStore(
    record: FileRecord,
    key: string,
    finalKey: string,
    size: number,
    check: (buffer: Buffer) => ContentCheck,
  ): Promise<number> {
    let release: () => void;
    try {
      release = await this.verifyBudget.acquire(size, VERIFY_BUDGET_WAIT_MS);
    } catch (error) {
      if (!(error instanceof ByteBudgetTimeoutError)) throw error;
      throw new ServiceUnavailableException(
        'The server is busy checking other uploads. Try again in a moment.',
      );
    }

    try {
      // The object can change between the HEAD and this read, so the read is
      // capped at the size that was checked (and budgeted) on its own.
      let buffer: Buffer | null;
      try {
        buffer = await this.storage.getBuffer(key, size);
      } catch (error) {
        if (!(error instanceof ObjectTooLargeError)) throw error;
        await this.discardUpload(
          record,
          'failed',
          'Uploaded file does not match the declared size',
        );
        throw new BadRequestException(
          'The uploaded file does not match the declared size',
        );
      }
      if (!buffer) {
        await this.failUpload(record.id, 'failed', 'Upload did not complete');
        throw new BadRequestException('The upload did not complete');
      }
      if (buffer.byteLength === 0) {
        await this.discardUpload(record, 'failed', 'Uploaded file was empty');
        throw new BadRequestException('File is empty');
      }

      const verdict = check(buffer);
      if (!verdict.ok) {
        await this.discardUpload(record, 'failed', verdict.reason);
        throw new BadRequestException(verdict.reason);
      }

      // Serve the bytes that were verified, from a key no upload URL was ever
      // signed for. Writing the checked buffer (rather than copying the staged
      // object) leaves no window for the staged object to be swapped.
      if (finalKey !== key) {
        try {
          await this.storage.put(finalKey, buffer, record.content_type);
        } catch (error) {
          this.logger.error(
            `Failed to store verified upload ${record.id}: ${(error as Error).message}`,
          );
          throw new BadRequestException('Failed to record file');
        }
      }
      return buffer.byteLength;
    } finally {
      release();
    }
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
    const file = await this.loadOwned(userId, fileId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.file.updateMany({
          where: { id: fileId },
          data: { deleted_at: new Date() },
        });
        await this.erasure.record(tx, {
          kind: 'file',
          subjectTable: 'file_manager.file',
          subjectIds: [fileId],
          schoolId: file.school_id,
          actor: userId,
          reason: 'user_request',
          replay: plan.of(
            plan.update(
              'file_manager.file',
              { id: [fileId] },
              { deleted_at: OCCURRED_AT },
            ),
          ),
        });
      });
    } catch {
      throw new BadRequestException('Failed to delete file');
    }
    return { id: fileId, deleted: true };
  }

  // ── Content delivery ────────────────────────────────────────────────────────

  /** Content for the inline viewer. Requires view access (owner or share). */
  async getViewContent(userId: string, fileId: string) {
    const { file } = await this.loadViewable(userId, fileId);
    return this.openContent(file);
  }

  /** Content for download. Requires download access (owner or downloadable share). */
  async getDownloadContent(userId: string, fileId: string) {
    const { file, access } = await this.loadViewable(userId, fileId);
    if (!access.canDownload) {
      throw new ForbiddenException(
        'You do not have permission to download this file',
      );
    }
    return this.openContent(file);
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
   * Content for a caller who has already been authorised by something other than
   * file sharing - a teacher reading work handed in to their own class, where
   * the student owns the file and no share exists. The caller must do that
   * check; this deliberately does none.
   */
  async readContentForAuthorisedCaller(fileId: string) {
    const data = !isUuid(fileId)
      ? null
      : await this.prisma.file
          .findFirst({
            where: { id: fileId, deleted_at: null },
            select: FILE_COLUMNS,
          })
          .catch(() => null);

    if (!data) {
      throw new NotFoundException('File not found');
    }

    return this.openContent(data);
  }

  /** Stream a file after its caller has already checked authorization. */
  async readStreamForAuthorisedCaller(fileId: string) {
    const data = !isUuid(fileId)
      ? null
      : await this.prisma.file.findFirst({
          where: { id: fileId, deleted_at: null },
          select: FILE_COLUMNS,
        });

    if (!data || data.status !== 'ready') {
      throw new NotFoundException('File content unavailable');
    }

    const object = await this.storage.get(
      objectKey(data.bucket, data.storage_path),
    );
    if (!object) {
      throw new NotFoundException('File content unavailable');
    }
    return {
      body: object.body,
      contentType: data.content_type,
      filename: data.name,
    };
  }

  /**
   * The object as a stream, so serving a file never holds it in memory
   * (uploads go up to UPLOAD_MAX_MB). `size` is the stored length, for Content-Length.
   */
  private async openContent(file: FileRecord) {
    if (file.status !== 'ready') {
      throw new NotFoundException('File is not available');
    }

    let object: Awaited<ReturnType<StorageService['get']>> = null;
    try {
      object = await this.storage.get(objectKey(file.bucket, file.storage_path));
    } catch (error) {
      this.logger.error(
        `Failed to read ${file.bucket}/${file.storage_path}: ${(error as Error).message}`,
      );
    }
    if (!object) {
      this.logger.error(`Missing object ${file.bucket}/${file.storage_path}`);
      throw new NotFoundException('File content unavailable');
    }
    return {
      body: object.body,
      size: object.size,
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
