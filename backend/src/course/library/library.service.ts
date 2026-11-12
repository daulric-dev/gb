import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { objectKey } from '@/storage/keys';
import { isUniqueViolation } from '@/common/db-values';
import { CourseAccessService, MANAGE_ROLES } from '../access/course-access.service';
import { fileSlug } from '../course-file-copy.service';
import {
  isWholeCourse,
  readSnapshot,
  selectSnapshot,
  snapshotCounts,
  type CourseSnapshot,
  type SnapshotSelection,
} from '../course-snapshot';
import {
  assertMayShareWithOrganisation,
  canManageItem,
  ITEM_NOT_FOUND,
  libraryCaller,
  visibleWhere,
  type LibraryCaller,
} from './library-access';
import type {
  LibraryBrowseQueryDto,
  LibraryVisibility,
  PublishLibraryItemDto,
  RepublishLibraryItemDto,
  UpdateLibraryItemDto,
} from './library.dto';

/** Storage area of the library's own file copies. */
export const LIBRARY_BUCKET = 'course-library';

/** A stored version: the snapshot plus the selection it was made with. */
export type LibraryContent = CourseSnapshot & { selection?: SnapshotSelection | null };

const ITEM_SELECT = {
  id: true,
  school_id: true,
  source_course_id: true,
  title: true,
  description: true,
  subject: true,
  grade_level: true,
  tags: { select: { tag: true }, orderBy: { tag: 'asc' } },
  visibility: true,
  latest_version: true,
  created_by: true,
  unpublished_at: true,
  created_at: true,
  updated_at: true,
  school: { select: { name: true } },
  user_profile: { select: { first_name: true, last_name: true } },
} as const;

type ItemRow = Prisma.library_itemGetPayload<{ select: typeof ITEM_SELECT }>;

