import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { SessionService } from '@/account/session.service';
import {
  AccountDeletionBlockedException,
  accountDeletionCheck,
  type DeletionBlocker,
} from '@/auth/account-deletion';
import { ErasureLogService } from './erasure-log.service';
import { AccountErasureFailed, deleteUserAccount } from './account-erasure';

/** The blockers, worded for the admin deleting someone else's account. */
function forAdmin(b: DeletionBlocker): DeletionBlocker {
  switch (b.code) {
    case 'ORG_OWNER':
      return { ...b, message: 'They own the organisation. Ownership must be transferred first.' };
    case 'LAST_ORG_ADMIN':
      return { ...b, message: "They are the organisation's last administrator. Add another administrator first." };
    case 'SCHOOL_OWNER':
      return {
        ...b,
        message: `They own ${b.action?.type === 'transfer_school_ownership' ? b.action.schoolName : 'a school'}. Transfer its ownership first.`,
      };
    case 'SCHOOL_ADMIN':
      return {
        ...b,
        message: `They are the only administrator of ${b.action?.type === 'transfer_school_ownership' ? b.action.schoolName : 'a school'}. Appoint another administrator first.`,
      };
    default:
      return b;
  }
}

/**
 * Account deletion by an organisation admin
 * (`DELETE /organisation/users/:userId`): the same deletion as
 * `DELETE /auth/account` (src/erasure/account-erasure.ts), refused by the
 * same ownership blockers. A school-managed (single sign-on) student
 * account is not a blocker here - the organisation is who removes those.
 */
@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly erasure: ErasureLogService,
    private readonly cache: CacheService,
    private readonly sessions: SessionService,
  ) {}

  async deleteByAdmin(actorId: string, userId: string): Promise<{ deleted: true }> {
    if (actorId === userId) {
      throw new BadRequestException('Delete your own account from your account settings');
    }
    const user = await this.prisma.app_user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const { blockers } = await accountDeletionCheck(this.prisma, userId);
    const remaining = blockers.filter((b) => b.code !== 'SSO_STUDENT').map(forAdmin);
    if (remaining.length > 0) throw new AccountDeletionBlockedException(remaining);

    try {
      await deleteUserAccount(
        { prisma: this.prisma, erasure: this.erasure, cache: this.cache, sessions: this.sessions },
        userId,
        { actor: actorId, reason: 'admin', revokeReason: 'organisation_admin' },
      );
    } catch (err) {
      if (!(err instanceof AccountErasureFailed)) throw err;
      this.logger.error(`Failed to delete account ${userId}: ${err.message}`);
      throw new BadRequestException('Failed to delete the account');
    }
    this.logger.log(`Organisation admin ${actorId} deleted account ${userId}`);
    return { deleted: true };
  }
}
