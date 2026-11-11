import { Controller, Delete, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { AccountErasureService } from '@/erasure/account-erasure.service';
import { OrganisationAdminGuard } from './organisation-admin.guard';

/** At most this many account deletions per admin per hour. */
export const DELETE_USER_THROTTLE = { route: { limit: 10, ttl: 60 * 60 * 1000 } };

/** Organisation admins acting on any user account. */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation')
export class OrganisationUsersController {
  constructor(private readonly accounts: AccountErasureService) {}

  /**
   * Delete a user's account for good (step-up). The same deletion as a
   * person deleting their own account, refused (409
   * ACCOUNT_DELETION_BLOCKED) while they own the organisation or a school,
   * or are its last administrator. School-managed student accounts are
   * deleted here too. Student records stay with their school.
   */
  @Delete('users/:userId')
  @RequireStepUp()
  @Throttle(DELETE_USER_THROTTLE)
  deleteUser(
    @Req() req: { user: { id: string } },
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.accounts.deleteByAdmin(req.user.id, userId);
  }
}
