import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

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
  action: 'create' | 'update' | 'delete';
  changes: AuditChanges;
};

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

  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient,
    schoolId: string | null,
    actor: AuditActor,
    entry: AuditLogEntry,
  ): Promise<void> {
    if (Object.keys(entry.changes).length === 0) return;
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
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    const actorName =
      [profile?.first_name, profile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || null;

    await tx.audit_log.create({
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
}
