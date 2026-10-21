import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  CourseAccessService,
  CourseRow,
  MANAGE_ROLES,
} from './access/course-access.service';
import type { ModuleItemType } from './dto/content.dto';

const MODULE_COLUMNS = 'id, course_id, title, position, is_published';
const ITEM_COLUMNS =
  'id, module_id, course_id, position, item_type, title, page_id, activity_id, file_id, url, indent, is_published';

interface ModuleRow {
  id: string;
  course_id: string;
  title: string;
  position: number;
  is_published: boolean;
}

interface ItemRow {
  id: string;
  module_id: string;
  course_id: string;
  position: number;
  item_type: ModuleItemType;
  title: string | null;
  page_id: string | null;
  activity_id: string | null;
  file_id: string | null;
  url: string | null;
  indent: number;
  is_published: boolean;
}

interface ActivitySummary {
  id: string;
  title: string;
  kind: 'quiz' | 'assignment' | 'offline';
  points: number;
  due_at: string | null;
  status: 'draft' | 'published' | 'closed';
}

/**
 * Modules and the items inside them - the spine of a course.
 *
 * An item either carries its own content (a link, a header) or points at
 * something else in the course (a page, an activity, a file). Pointers are
 * checked against the course on write, so a module can never surface another
 * course's page or another school's file.
 */
@Injectable()
export class ModuleService {
  private readonly logger = new Logger(ModuleService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
  ) {}

