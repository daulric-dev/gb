/**
 * Deleting a user account (app_user + user_profile and everything that hangs
 * off them), shared by every path that does it:
 *
 * - `DELETE /auth/account` - the person themselves (AuthService.deleteAccount);
 * - `DELETE /organisation/users/:userId` - an organisation admin;
 * - `DELETE /students/:id` - a school erasing a student record whose account
 *   the school manages (StudentErasureService).
 *
 * Callers decide who may delete and check the ownership blockers
 * (src/auth/account-deletion.ts) first. The work is split so a caller can
 * run the row deletes inside its own transaction:
 *
 *   const prep = await prepareAccountErasure(prisma, userId);
 *   await sessions.revokeAll(userId, ...);            // before, outside the tx
 *   await prisma.$transaction((tx) => eraseAccountRows(tx, erasure, prep, who));
 *   await finishAccountErasure({ erasure, cache }, prep); // after commit
 *
 * `deleteUserAccount()` runs all four for callers with no other work.
 */
import type { CacheService } from '@/cache/cache.service';
import type { PrismaService } from '@/prisma/prisma.service';
import type { RevokeReason, SessionService } from '@/account/session.service';
import { objectKey } from '@/storage/keys';
import { userPermCachePrefix } from '@/permission/permission.effective';
import type { Db, ErasureLogService } from './erasure-log.service';
import { plan, userStoragePrefixes, type ErasureReason } from './erasure-plan';

/** What is read before the account goes (ids only; nothing is logged from it). */
export interface AccountErasurePrep {
  userId: string;
  /** The active school, for the log entry's school_id. */
  schoolId: string | null;
  /** Every school the account belonged to (active school and memberships). */
  schoolIds: string[];
  /** Storage prefixes of the user's own objects (file folders, avatar). */
  prefixes: string[];
  /** Exact keys of the user's files (also under the prefixes; kept for stores that list slowly). */
  objectKeys: string[];
}

export interface AccountErasureWho {
  /** The user who asked for it (themselves or an admin), or 'system'. */
  actor: string;
  reason: ErasureReason;
}

export async function prepareAccountErasure(
  prisma: PrismaService | Db,
  userId: string,
): Promise<AccountErasurePrep> {
  const [files, profile, memberships] = await Promise.all([
    prisma.file
      .findMany({
        where: { owner_id: userId },
        select: { school_id: true, bucket: true, storage_path: true },
      })
      .catch(() => []),
    prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null),
    prisma.school_management
      .findMany({ where: { user_id: userId }, select: { school_id: true } })
      .catch(() => []),
  ]);
  const schoolIds = [
    ...new Set(
      [
        profile?.school_id,
        ...(memberships ?? []).map((m) => m.school_id),
      ].filter((s): s is string => !!s),
    ),
  ];
  return {
    userId,
    schoolId: profile?.school_id ?? null,
    schoolIds,
    prefixes: userStoragePrefixes(
      userId,
      (files ?? []).map((f) => f.school_id),
    ),
    objectKeys: (files ?? []).map((f) =>
      objectKey(f.bucket as string, f.storage_path as string),
    ),
  };
}

/**
 * The row deletes and the log entry, with the caller's transaction client.
 * The profile delete cascades to memberships, course roles, files and
 * folders, chat messages and memberships, notifications, parent links, push
 * devices and sign-in identities; discussion posts and other authored rows
 * keep their content without an author (SET NULL). AI request log rows lose
 * the user id here, since that column has no foreign key.
 */
export async function eraseAccountRows(
  tx: Db,
  erasure: ErasureLogService,
  prep: AccountErasurePrep,
  who: AccountErasureWho,
): Promise<void> {
  const { userId } = prep;
  await tx.ai_request.updateMany({
    where: { user_id: userId },
    data: { user_id: null },
  });
  await tx.push_device.deleteMany({ where: { user_id: userId } });
  // Rostering links whose target is this account (rostered staff): they
  // hold the roster email and the source record.
  await tx.roster_link.deleteMany({ where: { target_id: userId } });
  // Keep the audit events for the two-year retention window, but remove the
  // copied name and email of the account being erased. The trigger only
  // permits this update through its transaction-local purge path. Erasure
  // replay repeats the scrub after restoring a backup.
  await tx.$queryRaw`SELECT set_config('gradebook.audit_purge', 'on', true)`;
  await tx.audit_log.updateMany({
    where: { actor_id: userId },
    data: { actor_name: null, actor_email: null },
  });
  await tx.user_profile.deleteMany({ where: { id: userId } });
  // Cascades to sessions and linked sign-in identities.
  await tx.app_user.deleteMany({ where: { id: userId } });
  await erasure.record(tx, {
    kind: 'account',
    subjectTable: 'account.app_user',
    subjectIds: [userId],
    schoolId: prep.schoolId,
    actor: who.actor,
    reason: who.reason,
    replay: plan.of(
      plan.prefixes(prep.prefixes),
      plan.del('file_manager.file', { owner_id: [userId] }, true),
      plan.update('public.ai_request', { user_id: [userId] }, { user_id: null }),
      plan.del('public.push_device', { user_id: [userId] }),
      plan.del('public.roster_link', { target_id: [userId] }),
      plan.update('public.audit_log', { actor_id: [userId] }, { actor_name: null, actor_email: null }),
      plan.del('public.user_profile', { id: [userId] }),
      plan.del('account.app_user', { id: [userId] }),
    ),
  });
}

/**
 * After commit: storage objects (best effort; the retention job retries the
 * prefixes of recent account entries) and every cache entry about the user.
 */
export async function finishAccountErasure(
  deps: {
    erasure: Pick<ErasureLogService, 'removeObjects'>;
    cache: Pick<CacheService, 'delete' | 'deleteByPrefix'>;
  },
  prep: AccountErasurePrep,
): Promise<void> {
  const { userId } = prep;
  await deps.erasure.removeObjects(prep.objectKeys, prep.prefixes);
  await Promise.all([
    deps.cache.delete(`profile:${userId}`),
    deps.cache.delete(`student-context:${userId}`),
    deps.cache.deleteByPrefix(userPermCachePrefix(userId)),
    // Cached rosters of the schools they were in.
    ...prep.schoolIds.map((s) => deps.cache.delete(`students:${s}`)),
  ]);
}

export class AccountErasureFailed extends Error {}

/**
 * The whole deletion for callers with nothing else to do in the
 * transaction: sessions revoked first (so the account stops working even if
 * the rest fails), then rows and log entry, then storage and caches. Throws
 * AccountErasureFailed with the stage that failed; callers map it to their
 * own HTTP error.
 */
export async function deleteUserAccount(
  deps: {
    prisma: PrismaService;
    erasure: ErasureLogService;
    cache: Pick<CacheService, 'delete' | 'deleteByPrefix'>;
    sessions: Pick<SessionService, 'revokeAll'>;
  },
  userId: string,
  who: AccountErasureWho & { revokeReason?: RevokeReason },
): Promise<void> {
  const prep = await prepareAccountErasure(deps.prisma, userId);
  try {
    await deps.sessions.revokeAll(userId, who.revokeReason ?? 'account_deleted');
  } catch (err) {
    throw new AccountErasureFailed(`revoke sessions: ${(err as Error).message}`);
  }
  try {
    await deps.prisma.$transaction(async (tx) => {
      await eraseAccountRows(tx, deps.erasure, prep, who);
    });
  } catch (err) {
    throw new AccountErasureFailed(`delete rows: ${(err as Error).message}`);
  }
  await finishAccountErasure(deps, prep);
}
