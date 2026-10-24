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
  MANAGE_ROLES,
} from './access/course-access.service';

const PAGE_SUMMARY_SELECT = {
  id: true,
  course_id: true,
  title: true,
  is_published: true,
  updated_at: true,
} as const;
const PAGE_SELECT = {
  ...PAGE_SUMMARY_SELECT,
  body: true,
  created_by: true,
  created_at: true,
} as const;

type PageRecord = {
  id: string;
  course_id: string;
  title: string;
  is_published: boolean;
  updated_at: Date;
  body?: string;
  created_by?: string | null;
  created_at?: Date;
};

function toPageRow(p: PageRecord): PageRow {
  return {
    ...p,
    updated_at: isoDate(p.updated_at)!,
    created_at: p.created_at ? isoDate(p.created_at)! : undefined,
  };
}

export interface PageRow {
  id: string;
  course_id: string;
  title: string;
  is_published: boolean;
  updated_at: string;
  body?: string;
  created_by?: string | null;
  created_at?: string;
}

/**
 * Course pages: markdown documents a teacher writes and links from modules.
 *
 * Staff read every page; teachers and admins write. Students only ever reach
 * published pages, through the portal (`getPublished`).
 */
@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  /** Every page in the course, without bodies - a list can be long. */
  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId);

    let data: PageRecord[];
    try {
      data = await this.prisma.page.findMany({
        where: { course_id: courseId },
        select: PAGE_SUMMARY_SELECT,
        orderBy: { title: 'asc' },
      });
    } catch (error) {
      this.logger.error(`Failed to list pages: ${(error as Error).message}`);
      throw new BadRequestException('Failed to load pages');
    }

    return data.map((p) => this.toSummary(toPageRow(p)));
  }

  async get(userId: string, courseId: string, pageId: string) {
    await this.access.require(userId, courseId);
    return this.toPage(await this.load(courseId, pageId));
  }

  /** A published page, for a student the caller has already checked. */
  async getPublished(courseId: string, pageId: string) {
    const page = await this.load(courseId, pageId);
    // An unpublished page is still being written; it does not exist yet as
    // far as a student is concerned.
    if (!page.is_published) throw new NotFoundException('Page not found');
    return this.toPage(page);
  }

  async create(
    userId: string,
    courseId: string,
    input: { title: string; body?: string; isPublished?: boolean },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the page a title');

    let data: PageRecord;
    try {
      data = await this.prisma.page.create({
        data: {
          course_id: courseId,
          title,
          body: input.body ?? '',
          is_published: input.isPublished ?? false,
          created_by: userId,
        },
        select: PAGE_SELECT,
      });
    } catch (error) {
      this.logger.error(`Failed to create page: ${(error as Error).message}`);
      throw new BadRequestException('Failed to create the page');
    }

    return this.toPage(toPageRow(data));
  }

  async update(
    userId: string,
    courseId: string,
    pageId: string,
    patch: { title?: string; body?: string; isPublished?: boolean },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const changes: Prisma.pageUncheckedUpdateManyInput = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Give the page a title');
      changes.title = title;
    }
    if (patch.body !== undefined) changes.body = patch.body;
    if (patch.isPublished !== undefined) {
      changes.is_published = patch.isPublished;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date();

    let data: PageRecord[];
    try {
      data = await this.prisma.page.updateManyAndReturn({
        where: { id: pageId, course_id: courseId },
        data: changes,
        select: PAGE_SELECT,
      });
    } catch (error) {
      this.logger.error(`Failed to update page: ${(error as Error).message}`);
      throw new BadRequestException('Failed to update the page');
    }
    if (!data[0]) throw new NotFoundException('Page not found');

    return this.toPage(toPageRow(data[0]));
  }

  /** Module items linking the page go with it (FK cascade). */
  async remove(userId: string, courseId: string, pageId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    let count: number;
    try {
      ({ count } = await this.prisma.page.deleteMany({
        where: { id: pageId, course_id: courseId },
      }));
    } catch (error) {
      this.logger.error(`Failed to delete page: ${(error as Error).message}`);
      throw new BadRequestException('Failed to delete the page');
    }
    if (count === 0) throw new NotFoundException('Page not found');
  }

  /** Scoped by course, so a page id from another course is simply missing. */
  private async load(courseId: string, pageId: string): Promise<PageRow> {
    const data = await this.prisma.page.findFirst({
      where: { id: pageId, course_id: courseId },
      select: PAGE_SELECT,
    });

    if (!data) throw new NotFoundException('Page not found');
    return toPageRow(data);
  }

  private toSummary(p: PageRow) {
    return {
      id: p.id,
      courseId: p.course_id,
      title: p.title,
      isPublished: p.is_published,
      updatedAt: p.updated_at,
    };
  }

  private toPage(p: PageRow) {
    return {
      ...this.toSummary(p),
      body: p.body ?? '',
      createdBy: p.created_by ?? null,
      createdAt: p.created_at ?? p.updated_at,
    };
  }
}
