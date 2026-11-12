import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import {
  effectiveForSchool,
  organisationSettings,
} from '@/features/feature.catalog';
import { buildEnvelope } from '@/integrations/events/webhook-envelope';
import { validateEventData } from '@/integrations/events/webhook-event-types';
import { isForeignKeyViolation, isUniqueViolation } from '@/common/db-values';
import { userSchoolId } from '@/common/user-school';

export type AuditActor = {
  id: string;
};

export type AuditChange = {
  before: unknown;
  after: unknown;
};

export type AuditChanges = Record<string, AuditChange>;

export type AuditLogEntry = {
  entity: string;
  entityId: string | null;
  /**
   * `read` records an access, not a change (pastoral notes); `export` a
   * download of personal data (CSV exports), with its scope and row count.
   * Neither is sent to webhooks.
   */
  action: 'create' | 'update' | 'delete' | 'read' | 'export';
  changes: AuditChanges;
};

/**
 * Entities whose audit entries never leave the platform: no `audit.changed`
 * webhook is queued for them (pastoral notes and quiz accommodations, which
 * are health and welfare information, are never sent to webhooks). Their
 * entries carry ids and settings only, never note text or reasons.
 */
export const PRIVATE_AUDIT_ENTITIES: ReadonlySet<string> = new Set([
  'pastoral_note',
  'pastoral_category',
  'pastoral_setting',
  'activity_accommodation',
  'student_accommodation',
  'school_retention_setting',
]);

/**
 * Per entity, the only changed fields an `audit.changed` webhook may carry;
 * the audit log itself keeps every field. Entities not listed send all
 * their (already redacted) fields. `student`: names and enrolment, never
 * gender or date of birth.
 */
export const WEBHOOK_AUDIT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  student: ['first_name', 'last_name', 'enrollment_date', 'is_active'],
};

/** The changes an `audit.changed` webhook carries for this entity. */
export function webhookChanges(
  entity: string,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = WEBHOOK_AUDIT_FIELDS[entity];
  if (!allowed) return changes;
  return Object.fromEntries(
    Object.entries(changes).filter(([field]) => allowed.includes(field)),
  );
}

/** What `recordExport` writes: one entry per download. */
export type AuditExport = {
  /** What was exported, e.g. `gradebook`, `attendance`, `pastoral_note`. */
  entity: string;
  /** The course or student it was about, when there is one. */
  entityId?: string | null;
  /** `course`, `school` or `student`. */
  scope: string;
  /** The CSV as sent; its data rows are counted. Or give `rows`. */
  csv?: string;
  rows?: number;
  /** Filters or table choice that shaped the export (no personal data). */
  details?: Record<string, unknown>;
};

/** A staff or administrator opened personal data; details must describe the access, never the data. */
export type AuditRead = {
  entity: string;
  entityId?: string | null;
  /** The course's school is resolved when only courseId is supplied. */
  courseId?: string;
  schoolId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Data records in a CSV (header excluded), counting line breaks outside
 * quoted cells, so a multi-line cell is one record.
 */
export function csvRecordCount(csv: string): number {
  let records = 0;
  let quoted = false;
  let sawData = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      if (sawData) records++;
      sawData = false;
      continue;
    }
    sawData = true;
  }
  if (sawData) records++;
  return Math.max(records - 1, 0);
}

type RevertableEntity = 'academic_year' | 'term';
type RevertField = 'name' | 'start_date' | 'end_date' | 'sort_order';

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY =
  /(?:password|secret|token|credential|authorization|cookie|api.?key|private.?key|access.?key|join.?code|verification.?code|reset.?code)/i;
const MAX_VALUE_LENGTH = 16_384;

function safeValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LENGTH
      ? `${value.slice(0, MAX_VALUE_LENGTH)}… [truncated]`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => safeValue(item));
  }
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) return '[binary data]';
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        result[key] =
          nested !== null &&
          typeof nested === 'object' &&
          ('before' in nested || 'after' in nested)
            ? {
                before: '[redacted]',
                after: '[redacted]',
              }
            : '[redacted]';
      } else {
        result[key] = safeValue(nested);
      }
    }
    return result;
  }
  return typeof value === 'bigint' ? value.toString() : null;
}

