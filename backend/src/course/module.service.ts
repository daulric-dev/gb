import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { isoDate } from '@/common/db-values';
import {
  CourseAccessService,
  CourseRow,
  MANAGE_ROLES,
} from './access/course-access.service';
import type { ModuleItemType } from './dto/content.dto';

const MODULE_SELECT = {
  id: true,
  course_id: true,
  title: true,
  position: true,
  is_published: true,
} as const;

/** An item's columns plus what it points at, so one query shapes it. */
const ITEM_SELECT = {
  id: true,
  module_id: true,
  course_id: true,
  position: true,
  item_type: true,
  title: true,
  page_id: true,
  activity_id: true,
  file_id: true,
  discussion_topic_id: true,
  url: true,
  indent: true,
  is_published: true,
  page: { select: { id: true, title: true, is_published: true } },
  activity: {
    select: {
      id: true,
      title: true,
      kind: true,
      points: true,
      due_at: true,
      status: true,
    },
  },
  file: { select: { id: true, name: true, deleted_at: true } },
  discussion_topic: { select: { id: true, title: true, is_published: true } },
} as const;

type ItemWithTargets = Prisma.module_itemGetPayload<{
  select: typeof ITEM_SELECT;
}>;

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
  discussion_topic_id: string | null;
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
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

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
    const where = {
      course_id: courseId,
      ...(studentView ? { is_published: true } : {}),
    };
    const orderBy = [
      { position: 'asc' as const },
      { created_at: 'asc' as const },
    ];

    let modules: ModuleRow[];
    let items: ItemWithTargets[];
    try {
      [modules, items] = await Promise.all([
        this.prisma.module.findMany({ where, orderBy, select: MODULE_SELECT }),
        this.prisma.module_item.findMany({
          where,
          orderBy,
          select: ITEM_SELECT,
        }),
      ]);
    } catch (error) {
      this.logger.error(`Failed to load modules: ${(error as Error).message}`);
      throw new BadRequestException('Failed to load modules');
    }

    const itemRows: ItemRow[] = items;
    const targets = this.targetsOf(items);

    const byModule = new Map<string, ReturnType<typeof this.toItem>[]>();
    for (const row of itemRows) {
      if (studentView && !this.visibleToStudent(row, targets)) continue;
      const list = byModule.get(row.module_id) ?? [];
      list.push(this.toItem(row, targets));
      byModule.set(row.module_id, list);
    }

    return modules.map((m) => ({
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
    targets: ReturnType<typeof this.targetsOf>,
  ) {
    if (row.item_type === 'page') {
      return targets.pages.get(row.page_id!)?.is_published === true;
    }
    if (row.item_type === 'activity') {
      const status = targets.activities.get(row.activity_id!)?.status;
      return status === 'published' || status === 'closed';
    }
    if (row.item_type === 'file') return targets.files.has(row.file_id!);
    // A draft topic does not exist for a student.
    if (row.item_type === 'discussion') {
      return targets.topics.get(row.discussion_topic_id!)?.is_published === true;
    }
    return true;
  }

  /** The pages, activities, files and topics items point at. */
  private targetsOf(items: ItemWithTargets[]) {
    const pages = new Map<string, { title: string; is_published: boolean }>();
    const topics = new Map<string, { title: string; is_published: boolean }>();
    const activities = new Map<string, ActivitySummary>();
    const files = new Map<string, { name: string }>();

    for (const i of items) {
      if (i.item_type === 'page' && i.page) pages.set(i.page.id, i.page);
      if (i.item_type === 'activity' && i.activity) {
        const a = i.activity;
        activities.set(a.id, {
          id: a.id,
          title: a.title,
          kind: a.kind,
          points: Number(a.points),
          due_at: isoDate(a.due_at),
          status: a.status,
        });
      }
      // A deleted file is as good as gone.
      if (i.item_type === 'file' && i.file && i.file.deleted_at === null) {
        files.set(i.file.id, { name: i.file.name });
      }
      if (i.item_type === 'discussion' && i.discussion_topic) {
        topics.set(i.discussion_topic.id, i.discussion_topic);
      }
    }

    return { pages, activities, files, topics };
  }

  private toItem(row: ItemRow, targets: ReturnType<typeof this.targetsOf>) {
    const activity = row.activity_id
      ? targets.activities.get(row.activity_id)
      : undefined;

    const fallback =
      (row.page_id && targets.pages.get(row.page_id)?.title) ||
      activity?.title ||
      (row.file_id && targets.files.get(row.file_id)?.name) ||
      (row.discussion_topic_id &&
        targets.topics.get(row.discussion_topic_id)?.title) ||
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
      discussionTopicId: row.discussion_topic_id,
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
  private shapeOne(row: ItemWithTargets) {
    return this.toItem(row, this.targetsOf([row]));
  }

  // ── modules ───────────────────────────────────────────────────────────────

  private async loadModule(courseId: string, moduleId: string) {
    const data = await this.prisma.module.findFirst({
      where: { id: moduleId, course_id: courseId },
      select: MODULE_SELECT,
    });

    if (!data) throw new NotFoundException('Module not found');
    return data;
  }

  /** New modules go last. */
  async create(userId: string, courseId: string, title: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const trimmed = title.trim();
    if (!trimmed) throw new BadRequestException('Give the module a title');

    const position = await this.nextPosition('module', 'course_id', courseId);

    let m: ModuleRow;
    try {
      m = await this.prisma.module.create({
        data: { course_id: courseId, title: trimmed, position },
        select: MODULE_SELECT,
      });
    } catch (error) {
      this.logger.error(`Failed to create module: ${(error as Error).message}`);
      throw new BadRequestException('Failed to create the module');
    }

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

    const changes: Prisma.moduleUncheckedUpdateManyInput = {};
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

    try {
      await this.prisma.module.updateMany({
        where: { id: moduleId, course_id: courseId },
        data: changes,
      });
    } catch (error) {
      this.logger.error(`Failed to update module: ${(error as Error).message}`);
      throw new BadRequestException('Failed to update the module');
    }

    const modules = await this.build(courseId, false);
    return modules.find((m) => m.id === moduleId)!;
  }

  /** Items go with the module; the pages and activities they link stay. */
  async remove(userId: string, courseId: string, moduleId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadModule(courseId, moduleId);

    try {
      await this.prisma.module.deleteMany({
        where: { id: moduleId, course_id: courseId },
      });
    } catch (error) {
      this.logger.error(`Failed to delete module: ${(error as Error).message}`);
      throw new BadRequestException('Failed to delete the module');
    }
  }

  /** `moduleIds` must name every module in the course, in the new order. */
  async reorder(userId: string, courseId: string, moduleIds: string[]) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const data = await this.prisma.module.findMany({
      where: { course_id: courseId },
      select: { id: true },
    });

    this.assertSameSet(
      data.map((r) => r.id),
      moduleIds,
      'module',
    );
    await this.writePositions('module', moduleIds);
    return this.build(courseId, false);
  }

  // ── items ─────────────────────────────────────────────────────────────────

  private async loadItem(courseId: string, moduleId: string, itemId: string) {
    const data = await this.prisma.module_item.findFirst({
      where: { id: itemId, module_id: moduleId, course_id: courseId },
      select: ITEM_SELECT,
    });

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
      discussionTopicId?: string;
      url?: string;
    },
  ) {
    const title = input.title?.trim() || null;
    const row = {
      item_type: input.itemType,
      title,
      page_id: null as string | null,
      activity_id: null as string | null,
      file_id: null as string | null,
      discussion_topic_id: null as string | null,
      url: null as string | null,
    };

    switch (input.itemType) {
      case 'page': {
        if (!input.pageId) throw new BadRequestException('Choose a page');
        const data = await this.prisma.page.findFirst({
          where: { id: input.pageId, course_id: course.id },
          select: { id: true },
        });
        if (!data) throw new NotFoundException('Page not found');
        row.page_id = input.pageId;
        break;
      }
      case 'activity': {
        if (!input.activityId) {
          throw new BadRequestException('Choose an assignment or quiz');
        }
        const data = await this.prisma.activity.findFirst({
          where: { id: input.activityId, course_id: course.id },
          select: { id: true },
        });
        if (!data) throw new NotFoundException('Assignment not found');
        row.activity_id = input.activityId;
        break;
      }
      case 'file': {
        if (!input.fileId) throw new BadRequestException('Choose a file');
        const data = await this.prisma.file.findFirst({
          where: {
            id: input.fileId,
            school_id: course.school_id,
            // Only your own files: a colleague's private file id would
            // otherwise put its name in front of the whole course.
            owner_id: userId,
            deleted_at: null,
          },
          select: { id: true },
        });
        if (!data) throw new NotFoundException('File not found');
        row.file_id = input.fileId;
        break;
      }
      case 'discussion': {
        if (!input.discussionTopicId) {
          throw new BadRequestException('Choose a discussion topic');
        }
        const data = await this.prisma.discussion_topic.findFirst({
          where: { id: input.discussionTopicId, course_id: course.id },
          select: { id: true },
        });
        if (!data) throw new NotFoundException('Discussion topic not found');
        row.discussion_topic_id = input.discussionTopicId;
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
      discussionTopicId?: string;
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

    let data: ItemWithTargets;
    try {
      data = await this.prisma.module_item.create({
        data: {
          ...target,
          module_id: moduleId,
          course_id: courseId,
          position,
          indent: input.indent ?? 0,
        },
        select: ITEM_SELECT,
      });
    } catch (error) {
      this.logger.error(
        `Failed to add module item: ${(error as Error).message}`,
      );
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

    const changes: Prisma.module_itemUncheckedUpdateInput = {};
    if (patch.title !== undefined) {
      const title = patch.title?.trim() || null;
      // Links and headers have nothing else to show.
      if (
        !title &&
        (item.item_type === 'link' || item.item_type === 'header')
      ) {
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

    let data: ItemWithTargets;
    try {
      // loadItem proved the item is in this course, so `id` alone is enough.
      data = await this.prisma.module_item.update({
        where: { id: itemId },
        data: changes,
        select: ITEM_SELECT,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update module item: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to update the module item');
    }

    return this.shapeOne(data);
  }

  /** Removes the item only; the page, activity, file or topic it linked stays. */
  async removeItem(
    userId: string,
    courseId: string,
    moduleId: string,
    itemId: string,
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    await this.loadItem(courseId, moduleId, itemId);

    try {
      await this.prisma.module_item.deleteMany({
        where: { id: itemId, course_id: courseId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to delete module item: ${(error as Error).message}`,
      );
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

    const data = await this.prisma.module_item.findMany({
      where: { module_id: moduleId, course_id: courseId },
      select: { id: true },
    });

    this.assertSameSet(
      data.map((r) => r.id),
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
    const query = {
      where: { [column]: id },
      orderBy: { position: 'desc' as const },
      select: { position: true },
    };
    const data =
      table === 'module'
        ? await this.prisma.module.findFirst(query)
        : await this.prisma.module_item.findFirst(query);

    const top = data?.position;
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
    try {
      await this.prisma.$transaction(
        ids.map((id, position) =>
          table === 'module'
            ? this.prisma.module.updateMany({
                where: { id },
                data: { position },
              })
            : this.prisma.module_item.updateMany({
                where: { id },
                data: { position },
              }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to reorder ${table}: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to save the new order');
    }
  }
}
