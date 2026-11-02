import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, X509Certificate } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';

/** Which console a change came from. */
export type SsoActorVia = 'school_admin' | 'organisation_admin';

/** Who changed a school's sign-in settings, and from where. */
export interface SsoActor {
  /** null: the system (no signed-in user). */
  id: string | null;
  via: SsoActorVia;
}

/** Kept in step with the CHECK on public.sso_audit_log.action. */
export type SsoAuditAction =
  | 'domain_added'
  | 'domain_removed'
  | 'domain_verified'
  | 'domain_settings_changed'
  | 'provider_changed'
  | 'sso_required_changed'
  | 'saml_changed'
  | 'azure_tenant_changed'
  | 'app_changed'
  | 'app_secret_changed'
  | 'app_enabled'
  | 'app_disabled';

/** One field's value before and after. */
export interface FieldChange {
  before: unknown;
  after: unknown;
}

/**
 * One entry to write. `changes` maps a field to its `{ before, after }`, plus
 * context such as `app` (the sign-in app's key). It must never hold a secret:
 * pass certificates through `certificateFingerprint` and client secrets
 * through `secretState`.
 */
export interface SsoAuditEntry {
  action: SsoAuditAction;
  domainId?: string | null;
  domain?: string | null;
  changes: Record<string, unknown>;
}

/** One row of the Activity list. */
export interface SsoAuditItem {
  id: string;
  createdAt: string;
  action: SsoAuditAction;
  domain: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  actorVia: SsoActorVia;
  changes: Record<string, unknown>;
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

/**
 * A certificate's SHA-256 fingerprint ("AB:CD:..."), the way identity
 * providers show it - never the certificate itself. Anything that does not
 * parse is hashed as text, so two different values still compare different.
 */
export function certificateFingerprint(pem: string | null | undefined): string | null {
  if (!pem) return null;
  try {
    return new X509Certificate(pem).fingerprint256;
  } catch {
    const hex = createHash('sha256').update(pem.trim()).digest('hex').toUpperCase();
    return hex.match(/.{2}/g)!.join(':');
  }
}

/** What the log says about a client secret: whether one is stored, never its value. */
export function secretState(stored: boolean): 'set' | 'cleared' {
  return stored ? 'set' : 'cleared';
}

/**
 * `{ field: { before, after } }` for the fields whose value differs (a field
 * missing on one side counts as null), or null when none does.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, FieldChange> | null {
  const out: Record<string, FieldChange> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key] ?? null;
    const a = after[key] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) out[key] = { before: b, after: a };
  }
  return Object.keys(out).length ? out : null;
}

const displayName = (p: { first_name: string | null; last_name: string | null } | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || null;

/**
 * The SSO audit log (public.sso_audit_log): one row per change to a school's
 * single sign-on settings. Writers call `record` with their own transaction
 * client, so an entry exists exactly when its change committed. Read by the
 * school admin (`GET /schools/current/sso/audit`) and organisation admins
 * (`GET /organisation/schools/:id/sso/audit`); callers check who may read
 * which school.
 */
@Injectable()
export class SsoAuditService {
  private readonly logger = new Logger(SsoAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Write entries inside the caller's transaction. */
  async record(
    tx: Prisma.TransactionClient,
    schoolId: string,
    actor: SsoActor,
    entries: SsoAuditEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await tx.sso_audit_log.createMany({
      data: entries.map((e) => ({
        school_id: schoolId,
        domain_id: e.domainId ?? null,
        domain: e.domain ?? null,
        actor_id: actor.id,
        actor_via: actor.via,
        action: e.action,
        changes: e.changes as Prisma.InputJsonValue,
      })),
    });
  }

  /**
   * A school's entries, newest first. `before` is the id of the last entry
   * already shown (the next page starts after it); `limit` defaults to 50,
   * at most 200.
   */
  async list(
    schoolId: string,
    opts: { limit?: number | string; before?: string } = {},
  ): Promise<SsoAuditItem[]> {
    const limit = parseLimit(opts.limit);
    let where: Prisma.sso_audit_logWhereInput = { school_id: schoolId };
    if (opts.before) {
      if (!UUID.test(opts.before)) throw new BadRequestException('Invalid cursor');
      const cursor = await this.prisma.sso_audit_log.findFirst({
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

    let rows: Awaited<ReturnType<PrismaService['sso_audit_log']['findMany']>>;
    try {
      rows = await this.prisma.sso_audit_log.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit,
      });
    } catch (err) {
      this.logger.error(`Failed to load SSO activity for ${schoolId}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to load sign-in activity');
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
        action: r.action as SsoAuditAction,
        domain: r.domain,
        actor: r.actor_id
          ? {
              id: r.actor_id,
              name: displayName(p),
              email: p?.app_user?.email ?? p?.email ?? null,
            }
          : null,
        actorVia: r.actor_via as SsoActorVia,
        changes: (r.changes ?? {}) as Record<string, unknown>,
      };
    });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLimit(raw: number | string | undefined): number {
  if (raw === undefined || raw === '') return AUDIT_DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('limit must be a positive whole number');
  return Math.min(n, AUDIT_MAX_LIMIT);
}