export function auditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChanges {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const changes: AuditChanges = {};
  for (const key of keys) {
    const oldValue = before?.[key] ?? null;
    const newValue = after?.[key] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { before: oldValue, after: newValue };
    }
  }
  return changes;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async record(
    tx: Prisma.TransactionClient,
    schoolId: string | null,
    actor: AuditActor,
    entry: AuditLogEntry,
  ): Promise<void> {
    // A read or export is recorded even without changes; a write that
    // changed nothing is not.
    const access = entry.action === 'read' || entry.action === 'export';
    if (!access && Object.keys(entry.changes).length === 0) return;
    const [profile, school] = await Promise.all([
      tx.user_profile.findUnique({
        where: { id: actor.id },
        select: {
          first_name: true,
          last_name: true,
          email: true,
          app_user: { select: { email: true } },
        },
      }),
      schoolId
        ? tx.school.findUnique({
            where: { id: schoolId },
            select: { name: true, disabled_feature_rows: { select: { feature: true } } },
          })
        : Promise.resolve(null),
    ]);
    const actorName =
      [profile?.first_name, profile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || null;

    const auditRecord = await tx.audit_log.create({
      data: {
        scope: schoolId ? 'school' : 'organisation',
        school_id: schoolId,
        school_name: school?.name ?? null,
        actor_id: actor.id,
        actor_name: actorName,
        actor_email: profile?.app_user?.email ?? profile?.email ?? null,
        entity: entry.entity,
        entity_id: entry.entityId,
        action: entry.action,
        changes: safeValue(entry.changes) as Prisma.InputJsonValue,
      },
    });
    if (
      schoolId &&
      school &&
      !access &&
      !PRIVATE_AUDIT_ENTITIES.has(entry.entity)
    ) {
      const organisation = await tx.organisation.findFirst({
        select: { features: true },
      });
      if (
        effectiveForSchool(
          organisationSettings(organisation?.features),
          school.disabled_feature_rows.map(({ feature }) => feature),
        ).integrations
      ) {
        const hooks = await tx.school_webhook.findMany({
          where: {
            school_id: schoolId,
            enabled: true,
            event_subscriptions: { some: { event_type: 'audit.changed' } },
          },
          select: { id: true },
        });
        if (hooks.length > 0) {
          const data = {
            school: { id: schoolId, name: school.name ?? '' },
            audit: {
              id: auditRecord.id,
              entity: auditRecord.entity,
              entityId: auditRecord.entity_id,
              action: entry.action,
              actor: {
                id: actor.id,
                name: actorName,
                email: profile?.app_user?.email ?? profile?.email ?? null,
              },
              changes: webhookChanges(
                auditRecord.entity,
                auditRecord.changes as Record<string, unknown>,
              ),
              createdAt: auditRecord.created_at.toISOString(),
            },
          };
          const problems = validateEventData('audit.changed', data);
          if (problems.length) {
            this.logger.warn(
              `Webhook event audit.changed does not match its schema: ${problems.slice(0, 5).join('; ')}`,
            );
          }
          const envelope = buildEnvelope('audit.changed', data);
          await tx.webhook_delivery.createMany({
            data: hooks.map((hook) => ({
              webhook_id: hook.id,
              school_id: schoolId,
              event_id: auditRecord.id,
              event_type: 'audit.changed',
              payload: envelope as unknown as Prisma.InputJsonValue,
              status: 'pending',
            })),
          });
        }
      }
    }
  }

  /**
   * Record a download of personal data (a CSV export): who, what, the scope
   * and how many rows. The school is the course's when `courseId` is given,
   * else the caller's active school. Awaited before the file is sent, so an
   * export that cannot be audited is not sent.
   */
  async recordExport(
    actorId: string,
    entry: AuditExport & { courseId?: string; schoolId?: string | null },
  ): Promise<void> {
    let schoolId = entry.schoolId ?? null;
    if (!schoolId && entry.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: entry.courseId },
        select: { school_id: true },
      });
      schoolId = course?.school_id ?? null;
    }
    if (!schoolId) schoolId = await userSchoolId(this.prisma, actorId);
    const rows = entry.rows ?? (entry.csv !== undefined ? csvRecordCount(entry.csv) : 0);
    const changes: AuditChanges = {
      scope: { before: null, after: entry.scope },
      rows: { before: null, after: rows },
    };
    for (const [key, value] of Object.entries(entry.details ?? {})) {
      if (value !== undefined) changes[key] = { before: null, after: value };
    }
    await this.prisma.$transaction(async (tx) => {
      await this.record(tx, schoolId, { id: actorId }, {
        entity: entry.entity,
        entityId: entry.entityId ?? entry.courseId ?? null,
        action: 'export',
        changes,
      });
    });
  }

  /**
   * Record a read of personal data. Read events are deliberately excluded
   * from audit.changed webhooks; details should contain scope/count metadata,
   * never names, grades, note text or other personal data values.
   */
  async recordRead(actorId: string, entry: AuditRead): Promise<void> {
    let schoolId = entry.schoolId ?? null;
    if (!schoolId && entry.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: entry.courseId },
        select: { school_id: true },
      });
      schoolId = course?.school_id ?? null;
    }
    if (!schoolId) schoolId = await userSchoolId(this.prisma, actorId);
    const changes: AuditChanges = Object.fromEntries(
      Object.entries(entry.details ?? {}).map(([key, value]) => [key, { before: null, after: value }]),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.record(tx, schoolId, { id: actorId }, {
        entity: entry.entity,
        entityId: entry.entityId ?? entry.courseId ?? null,
        action: 'read',
        changes,
      });
    });
  }

  async list(
    options: { schoolId?: string; before?: string; limit?: number } = {},
  ) {
    const limit = Math.min(
      Math.max(options.limit ?? AUDIT_LOG_DEFAULT_LIMIT, 1),
      AUDIT_LOG_MAX_LIMIT,
    );
    const schoolFilter: Prisma.audit_logWhereInput = options.schoolId
      ? { school_id: options.schoolId }
      : {};
    let where: Prisma.audit_logWhereInput = schoolFilter;

    if (options.before) {
      if (!UUID.test(options.before))
        throw new BadRequestException('Invalid cursor');
      const cursor = await this.prisma.audit_log.findFirst({
        where: { id: options.before, ...schoolFilter },
        select: { id: true, created_at: true },
      });
      if (!cursor) throw new BadRequestException('Invalid cursor');
      where = {
        ...schoolFilter,
        OR: [
          { created_at: { lt: cursor.created_at } },
          { created_at: cursor.created_at, id: { lt: cursor.id } },
        ],
      };
    }

    let rows: Prisma.audit_logGetPayload<{
      include: { school: { select: { id: true; name: true } } };
    }>[];
    try {
      rows = await this.prisma.audit_log.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { school: { select: { id: true, name: true } } },
      });
    } catch (error) {
      this.logger.error(
        `Failed to load audit log: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new InternalServerErrorException('Failed to load audit log');
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        schoolId: row.school_id,
        schoolName: row.school?.name ?? row.school_name,
        actor: row.actor_id
          ? {
              id: row.actor_id,
              name: row.actor_name,
              email: row.actor_email,
            }
          : null,
        entity: row.entity,
        entityId: row.entity_id,
        action: row.action,
        changes: row.changes as Record<string, AuditChange>,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor:
        rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async revert(auditId: string, actor: AuditActor) {
    const audit = await this.prisma.audit_log.findUnique({
      where: { id: auditId },
    });
    if (!audit) throw new NotFoundException('Audit entry not found');
    if (audit.scope !== 'school' || !audit.school_id || !audit.entity_id) {
      throw new BadRequestException(
        'This audit entry cannot be reverted safely',
      );
    }
    if (audit.entity !== 'term' && audit.entity !== 'academic_year') {
      throw new BadRequestException(
        'Reverting this record type is not supported yet',
      );
    }

    const changes = readChanges(audit.changes);
    if (!changes) {
      throw new BadRequestException(
        'This audit entry does not contain enough information to revert',
      );
    }

    const entity = audit.entity;
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      throw new BadRequestException('This audit entry has no values to revert');
    }
    if (audit.action !== 'update' && audit.action !== 'create') {
      throw new BadRequestException(
        'Deleted records cannot be restored from this audit entry',
      );
    }

    let termCacheYearId: string | null = null;
    if (entity === 'term') {
      const term = await this.prisma.term.findFirst({
        where: {
          id: audit.entity_id,
          academic_year: { school_id: audit.school_id },
        },
        select: { academic_year_id: true },
      });
      if (!term) throw new ConflictException('The term no longer exists');
      termCacheYearId = term.academic_year_id;
    }

    if (audit.action === 'update') {
      if (entity === 'academic_year' && fields.includes('is_active')) {
        throw new BadRequestException(
          'Academic-year activation changes must be reverted by changing the active year explicitly',
        );
      }
      if (
        !fields.every(
          (field) =>
            isRevertField(field) &&
            (entity === 'term' || field !== 'sort_order'),
        )
      ) {
        throw new BadRequestException(
          'This audit entry contains fields that cannot be reverted safely',
        );
      }
      await this.revertUpdate(audit, actor, entity, changes);
    } else if (audit.action === 'create') {
      await this.revertCreate(audit, actor, entity, changes);
    }

    if (entity === 'term' && termCacheYearId) {
      await this.cache.delete(`terms:${termCacheYearId}`);
    } else {
      await this.cache.deleteByPrefix('academic-year');
    }

    return { message: 'Audit entry reverted' };
  }

  private async revertUpdate(
    audit: Prisma.audit_logGetPayload<Record<string, never>>,
    actor: AuditActor,
    entity: RevertableEntity,
    changes: AuditChanges,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (entity === 'term') {
          const current = await tx.term.findFirst({
            where: {
              id: audit.entity_id!,
              academic_year: { school_id: audit.school_id! },
            },
          });
          if (!current)
            throw new ConflictException('The term no longer exists');
          const data = revertData(changes);
          assertValuesMatch(current, changes, 'after');
          const result = await tx.term.updateMany({
            where: { id: current.id, ...revertData(changes, 'after') },
            data,
          });
          if (result.count !== 1) {
            throw new ConflictException(
              'The term has changed since this audit entry; refresh and review the latest values',
            );
          }
          await this.record(tx, audit.school_id, actor, {
            entity,
            entityId: current.id,
            action: 'update',
            changes: auditChanges(
              recordFields(current, changes),
              recordFields({ ...current, ...data }, changes),
            ),
          });
          return;
        }

        const current = await tx.academic_year.findFirst({
          where: { id: audit.entity_id!, school_id: audit.school_id! },
        });
        if (!current)
          throw new ConflictException('The academic year no longer exists');
        const data = revertData(changes);
        assertValuesMatch(current, changes, 'after');
        const result = await tx.academic_year.updateMany({
          where: {
            id: current.id,
            school_id: audit.school_id!,
            ...revertData(changes, 'after'),
          },
          data,
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'The academic year has changed since this audit entry; refresh and review the latest values',
          );
        }
        await this.record(tx, audit.school_id, actor, {
          entity,
          entityId: current.id,
          action: 'update',
          changes: auditChanges(
            recordFields(current, changes),
            recordFields({ ...current, ...data }, changes),
          ),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Reverting these values would conflict with another record',
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'The record is still in use and cannot be reverted safely',
        );
      }
      throw error;
    }
  }

  private async revertCreate(
    audit: Prisma.audit_logGetPayload<Record<string, never>>,
    actor: AuditActor,
    entity: RevertableEntity,
    changes: AuditChanges,
  ) {
    const createFields =
      entity === 'term'
        ? ['academic_year_id', 'name', 'start_date', 'end_date', 'sort_order']
        : ['name', 'start_date', 'end_date', 'is_active'];
    const requiredCreateFields =
      entity === 'term'
        ? createFields
        : ['name', 'start_date', 'end_date', 'is_active'];
    if (
      !Object.keys(changes).every((field) => createFields.includes(field)) ||
      !requiredCreateFields.every((field) => field in changes) ||
      (entity === 'academic_year' && changes.is_active?.after !== false)
    ) {
      throw new BadRequestException(
        'This audit entry does not contain a complete, safe record snapshot',
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        if (entity === 'term') {
          const current = await tx.term.findFirst({
            where: {
              id: audit.entity_id!,
              academic_year: { school_id: audit.school_id! },
            },
          });
          if (!current)
            throw new ConflictException('The term no longer exists');
          assertValuesMatch(current, changes, 'after');
          const result = await tx.term.deleteMany({
            where: { id: current.id, ...revertData(changes, 'after') },
          });
          if (result.count !== 1) {
            throw new ConflictException(
              'The term has changed since this audit entry; refresh and review the latest values',
            );
          }
          await this.record(tx, audit.school_id, actor, {
            entity,
            entityId: current.id,
            action: 'delete',
            changes: auditChanges(recordFields(current, changes), null),
          });
          return;
        }

        const current = await tx.academic_year.findFirst({
          where: { id: audit.entity_id!, school_id: audit.school_id! },
        });
        if (!current)
          throw new ConflictException('The academic year no longer exists');
        if (current.is_active) {
          throw new ConflictException(
            'An active academic year cannot be reverted; deactivate it first',
          );
        }
        const [termCount, courseCount] = await Promise.all([
          tx.term.count({ where: { academic_year_id: current.id } }),
          tx.course.count({ where: { academic_year_id: current.id } }),
        ]);
        if (termCount > 0 || courseCount > 0) {
          throw new ConflictException(
            'This academic year is in use and cannot be safely removed',
          );
        }
        assertValuesMatch(current, changes, 'after');
        const result = await tx.academic_year.deleteMany({
          where: {
            id: current.id,
            school_id: audit.school_id!,
            ...revertData(changes, 'after'),
          },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'The academic year has changed since this audit entry; refresh and review the latest values',
          );
        }
        await this.record(tx, audit.school_id, actor, {
          entity,
          entityId: current.id,
          action: 'delete',
          changes: auditChanges(recordFields(current, changes), null),
        });
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'The record is still in use and cannot be removed safely',
        );
      }
      throw error;
    }
  }
}

function isRevertField(field: string): field is RevertField {
  return ['name', 'start_date', 'end_date', 'sort_order'].includes(field);
}

function readChanges(value: Prisma.JsonValue): AuditChanges | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const changes: AuditChanges = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!('before' in raw) || !('after' in raw)) return null;
    changes[field] = {
      before: (raw as { before: unknown }).before,
      after: (raw as { after: unknown }).after,
    };
  }
  return changes;
}

function valueForCompare(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function assertValuesMatch(
  current: Record<string, unknown>,
  changes: AuditChanges,
  side: 'before' | 'after',
) {
  for (const [field, change] of Object.entries(changes)) {
    if (
      JSON.stringify(valueForCompare(current[field])) !==
      JSON.stringify(change[side])
    ) {
      throw new ConflictException(
        'The record has changed since this audit entry; refresh and review the latest values',
      );
    }
  }
}

function revertData(
  changes: AuditChanges,
  side: 'before' | 'after' = 'before',
) {
  const data: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(changes)) {
    const value = change[side];
    data[field] =
      field === 'start_date' || field === 'end_date'
        ? new Date(String(value))
        : value;
  }
  return data;
}

function recordFields(record: Record<string, unknown>, changes: AuditChanges) {
  return Object.fromEntries(
    Object.keys(changes).map((field) => [field, record[field]]),
  );
}
