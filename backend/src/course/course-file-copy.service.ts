import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import { FeatureService } from '@/features/feature.service';
import { UploadLimitService } from '@/file-manager/upload-limit.service';
import type { SnapshotFile } from './course-snapshot';

/** The file-manager area every importer's copy lands in. */
export const FILE_MANAGER_BUCKET = 'file-manager';

/** Same rule as the file manager's upload keys. */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file'
  );
}

/**
 * A uuid fixed by its inputs (SHA-256, shaped as a version-4-style uuid), so a
 * resumed import reserves the same file rows instead of new ones.
 */
export function stableUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join(':')).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface FileOwner {
  schoolId: string;
  ownerId: string;
}

/**
 * Copies the files a course design links into the importer's own storage, so
 * copying, importing or using a library template never hands out access to
 * the author's files (the decision on ROADMAP item 13).
 *
 * The steps, in this order so a crash never leaves anything half-visible:
 *
 * 1. `assertFits` - every file must fit the target school's upload limit;
 *    refused before anything is written.
 * 2. `reserve` - one `pending` file row per file, owned by the importer, at
 *    `file-manager/<school>/<importer>/<new id>-<slug>`. Pending rows are not
 *    shown to anyone else, and the retention job removes them (row and
 *    object) after an hour if nothing ever links them.
 * 3. `copyObjects` - a server-side copy inside the bucket per file (the
 *    bytes never pass through the API). Re-running copies again: idempotent.
 * 4. `markReady` - inside the caller's content transaction, together with
 *    the module items that link the copies.
 *
 * `discard` removes the reserved rows and objects after a failure.
 */
@Injectable()
export class CourseFileCopyService {
  private readonly logger = new Logger(CourseFileCopyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly uploadLimits: UploadLimitService,
    private readonly features: FeatureService,
  ) {}

  /** 400 naming every file above the school's upload limit; writes nothing. */
  async assertFits(files: SnapshotFile[], schoolId: string): Promise<void> {
    if (files.length === 0) return;
    const limit = await this.uploadLimits.forSchool(schoolId);
    const tooLarge = files.filter((f) => f.sizeBytes > limit.uploadLimitBytes);
    if (tooLarge.length > 0) {
      const names = tooLarge
        .slice(0, 5)
        .map((f) => `"${f.name}"`)
        .join(', ');
      const more = tooLarge.length > 5 ? ` and ${tooLarge.length - 5} more` : '';
      throw new BadRequestException(
        `Nothing was imported: ${names}${more} ${tooLarge.length === 1 ? 'is' : 'are'} larger than your school's upload limit of ${limit.uploadLimitMb} MB.`,
      );
    }
  }

  /**
   * Reserve the importer's rows. `idFor` gives each file's new id (random for
   * a one-off copy, `stableUuid` for a resumable import). Returns
   * snapshot file id -> new file id.
   */
  async reserve(
    files: SnapshotFile[],
    owner: FileOwner,
    idFor: (file: SnapshotFile) => string,
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    if (files.length === 0) return ids;
    const rows: Prisma.fileCreateManyInput[] = files.map((f) => {
      const id = idFor(f);
      ids.set(f.id, id);
      return {
        id,
        school_id: owner.schoolId,
        owner_id: owner.ownerId,
        name: f.name,
        bucket: FILE_MANAGER_BUCKET,
        storage_path: this.pathFor(owner, id, f.name),
        content_type: f.contentType,
        size_bytes: BigInt(f.sizeBytes),
        status: 'pending',
      };
    });
    await this.prisma.file.createMany({ data: rows, skipDuplicates: true });
    return ids;
  }

  pathFor(owner: FileOwner, id: string, name: string): string {
    return `${owner.schoolId}/${owner.ownerId}/${id}-${fileSlug(name)}`;
  }

  /** Copy each file's bytes to its reserved key; `onCopied` after each one. */
  async copyObjects(
    files: SnapshotFile[],
    ids: Map<string, string>,
    owner: FileOwner,
    onCopied?: (done: number) => Promise<void> | void,
  ): Promise<void> {
    let done = 0;
    for (const f of files) {
      const id = ids.get(f.id);
      if (!id) continue;
      await this.storage.copy(
        objectKey(f.bucket, f.path),
        objectKey(FILE_MANAGER_BUCKET, this.pathFor(owner, id, f.name)),
        f.contentType,
      );
      done++;
      await onCopied?.(done);
    }
  }

  /** Inside the content transaction: the copies become ordinary files. */
  async markReady(tx: Prisma.TransactionClient, ids: Iterable<string>): Promise<void> {
    const list = [...ids];
    if (list.length === 0) return;
    await tx.file.updateMany({
      where: { id: { in: list }, status: 'pending' },
      data: { status: 'ready', updated_at: new Date() },
    });
  }

  /** Best effort: drop reserved rows that never became ready, and their objects. */
  async discard(ids: Iterable<string>): Promise<void> {
    const list = [...ids];
    if (list.length === 0) return;
    try {
      const rows = await this.prisma.file.findMany({
        where: { id: { in: list }, status: 'pending' },
        select: { id: true, bucket: true, storage_path: true },
      });
      if (rows.length === 0) return;
      await this.storage.delete(rows.map((r) => objectKey(r.bucket, r.storage_path)));
      await this.prisma.file.deleteMany({
        where: { id: { in: rows.map((r) => r.id) }, status: 'pending' },
      });
    } catch (error) {
      // The retention job removes pending rows and their objects after an hour.
      this.logger.warn(`Could not discard copied files: ${(error as Error).message}`);
    }
  }

  /**
   * External tools a design uses that the target school may launch: the tool
   * is enabled, `lti` is on for the school, and a deployment reaches it (all
   * schools, or this one). Tool id -> deployment id, plus every tool's name
   * for the note when one is skipped.
   */
  async ltiDeployments(
    schoolId: string,
    toolIds: string[],
  ): Promise<{ deployments: Map<string, string>; names: Map<string, string> }> {
    const deployments = new Map<string, string>();
    const names = new Map<string, string>();
    const unique = [...new Set(toolIds)];
    if (unique.length === 0) return { deployments, names };
    const tools = await this.prisma.lti_tool.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        name: true,
        enabled: true,
        deployments: {
          where: { OR: [{ school_id: null }, { school_id: schoolId }] },
          select: { id: true, school_id: true },
        },
      },
    });
    for (const t of tools) names.set(t.id, t.name);
    if (!(await this.features.isEnabled(schoolId, 'lti'))) {
      return { deployments, names };
    }
    for (const t of tools) {
      if (!t.enabled || t.deployments.length === 0) continue;
      // Prefer the school's own deployment over the all-schools one.
      const own = t.deployments.find((d) => d.school_id === schoolId);
      deployments.set(t.id, (own ?? t.deployments[0]).id);
    }
    return { deployments, names };
  }
}
