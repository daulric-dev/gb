import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { CacheService } from '@/cache/cache.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { plan } from '@/erasure/erasure-plan';
import { FileManagerService } from '@/file-manager/file-manager.service';
import { loadEffectivePermissions } from '@/permission/permission.effective';
import { csvCell } from '@/grading/gradebook.service';
import { isUniqueViolation } from '@/common/db-values';
import {
  canChangeNote,
  canSeeNote,
  canWriteIn,
  hasAnyPastoralKey,
  pastoralCaller,
  visibleNotes,
  type PastoralCaller,
} from './pastoral-access';
import { DEFAULT_CATEGORIES, MAX_NOTES } from './pastoral.constants';
import type {
  CreatePastoralCategoryDto,
  CreatePastoralNoteDto,
  PastoralNoteQueryDto,
  UpdatePastoralCategoryDto,
  UpdatePastoralNoteDto,
  UpdatePastoralSettingsDto,
} from './pastoral.dto';

type Tx = Prisma.TransactionClient;

const NOTE_SELECT = {
  id: true,
  school_id: true,
  student_id: true,
  category_id: true,
  is_safeguarding: true,
  severity: true,
  occurred_on: true,
  body: true,
  follow_up_on: true,
  assigned_to: true,
  status: true,
  resolved_at: true,
  resolved_by: true,
  author_id: true,
  created_at: true,
  updated_at: true,
  category: { select: { label: true, kind: true } },
  student: { select: { first_name: true, last_name: true, student_number: true } },
  author: { select: { first_name: true, last_name: true } },
  assignee: { select: { first_name: true, last_name: true } },
  files: {
    select: { file: { select: { id: true, name: true, content_type: true, size_bytes: true, deleted_at: true } } },
  },
} as const;

type NoteRow = Prisma.pastoral_noteGetPayload<{ select: typeof NOTE_SELECT }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const fullName = (p: { first_name: string | null; last_name: string | null } | null) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null : null;

/**
 * Behaviour and pastoral notes: private staff notes about a student
 * (feature `pastoral_notes`).
 *
 * Every rule lives here, from `pastoral-access.ts`: `pastoral-note:read` sees
 * the school's notes, `:create` writes them, `:update` edits, resolves and
 * deletes them, and `:safeguarding` is needed on top for anything in a
 * safeguarding category. Authors always see their own notes. Every read of a
 * safeguarding note (opening it, a timeline or list that includes it, an
 * export) writes an audit entry with action `read`.
 *
 * Nothing else in the API reads these tables: there is no student, parent,
 * report card, webhook or LTI path to them. Audit entries carry ids and
 * settings only (never the text) and are never sent to webhooks
 * (`PRIVATE_AUDIT_ENTITIES`). Deleting a note is an erasure, written to the
 * erasure log in the same transaction.
 */
@Injectable()
export class PastoralService {
  private readonly logger = new Logger(PastoralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditLogService,
    private readonly erasure: ErasureLogService,
    private readonly files: FileManagerService,
  ) {}

  caller(userId: string) {
    return pastoralCaller(this.prisma, this.cache, userId);
  }

  /** What the caller may do, for the apps to show the right controls. */
  async me(userId: string) {
    const c = await this.caller(userId);
    return {
      canRead: c.read,
      canCreate: c.create,
      canUpdate: c.update,
      canSafeguard: c.safeguarding,
      canManageSettings: c.admin,
    };
  }

  // ── categories and settings ───────────────────────────────────────────────

