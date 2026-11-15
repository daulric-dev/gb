import { Logger } from '@nestjs/common';
import type { Prisma, audit_log } from '@/generated/prisma/client';
import { detectProvider, type DatabaseProvider } from '@/database-setup/provider';

/**
 * The only way application code writes the three audit tables
 * (`audit_log`, `sso_audit_log`, `integration_audit_log`).
 *
 * Ordinary code may only append. The two privileged operations - retention
 * purging expired entries and erasure scrubbing an erased account's copied
 * name/email - are here and nowhere else, narrow (by id / by actor), inside
 * the caller's transaction, and logged. A repository test
 * (audit-store.test.ts) fails on any other update/delete of these tables.
 *
 * Provider-specific part: on PostgreSQL the hardening step installs
 * append-only triggers that refuse every update, delete and truncate unless
 * the transaction first sets `gradebook.audit_purge` (transaction-local, via
 * `set_config(..., true)`); the PostgreSQL store does that just before its
 * privileged statement. On other providers there are no triggers yet, so
 * append-only rests on this boundary and its test (see
 * prisma/DATABASE_PORTABILITY.md).
 */
export const AUDIT_TABLES = ['audit_log', 'sso_audit_log', 'integration_audit_log'] as const;
export type AuditTable = (typeof AUDIT_TABLES)[number];

export interface AuditRows {
  audit_log: Prisma.audit_logUncheckedCreateInput;
  sso_audit_log: Prisma.sso_audit_logCreateManyInput;
  integration_audit_log: Prisma.integration_audit_logCreateManyInput;
}

export type AuditTx = Pick<Prisma.TransactionClient, AuditTable | '$queryRaw'>;

export interface AuditStore {
  readonly provider: DatabaseProvider;
  /** Append one school/organisation audit entry and return it. */
  appendAuditLog(tx: AuditTx, row: AuditRows['audit_log']): Promise<audit_log>;
  /** Append entries to one audit table; returns how many were written. */
  append<T extends AuditTable>(tx: AuditTx, table: T, rows: AuditRows[T][]): Promise<number>;
  /**
   * Retention: delete these entries, but only those created before
   * `olderThan` (a stale id list can never reach a newer entry).
   */
  purgeExpired(tx: AuditTx, table: AuditTable, ids: string[], olderThan: Date): Promise<number>;
  /**
   * Erasure: clear the copied actor name and email of these accounts'
   * entries (the events stay for their retention period). Returns the rows
   * changed; entries already scrubbed are not touched again.
   */
  scrubActor(tx: AuditTx, actorIds: string[]): Promise<number>;
}

const logger = new Logger('AuditStore');

class PrismaAuditStore implements AuditStore {
  constructor(readonly provider: DatabaseProvider) {}

  /** PostgreSQL: open the triggers' transaction-local purge path. */
  private async allowPrivileged(tx: AuditTx): Promise<void> {
    if (this.provider === 'postgresql') {
      await tx.$queryRaw`SELECT set_config('gradebook.audit_purge', 'on', true)`;
    }
  }

  appendAuditLog(tx: AuditTx, row: AuditRows['audit_log']): Promise<audit_log> {
    return tx.audit_log.create({ data: row });
  }

  async append<T extends AuditTable>(tx: AuditTx, table: T, rows: AuditRows[T][]): Promise<number> {
    if (rows.length === 0) return 0;
    // One branch per table keeps each createMany fully typed.
    switch (table) {
      case 'audit_log':
        return (await tx.audit_log.createMany({ data: rows as AuditRows['audit_log'][] })).count;
      case 'sso_audit_log':
        return (await tx.sso_audit_log.createMany({ data: rows as AuditRows['sso_audit_log'][] })).count;
      default:
        return (await tx.integration_audit_log.createMany({ data: rows as AuditRows['integration_audit_log'][] }))
          .count;
    }
  }

  async purgeExpired(tx: AuditTx, table: AuditTable, ids: string[], olderThan: Date): Promise<number> {
    if (ids.length === 0) return 0;
    await this.allowPrivileged(tx);
    const where = { id: { in: ids }, created_at: { lt: olderThan } };
    const { count } =
      table === 'audit_log'
        ? await tx.audit_log.deleteMany({ where })
        : table === 'sso_audit_log'
          ? await tx.sso_audit_log.deleteMany({ where })
          : await tx.integration_audit_log.deleteMany({ where });
    if (count > 0) logger.log(`Retention purged ${count} ${table} entr${count === 1 ? 'y' : 'ies'}`);
    return count;
  }

  async scrubActor(tx: AuditTx, actorIds: string[]): Promise<number> {
    if (actorIds.length === 0) return 0;
    await this.allowPrivileged(tx);
    const { count } = await tx.audit_log.updateMany({
      where: {
        actor_id: { in: actorIds },
        OR: [{ actor_name: { not: null } }, { actor_email: { not: null } }],
      },
      data: { actor_name: null, actor_email: null },
    });
    if (count > 0) logger.log(`Erasure scrubbed the actor of ${count} audit entr${count === 1 ? 'y' : 'ies'}`);
    return count;
  }
}

/** The store for a provider. */
export function auditStoreFor(provider: DatabaseProvider): AuditStore {
  return new PrismaAuditStore(provider);
}

let current: AuditStore | undefined;

/**
 * The store for this process's database (the generated client's provider,
 * else DATABASE_URL's scheme). Pass the root client when one is at hand.
 */
export function auditStore(client?: unknown): AuditStore {
  const provider = detectProvider({ client, url: process.env.DATABASE_URL });
  if (!current || current.provider !== provider) current = auditStoreFor(provider);
  return current;
}
