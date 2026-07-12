import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

const FOLDER_COLUMNS = 'id, school_id, owner_id, parent_id, name, is_system, created_at, updated_at';

interface FolderRow {
  id: string;
  school_id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * The owner's folder tree in the file manager. Folders are private to the
 * owner (organization only — sharing stays at the file level), so every method
 * is scoped to `owner_id === userId`.
 */
@Injectable()
export class FolderService {
  private readonly logger = new Logger(FolderService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Live child folders of `parentId` (or the roots when null), by name. */
  async listChildren(userId: string, parentId: string | null) {
    let query = this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .select(FOLDER_COLUMNS)
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);

    const { data } = await query;
    return (data ?? []).map((f: FolderRow) => this.present(f));
  }

  /** Every live folder the caller owns (for a move-target picker). */
  async listAll(userId: string) {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .select(FOLDER_COLUMNS)
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    return (data ?? []).map((f: FolderRow) => this.present(f));
  }

  /** Load one of the caller's live folders, or throw. */
  async getOwned(userId: string, folderId: string): Promise<FolderRow> {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .select(FOLDER_COLUMNS)
      .eq('id', folderId)
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) throw new NotFoundException('Folder not found');
    return data as FolderRow;
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
    const schoolId = await this.supabase.getUserSchoolId(userId);

    // A given parent must be one of the caller's own live folders.
    let parent: string | null = null;
    if (parentId) {
      const p = await this.getOwned(userId, parentId);
      parent = p.id;
    }

    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .insert({
        school_id: schoolId,
        owner_id: userId,
        parent_id: parent,
        name: clean,
      })
      .select(FOLDER_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException(
          'A folder with that name already exists here',
        );
      }
      this.logger.error(`Failed to create folder: ${error.message}`);
      throw new BadRequestException('Failed to create folder');
    }
    return this.present(data as FolderRow);
  }

  async rename(userId: string, folderId: string, name: string) {
    const folder = await this.getOwned(userId, folderId);
    if (folder.is_system) {
      throw new BadRequestException('System folders cannot be renamed');
    }
    const clean = this.cleanName(name);

    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .update({ name: clean, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .select(FOLDER_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException(
          'A folder with that name already exists here',
        );
      }
      throw new BadRequestException('Failed to rename folder');
    }
    return this.present(data as FolderRow);
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

    const { data, error } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('folder')
      .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .eq('owner_id', userId)
      .select(FOLDER_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException(
          'A folder with that name already exists there',
        );
      }
      throw new BadRequestException('Failed to move folder');
    }
    return this.present(data as FolderRow);
  }

  /**
   * Soft-delete a folder and everything inside it: all descendant folders and
   * every file within any of them. The subtree is walked in JS (folder trees
   * are shallow) so we can soft-delete files the same way a direct file delete
   * does, rather than relying on the FK cascade (which would hard-delete rows).
   */
  async remove(userId: string, folderId: string) {
    await this.getOwned(userId, folderId);
    const client = this.supabase.getServiceClient();
    const now = new Date().toISOString();

    const ids = await this.collectSubtree(userId, folderId);

    const { error: fileErr } = await client
      .schema('file_manager')
      .from('file')
      .update({ deleted_at: now })
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .in('folder_id', ids);
    if (fileErr) {
      throw new BadRequestException('Failed to delete folder contents');
    }

    const { error: folderErr } = await client
      .schema('file_manager')
      .from('folder')
      .update({ deleted_at: now })
      .eq('owner_id', userId)
      .in('id', ids);
    if (folderErr) throw new BadRequestException('Failed to delete folder');

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
    const client = this.supabase.getServiceClient();
    let parentId: string | null = null;

    for (const rawName of path) {
      const name = this.cleanName(rawName);

      const existingQuery = client
        .schema('file_manager')
        .from('folder')
        .select('id')
        .eq('owner_id', userId)
        .eq('name', name)
        .is('deleted_at', null);
      const { data: existing } = await (parentId
        ? existingQuery.eq('parent_id', parentId)
        : existingQuery.is('parent_id', null)
      ).maybeSingle();

      if (existing?.id) {
        parentId = existing.id;
        continue;
      }

      const { data: created, error } = await client
        .schema('file_manager')
        .from('folder')
        .insert({
          school_id: schoolId,
          owner_id: userId,
          parent_id: parentId,
          name,
          is_system: true,
        })
        .select('id')
        .single();

      // Lost a race to the unique index — re-read the winner.
      if (error || !created) {
        const raceQuery = client
          .schema('file_manager')
          .from('folder')
          .select('id')
          .eq('owner_id', userId)
          .eq('name', name)
          .is('deleted_at', null);
        const { data: raced } = await (parentId
          ? raceQuery.eq('parent_id', parentId)
          : raceQuery.is('parent_id', null)
        ).maybeSingle();
        if (!raced?.id) {
          this.logger.warn(
            `Could not resolve system folder "${name}": ${error?.message}`,
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
    const client = this.supabase.getServiceClient();
    const ids = [rootId];
    let frontier = [rootId];

    while (frontier.length > 0) {
      const { data } = await client
        .schema('file_manager')
        .from('folder')
        .select('id')
        .eq('owner_id', userId)
        .is('deleted_at', null)
        .in('parent_id', frontier);
      const children = (data ?? []).map((f: { id: string }) => f.id);
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
