import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { copyOutcomeAlignments } from '@/mastery/outcome-evidence';
import { CourseAccessService, MANAGE_ROLES } from '../access/course-access.service';
import { CourseService } from '../course.service';
import { shiftOf, TX_OPTIONS } from '../course-copy.service';
import { CourseFileCopyService, stableUuid } from '../course-file-copy.service';
import { writeSnapshot } from '../course-snapshot';
import { libraryCaller } from './library-access';
import { LibraryService, type LibraryContent } from './library.service';
import type { ImportLibraryItemDto } from './library.dto';
import {
  LIBRARY_IMPORT_ATTEMPTS,
  LIBRARY_IMPORT_JOB_OPTS,
  LIBRARY_IMPORT_STALE_MS,
  QUEUE_LIBRARY_IMPORT,
  libraryImportJobId,
} from './library.constants';

/** What `start` stores in `library_import.options`. */
interface ImportOptions {
  /** ms to move dates by; null clears due dates. */
  shift: number | null;
  newCourse?: { name: string; code?: string | null; academicYearId?: string | null; termId?: string | null };
}

const IMPORT_SELECT = {
  id: true,
  version_id: true,
  school_id: true,
  requested_by: true,
  mode: true,
  target_course_id: true,
  options: true,
  status: true,
  files_total: true,
  files_done: true,
  result: true,
  notes: true,
  error: true,
  attempts: true,
  created_at: true,
  updated_at: true,
  finished_at: true,
  version: {
    select: {
      version: true,
      item: { select: { id: true, title: true } },
    },
  },
} as const;

type ImportRow = Prisma.library_importGetPayload<{ select: typeof IMPORT_SELECT }>;

/**
 * Importing a library version into an existing course (modules appended) or
 * a new draft course, as a background job with progress.
 *
 * `start` checks everything that can be checked up front - the caller may
 * see the item and edit the target (or create courses), and every file fits
 * the school's upload limit - so an over-limit template fails clearly before
 * anything is written. It records a `library_import` row and queues
 * `run(importId)`: on the `course-library-import` BullMQ queue with Redis,
 * otherwise in this process after the request answers.
 *
 * `run` is idempotent and resumable. File rows get ids fixed by the import
 * and the source file (`stableUuid`), so a re-run reserves the same rows and
 * re-copies the same keys; the content is written in one transaction that
 * first locks the import row and stops if it is already done, then marks it
 * done, so it is written at most once. `resumeStale` (on boot and every few
 * minutes) picks up imports a restart left behind.
 */
