import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { isoDate } from '@/common/db-values';
import { CourseNotificationService } from '@/course-notification/course-notification.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
  type CourseRole,
  type CourseRow,
} from '@/course/access/course-access.service';
import type {
  CreateReplyDto,
  CreateTopicDto,
  UpdateReplyDto,
  UpdateTopicDto,
} from './dto/discussion.dto';

/**
 * Who is acting in a course's discussions. Staff and students both post as
 * their user_profile; `role` is their course role, or 'student' for a
 * portal caller the access service has already checked.
 */
export interface DiscussionCtx {
  course: CourseRow;
  userId: string;
  role: CourseRole | 'student';
}

// Names and avatars only: posts are read by every student in the course, so
// no email or internal id of another author goes out.
const AUTHOR_SELECT = {
  select: { first_name: true, last_name: true, avatar_url: true, account_type: true },
} as const;

const TOPIC_SELECT = {
  id: true,
  course_id: true,
  author_user_profile_id: true,
  title: true,
  body: true,
  is_pinned: true,
  is_locked: true,
  is_published: true,
  require_initial_post: true,
  last_reply_at: true,
  edited_at: true,
  created_at: true,
  updated_at: true,
  user_profile: AUTHOR_SELECT,
} as const;

const REPLY_SELECT = {
  id: true,
  topic_id: true,
  parent_id: true,
  author_user_profile_id: true,
  body: true,
  edited_at: true,
  deleted_at: true,
  created_at: true,
  user_profile: AUTHOR_SELECT,
} as const;

type AuthorRecord = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  account_type: 'staff' | 'student';
} | null;

type TopicRecord = Prisma.discussion_topicGetPayload<{ select: typeof TOPIC_SELECT }>;
type ReplyRecord = Prisma.discussion_replyGetPayload<{ select: typeof REPLY_SELECT }>;

interface TopicStats {
  topic_id: string;
  reply_count: number;
  unread_count: number;
}

const toAuthor = (a: AuthorRecord) =>
  a
    ? {
        firstName: a.first_name,
        lastName: a.last_name,
        avatarUrl: a.avatar_url,
        isStaff: a.account_type === 'staff',
      }
    : null;

/**
 * Course discussions: topics with Markdown bodies and replies threaded one
 * level deep.
 *
 * Any staff member starts topics (as with announcements, a TA running a
 * section needs no extra grant); students do when the course turns it on.
 * Everyone edits and deletes their own posts; teachers and admins moderate
 * anything - edit, delete, pin, lock. An archived course is read-only, apart
 * from staff cleaning up.
 */
@Injectable()
export class DiscussionService {
  private readonly logger = new Logger(DiscussionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    @Optional() private readonly notices?: CourseNotificationService,
  ) {}

  // ── who is asking ─────────────────────────────────────────────────────────

  async forStaff(userId: string, courseId: string): Promise<DiscussionCtx> {
    const { course, role } = await this.access.require(userId, courseId, STAFF_ROLES);
    return { course, userId, role };
  }

  /** The portal's caller: an active enrolment in a published (or archived) course. */
  async forStudent(
    userId: string,
    studentId: string,
    courseId: string,
  ): Promise<DiscussionCtx> {
    const course = await this.access.requireStudent(studentId, courseId);
    return { course, userId, role: 'student' };
  }

  // ── settings ──────────────────────────────────────────────────────────────

  async getSettings(ctx: DiscussionCtx) {
    const row = await this.prisma.discussion_setting.findUnique({
      where: { course_id: ctx.course.id },
      select: { students_can_create_topics: true },
    });
    return { studentsCanCreateTopics: row?.students_can_create_topics ?? false };
  }

  async updateSettings(ctx: DiscussionCtx, studentsCanCreateTopics: boolean) {
    this.assertModerator(ctx);
    await this.prisma.discussion_setting.upsert({
      where: { course_id: ctx.course.id },
      create: { course_id: ctx.course.id, students_can_create_topics: studentsCanCreateTopics },
      update: { students_can_create_topics: studentsCanCreateTopics, updated_at: new Date() },
    });
    return { studentsCanCreateTopics };
  }

  // ── topics ────────────────────────────────────────────────────────────────