  private db() {
    return this.supabaseService.getServiceClient();
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /** Every module and item, drafts included, for course staff. */
  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId);
    return this.build(courseId, false);
  }

  /**
   * What a student sees: published modules holding published items, minus
   * any item whose page is unpublished or whose activity is still a draft.
   * The caller has already proved the student is enrolled.
   */
  async listForStudent(courseId: string) {
    return this.build(courseId, true);
  }

  private async build(courseId: string, studentView: boolean) {
    const supabase = this.db();

    let modulesQuery = supabase
      .schema('course')
      .from('module')
      .select(MODULE_COLUMNS)
      .eq('course_id', courseId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (studentView) modulesQuery = modulesQuery.eq('is_published', true);

    let itemsQuery = supabase
      .schema('course')
      .from('module_item')
      .select(ITEM_COLUMNS)
      .eq('course_id', courseId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (studentView) itemsQuery = itemsQuery.eq('is_published', true);

    const [{ data: modules, error }, { data: items, error: itemsError }] =
      await Promise.all([modulesQuery, itemsQuery]);

    if (error || itemsError) {
      this.logger.error(
        `Failed to load modules: ${(error ?? itemsError)?.message}`,
      );
      throw new BadRequestException('Failed to load modules');
    }

    const itemRows = (items ?? []) as ItemRow[];
    const targets = await this.loadTargets(itemRows);

    const byModule = new Map<string, ReturnType<typeof this.toItem>[]>();
    for (const row of itemRows) {
      if (studentView && !this.visibleToStudent(row, targets)) continue;
      const list = byModule.get(row.module_id) ?? [];
      list.push(this.toItem(row, targets));
      byModule.set(row.module_id, list);
    }

    return ((modules ?? []) as ModuleRow[]).map((m) => ({
      id: m.id,
      courseId: m.course_id,
      title: m.title,
      position: m.position,
      isPublished: m.is_published,
      items: byModule.get(m.id) ?? [],
    }));
  }

  private visibleToStudent(
    row: ItemRow,
    targets: Awaited<ReturnType<typeof this.loadTargets>>,
  ) {
    if (row.item_type === 'page') {
      return targets.pages.get(row.page_id!)?.is_published === true;
    }
    if (row.item_type === 'activity') {
      const status = targets.activities.get(row.activity_id!)?.status;
      return status === 'published' || status === 'closed';
    }
    if (row.item_type === 'file') return targets.files.has(row.file_id!);
    return true;
  }

  /** The pages, activities and files items point at, in three queries. */
  private async loadTargets(items: ItemRow[]) {
    const supabase = this.db();
    const ids = (pick: (i: ItemRow) => string | null) => [
      ...new Set(items.map(pick).filter((v): v is string => !!v)),
    ];
    const pageIds = ids((i) => (i.item_type === 'page' ? i.page_id : null));
    const activityIds = ids((i) =>
      i.item_type === 'activity' ? i.activity_id : null,
    );
    const fileIds = ids((i) => (i.item_type === 'file' ? i.file_id : null));

    const none = Promise.resolve({ data: [] as any[] });
    const [{ data: pages }, { data: activities }, { data: files }] =
      await Promise.all([
        pageIds.length
          ? supabase
              .schema('course')
              .from('page')
              .select('id, title, is_published')
              .in('id', pageIds)
          : none,
        activityIds.length
          ? supabase
              .schema('grading')
              .from('activity')
              .select('id, title, kind, points, due_at, status')
              .in('id', activityIds)
          : none,
        fileIds.length
          ? supabase
              .schema('file_manager')
              .from('file')
              .select('id, name')
              .in('id', fileIds)
              .is('deleted_at', null)
          : none,
      ]);

    return {
      pages: new Map<string, { title: string; is_published: boolean }>(
        (pages ?? []).map((p: any) => [p.id, p]),
      ),
      activities: new Map<string, ActivitySummary>(
        (activities ?? []).map((a: any) => [a.id, a]),
      ),
      files: new Map<string, { name: string }>(
        (files ?? []).map((f: any) => [f.id, f]),
      ),
    };
  }

  private toItem(
    row: ItemRow,
    targets: Awaited<ReturnType<typeof this.loadTargets>>,
  ) {
    const activity = row.activity_id
      ? targets.activities.get(row.activity_id)
      : undefined;

    const fallback =
      (row.page_id && targets.pages.get(row.page_id)?.title) ||
      activity?.title ||
      (row.file_id && targets.files.get(row.file_id)?.name) ||
      'Untitled';

    return {
      id: row.id,
      moduleId: row.module_id,
      position: row.position,
      itemType: row.item_type,
      title: row.title?.trim() || fallback,
      pageId: row.page_id,
      activityId: row.activity_id,
      fileId: row.file_id,
      url: row.url,
      indent: row.indent,
      isPublished: row.is_published,
      ...(row.item_type === 'activity' && activity
        ? {
            activity: {
              kind: activity.kind,
              points: Number(activity.points),
              dueAt: activity.due_at,
              status: activity.status,
            },
          }
        : {}),
    };
  }

  /** One item, shaped exactly as it appears in a module listing. */
  private async shapeOne(row: ItemRow) {
    return this.toItem(row, await this.loadTargets([row]));
  }

  // ── modules ───────────────────────────────────────────────────────────────

  private async loadModule(courseId: string, moduleId: string) {
    const { data } = await this.db()
      .schema('course')
      .from('module')
      .select(MODULE_COLUMNS)
      .eq('id', moduleId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Module not found');
    return data;
  }

  /** New modules go last. */
  async create(userId: string, courseId: string, title: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const trimmed = title.trim();
    if (!trimmed) throw new BadRequestException('Give the module a title');

    const position = await this.nextPosition('module', 'course_id', courseId);

    const { data, error } = await this.db()
      .schema('course')
      .from('module')
      .insert({ course_id: courseId, title: trimmed, position })
      .select(MODULE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create module: ${error?.message}`);
      throw new BadRequestException('Failed to create the module');
    }

    const m = data;
    return {
      id: m.id,
      courseId: m.course_id,
      title: m.title,
      position: m.position,
      isPublished: m.is_published,
      items: [],
    };
  }

  async update(
    userId: string,
    courseId: string,
    moduleId: string,
    patch: { title?: string; isPublished?: boolean },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadModule(courseId, moduleId);

    const changes: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Give the module a title');
      changes.title = title;
    }
    if (patch.isPublished !== undefined) {
      changes.is_published = patch.isPublished;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const { error } = await this.db()
      .schema('course')
      .from('module')
      .update(changes)
      .eq('id', moduleId)
      .eq('course_id', courseId);

    if (error) {
      this.logger.error(`Failed to update module: ${error.message}`);
      throw new BadRequestException('Failed to update the module');
    }

    const modules = await this.build(courseId, false);
    return modules.find((m) => m.id === moduleId)!;
  }

  /** Items go with the module; the pages and activities they link stay. */
  async remove(userId: string, courseId: string, moduleId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadModule(courseId, moduleId);

    const { error } = await this.db()
      .schema('course')
      .from('module')
      .delete()
      .eq('id', moduleId)
      .eq('course_id', courseId);

    if (error) {
      this.logger.error(`Failed to delete module: ${error.message}`);
      throw new BadRequestException('Failed to delete the module');
    }
  }

  /** `moduleIds` must name every module in the course, in the new order. */
  async reorder(userId: string, courseId: string, moduleIds: string[]) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const { data } = await this.db()
      .schema('course')
      .from('module')
      .select('id')
      .eq('course_id', courseId);

    this.assertSameSet(
      (data ?? []).map((r: any) => r.id as string),
      moduleIds,
      'module',
    );
    await this.writePositions('module', moduleIds);
    return this.build(courseId, false);
  }

  // ── items ─────────────────────────────────────────────────────────────────

  private async loadItem(courseId: string, moduleId: string, itemId: string) {
    const { data } = await this.db()
      .schema('course')
      .from('module_item')
      .select(ITEM_COLUMNS)
      .eq('id', itemId)
      .eq('module_id', moduleId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Module item not found');
    return data;
  }

  /**
   * Work out the stored row for a new item. Only the field the type names is
   * kept, and it must belong to this course (or, for a file, its school).
   */
  private async resolveTarget(
    userId: string,
    course: CourseRow,
    input: {
      itemType: ModuleItemType;
      title?: string;
      pageId?: string;
      activityId?: string;
      fileId?: string;
      url?: string;
    },
  ) {
    const supabase = this.db();
    const title = input.title?.trim() || null;
    const row = {
      item_type: input.itemType,
      title,
      page_id: null as string | null,
      activity_id: null as string | null,
      file_id: null as string | null,
      url: null as string | null,
    };

    switch (input.itemType) {
      case 'page': {
        if (!input.pageId) throw new BadRequestException('Choose a page');
        const { data } = await supabase
          .schema('course')
          .from('page')
          .select('id')
          .eq('id', input.pageId)
          .eq('course_id', course.id)
          .maybeSingle();
        if (!data) throw new NotFoundException('Page not found');
        row.page_id = input.pageId;
        break;
      }
      case 'activity': {
        if (!input.activityId) {
          throw new BadRequestException('Choose an assignment or quiz');
        }
        const { data } = await supabase
          .schema('grading')
          .from('activity')
          .select('id')
          .eq('id', input.activityId)
          .eq('course_id', course.id)
          .maybeSingle();
        if (!data) throw new NotFoundException('Assignment not found');
        row.activity_id = input.activityId;
        break;
      }
      case 'file': {
        if (!input.fileId) throw new BadRequestException('Choose a file');
        const { data } = await supabase
          .schema('file_manager')
          .from('file')
          .select('id')
          .eq('id', input.fileId)
          .eq('school_id', course.school_id)
          // Only your own files: a colleague's private file id would
          // otherwise put its name in front of the whole course.
          .eq('owner_id', userId)
          .is('deleted_at', null)
          .maybeSingle();
        if (!data) throw new NotFoundException('File not found');
        row.file_id = input.fileId;
        break;
      }
      case 'link':
        if (!input.url) throw new BadRequestException('Give the link a URL');
        if (!title) throw new BadRequestException('Give the link a title');
        row.url = input.url;
        break;
      case 'header':
        if (!title) throw new BadRequestException('Give the header a title');
        break;
    }

    return row;
  }

  async createItem(
    userId: string,
    courseId: string,
    moduleId: string,
    input: {
      itemType: ModuleItemType;
      title?: string;
      pageId?: string;
      activityId?: string;
      fileId?: string;
      url?: string;
      indent?: number;
    },
  ) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    await this.loadModule(courseId, moduleId);

    const target = await this.resolveTarget(userId, course, input);
    const position = await this.nextPosition(
      'module_item',
      'module_id',
      moduleId,
    );

    const { data, error } = await this.db()
      .schema('course')
      .from('module_item')
      .insert({
        ...target,
        module_id: moduleId,
        course_id: courseId,
        position,
        indent: input.indent ?? 0,
      })
      .select(ITEM_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to add module item: ${error?.message}`);
      throw new BadRequestException('Failed to add to the module');
    }

    return this.shapeOne(data);
  }

  async updateItem(
    userId: string,
    courseId: string,
    moduleId: string,
    itemId: string,
    patch: {
      title?: string | null;
      indent?: number;
      isPublished?: boolean;
      moduleId?: string;
    },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const item = await this.loadItem(courseId, moduleId, itemId);

    const changes: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = patch.title?.trim() || null;
      // Links and headers have nothing else to show.
      if (!title && (item.item_type === 'link' || item.item_type === 'header')) {
        throw new BadRequestException('This item needs a title');
      }
      changes.title = title;
    }
    if (patch.indent !== undefined) changes.indent = patch.indent;
    if (patch.isPublished !== undefined) {
      changes.is_published = patch.isPublished;
    }
    if (patch.moduleId !== undefined && patch.moduleId !== item.module_id) {
      await this.loadModule(courseId, patch.moduleId);
      changes.module_id = patch.moduleId;
      changes.position = await this.nextPosition(
        'module_item',
        'module_id',
        patch.moduleId,
      );
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const { data, error } = await this.db()
      .schema('course')
      .from('module_item')
      .update(changes)
      .eq('id', itemId)
      .eq('course_id', courseId)
      .select(ITEM_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update module item: ${error?.message}`);
      throw new BadRequestException('Failed to update the module item');
    }

    return this.shapeOne(data);
  }

  /** Removes the item only; the page, activity or file it linked stays. */
  async removeItem(
    userId: string,
    courseId: string,
    moduleId: string,
    itemId: string,
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadItem(courseId, moduleId, itemId);

    const { error } = await this.db()
      .schema('course')
      .from('module_item')
      .delete()
      .eq('id', itemId)
      .eq('course_id', courseId);

    if (error) {
      this.logger.error(`Failed to delete module item: ${error.message}`);
      throw new BadRequestException('Failed to remove from the module');
    }
  }

  /** `itemIds` must name every item in the module, in the new order. */
  async reorderItems(
    userId: string,
    courseId: string,
    moduleId: string,
    itemIds: string[],
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadModule(courseId, moduleId);

    const { data } = await this.db()
      .schema('course')
      .from('module_item')
      .select('id')
      .eq('module_id', moduleId)
      .eq('course_id', courseId);

    this.assertSameSet(
      (data ?? []).map((r: any) => r.id as string),
      itemIds,
      'item',
    );
    await this.writePositions('module_item', itemIds);

    const modules = await this.build(courseId, false);
    return modules.find((m) => m.id === moduleId)!;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async nextPosition(
    table: 'module' | 'module_item',
    column: 'course_id' | 'module_id',
    id: string,
  ) {
    const { data } = await this.db()
      .schema('course')
      .from(table)
      .select('position')
      .eq(column, id)
      .order('position', { ascending: false })
      .limit(1);

    const top = (data)?.[0]?.position;
    return top === undefined ? 0 : top + 1;
  }

  /**
   * A reorder must be a permutation of what is there. Anything else - a
   * missing id, a stranger's id, a duplicate - means the client's view is
   * stale, and writing it would scramble positions.
   */
  private assertSameSet(existing: string[], given: string[], noun: string) {
    const have = new Set(existing);
    const unique = new Set(given);
    if (
      unique.size !== given.length ||
      unique.size !== have.size ||
      given.some((id) => !have.has(id))
    ) {
      throw new BadRequestException(
        `List every ${noun} exactly once; the page may be out of date, so refresh and try again`,
      );
    }
  }

  private async writePositions(table: 'module' | 'module_item', ids: string[]) {
    const supabase = this.db();
    const results = await Promise.all(
      ids.map((id, position) =>
        supabase.schema('course').from(table).update({ position }).eq('id', id),
      ),
    );

    const failed = results.find((r: any) => r?.error);
    if (failed) {
      this.logger.error(`Failed to reorder ${table}: ${failed.error?.message}`);
      throw new BadRequestException('Failed to save the new order');
    }
  }
}