  /** The school's categories; safeguarding ones only for `safeguarding`. */
  async categories(userId: string, includeArchived = false) {
    const c = await this.caller(userId);
    if (!hasAnyPastoralKey(c) && !c.admin) throw new ForbiddenException('Missing permission: pastoral-note:read');
    await this.ensureCategories(c.schoolId);
    const rows = await this.prisma.pastoral_category.findMany({
      where: {
        school_id: c.schoolId,
        ...(c.safeguarding || c.admin ? {} : { is_safeguarding: false }),
        ...(includeArchived ? {} : { archived_at: null }),
      },
      orderBy: [{ position: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      isSafeguarding: r.is_safeguarding,
      position: r.position,
      archived: !!r.archived_at,
    }));
  }

  private async ensureCategories(schoolId: string) {
    const count = await this.prisma.pastoral_category.count({ where: { school_id: schoolId } });
    if (count > 0) return;
    await this.prisma.pastoral_category.createMany({
      data: DEFAULT_CATEGORIES.map((d, i) => ({
        school_id: schoolId,
        label: d.label,
        kind: d.kind,
        is_safeguarding: d.safeguarding,
        position: i,
      })),
      skipDuplicates: true,
    });
  }

  async createCategory(userId: string, dto: CreatePastoralCategoryDto) {
    const c = await this.requireAdmin(userId);
    const label = dto.label.trim();
    const isSafeguarding = dto.kind === 'safeguarding' || !!dto.isSafeguarding;
    try {
      await this.prisma.$transaction(async (tx) => {
        const last = await tx.pastoral_category.aggregate({
          where: { school_id: c.schoolId },
          _max: { position: true },
        });
        const row = await tx.pastoral_category.create({
          data: {
            school_id: c.schoolId,
            label,
            kind: dto.kind,
            is_safeguarding: isSafeguarding,
            position: (last?._max?.position ?? -1) + 1,
          },
        });
        await this.audit.record(tx, c.schoolId, { id: userId }, {
          entity: 'pastoral_category',
          entityId: row.id,
          action: 'create',
          changes: auditChanges(null, { label, kind: dto.kind, is_safeguarding: isSafeguarding }),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BadRequestException('A category with that name already exists');
      throw error;
    }
    return this.categories(userId, true);
  }

  /**
   * Rename, reorder, archive, or change whether a category is safeguarding.
   * Its notes follow the safeguarding flag in the same transaction.
   */
  async updateCategory(userId: string, categoryId: string, dto: UpdatePastoralCategoryDto) {
    const c = await this.requireAdmin(userId);
    const cat = await this.prisma.pastoral_category.findFirst({
      where: { id: categoryId, school_id: c.schoolId },
    });
    if (!cat) throw new NotFoundException('Category not found');
    if (dto.isSafeguarding === false && cat.kind === 'safeguarding') {
      throw new BadRequestException('A safeguarding category is always restricted');
    }
    const data: Prisma.pastoral_categoryUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.archived !== undefined) data.archived_at = dto.archived ? (cat.archived_at ?? new Date()) : null;
    if (dto.isSafeguarding !== undefined) data.is_safeguarding = dto.isSafeguarding;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.pastoral_category.update({ where: { id: cat.id }, data });
        if (dto.isSafeguarding !== undefined && dto.isSafeguarding !== cat.is_safeguarding) {
          await tx.pastoral_note.updateMany({
            where: { category_id: cat.id },
            data: { is_safeguarding: dto.isSafeguarding },
          });
        }
        await this.audit.record(tx, c.schoolId, { id: userId }, {
          entity: 'pastoral_category',
          entityId: cat.id,
          action: 'update',
          changes: auditChanges(
            { label: cat.label, is_safeguarding: cat.is_safeguarding, archived: !!cat.archived_at, position: cat.position },
            {
              label: dto.label?.trim() ?? cat.label,
              is_safeguarding: dto.isSafeguarding ?? cat.is_safeguarding,
              archived: dto.archived ?? !!cat.archived_at,
              position: dto.position ?? cat.position,
            },
          ),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BadRequestException('A category with that name already exists');
      throw error;
    }
    return this.categories(userId, true);
  }

  async settings(userId: string) {
    const c = await this.caller(userId);
    if (!c.admin && !hasAnyPastoralKey(c)) throw new ForbiddenException('Missing permission: pastoral-note:read');
    const row = await this.prisma.pastoral_setting.findUnique({ where: { school_id: c.schoolId } });
    return { retentionDays: row?.retention_days ?? null };
  }

  async updateSettings(userId: string, dto: UpdatePastoralSettingsDto) {
    const c = await this.requireAdmin(userId);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.pastoral_setting.findUnique({ where: { school_id: c.schoolId } });
      await tx.pastoral_setting.upsert({
        where: { school_id: c.schoolId },
        create: { school_id: c.schoolId, retention_days: dto.retentionDays },
        update: { retention_days: dto.retentionDays, updated_at: new Date() },
      });
      await this.audit.record(tx, c.schoolId, { id: userId }, {
        entity: 'pastoral_setting',
        entityId: c.schoolId,
        action: 'update',
        changes: auditChanges(
          { retention_days: before?.retention_days ?? null },
          { retention_days: dto.retentionDays },
        ),
      });
    });
    return { retentionDays: dto.retentionDays };
  }

  private async requireAdmin(userId: string) {
    const c = await this.caller(userId);
    if (!c.admin) throw new ForbiddenException('Missing permission: school:update');
    return c;
  }

  /**
   * Staff a follow-up can go to: members of the school who can read the
   * note (and, for a safeguarding note, hold the safeguarding key).
   */
  async assignees(userId: string, safeguarding: boolean) {
    const c = await this.caller(userId);
    if (!hasAnyPastoralKey(c)) throw new ForbiddenException('Missing permission: pastoral-note:read');
    const members = await this.prisma.school_management.findMany({
      where: { school_id: c.schoolId },
      select: { user_profile: { select: { id: true, first_name: true, last_name: true, email: true } } },
      take: 1000,
    });
    const out: { id: string; name: string }[] = [];
    for (const m of members) {
      const p = m.user_profile;
      if (!p) continue;
      const effective = await loadEffectivePermissions(this.prisma, this.cache, p.id, c.schoolId);
      const keys = new Set<string>(effective.keys);
      if (!keys.has('pastoral-note:read')) continue;
      if (safeguarding && !keys.has('pastoral-note:safeguarding')) continue;
      out.push({ id: p.id, name: fullName(p) ?? p.email ?? 'Staff member' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── notes ─────────────────────────────────────────────────────────────────

  /** Notes the caller may see, newest first, with filters. */
  async list(userId: string, q: PastoralNoteQueryDto) {
    const c = await this.caller(userId);
    if (!hasAnyPastoralKey(c)) throw new ForbiddenException('Missing permission: pastoral-note:read');
    if (q.studentId) await this.requireStudent(c, q.studentId);
    const rows = await this.prisma.pastoral_note.findMany({
      where: { AND: [visibleNotes(c), this.filters(q)] },
      select: NOTE_SELECT,
      orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
      take: MAX_NOTES,
    });
    await this.auditSafeguardingReads(c, rows);
    return rows.map((r) => this.toNote(r, c));
  }

  /** One student's timeline. */
  async timeline(userId: string, studentId: string, q: PastoralNoteQueryDto) {
    return this.list(userId, { ...q, studentId });
  }

  /** Open notes assigned to the caller with a follow-up date, soonest first. */
  async myFollowUps(userId: string) {
    const c = await this.caller(userId);
    const rows = await this.prisma.pastoral_note.findMany({
      where: {
        AND: [visibleNotes(c), { assigned_to: c.userId, status: 'open' }],
      },
      select: NOTE_SELECT,
      orderBy: [{ follow_up_on: { sort: 'asc', nulls: 'last' } }, { occurred_on: 'desc' }],
      take: MAX_NOTES,
    });
    await this.auditSafeguardingReads(c, rows);
    return rows.map((r) => this.toNote(r, c));
  }

  async get(userId: string, noteId: string) {
    const c = await this.caller(userId);
    const row = await this.requireVisible(c, noteId);
    await this.auditSafeguardingReads(c, [row]);
    return this.toNote(row, c);
  }

  async create(userId: string, studentId: string, dto: CreatePastoralNoteDto) {
    const c = await this.caller(userId);
    if (!c.create) throw new ForbiddenException('Missing permission: pastoral-note:create');
    await this.requireStudent(c, studentId);
    const category = await this.requireCategory(c, dto.categoryId, true);
    if (dto.assignedTo) await this.requireAssignee(c, dto.assignedTo, category.is_safeguarding);
    const fileIds = await this.ownFiles(c, dto.fileIds ?? []);

    const id = await this.prisma.$transaction(async (tx) => {
      const note = await tx.pastoral_note.create({
        data: {
          school_id: c.schoolId,
          student_id: studentId,
          category_id: category.id,
          is_safeguarding: category.is_safeguarding,
          severity: dto.severity ?? 'low',
          occurred_on: asDate(dto.occurredOn),
          body: dto.body.trim(),
          follow_up_on: dto.followUpOn ? asDate(dto.followUpOn) : null,
          assigned_to: dto.assignedTo ?? null,
          author_id: c.userId,
        },
        select: { id: true },
      });
      if (fileIds.length > 0) {
        await tx.pastoral_note_file.createMany({
          data: fileIds.map((file_id) => ({ note_id: note.id, file_id })),
          skipDuplicates: true,
        });
      }
      await this.audit.record(tx, c.schoolId, { id: c.userId }, {
        entity: 'pastoral_note',
        entityId: note.id,
        action: 'create',
        changes: auditChanges(null, {
          student_id: studentId,
          category_id: category.id,
          is_safeguarding: category.is_safeguarding,
          severity: dto.severity ?? 'low',
          assigned_to: dto.assignedTo ?? null,
          attachments: fileIds.length,
        }),
      });
      return note.id;
    });
    return this.get(userId, id);
  }

  async update(userId: string, noteId: string, dto: UpdatePastoralNoteDto) {
    const c = await this.caller(userId);
    const note = await this.requireVisible(c, noteId);
    if (!canChangeNote(c, note)) {
      throw new ForbiddenException('You cannot change this note');
    }
    let isSafeguarding = note.is_safeguarding;
    const data: Prisma.pastoral_noteUncheckedUpdateInput = { updated_at: new Date() };
    if (dto.categoryId !== undefined && dto.categoryId !== note.category_id) {
      const category = await this.requireCategory(c, dto.categoryId, true);
      data.category_id = category.id;
      data.is_safeguarding = category.is_safeguarding;
      isSafeguarding = category.is_safeguarding;
    }
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.occurredOn !== undefined) data.occurred_on = asDate(dto.occurredOn);
    if (dto.body !== undefined) data.body = dto.body.trim();
    if (dto.followUpOn !== undefined) data.follow_up_on = dto.followUpOn ? asDate(dto.followUpOn) : null;
    const assignee = dto.assignedTo !== undefined ? dto.assignedTo : note.assigned_to;
    if (assignee && (dto.assignedTo !== undefined || isSafeguarding !== note.is_safeguarding)) {
      await this.requireAssignee(c, assignee, isSafeguarding);
    }
    if (dto.assignedTo !== undefined) data.assigned_to = dto.assignedTo;
    if (dto.status !== undefined && dto.status !== note.status) {
      data.status = dto.status;
      data.resolved_at = dto.status === 'resolved' ? new Date() : null;
      data.resolved_by = dto.status === 'resolved' ? c.userId : null;
    }
    let fileIds: string[] | undefined;
    if (dto.fileIds !== undefined) {
      const current = new Set(note.files.map((f) => f.file.id));
      // Attachments already on the note may stay; new ones must be your own.
      const added = await this.ownFiles(c, dto.fileIds.filter((id) => !current.has(id)));
      fileIds = [...new Set([...dto.fileIds.filter((id) => current.has(id)), ...added])];
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pastoral_note.update({ where: { id: note.id }, data });
      if (fileIds) {
        await tx.pastoral_note_file.deleteMany({
          where: { note_id: note.id, file_id: { notIn: fileIds } },
        });
        if (fileIds.length > 0) {
          await tx.pastoral_note_file.createMany({
            data: fileIds.map((file_id) => ({ note_id: note.id, file_id })),
            skipDuplicates: true,
          });
        }
      }
      await this.audit.record(tx, c.schoolId, { id: c.userId }, {
        entity: 'pastoral_note',
        entityId: note.id,
        action: 'update',
        changes: auditChanges(
          {
            category_id: note.category_id,
            is_safeguarding: note.is_safeguarding,
            severity: note.severity,
            occurred_on: day(note.occurred_on),
            follow_up_on: day(note.follow_up_on),
            assigned_to: note.assigned_to,
            status: note.status,
            text_edited: false,
            attachments: note.files.length,
          },
          {
            category_id: (data.category_id) ?? note.category_id,
            is_safeguarding: isSafeguarding,
            severity: dto.severity ?? note.severity,
            occurred_on: dto.occurredOn ?? day(note.occurred_on),
            follow_up_on: dto.followUpOn !== undefined ? dto.followUpOn : day(note.follow_up_on),
            assigned_to: dto.assignedTo !== undefined ? dto.assignedTo : note.assigned_to,
            status: dto.status ?? note.status,
            // Never the text itself: only that it changed.
            text_edited: dto.body !== undefined && dto.body.trim() !== note.body,
            attachments: fileIds ? fileIds.length : note.files.length,
          },
        ),
      });
    });
    return this.get(userId, note.id);
  }

  /**
   * Delete a note for good (an erasure): `update`, and `safeguarding` for a
   * safeguarding note. Written to the erasure log and the audit log in the
   * same transaction. Attached files stay in their owner's file manager.
   */
  async remove(userId: string, noteId: string) {
    const c = await this.caller(userId);
    const note = await this.requireVisible(c, noteId);
    if (!c.update || (note.is_safeguarding && !c.safeguarding)) {
      throw new ForbiddenException('You cannot delete this note');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.pastoral_note.deleteMany({ where: { id: note.id } });
      await this.erasure.record(tx, {
        kind: 'pastoral_note',
        subjectTable: 'student.pastoral_note',
        subjectIds: [note.id],
        schoolId: c.schoolId,
        actor: c.userId,
        reason: 'admin',
        replay: plan.of(plan.del('student.pastoral_note', { id: [note.id] })),
      });
      await this.audit.record(tx, c.schoolId, { id: c.userId }, {
        entity: 'pastoral_note',
        entityId: note.id,
        action: 'delete',
        changes: auditChanges(
          { student_id: note.student_id, is_safeguarding: note.is_safeguarding },
          null,
        ),
      });
    });
  }

  /** An attachment of a note the caller may see (streamed by the controller). */
  async readFile(userId: string, noteId: string, fileId: string) {
    const c = await this.caller(userId);
    const note = await this.requireVisible(c, noteId);
    if (!note.files.some((f) => f.file.id === fileId && !f.file.deleted_at)) {
      throw new NotFoundException('File not found');
    }
    await this.auditSafeguardingReads(c, [note]);
    return this.files.readContentForAuthorisedCaller(fileId);
  }

  /**
   * The staff CSV export: the notes the caller may see under the same rules
   * (and `read` is required), safeguarding reads audited. The only export
   * of pastoral notes anywhere.
   */
  async exportCsv(userId: string, q: PastoralNoteQueryDto) {
    const c = await this.caller(userId);
    if (!c.read) throw new ForbiddenException('Missing permission: pastoral-note:read');
    if (q.studentId) await this.requireStudent(c, q.studentId);
    const rows = await this.prisma.pastoral_note.findMany({
      where: { AND: [visibleNotes(c), this.filters(q)] },
      select: NOTE_SELECT,
      orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
      take: 10_000,
    });
    await this.auditSafeguardingReads(c, rows);
    const header = [
      'Date', 'Student', 'Student number', 'Category', 'Safeguarding', 'Severity', 'Status',
      'Author', 'Assigned to', 'Follow up by', 'Resolved at', 'Note',
    ];
    const lines = rows.map((r) => [
      day(r.occurred_on) ?? '',
      fullName(r.student) ?? '',
      r.student.student_number ?? '',
      r.category.label,
      r.is_safeguarding ? 'yes' : 'no',
      r.severity,
      r.status,
      fullName(r.author) ?? '',
      fullName(r.assignee) ?? '',
      day(r.follow_up_on) ?? '',
      r.resolved_at?.toISOString() ?? '',
      r.body,
    ]);
    const csv = [header, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const stamp = new Date().toISOString().slice(0, 10);
    return { csv, filename: `pastoral-notes-${stamp}.csv` };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private filters(q: PastoralNoteQueryDto): Prisma.pastoral_noteWhereInput {
    const where: Prisma.pastoral_noteWhereInput = {};
    if (q.studentId) where.student_id = q.studentId;
    if (q.categoryId) where.category_id = q.categoryId;
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (q.assignedTo) where.assigned_to = q.assignedTo;
    if (q.from || q.to) {
      where.occurred_on = {
        ...(q.from ? { gte: asDate(q.from) } : {}),
        ...(q.to ? { lte: asDate(q.to) } : {}),
      };
    }
    return where;
  }

  /** A note the caller may see; anything else (another school's too) is 404. */
  private async requireVisible(c: PastoralCaller, noteId: string): Promise<NoteRow> {
    const row = await this.prisma.pastoral_note.findUnique({
      where: { id: noteId },
      select: NOTE_SELECT,
    });
    if (!row || !canSeeNote(c, row)) throw new NotFoundException('Note not found');
    return row;
  }

  private async requireStudent(c: PastoralCaller, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, school_id: c.schoolId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
  }

  private async requireCategory(c: PastoralCaller, categoryId: string, forWriting: boolean) {
    const category = await this.prisma.pastoral_category.findFirst({
      where: { id: categoryId, school_id: c.schoolId },
    });
    if (!category || (category.is_safeguarding && !c.safeguarding)) {
      throw new NotFoundException('Category not found');
    }
    if (forWriting) {
      if (category.archived_at) throw new BadRequestException('That category is archived');
      if (!canWriteIn(c, category)) {
        throw new ForbiddenException('You cannot write notes in this category');
      }
    }
    return category;
  }

  /** The follow-up owner must be staff of the school who can read the note. */
  private async requireAssignee(c: PastoralCaller, userId: string, safeguarding: boolean) {
    const effective = await loadEffectivePermissions(this.prisma, this.cache, userId, c.schoolId);
    const keys = new Set<string>(effective.keys);
    const ok =
      effective.member &&
      keys.has('pastoral-note:read') &&
      (!safeguarding || keys.has('pastoral-note:safeguarding'));
    if (!ok) {
      throw new BadRequestException(
        safeguarding
          ? 'Follow-ups on a safeguarding note can only go to staff with the safeguarding permission'
          : 'Follow-ups can only go to staff who can read pastoral notes',
      );
    }
  }

  /** Attachments must be the caller's own ready files in this school. */
  private async ownFiles(c: PastoralCaller, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.file.findMany({
      where: {
        id: { in: unique },
        owner_id: c.userId,
        school_id: c.schoolId,
        deleted_at: null,
        status: 'ready',
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException('You can only attach your own files');
    }
    return unique;
  }

  /** One `read` audit entry per safeguarding note the caller is shown. */
  private async auditSafeguardingReads(c: PastoralCaller, rows: NoteRow[]) {
    const safeguarding = rows.filter((r) => r.is_safeguarding);
    if (safeguarding.length === 0) return;
    await this.prisma.$transaction(async (tx: Tx) => {
      for (const r of safeguarding) {
        await this.audit.record(tx, c.schoolId, { id: c.userId }, {
          entity: 'pastoral_note',
          entityId: r.id,
          action: 'read',
          changes: { student_id: { before: null, after: r.student_id } },
        });
      }
    });
  }

  private toNote(r: NoteRow, c: PastoralCaller) {
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: fullName(r.student),
      categoryId: r.category_id,
      categoryLabel: r.category.label,
      categoryKind: r.category.kind,
      isSafeguarding: r.is_safeguarding,
      severity: r.severity,
      occurredOn: day(r.occurred_on),
      body: r.body,
      followUpOn: day(r.follow_up_on),
      assignedTo: r.assigned_to,
      assignedToName: fullName(r.assignee),
      status: r.status,
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      authorId: r.author_id,
      authorName: fullName(r.author),
      files: r.files
        .filter((f) => !f.file.deleted_at)
        .map((f) => ({
          id: f.file.id,
          name: f.file.name,
          contentType: f.file.content_type,
          sizeBytes: Number(f.file.size_bytes),
        })),
      canEdit: canChangeNote(c, r),
      canDelete: c.update && (!r.is_safeguarding || c.safeguarding),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}
