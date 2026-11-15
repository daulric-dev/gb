import { Prisma } from '@/generated/prisma/client';

/**
 * Prisma hands back richer types than the JSON the API has always sent:
 * `Date` for date and timestamp columns, `Decimal` for numeric, `bigint` for
 * bigint. Sent as-is they change the wire format (a `date` column becomes
 * "2026-09-01T00:00:00.000Z", a numeric becomes a string, a bigint throws),
 * so every response goes through these to keep the shapes clients expect.
 */

/** A Postgres `date` column as "YYYY-MM-DD" (Prisma gives midnight UTC). */
export function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** A timestamp column as an ISO string. */
export function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** A numeric/decimal/bigint column as a JS number. */
export function num(
  value: Prisma.Decimal | number | bigint | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** Error code helpers for the Prisma equivalents of the old Postgres codes. */
export function isUniqueViolation(err: unknown): boolean {
  const code = providerCode(err);
  return prismaCode(err) === 'P2002' || ['23505', 'ER_DUP_ENTRY', '1062', '2601', '2627', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY', '2067', '1555'].includes(code ?? '');
}

export function isForeignKeyViolation(err: unknown): boolean {
  const code = providerCode(err);
  return prismaCode(err) === 'P2003' || ['23503', 'ER_NO_REFERENCED_ROW_2', '1452', '547', 'SQLITE_CONSTRAINT_FOREIGNKEY', '787'].includes(code ?? '');
}

/** A NOT NULL constraint rejected an insert or update. */
export function isNotNullViolation(err: unknown): boolean {
  const code = providerCode(err);
  return prismaCode(err) === 'P2011' || ['23502', 'ER_BAD_NULL_ERROR', '1048', '515', 'SQLITE_CONSTRAINT_NOTNULL', '1299'].includes(code ?? '');
}

/** Update/delete of a row that does not exist. */
export function isNotFound(err: unknown): boolean {
  return prismaCode(err) === 'P2025';
}

function prismaCode(err: unknown): string | undefined {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
}

/** Database codes exposed by Prisma's adapters; kept separate from PG SQLSTATEs. */
function providerCode(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  const meta = isRecord(err.meta) ? err.meta : undefined;
  const adapter = meta && isRecord(meta.driverAdapterError) ? meta.driverAdapterError : undefined;
  const adapterCause = adapter && isRecord(adapter.cause) ? adapter.cause : undefined;
  const cause = isRecord(err.cause) ? err.cause : undefined;
  const candidates = [meta?.code, adapter?.code, adapterCause?.originalCode, adapterCause?.code, cause?.code, err.code];
  const code = candidates.find((candidate) => typeof candidate === 'string' || typeof candidate === 'number');
  return code?.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * The Postgres SQLSTATE behind an error, including from $queryRaw (P2010)
 * and driver-adapter errors, where Prisma wraps the database error.
 */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; meta?: Record<string, unknown>; cause?: unknown };
  const fromMeta = e?.meta?.code ?? (e?.meta?.driverAdapterError as any)?.cause?.originalCode;
  if (typeof fromMeta === 'string') return fromMeta;
  if (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return undefined;
}

/**
 * The message a SQL function raised (`RAISE EXCEPTION 'no_attempts_left'`),
 * wherever Prisma put it, for mapping to an HTTP error.
 */
export function raisedMessage(err: unknown): string {
  const e = err as { message?: string; meta?: Record<string, unknown> };
  return [e?.message, JSON.stringify(e?.meta ?? {})].join(' ');
}
