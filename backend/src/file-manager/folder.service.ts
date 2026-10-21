import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { userSchoolId } from '@/common/user-school';
import { isUniqueViolation } from '@/common/db-values';

const FOLDER_COLUMNS = {
  id: true,
  school_id: true,
  owner_id: true,
  parent_id: true,
  name: true,
  is_system: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.folderSelect;

type FolderRow = Prisma.folderGetPayload<{ select: typeof FOLDER_COLUMNS }>;

/**
 * Ids come straight from the URL. Postgres rejects a malformed uuid, which
 * the API has always reported as "not found" rather than a server error.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID_RE.test(id);

/**
 * The owner's folder tree in the file manager. Folders are private to the
 * owner (organization only — sharing stays at the file level), so every method
 * is scoped to `owner_id === userId`.
 */
@Injectable()
export class FolderService {
  private readonly logger = new Logger(FolderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Live child folders of `parentId` (or the roots when null), by name. */
  async listChildren(userId: string, parentId: string | null) {
    const data = await this.prisma.folder.findMany({
      where: {
        owner_id: userId,
        deleted_at: null,
        parent_id: parentId ?? null,
      },
      select: FOLDER_COLUMNS,
      orderBy: { name: 'asc' },
    });
    return (data ?? []).map((f) => this.present(f));
  }

  /** Every live folder the caller owns (for a move-target picker). */
  async listAll(userId: string) {
    const data = await this.prisma.folder.findMany({
      where: { owner_id: userId, deleted_at: null },
      select: FOLDER_COLUMNS,
      orderBy: { name: 'asc' },
    });
    return (data ?? []).map((f) => this.present(f));
  }

  /** Load one of the caller's live folders, or throw. */
  async getOwned(userId: string, folderId: string): Promise<FolderRow> {
    if (!isUuid(folderId)) throw new NotFoundException('Folder not found');
    const data = await this.prisma.folder.findFirst({
      where: { id: folderId, owner_id: userId, deleted_at: null },
      select: FOLDER_COLUMNS,
    });
    if (!data) throw new NotFoundException('Folder not found');
    return data;
  }

  /** Root → … → folder path for breadcrumbs. Empty array at the root. */
  async breadcrumb(userId: string, folderId: string | null) {
    const trail: ReturnType<FolderService['present']>[] = [];
    let cursor = folderId;
    // Bounded by tree depth; guard against a pathological cycle.
    for (let i = 0; cursor && i < 64; i++) {
      const folder = await this.getOwned(userId, cursor);
      trail.unshift(this.present(folder));
      cursor = folder.parent_id;
    }
    return trail;
  }

  async create(userId: string, name: string, parentId?: string | null) {
    const clean = this.cleanName(name);
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }

    // A given parent must be one of the caller's own live folders.
    let parent: string | null = null;
    if (parentId) {
      const p = await this.getOwned(userId, parentId);
      parent = p.id;
    }

    try {
      const data = await this.prisma.folder.create({
        data: {
          school_id: schoolId,
          owner_id: userId,
          parent_id: parent,
          name: clean,
        },
        select: FOLDER_COLUMNS,
      });
      return this.present(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(
          'A folder with that name already exists here',
        );
      }
      this.logger.error(`Failed to create folder: ${(error as Error).message}`);
      throw new BadRequestException('Failed to create folder');
    }
  }

  async rename(userId: string, folderId: string, name: string) {
    const folder = await this.getOwned(userId, folderId);
    if (folder.is_system) {
      throw new BadRequestException('System folders cannot be renamed');
    }
    const clean = this.cleanName(name);

    try {
      const data = await this.prisma.folder.update({
        where: { id: folderId },
        data: { name: clean, updated_at: new Date() },
        select: FOLDER_COLUMNS,
      });
      return this.present(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(
          'A folder with that name already exists here',
        );
      }
      throw new BadRequestException('Failed to rename folder');
    }
  }

  /**
   * Re-parent a folder. `newParentId` null moves it to the root. Guards against
   * moving a folder into itself or into one of its own descendants (which would
   * orphan a cycle), and against a name collision in the destination.
   */
  async move(userId: string, folderId: string, newParentId: string | null) {
    const folder = await this.getOwned(userId, folderId);

    if (newParentId === folderId) {
      throw new BadRequestException('A folder cannot contain itself');
    }
    if ((folder.parent_id ?? null) === (newParentId ?? null)) {
      return this.present(folder); // no-op: already there
    }

    if (newParentId) {
      await this.getOwned(userId, newParentId); // must be the caller's folder
      const subtree = await this.collectSubtree(userId, folderId);
      if (subtree.includes(newParentId)) {
        throw new BadRequestException(
          'A folder cannot be moved into one of its own subfolders',
        );
      }
    }

    try {
      const data = await this.prisma.folder.update({
        where: { id: folderId, owner_id: userId },
        data: { parent_id: newParentId, updated_at: new Date() },
        select: FOLDER_COLUMNS,
      });
      return this.present(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(
          'A folder with that name already exists there',
        );
      }
      throw new BadRequestException('Failed to move folder');
    }
  }

  /**
   * Soft-delete a folder and everything inside it: all descendant folders and
   * every file within any of them. The subtree is walked in JS (folder trees
   * are shallow) so we can soft-delete files the same way a direct file delete
   * does, rather than relying on the FK cascade (which would hard-delete rows).
   */
  async remove(userId: string, folderId: string) {
    await this.getOwned(userId, folderId);
    const now = new Date();

    const ids = await this.collectSubtree(userId, folderId);

    // Files and folders go together, so a failure never leaves live files in
    // a deleted folder.
    let step = 'Failed to delete folder contents';
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.file.updateMany({
          where: { owner_id: userId, deleted_at: null, folder_id: { in: ids } },
          data: { deleted_at: now },
        });
        step = 'Failed to delete folder';
        await tx.folder.updateMany({
          where: { owner_id: userId, id: { in: ids } },
          data: { deleted_at: now },
        });
      });
    } catch {
      throw new BadRequestException(step);
    }

    return { id: folderId, deleted: true, folderCount: ids.length };
  }

  /**
   * Find or create a nested path of system folders for an owner, returning the
   * leaf folder id. Used to file server-generated reports under, e.g.,
   * ["Reports", "2026-07-12"]. Idempotent thanks to the unique folder indexes.
   */
  async findOrCreateSystemPath(
    userId: string,
    schoolId: string,
    path: string[],
  ): Promise<string | null> {
    let parentId: string | null = null;

    for (const rawName of path) {
      const name = this.cleanName(rawName);
      const where: Prisma.folderWhereInput = {
        owner_id: userId,
        name,
        deleted_at: null,
        parent_id: parentId,
      };

      const existing = await this.prisma.folder.findFirst({
        where,
        select: { id: true },
      });

      if (existing?.id) {
        parentId = existing.id;
        continue;
      }

      let error: Error | null = null;
      const created = await this.prisma.folder
        .create({
          data: {
            school_id: schoolId,
            owner_id: userId,
            parent_id: parentId,
            name,
            is_system: true,
          },
          select: { id: true },
        })
        .catch((err: Error) => {
          error = err;
          return null;
        });

      // Lost a race to the unique index — re-read the winner.
      if (!created) {
        const raced = await this.prisma.folder.findFirst({
          where,
          select: { id: true },
        });
        if (!raced?.id) {
          this.logger.warn(
            `Could not resolve system folder "${name}": ${(error as Error | null)?.message}`,
          );
          return null;
        }
        parentId = raced.id;
        continue;
      }
      parentId = created.id;
    }

    return parentId;
  }

  /** Collect a folder id and all its live descendant folder ids (BFS). */
  private async collectSubtree(
    userId: string,
    rootId: string,
  ): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];

    while (frontier.length > 0) {
      const data = await this.prisma.folder.findMany({
        where: {
          owner_id: userId,
          deleted_at: null,
          parent_id: { in: frontier },
        },
        select: { id: true },
      });
      const children = (data ?? []).map((f) => f.id);
      if (children.length === 0) break;
      ids.push(...children);
      frontier = children;
    }
    return ids;
  }

  private cleanName(name: string): string {
    const clean = (name ?? '').trim().replace(/[/\\]/g, '-').slice(0, 120);
    if (!clean) throw new BadRequestException('Folder name is required');
    return clean;
  }

  private present(f: FolderRow) {
    return {
      id: f.id,
      name: f.name,
      parentId: f.parent_id,
      isSystem: f.is_system,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    };
  }
}
