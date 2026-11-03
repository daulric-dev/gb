import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';

/** Which console a change came from; `system` for the worker's auto-disable. */
export type IntegrationActorVia = 'school_admin' | 'organisation_admin' | 'system';

export interface IntegrationActor {
  /** null: the system. */
  id: string | null;
  via: IntegrationActorVia;
}

export const SYSTEM_ACTOR: IntegrationActor = { id: null, via: 'system' };

/** Kept in step with the CHECK on public.integration_audit_log.action. */
export type IntegrationAuditAction =
  | 'webhook_created'
  | 'webhook_updated'
  | 'webhook_deleted'
  | 'webhook_enabled'
  | 'webhook_disabled'
  | 'webhook_auto_disabled'
  | 'secret_rotated'
  | 'test_sent'
  | 'delivery_redelivered'
  | 'tls_verification_disabled'
  | 'tls_verification_enabled'
  | 'tls_ca_changed';

/**
 * One entry to write. `changes` is `{ field: { before, after } }` plus
 * context; it must never hold the signing secret (rotation logs only that it
 * happened) or a custom header's value (`headers` lists names added, removed,
 * renamed and whose value changed).
 */
export interface IntegrationAuditEntry {
  action: IntegrationAuditAction;
  webhookId: string | null;
  /** The webhook's name, kept so the entry outlives it. */
  webhook: string | null;
  changes: Record<string, unknown>;
}

export interface IntegrationAuditItem {
  id: string;
  createdAt: string;
  action: IntegrationAuditAction;
  webhookId: string | null;
  webhook: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  actorVia: IntegrationActorVia;
  changes: Record<string, unknown>;
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys that must never reach the log, whatever a caller passes. */
const SECRET_KEYS = new Set(['secret', 'secret_enc', 'secretEnc', 'signingSecret', 'value', 'value_enc', 'valueEnc']);

function scrub(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).filter(([k]) => !SECRET_KEYS.has(k)));
}

const displayName = (p: { first_name: string | null; last_name: string | null } | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || null;

/**
 * The integrations audit log (public.integration_audit_log): one row per
 * change to a school's webhooks, per test and per redelivery. Writers pass
 * their own transaction client, so an entry exists exactly when its change
 * committed. Read by the school admin (`QUERY /schools/current/webhooks/audit`)
 * and organisation admins (`QUERY /organisation/schools/:schoolId/webhooks/audit`).
 */
@Injectable()
export class IntegrationAuditService {
  private readonly logger = new Logger(IntegrationAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient,
    schoolId: string,
    actor: IntegrationActor,
    entries: IntegrationAuditEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await tx.integration_audit_log.createMany({
      data: entries.map((e) => ({
        school_id: schoolId,
        webhook_id: e.webhookId,
        webhook: e.webhook,
        actor_id: actor.id,
        actor_via: actor.via,
        action: e.action,
        changes: scrub(e.changes) as Prisma.InputJsonValue,
      })),
    });
  }

  /** A school's entries, newest first; `before` is the last id shown. */
  async list(
    schoolId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<IntegrationAuditItem[]> {
    const limit = Math.min(Math.max(opts.limit ?? AUDIT_DEFAULT_LIMIT, 1), AUDIT_MAX_LIMIT);
    let where: Prisma.integration_audit_logWhereInput = { school_id: schoolId };
    if (opts.before) {
      if (!UUID.test(opts.before)) throw new BadRequestException('Invalid cursor');
      const cursor = await this.prisma.integration_audit_log.findFirst({
        where: { id: opts.before, school_id: schoolId },
        select: { id: true, created_at: true },
      });
      if (!cursor) throw new BadRequestException('Invalid cursor');
      where = {
        school_id: schoolId,
        OR: [
          { created_at: { lt: cursor.created_at } },
          { created_at: cursor.created_at, id: { lt: cursor.id } },
        ],
      };
    }

    let rows: Awaited<ReturnType<PrismaService['integration_audit_log']['findMany']>>;
    try {
      rows = await this.prisma.integration_audit_log.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
      });
    } catch (err) {
      this.logger.error(`Failed to load integration activity for ${schoolId}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load integration activity');
    }

    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))];
    const people = actorIds.length
      ? await this.prisma.user_profile.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            app_user: { select: { email: true } },
          },
        })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));

    return rows.map((r) => {
      const p = r.actor_id ? byId.get(r.actor_id) : undefined;
      return {
        id: r.id,
        createdAt: r.created_at.toISOString(),
        action: r.action as IntegrationAuditAction,
        webhookId: r.webhook_id,
        webhook: r.webhook,
        actor: r.actor_id
          ? { id: r.actor_id, name: displayName(p), email: p?.app_user?.email ?? p?.email ?? null }
          : null,
        actorVia: r.actor_via as IntegrationActorVia,
        changes: (r.changes ?? {}) as Record<string, unknown>,
      };
    });
  }
}
