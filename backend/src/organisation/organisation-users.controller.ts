import { Controller, Delete, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { AccountErasureService } from '@/erasure/account-erasure.service';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { OrganisationUsersService, type AccountType } from './organisation-users.service';

/** At most this many account deletions per admin per hour. */
export const DELETE_USER_THROTTLE = { route: { limit: 10, ttl: 60 * 60 * 1000 } };

/** Organisation admins acting on any user account. */
@ApiTags('Organisation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard)
@Controller('organisation')
export class OrganisationUsersController {
  constructor(
    private readonly accounts: AccountErasureService,
    private readonly users: OrganisationUsersService,
  ) {}

  /**
   * Every account of the install, a page at a time (`page` from 1, `limit`
   * 1-100, default 25), optionally matching `search` (name or email) and of
   * one `accountType`: `{ users, total, page, limit }`.
   */
  @Get('users')
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'accountType', required: false, enum: ['staff', 'student', 'parent'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Throttle({ route: { limit: 120, ttl: 60_000 } })
  listUsers(
    @Query('search') search?: string,
    @Query('accountType') accountType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.list({
      search: typeof search === 'string' ? search : undefined,
      accountType: ['staff', 'student', 'parent'].includes(accountType ?? '') ? (accountType as AccountType) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

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
