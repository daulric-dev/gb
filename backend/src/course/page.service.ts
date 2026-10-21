import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
} from './access/course-access.service';

const PAGE_SUMMARY_COLUMNS = 'id, course_id, title, is_published, updated_at';
const PAGE_COLUMNS = `${PAGE_SUMMARY_COLUMNS}, body, created_by, created_at`;

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
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
  ) {}

  private pages() {
    return this.supabaseService.getServiceClient().schema('course').from('page');
  }

  /** Every page in the course, without bodies - a list can be long. */
  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId);

    const { data, error } = await this.pages()
      .select(PAGE_SUMMARY_COLUMNS)
      .eq('course_id', courseId)
      .order('title', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list pages: ${error.message}`);
      throw new BadRequestException('Failed to load pages');
    }

    return ((data ?? []) as PageRow[]).map((p) => this.toSummary(p));
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

    const { data, error } = await this.pages()
      .insert({
        course_id: courseId,
        title,
        body: input.body ?? '',
        is_published: input.isPublished ?? false,
        created_by: userId,
      })
      .select(PAGE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create page: ${error?.message}`);
      throw new BadRequestException('Failed to create the page');
    }

    return this.toPage(data);
  }

  async update(
    userId: string,
    courseId: string,
    pageId: string,
    patch: { title?: string; body?: string; isPublished?: boolean },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const changes: Record<string, unknown> = {};
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
    changes.updated_at = new Date().toISOString();

    const { data, error } = await this.pages()
      .update(changes)
      .eq('id', pageId)
      .eq('course_id', courseId)
      .select(PAGE_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update page: ${error.message}`);
      throw new BadRequestException('Failed to update the page');
    }
    if (!data) throw new NotFoundException('Page not found');

    return this.toPage(data);
  }

  /** Module items linking the page go with it (FK cascade). */
  async remove(userId: string, courseId: string, pageId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const { data, error } = await this.pages()
      .delete()
      .eq('id', pageId)
      .eq('course_id', courseId)
      .select('id')
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to delete page: ${error.message}`);
      throw new BadRequestException('Failed to delete the page');
    }
    if (!data) throw new NotFoundException('Page not found');
  }

  /** Scoped by course, so a page id from another course is simply missing. */
  private async load(courseId: string, pageId: string): Promise<PageRow> {
    const { data } = await this.pages()
      .select(PAGE_COLUMNS)
      .eq('id', pageId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Page not found');
    return data;
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