const clean = (v: string | undefined | null) => {
  const t = v?.trim();
  return t ? t : null;
};
const cleanTags = (tags?: string[]) =>
  tags === undefined
    ? undefined
    : [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

/**
 * The course template library: publish a course (or chosen modules, quizzes,
 * rubrics and pages) for your school or the whole organisation, browse and
 * preview what others published, republish (a new version; imports already
 * made keep their copy) and unpublish (hidden; imports unaffected).
 *
 * Publishing freezes the design as a JSON snapshot and copies every linked
 * file into the library's own storage (`course-library/<item>/<version>/`),
 * so a version never points at the author's files and keeps working after
 * the author changes or deletes them. Importing is `LibraryImportService`.
 */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly storage: StorageService,
  ) {}

  caller(userId: string) {
    return libraryCaller(this.prisma, this.cache, userId);
  }

  // ── browsing ──────────────────────────────────────────────────────────────

  async browse(userId: string, q: LibraryBrowseQueryDto) {
    const caller = await this.caller(userId);
    const and: Prisma.library_itemWhereInput[] = [];
    const scope = q.scope ?? 'all';
    if (scope === 'mine') {
      // Your own items, published or not, in your current school.
      and.push({ created_by: caller.userId, school_id: caller.schoolId });
    } else {
      and.push(visibleWhere(caller));
      if (scope === 'school') and.push({ school_id: caller.schoolId });
      if (scope === 'organisation') and.push({ visibility: 'organisation' });
    }
    if (q.sourceCourseId) {
      // Items from one course: only for someone who may see that course's
      // items (its own school).
      and.push({ source_course_id: q.sourceCourseId, school_id: caller.schoolId });
    }
    const text = q.q?.trim();
    if (text) {
      and.push({
        OR: [
          { title: { contains: text, mode: 'insensitive' } },
          { description: { contains: text, mode: 'insensitive' } },
          { subject: { contains: text, mode: 'insensitive' } },
          { tags: { some: { tag: text.toLowerCase() } } },
        ],
      });
    }
    if (q.subject?.trim()) {
      and.push({ subject: { equals: q.subject.trim(), mode: 'insensitive' } });
    }
    if (q.gradeLevel?.trim()) {
      and.push({ grade_level: { equals: q.gradeLevel.trim(), mode: 'insensitive' } });
    }
    if (q.tag?.trim()) and.push({ tags: { some: { tag: q.tag.trim().toLowerCase() } } });

    const rows = await this.prisma.library_item.findMany({
      where: { AND: and },
      select: {
        ...ITEM_SELECT,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, counts: true, file_count: true, file_bytes: true, created_at: true },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      ...this.toItem(r, caller),
      latest: r.versions[0]
        ? {
            version: r.versions[0].version,
            counts: r.versions[0].counts,
            fileCount: r.versions[0].file_count,
            fileBytes: Number(r.versions[0].file_bytes),
            publishedAt: r.versions[0].created_at.toISOString(),
          }
        : null,
    }));
  }

  /** An item the caller may see: published and visible, or one they manage. */
  async requireVisible(caller: LibraryCaller, itemId: string): Promise<ItemRow> {
    const item = await this.prisma.library_item.findUnique({
      where: { id: itemId },
      select: ITEM_SELECT,
    });
    if (!item) throw ITEM_NOT_FOUND();
    const visible =
      !item.unpublished_at &&
      (item.school_id === caller.schoolId || item.visibility === 'organisation');
    if (!visible && !canManageItem(caller, item)) throw ITEM_NOT_FOUND();
    return item;
  }

  /** One item with its versions and a read-only preview of one version. */
  async get(userId: string, itemId: string, version?: number) {
    const caller = await this.caller(userId);
    const item = await this.requireVisible(caller, itemId);
    const versions = await this.prisma.library_item_version.findMany({
      where: { item_id: item.id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        counts: true,
        file_count: true,
        file_bytes: true,
        note: true,
        created_at: true,
      },
    });
    const wanted = version ?? item.latest_version;
    const row = await this.prisma.library_item_version.findUnique({
      where: { item_id_version: { item_id: item.id, version: wanted } },
      select: { version: true, content: true },
    });
    if (!row) throw ITEM_NOT_FOUND();
    const content = row.content as unknown as LibraryContent;
    return {
      ...this.toItem(item, caller),
      versions: versions.map((v) => ({
        version: v.version,
        counts: v.counts,
        fileCount: v.file_count,
        fileBytes: Number(v.file_bytes),
        note: v.note,
        publishedAt: v.created_at.toISOString(),
      })),
      preview: { version: row.version, ...previewOf(content) },
    };
  }

  // ── publishing ────────────────────────────────────────────────────────────

  /**
   * Publish a new library item from a course the caller may edit (a manage
   * role on it). Organisation-wide visibility needs `course-library:create`.
   */
  async publish(userId: string, dto: PublishLibraryItemDto) {
    const caller = await this.caller(userId);
    const visibility: LibraryVisibility = dto.visibility ?? 'school';
    if (visibility === 'organisation') assertMayShareWithOrganisation(caller);
    const source = await this.requireSource(caller, dto.sourceCourseId);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Give the template a title');

    const itemId = randomUUID();
    const version = await this.createVersion(caller, itemId, source, dto.selection ?? null, null, async (tx) => {
      await tx.library_item.create({
        data: {
          id: itemId,
          school_id: caller.schoolId,
          source_course_id: source.id,
          title,
          description: clean(dto.description),
          subject: clean(dto.subject),
          grade_level: clean(dto.gradeLevel),
          tags: { create: (cleanTags(dto.tags) ?? []).map((tag) => ({ tag })) },
          visibility,
          latest_version: 1,
          created_by: caller.userId,
        },
      });
      return 1;
    });
    return this.get(userId, itemId, version);
  }

  /**
   * Publish a new version of an item from its source course. Earlier versions
   * stay as they were (and anything imported from them is untouched); the
   * item is listed again if it was unpublished.
   */
  async republish(userId: string, itemId: string, dto: RepublishLibraryItemDto) {
    const caller = await this.caller(userId);
    const item = await this.requireManageable(caller, itemId);
    if (!item.source_course_id) {
      throw new BadRequestException(
        'The course this template was published from no longer exists',
      );
    }
    const source = await this.requireSource(caller, item.source_course_id);
    let selection: SnapshotSelection | null | undefined = dto.selection;
    if (selection === undefined) {
      const previous = await this.prisma.library_item_version.findUnique({
        where: { item_id_version: { item_id: item.id, version: item.latest_version } },
        select: { content: true },
      });
      selection = (previous?.content as unknown as LibraryContent | undefined)?.selection ?? null;
    }
    const version = await this.createVersion(caller, item.id, source, selection, dto.note ?? null, async (tx) => {
      const updated = await tx.library_item.update({
        where: { id: item.id },
        data: {
          latest_version: { increment: 1 },
          unpublished_at: null,
          updated_at: new Date(),
        },
        select: { latest_version: true },
      });
      return updated.latest_version;
    });
    return this.get(userId, item.id, version);
  }

  /** Title, description, subject, grade level, tags and visibility. */
  async update(userId: string, itemId: string, dto: UpdateLibraryItemDto) {
    const caller = await this.caller(userId);
    const item = await this.requireManageable(caller, itemId);
    if (dto.visibility === 'organisation' && item.visibility !== 'organisation') {
      assertMayShareWithOrganisation(caller);
    }
    const data: Prisma.library_itemUpdateInput = { updated_at: new Date() };
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Give the template a title');
      data.title = title;
    }
    if (dto.description !== undefined) data.description = clean(dto.description);
    if (dto.subject !== undefined) data.subject = clean(dto.subject);
    if (dto.gradeLevel !== undefined) data.grade_level = clean(dto.gradeLevel);
    const tags = dto.tags !== undefined ? cleanTags(dto.tags) : undefined;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    await this.prisma.$transaction(async (tx) => {
      await tx.library_item.update({ where: { id: item.id }, data });
      if (tags !== undefined) {
        await tx.library_item_tag.deleteMany({ where: { item_id: item.id } });
        await tx.library_item_tag.createMany({ data: tags.map((tag) => ({ item_id: item.id, tag })) });
      }
    });
    return this.get(userId, item.id);
  }

  /** Hide an item from browsing and importing; imports already made stay. */
  async unpublish(userId: string, itemId: string) {
    const caller = await this.caller(userId);
    const item = await this.requireManageable(caller, itemId);
    await this.prisma.library_item.update({
      where: { id: item.id },
      data: { unpublished_at: item.unpublished_at ?? new Date(), updated_at: new Date() },
    });
    return { id: item.id, unpublished: true };
  }

  private async requireManageable(caller: LibraryCaller, itemId: string) {
    const item = await this.prisma.library_item.findUnique({
      where: { id: itemId },
      select: ITEM_SELECT,
    });
    if (!item) throw ITEM_NOT_FOUND();
    if (!canManageItem(caller, item)) {
      // Visible to them but not theirs: forbidden; otherwise not found.
      const visible =
        !item.unpublished_at &&
        (item.school_id === caller.schoolId || item.visibility === 'organisation');
      if (visible) {
        throw new ForbiddenException('Only the publisher or a school admin can change this template');
      }
      throw ITEM_NOT_FOUND();
    }
    return item;
  }

  /** A course in the caller's current school that they may edit. */
  private async requireSource(caller: LibraryCaller, courseId: string) {
    const { course } = await this.access.require(caller.userId, courseId, MANAGE_ROLES);
    if (course.school_id !== caller.schoolId) throw ITEM_NOT_FOUND();
    return course;
  }

  /**
   * Snapshot the source, copy its files into library storage, then write the
   * version in one transaction with `writeItem` (which returns the version
   * number). On failure the copied objects are removed.
   */
  private async createVersion(
    caller: LibraryCaller,
    itemId: string,
    source: { id: string; school_id: string; description: string | null; banner_color: string | null },
    selection: SnapshotSelection | null,
    note: string | null,
    writeItem: (tx: Prisma.TransactionClient) => Promise<number>,
  ): Promise<number> {
    const full = await readSnapshot(this.prisma, source);
    const snap = selectSnapshot(full, selection);
    if (
      snap.modules.length + snap.activities.length + snap.pages.length + snap.rubrics.length ===
      0
    ) {
      throw new BadRequestException('Choose at least one module, activity, page or rubric to publish');
    }

    const versionId = randomUUID();
    const copied: string[] = [];
    const files: CourseSnapshot['files'] = [];
    try {
      for (const f of snap.files) {
        const path = `${itemId}/${versionId}/${f.id}-${fileSlug(f.name)}`;
        const key = objectKey(LIBRARY_BUCKET, path);
        await this.storage.copy(objectKey(f.bucket, f.path), key, f.contentType);
        copied.push(key);
        files.push({ ...f, bucket: LIBRARY_BUCKET, path });
      }
      const content: LibraryContent = {
        ...snap,
        files,
        selection: isWholeCourse(selection) ? null : selection,
      };
      const counts = snapshotCounts(content);
      const bytes = files.reduce((n, f) => n + f.sizeBytes, 0);
      return await this.prisma.$transaction(async (tx) => {
        const version = await writeItem(tx);
        await tx.library_item_version.create({
          data: {
            id: versionId,
            item_id: itemId,
            version,
            content: content as unknown as Prisma.InputJsonValue,
            counts: counts,
            file_count: files.length,
            file_bytes: BigInt(bytes),
            note: clean(note),
            published_by: caller.userId,
          },
        });
        return version;
      });
    } catch (error) {
      if (copied.length > 0) {
        await this.storage.delete(copied).catch(() => undefined);
      }
      if (isUniqueViolation(error)) {
        throw new BadRequestException('Someone published a version at the same time; try again');
      }
      if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Failed to publish to the library: ${(error as Error).message}`);
      throw new BadRequestException('Failed to publish to the library');
    }
  }

  private toItem(r: ItemRow, caller: LibraryCaller) {
    const author = [r.user_profile?.first_name, r.user_profile?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      subject: r.subject,
      gradeLevel: r.grade_level,
      tags: r.tags.map(({ tag }) => tag),
      visibility: r.visibility as LibraryVisibility,
      latestVersion: r.latest_version,
      published: !r.unpublished_at,
      unpublishedAt: r.unpublished_at?.toISOString() ?? null,
      schoolName: r.school?.name ?? null,
      fromYourSchool: r.school_id === caller.schoolId,
      authorName: author || null,
      // Only your own school sees which course an item came from.
      sourceCourseId: r.school_id === caller.schoolId ? r.source_course_id : null,
      canManage: canManageItem(caller, r),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/**
 * A read-only view of a version: module outline with item titles, pages with
 * their text, activities with question counts, rubrics, files (names and
 * sizes). Nothing here links to the stored objects.
 */
export function previewOf(c: LibraryContent) {
  const pages = new Map(c.pages.map((p) => [p.id, p]));
  const activities = new Map(c.activities.map((a) => [a.id, a]));
  const topics = new Map(c.topics.map((t) => [t.id, t]));
  const files = new Map(c.files.map((f) => [f.id, f]));
  const titleOf = (i: LibraryContent['items'][number]) =>
    i.title ??
    (i.pageId && pages.get(i.pageId)?.title) ??
    (i.activityId && activities.get(i.activityId)?.title) ??
    (i.topicId && topics.get(i.topicId)?.title) ??
    (i.fileId && files.get(i.fileId)?.name) ??
    'Untitled';
  return {
    counts: snapshotCounts(c),
    selection: c.selection ?? null,
    modules: [...c.modules]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        id: m.id,
        title: m.title,
        items: c.items
          .filter((i) => i.moduleId === m.id)
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            type: i.itemType,
            title: titleOf(i),
            indent: i.indent,
            url: i.itemType === 'link' ? i.url : null,
          })),
      })),
    pages: c.pages.map((p) => ({ id: p.id, title: p.title, body: p.body })),
    activities: c.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      points: Number(a.points),
      instructions: a.instructions,
      questionCount: a.questions.length,
      questions: a.questions.map((q) => ({ prompt: q.prompt, kind: q.kind, points: Number(q.points) })),
    })),
    rubrics: c.rubrics.map((r) => ({
      id: r.id,
      title: r.title,
      criteria: r.criteria.map((x) => ({ title: x.title, points: Number(x.points) })),
    })),
    files: c.files.map((f) => ({ name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes })),
  };
}