@Injectable()
export class LibraryImportService {
  private readonly logger = new Logger(LibraryImportService.name);
  /** Inline mode: the chain of runs (tests await it). */
  inflight: Promise<void> = Promise.resolve();
  /** Inline mode: delay before retry n is n x this. */
  inlineBackoffMs = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly files: CourseFileCopyService,
    private readonly library: LibraryService,
    @Optional()
    @InjectQueue(QUEUE_LIBRARY_IMPORT)
    private readonly queue?: Queue,
  ) {}

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  async start(userId: string, itemId: string, dto: ImportLibraryItemDto) {
    const caller = await libraryCaller(this.prisma, this.cache, userId);
    const item = await this.library.requireVisible(caller, itemId);
    if (item.unpublished_at) {
      throw new BadRequestException('This template has been unpublished');
    }
    const versionNo = dto.version ?? item.latest_version;
    const version = await this.prisma.library_item_version.findUnique({
      where: { item_id_version: { item_id: item.id, version: versionNo } },
      select: { id: true, content: true, file_count: true, file_bytes: true },
    });
    if (!version) throw new NotFoundException('Library item not found');
    const content = version.content as unknown as LibraryContent;
    const shift = shiftOf(dto);

    if (!!dto.targetCourseId === !!dto.newCourse) {
      throw new BadRequestException('Choose a course to import into, or a new course');
    }
    let targetCourseId: string | null = null;
    const options: ImportOptions = { shift };
    if (dto.targetCourseId) {
      const { course } = await this.access.require(userId, dto.targetCourseId, MANAGE_ROLES);
      if (course.school_id !== caller.schoolId) throw new NotFoundException('Course not found');
      targetCourseId = course.id;
    } else {
      if (!caller.keys.has('course:create')) {
        throw new ForbiddenException('Missing permission: course:create');
      }
      const name = dto.newCourse!.name.trim();
      if (!name) throw new BadRequestException('Give the course a name');
      await this.courses.validateLinks(caller.schoolId, dto.newCourse!);
      options.newCourse = {
        name,
        code: dto.newCourse!.code?.trim() || null,
        academicYearId: dto.newCourse!.academicYearId ?? null,
        termId: dto.newCourse!.termId ?? null,
      };
    }

    // Before anything is written: every file must fit the school's limit.
    await this.files.assertFits(content.files, caller.schoolId);

    const row = await this.prisma.library_import.create({
      data: {
        version_id: version.id,
        school_id: caller.schoolId,
        requested_by: userId,
        mode: targetCourseId ? 'append' : 'new_course',
        target_course_id: targetCourseId,
        options: options as unknown as Prisma.InputJsonValue,
        files_total: content.files.length,
        bytes_total: version.file_bytes,
      },
      select: IMPORT_SELECT,
    });
    await this.enqueue(row.id);
    return this.toImport(row);
  }

  /** The caller's own import; anyone else's reads as not found. */
  async status(userId: string, importId: string) {
    const row = await this.prisma.library_import.findUnique({
      where: { id: importId },
      select: IMPORT_SELECT,
    });
    if (!row || row.requested_by !== userId) throw new NotFoundException('Import not found');
    return this.toImport(row);
  }

  /** The caller's recent imports. */
  async listMine(userId: string) {
    const rows = await this.prisma.library_import.findMany({
      where: { requested_by: userId },
      select: IMPORT_SELECT,
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.toImport(r));
  }

  private async enqueue(importId: string) {
    if (this.queue) {
      await this.queue.add(
        'import',
        { importId },
        { ...LIBRARY_IMPORT_JOB_OPTS, jobId: libraryImportJobId(importId) },
      );
      return;
    }
    this.inflight = this.inflight.then(() => this.runInline(importId));
  }

  /** Inline fallback: the attempts left, with a short backoff; never throws. */
  private async runInline(importId: string): Promise<void> {
    for (let attempt = 1; attempt <= LIBRARY_IMPORT_ATTEMPTS; attempt++) {
      try {
        await this.run(importId, { final: attempt === LIBRARY_IMPORT_ATTEMPTS });
        return;
      } catch (error) {
        this.logger.warn(
          `Library import ${importId} failed, attempt ${attempt}: ${(error as Error).message}`,
        );
        if (attempt < LIBRARY_IMPORT_ATTEMPTS && this.inlineBackoffMs > 0) {
          await new Promise((r) => setTimeout(r, this.inlineBackoffMs * attempt));
        }
      }
    }
  }

  /**
   * Do (or finish) one import. Throws to be retried; on the final attempt the
   * import is marked failed and its reserved files discarded instead.
   */
  async run(importId: string, { final }: { final: boolean }): Promise<'done' | 'skipped' | 'failed'> {
    const row = await this.prisma.library_import.findUnique({
      where: { id: importId },
      select: {
        ...IMPORT_SELECT,
        version: {
          select: {
            version: true,
            content: true,
            item: { select: { id: true, title: true, source_course_id: true } },
          },
        },
      },
    });
    if (!row || row.status === 'done' || row.status === 'failed') return 'skipped';
    const content = row.version.content as unknown as LibraryContent;
    const options = (row.options ?? {}) as unknown as ImportOptions;
    const owner = { schoolId: row.school_id, ownerId: row.requested_by };
    const idFor = (f: { id: string }) => stableUuid('library-import', row.id, f.id);

    await this.prisma.library_import.update({
      where: { id: row.id },
      data: { status: 'copying', attempts: { increment: 1 }, updated_at: new Date(), error: null },
    });

    let fileIds = new Map<string, string>();
    try {
      fileIds = await this.files.reserve(content.files, owner, idFor);
      await this.files.copyObjects(content.files, fileIds, owner, async (done) => {
        await this.prisma.library_import.update({
          where: { id: row.id },
          data: { files_done: done, updated_at: new Date() },
        });
      });
      const tools = content.items
        .map((i) => i.externalTool?.toolId)
        .filter((id): id is string => !!id);
      const lti = await this.files.ltiDeployments(row.school_id, tools);

      const outcome = await this.prisma.$transaction(async (tx) => {
        // Claim the row with a compare-and-set update, which also holds its
        // row lock to the end of the transaction: whoever gets here second
        // waits, then finds it no longer copying and stops.
        const claimed = await tx.library_import.updateMany({
          where: { id: row.id, status: 'copying' },
          data: { updated_at: new Date() },
        });
        if (claimed.count !== 1) return 'skipped' as const;

        let targetId = row.target_course_id;
        if (row.mode === 'new_course') {
          const nc = options.newCourse!;
          const course = await tx.course.create({
            data: {
              school_id: row.school_id,
              academic_year_id: nc.academicYearId ?? null,
              term_id: nc.termId ?? null,
              name: nc.name,
              code: nc.code ?? null,
              description: content.description,
              banner_color: content.bannerColor,
              created_by: row.requested_by,
            },
            select: { id: true },
          });
          await tx.course_staff.create({
            data: { course_id: course.id, user_profile_id: row.requested_by, role: 'teacher' },
          });
          if (content.discussion) {
            await tx.discussion_setting.create({
              data: {
                course_id: course.id,
                students_can_create_topics: content.discussion.studentsCanCreateTopics,
              },
            });
          }
          targetId = course.id;
        }
        if (!targetId) throw new Error('The course to import into no longer exists');

        const written = await writeSnapshot(tx, content, {
          targetId,
          userId: row.requested_by,
          shift: options.shift === undefined ? 0 : options.shift,
          fileIds,
          ltiDeployments: lti.deployments,
          toolNames: lti.names,
        });
        // Learning outcomes and alignments still on the source course
        // (src/mastery); another school's school-level outcomes are skipped.
        if (row.version.item.source_course_id) {
          await copyOutcomeAlignments(tx, {
            sourceCourseId: row.version.item.source_course_id,
            targetCourseId: targetId,
            activityIds: written.ids,
            criterionIds: written.ids,
            questionIds: written.ids,
            userId: row.requested_by,
          });
        }
        await this.files.markReady(tx, fileIds.values());
        await tx.library_import.update({
          where: { id: row.id },
          data: {
            status: 'done',
            target_course_id: targetId,
            files_done: content.files.length,
            result: written.counts as unknown as Prisma.InputJsonValue,
            notes: written.notes,
            finished_at: new Date(),
            updated_at: new Date(),
          },
        });
        return 'done' as const;
      }, TX_OPTIONS);
      if (outcome === 'done' && row.mode === 'new_course') {
        const created = await this.prisma.library_import.findUnique({
          where: { id: row.id },
          select: { target_course_id: true },
        });
        if (created?.target_course_id) {
          this.courses.announceCreated?.(created.target_course_id, row.requested_by);
        }
      }
      return outcome;
    } catch (error) {
      const message = (error as Error).message;
      if (!final) throw error;
      this.logger.error(`Library import ${row.id} failed: ${message}`);
      await this.files.discard(fileIds.values());
      await this.prisma.library_import.updateMany({
        where: { id: row.id, status: { not: 'done' } },
        data: {
          status: 'failed',
          error: 'The import could not be completed. Nothing was added; try again.',
          finished_at: new Date(),
          updated_at: new Date(),
        },
      });
      return 'failed';
    }
  }

  /**
   * Imports a restart left behind (queued or copying, untouched for
   * LIBRARY_IMPORT_STALE_MS): run again with the attempts they have left,
   * or marked failed when none are left.
   */
  async resumeStale(now = new Date()): Promise<{ resumed: number; failed: number }> {
    const stale = await this.prisma.library_import.findMany({
      where: {
        status: { in: ['queued', 'copying'] },
        updated_at: { lt: new Date(now.getTime() - LIBRARY_IMPORT_STALE_MS) },
      },
      select: { id: true, attempts: true },
      take: 100,
    });
    let resumed = 0;
    let failed = 0;
    for (const s of stale) {
      if (s.attempts >= LIBRARY_IMPORT_ATTEMPTS) {
        await this.run(s.id, { final: true }).catch(() => undefined);
        failed++;
        continue;
      }
      // Touch it so another instance's sweep does not pick it up too.
      await this.prisma.library_import.update({
        where: { id: s.id },
        data: { updated_at: now },
      });
      if (this.queue) {
        await this.queue.add(
          'import',
          { importId: s.id },
          { ...LIBRARY_IMPORT_JOB_OPTS, jobId: `${libraryImportJobId(s.id)}-resume-${now.getTime()}` },
        );
      } else {
        this.inflight = this.inflight.then(() => this.runInline(s.id));
      }
      resumed++;
    }
    return { resumed, failed };
  }

  private toImport(r: ImportRow) {
    return {
      id: r.id,
      itemId: r.version.item.id,
      itemTitle: r.version.item.title,
      version: r.version.version,
      mode: r.mode as 'append' | 'new_course',
      targetCourseId: r.target_course_id,
      status: r.status as 'queued' | 'copying' | 'done' | 'failed',
      filesTotal: r.files_total,
      filesDone: r.files_done,
      result: r.result,
      notes: stringList(r.notes),
      error: r.error,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }
}

function stringList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