  /**
   * The topic list, pinned first and then by latest activity, with reply and
   * unread counts for the caller. Students see published topics only.
   */
  async list(ctx: DiscussionCtx) {
    const { studentsCanCreateTopics } = await this.getSettings(ctx);

    let topics: TopicRecord[];
    try {
      topics = await this.prisma.discussion_topic.findMany({
        where: {
          course_id: ctx.course.id,
          ...(this.isStaff(ctx) ? {} : { is_published: true }),
        },
        select: TOPIC_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to list topics: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load discussions');
    }

    const ids = topics.map((t) => t.id);
    const [stats, reads] = ids.length
      ? await Promise.all([
          this.stats(ctx),
          this.prisma.discussion_read.findMany({
            where: { user_profile_id: ctx.userId, topic_id: { in: ids } },
            select: { topic_id: true },
          }),
        ])
      : [[] as TopicStats[], [] as { topic_id: string }[]];

    const byTopic = new Map(stats.map((s) => [s.topic_id, s]));
    const opened = new Set(reads.map((r) => r.topic_id));

    const activity = (t: TopicRecord) => (t.last_reply_at ?? t.created_at).getTime();
    topics.sort(
      (a, b) => Number(b.is_pinned) - Number(a.is_pinned) || activity(b) - activity(a),
    );

    return {
      studentsCanCreateTopics,
      canCreateTopics: this.canCreateTopic(ctx, studentsCanCreateTopics),
      topics: topics.map((t) => ({
        ...this.toTopicSummary(ctx, t),
        replyCount: byTopic.get(t.id)?.reply_count ?? 0,
        unreadCount: byTopic.get(t.id)?.unread_count ?? 0,
        // A topic the caller has never opened (and did not write) is new.
        isRead: opened.has(t.id) || t.author_user_profile_id === ctx.userId,
      })),
    };
  }

  /**
   * One topic with its replies, threaded. Opening it marks it read.
   *
   * When the topic asks students to post first, a student who has not gets
   * the topic without anyone else's replies (`mustPostFirst`).
   */
  async get(ctx: DiscussionCtx, topicId: string) {
    const topic = await this.loadTopic(ctx, topicId);

    const replies = await this.prisma.discussion_reply.findMany({
      where: { topic_id: topic.id },
      select: REPLY_SELECT,
      orderBy: { created_at: 'asc' },
    });

    const hasPosted = replies.some(
      (r) => r.author_user_profile_id === ctx.userId && !r.deleted_at,
    );
    const mustPostFirst =
      !this.isStaff(ctx) && topic.require_initial_post && !hasPosted;

    const previous = await this.prisma.discussion_read.findUnique({
      where: { topic_id_user_profile_id: { topic_id: topic.id, user_profile_id: ctx.userId } },
      select: { last_read_at: true },
    });
    if (!mustPostFirst) {
      const now = new Date();
      await this.prisma.discussion_read.upsert({
        where: { topic_id_user_profile_id: { topic_id: topic.id, user_profile_id: ctx.userId } },
        create: { topic_id: topic.id, user_profile_id: ctx.userId, last_read_at: now },
        update: { last_read_at: now },
      });
    }

    const lastRead = previous?.last_read_at ?? null;
    return {
      ...this.toTopicSummary(ctx, topic),
      body: topic.body,
      mustPostFirst,
      canReply: this.canReply(ctx, topic),
      replyCount: replies.filter((r) => !r.deleted_at).length,
      replies: mustPostFirst ? [] : this.thread(ctx, replies, lastRead),
    };
  }

  async create(ctx: DiscussionCtx, dto: CreateTopicDto) {
    this.assertOpen(ctx);
    const { studentsCanCreateTopics } = await this.getSettings(ctx);
    if (!this.canCreateTopic(ctx, studentsCanCreateTopics)) {
      throw new ForbiddenException('Only course staff can start topics in this course');
    }

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Give the topic a title');

    // Students' topics go up as plain published threads.
    const staff = this.isStaff(ctx);
    let data: TopicRecord;
    try {
      data = await this.prisma.discussion_topic.create({
        data: {
          course_id: ctx.course.id,
          author_user_profile_id: ctx.userId,
          title,
          body: dto.body ?? '',
          is_pinned: staff ? (dto.isPinned ?? false) : false,
          is_locked: staff ? (dto.isLocked ?? false) : false,
          is_published: staff ? (dto.isPublished ?? true) : true,
          require_initial_post: staff ? (dto.requireInitialPost ?? false) : false,
        },
        select: TOPIC_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to create topic: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create the topic');
    }

    if (data.is_published) this.announceTopic(data);

    return {
      ...this.toTopicSummary(ctx, data),
      body: data.body,
      mustPostFirst: false,
      canReply: this.canReply(ctx, data),
      replyCount: 0,
      replies: [],
    };
  }

  /**
   * The author edits title and body; pinning, locking, publishing and the
   * post-first rule are staff settings (the staff author or a moderator).
   */
  async update(ctx: DiscussionCtx, topicId: string, dto: UpdateTopicDto) {
    const topic = await this.loadTopic(ctx, topicId);
    const isAuthor = topic.author_user_profile_id === ctx.userId;
    if (!isAuthor && !this.isModerator(ctx)) {
      throw new ForbiddenException('You can only edit topics you started');
    }
    if (!this.isStaff(ctx)) {
      this.assertOpen(ctx);
      if (topic.is_locked) throw new ForbiddenException('This topic is locked');
    }

    const settings =
      dto.isPinned !== undefined ||
      dto.isLocked !== undefined ||
      dto.isPublished !== undefined ||
      dto.requireInitialPost !== undefined;
    if (settings && !this.isStaff(ctx)) {
      throw new ForbiddenException('Only course staff can change topic settings');
    }

    const changes: Prisma.discussion_topicUncheckedUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Give the topic a title');
      changes.title = title;
    }
    if (dto.body !== undefined) changes.body = dto.body;
    if (changes.title !== undefined || changes.body !== undefined) {
      changes.edited_at = new Date();
    }
    if (dto.isPinned !== undefined) changes.is_pinned = dto.isPinned;
    if (dto.isLocked !== undefined) changes.is_locked = dto.isLocked;
    if (dto.isPublished !== undefined) changes.is_published = dto.isPublished;
    if (dto.requireInitialPost !== undefined) {
      changes.require_initial_post = dto.requireInitialPost;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date();

    let data: TopicRecord;
    try {
      data = await this.prisma.discussion_topic.update({
        where: { id: topic.id },
        data: changes,
        select: TOPIC_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to update topic: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update the topic');
    }

    if (!topic.is_published && data.is_published) this.announceTopic(data);
    return { ...this.toTopicSummary(ctx, data), body: data.body };
  }

  /**
   * Replies go with the topic. A student may remove their own topic only
   * while nobody else has answered it - other students' posts are not theirs
   * to take down.
   */
  async remove(ctx: DiscussionCtx, topicId: string) {
    const topic = await this.loadTopic(ctx, topicId);
    const isAuthor = topic.author_user_profile_id === ctx.userId;
    if (!isAuthor && !this.isModerator(ctx)) {
      throw new ForbiddenException('You can only delete topics you started');
    }

    if (!this.isStaff(ctx)) {
      this.assertOpen(ctx);
      const others = await this.prisma.discussion_reply.count({
        where: {
          topic_id: topic.id,
          deleted_at: null,
          NOT: { author_user_profile_id: ctx.userId },
        },
      });
      if (others > 0) {
        throw new ConflictException(
          'Others have replied to this topic; ask your teacher to remove it',
        );
      }
    }

    await this.prisma.discussion_topic.deleteMany({ where: { id: topic.id } });
  }

  // ── replies ───────────────────────────────────────────────────────────────

  async reply(ctx: DiscussionCtx, topicId: string, dto: CreateReplyDto) {
    const topic = await this.loadTopic(ctx, topicId);
    this.assertOpen(ctx);
    if (!this.canReply(ctx, topic)) {
      throw new ForbiddenException('This topic is locked');
    }

    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Write something first');

    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.discussion_reply.findFirst({
        where: { id: dto.parentId, topic_id: topic.id },
        select: { id: true, parent_id: true, deleted_at: true },
      });
      if (!parent) throw new NotFoundException('Reply not found');
      if (parent.deleted_at) {
        throw new BadRequestException('That post was deleted');
      }
      // One level deep: an answer to a nested reply joins its thread.
      parentId = parent.parent_id ?? parent.id;
    }

    let data: ReplyRecord;
    try {
      const now = new Date();
      [data] = await this.prisma.$transaction([
        this.prisma.discussion_reply.create({
          data: {
            topic_id: topic.id,
            course_id: ctx.course.id,
            parent_id: parentId,
            author_user_profile_id: ctx.userId,
            body,
            created_at: now,
          },
          select: REPLY_SELECT,
        }),
        this.prisma.discussion_topic.update({
          where: { id: topic.id },
          data: { last_reply_at: now },
          select: { id: true },
        }),
      ]);
    } catch (err) {
      this.logger.error(`Failed to post reply: ${(err as Error).message}`);
      throw new BadRequestException('Failed to post the reply');
    }

    // Fire and forget: posting never waits on notices or pushes.
    void this.notices?.discussionReplied(
      ctx.course.id,
      {
        id: topic.id,
        title: topic.title,
        authorUserProfileId: topic.author_user_profile_id,
      },
      { authorUserProfileId: ctx.userId, body },
    );

    return { ...this.toReply(ctx, data, null), replies: [] };
  }

  async updateReply(
    ctx: DiscussionCtx,
    topicId: string,
    replyId: string,
    dto: UpdateReplyDto,
  ) {
    const topic = await this.loadTopic(ctx, topicId);
    const reply = await this.loadReply(topic.id, replyId);
    if (reply.author_user_profile_id !== ctx.userId && !this.isModerator(ctx)) {
      throw new ForbiddenException('You can only edit your own posts');
    }
    if (!this.isStaff(ctx)) {
      this.assertOpen(ctx);
      if (topic.is_locked) throw new ForbiddenException('This topic is locked');
    }

    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Write something first');

    let data: ReplyRecord;
    try {
      data = await this.prisma.discussion_reply.update({
        where: { id: reply.id },
        data: { body, edited_at: new Date() },
        select: REPLY_SELECT,
      });
    } catch (err) {
      this.logger.error(`Failed to update reply: ${(err as Error).message}`);
      throw new BadRequestException('Failed to update the reply');
    }
    return this.toReply(ctx, data, null);
  }

  /**
   * A reply others have answered is blanked rather than removed, so their
   * answers keep their place ("This post was deleted"). Removing the last
   * answer under such a placeholder takes the placeholder too.
   */
  async removeReply(ctx: DiscussionCtx, topicId: string, replyId: string) {
    const topic = await this.loadTopic(ctx, topicId);
    const reply = await this.loadReply(topic.id, replyId);
    if (reply.author_user_profile_id !== ctx.userId && !this.isModerator(ctx)) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    if (!this.isStaff(ctx)) this.assertOpen(ctx);

    const children = await this.prisma.discussion_reply.count({
      where: { parent_id: reply.id },
    });

    if (children > 0) {
      await this.prisma.discussion_reply.update({
        where: { id: reply.id },
        data: { body: '', deleted_at: new Date() },
        select: { id: true },
      });
      return;
    }

    await this.prisma.discussion_reply.deleteMany({ where: { id: reply.id } });

    if (reply.parent_id) {
      const parent = await this.prisma.discussion_reply.findUnique({
        where: { id: reply.parent_id },
        select: { deleted_at: true, _count: { select: { children: true } } },
      });
      if (parent?.deleted_at && parent._count.children === 0) {
        await this.prisma.discussion_reply.deleteMany({
          where: { id: reply.parent_id },
        });
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Tell the class a topic is up. Fire and forget; never throws. */
  private announceTopic(t: TopicRecord) {
    void this.notices?.discussionTopicPublished(t.course_id, {
      id: t.id,
      title: t.title,
      body: t.body,
      authorUserProfileId: t.author_user_profile_id,
    });
  }

  private isStaff(ctx: DiscussionCtx): boolean {
    return ctx.role !== 'student';
  }

  private isModerator(ctx: DiscussionCtx): boolean {
    return ctx.role !== 'student' && MANAGE_ROLES.includes(ctx.role);
  }

  private assertModerator(ctx: DiscussionCtx) {
    if (!this.isModerator(ctx)) {
      throw new ForbiddenException('Only the course teacher can do that in this course');
    }
  }

  /** No new posts in an archived course; it stays readable. */
  private assertOpen(ctx: DiscussionCtx) {
    if (ctx.course.status === 'archived') {
      throw new ForbiddenException('This course is archived');
    }
  }

  private canCreateTopic(ctx: DiscussionCtx, studentsCanCreateTopics: boolean) {
    if (ctx.course.status === 'archived') return false;
    return this.isStaff(ctx) || studentsCanCreateTopics;
  }

  /** Locked topics take no new replies, except a moderator's closing word. */
  private canReply(ctx: DiscussionCtx, topic: { is_locked: boolean }) {
    if (ctx.course.status === 'archived') return false;
    return !topic.is_locked || this.isModerator(ctx);
  }

  /** Course-scoped; a draft topic does not exist for a student. */
  private async loadTopic(ctx: DiscussionCtx, topicId: string): Promise<TopicRecord> {
    const topic = await this.prisma.discussion_topic.findFirst({
      where: {
        id: topicId,
        course_id: ctx.course.id,
        ...(this.isStaff(ctx) ? {} : { is_published: true }),
      },
      select: TOPIC_SELECT,
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  /** A deleted placeholder can't be edited or deleted again. */
  private async loadReply(topicId: string, replyId: string) {
    const reply = await this.prisma.discussion_reply.findFirst({
      where: { id: replyId, topic_id: topicId, deleted_at: null },
      select: { id: true, parent_id: true, author_user_profile_id: true },
    });
    if (!reply) throw new NotFoundException('Reply not found');
    return reply;
  }

  /** Live reply counts and the caller's unread counts, per topic in the course. */
  private async stats(ctx: DiscussionCtx): Promise<TopicStats[]> {
    return this.prisma.$queryRaw<TopicStats[]>`
      SELECT r.topic_id,
             count(*) FILTER (WHERE r.deleted_at IS NULL)::int AS reply_count,
             count(*) FILTER (
               WHERE r.deleted_at IS NULL
                 AND r.author_user_profile_id IS DISTINCT FROM ${ctx.userId}::uuid
                 AND (rd.last_read_at IS NULL OR r.created_at > rd.last_read_at)
             )::int AS unread_count
        FROM course.discussion_reply r
        LEFT JOIN course.discussion_read rd
          ON rd.topic_id = r.topic_id AND rd.user_profile_id = ${ctx.userId}::uuid
       WHERE r.course_id = ${ctx.course.id}::uuid
       GROUP BY r.topic_id`;
  }

  private toTopicSummary(ctx: DiscussionCtx, t: TopicRecord) {
    const isAuthor = t.author_user_profile_id === ctx.userId;
    return {
      id: t.id,
      courseId: t.course_id,
      title: t.title,
      isPinned: t.is_pinned,
      isLocked: t.is_locked,
      isPublished: t.is_published,
      requireInitialPost: t.require_initial_post,
      author: toAuthor(t.user_profile),
      isMine: isAuthor,
      canEdit: isAuthor || this.isModerator(ctx),
      lastReplyAt: isoDate(t.last_reply_at),
      editedAt: isoDate(t.edited_at),
      createdAt: isoDate(t.created_at)!,
      updatedAt: isoDate(t.updated_at)!,
    };
  }

  private toReply(ctx: DiscussionCtx, r: ReplyRecord, lastRead: Date | null) {
    const deleted = !!r.deleted_at;
    const isAuthor = r.author_user_profile_id === ctx.userId;
    return {
      id: r.id,
      parentId: r.parent_id,
      body: deleted ? '' : r.body,
      isDeleted: deleted,
      author: deleted ? null : toAuthor(r.user_profile),
      isMine: !deleted && isAuthor,
      canEdit: !deleted && (isAuthor || this.isModerator(ctx)),
      // New since the caller last opened the topic (never: everything is).
      isNew:
        !deleted && !isAuthor && (!lastRead || r.created_at > lastRead),
      editedAt: isoDate(r.edited_at),
      createdAt: isoDate(r.created_at)!,
    };
  }

  /** Top-level replies oldest first, each with its answers beneath. */
  private thread(ctx: DiscussionCtx, rows: ReplyRecord[], lastRead: Date | null) {
    type Node = ReturnType<DiscussionService['toReply']> & { replies: Node[] };
    const nodes = new Map<string, Node>();
    const top: Node[] = [];

    for (const r of rows) {
      nodes.set(r.id, { ...this.toReply(ctx, r, lastRead), replies: [] });
    }
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      const parent = r.parent_id ? nodes.get(r.parent_id) : undefined;
      if (parent) parent.replies.push(node);
      else top.push(node);
    }
    return top;
  }
}
