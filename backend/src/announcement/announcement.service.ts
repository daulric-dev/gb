import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const CONTENT_SELECT =
  'id, school_id, course_id, author_user_profile_id, title, body, created_at, updated_at, author:author_user_profile_id(first_name, last_name, avatar_url)';
const CONTENT_TTL = 60 * 60 * 24 * 30;
const contentKey = (schoolId: string) => `announcements:content:${schoolId}`;

/**
 * What a student sees of a course announcement: no read receipts (other
 * students' names) and no internal author id.
 */
const STUDENT_SELECT =
  'id, course_id, title, body, created_at, updated_at, author:author_user_profile_id(first_name, last_name, avatar_url)';

export interface ReaderRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly courseAccess: CourseAccessService,
  ) {}

  /** Resolve the caller's school + role in one lookup. */
  private async getProfile(userId: string) {
    const { data: profile, error } = await this.supabaseService
      .getServiceClient()
      .from('user_profile')
      .select('school_id, role')
      .eq('id', userId)
      .single();

    if (error || !profile?.school_id) {
      this.logger.error(
        `Failed to resolve school for user ${userId}: ${error?.message}`,
      );
      throw new BadRequestException('Could not determine your school');
    }
    return profile;
  }

  /** Merge live read receipts into cached announcement content. */
  private async attachReaders<
    T extends { id: string; author_user_profile_id: string | null },
  >(items: T[]): Promise<(T & { readers: ReaderRow[] })[]> {
    if (items.length === 0) return [];

    const { data: reads } = await this.supabaseService
      .getServiceClient()
      .from('announcement_read')
      .select(
        'announcement_id, reader:user_profile_id(id, first_name, last_name, avatar_url)',
      )
      .in(
        'announcement_id',
        items.map((i) => i.id),
      );

    const byAnnouncement = new Map<string, ReaderRow[]>();
    for (const r of (reads ?? []) as any[]) {
      const reader = r.reader as ReaderRow | null;
      const announcement_id = r.announcement_id as string;

      if (!reader) continue;

      const list = byAnnouncement.get(announcement_id) ?? [];

      list.push(reader);
      byAnnouncement.set(announcement_id, list);
    }

    return items.map((item) => ({
      ...item,
      // The author isn't shown as a "reader" of their own post.
      readers: (byAnnouncement.get(item.id) ?? []).filter(
        (rd) => rd.id !== item.author_user_profile_id,
      ),
    }));
  }

  async findAll(userId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id }: { school_id: string } = await this.getProfile(userId);

    let content = (await this.cache.get(contentKey(school_id))) as any[] | null;
    if (!content) {
      const { data, error } = await supabase
        .from('announcement')
        .select(CONTENT_SELECT)
        .eq('school_id', school_id)
        // Course announcements belong to their course's stream only.
        .is('course_id', null)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Failed to fetch announcements: ${error.message}`);
        throw new BadRequestException('Failed to fetch announcements');
      }
      content = data ?? [];
      await this.cache.set(contentKey(school_id), content, CONTENT_TTL);
    }

    return this.attachReaders(content);
  }

  async findOne(userId: string, id: string) {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id } = await this.getProfile(userId);

    const { data, error } = await supabase
      .from('announcement')
      .select(CONTENT_SELECT)
      .eq('id', id)
      .eq('school_id', school_id)
      .is('course_id', null)
      .single();

    if (error || !data) throw new NotFoundException('Announcement not found');
    return (await this.attachReaders([data]))[0];
  }

  async create(userId: string, dto: CreateAnnouncementDto) {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id }: { school_id: string } = await this.getProfile(userId);

    const { data, error } = await supabase
      .from('announcement')
      .insert({
        school_id,
        author_user_profile_id: userId,
        title: dto.title,
        body: dto.body ?? null,
      })
      .select(CONTENT_SELECT)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create announcement: ${error?.message}`);
      throw new BadRequestException('Failed to create announcement');
    }
    await this.cache.delete(contentKey(school_id));
    return { ...data, readers: [] as ReaderRow[] };
  }

  async update(userId: string, id: string, dto: UpdateAnnouncementDto) {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id }: { school_id: string } = await this.assertCanManage(
      userId,
      id,
    );

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.body !== undefined) updateData.body = dto.body;

    const { data, error } = await supabase
      .from('announcement')
      .update(updateData)
      .eq('id', id)
      .select(CONTENT_SELECT)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update announcement: ${error?.message}`);
      throw new BadRequestException('Failed to update announcement');
    }
    await this.cache.delete(contentKey(school_id));
    return (await this.attachReaders([data]))[0];
  }

  async delete(userId: string, id: string) {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id }: { school_id: string } = await this.assertCanManage(
      userId,
      id,
    );

    const { error } = await supabase.from('announcement').delete().eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete announcement: ${error.message}`);
      throw new BadRequestException('Failed to delete announcement');
    }
    await this.cache.delete(contentKey(school_id));
    return { message: 'Announcement deleted' };
  }

  /**
   * Number of school-wide announcements posted by others the user hasn't
   * read.
   *
   * This used to call the `announcement_unread_count` RPC, but that function
   * predates course announcements and counts every announcement in the
   * school, so a teacher would see a badge for posts in courses they are not
   * on. Until the RPC gains a `course_id IS NULL` filter in a migration, the
   * count is done here.
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id } = await this.getProfile(userId);

    const { data: anns } = await supabase
      .from('announcement')
      .select('id, author_user_profile_id')
      .eq('school_id', school_id)
      .is('course_id', null);

    const candidates = (anns ?? [])
      .filter((a: any) => a.author_user_profile_id !== userId)
      .map((a: any) => a.id as string);
    if (candidates.length === 0) return { count: 0 };

    const { data: reads } = await supabase
      .from('announcement_read')
      .select('announcement_id')
      .eq('user_profile_id', userId)
      .in('announcement_id', candidates);

    const read = new Set((reads ?? []).map((r: any) => r.announcement_id));
    return { count: candidates.filter((id) => !read.has(id)).length };
  }

  /** Record a read receipt for every announcement currently in the school. */
  async markRead(userId: string): Promise<{ count: number }> {
    const supabase = this.supabaseService.getServiceClient();
    const { school_id } = await this.getProfile(userId);

    const { data: anns } = await supabase
      .from('announcement')
      .select('id')
      .eq('school_id', school_id)
      .is('course_id', null);

    const rows = (anns ?? []).map((a) => ({
      announcement_id: a.id,
      user_profile_id: userId,
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from('announcement_read').upsert(rows, {
        onConflict: 'announcement_id,user_profile_id',
        ignoreDuplicates: true,
      });
      if (error) {
        this.logger.error(`Failed to mark read: ${error.message}`);
        throw new BadRequestException('Failed to mark announcements read');
      }
    }
    return { count: 0 };
  }

  // ── course announcements ──────────────────────────────────────────────────

  /** A course's announcements, newest first, for any of its staff. */
  async findForCourse(userId: string, courseId: string) {
    await this.courseAccess.require(userId, courseId, STAFF_ROLES);

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .from('announcement')
      .select(CONTENT_SELECT)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch course announcements: ${error.message}`);
      throw new BadRequestException('Failed to fetch announcements');
    }
    return this.attachReaders(data ?? []);
  }

  /** TAs post too: announcing is part of running the course day to day. */
  async createForCourse(
    userId: string,
    courseId: string,
    dto: CreateAnnouncementDto,
  ) {
    const { course } = await this.courseAccess.require(
      userId,
      courseId,
      STAFF_ROLES,
    );

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .from('announcement')
      .insert({
        school_id: course.school_id,
        course_id: course.id,
        author_user_profile_id: userId,
        title: dto.title,
        body: dto.body ?? null,
      })
      .select(CONTENT_SELECT)
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to create course announcement: ${error?.message}`,
      );
      throw new BadRequestException('Failed to create announcement');
    }
    return { ...data, readers: [] as ReaderRow[] };
  }

  /**
   * A course's announcements for a student. The caller (portal) has already
   * proved the student is enrolled in a visible course.
   */
  async findForStudent(courseId: string) {
    const { data, error } = await this.supabaseService
      .getServiceClient()
      .from('announcement')
      .select(STUDENT_SELECT)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch course announcements: ${error.message}`);
      throw new BadRequestException('Failed to fetch announcements');
    }
    return data ?? [];
  }

  /**
   * Editing/removing a notice is limited to its author or a school admin.
   * Returns the caller's school_id for cache invalidation.
   */
  private async assertCanManage(userId: string, id: string) {
    const supabase = this.supabaseService.getServiceClient();
    const profile = await this.getProfile(userId);

    const { data: existing } = await supabase
      .from('announcement')
      .select('author_user_profile_id')
      .eq('id', id)
      .eq('school_id', profile.school_id)
      .maybeSingle();

    if (!existing) throw new NotFoundException('Announcement not found');

    const isAuthor = existing.author_user_profile_id === userId;
    if (profile.role !== 'admin' && !isAuthor) {
      throw new ForbiddenException(
        'You can only edit announcements you posted',
      );
    }
    return profile;
  }
}
