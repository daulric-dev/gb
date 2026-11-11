import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { EmailCodeService } from '@/account/email-code.service';
import { redactEmail } from '@/mail/mail.service';
import { SessionService, SESSION_TTL_MS } from '@/account/session.service';
import { AccountService } from '@/account/account.service';
import { CacheService } from '@/cache/cache.service';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import {
  eraseAccountRows,
  finishAccountErasure,
  prepareAccountErasure,
} from '@/erasure/account-erasure';
import { OnboardDto } from './dto/onboard.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { optionalImageUrl } from '@/images/public-url';
import { isOrgAdmin, organisationSummary } from '@/organisation/org-admin';
import {
  AccountDeletionBlockedException,
  accountDeletionCheck,
} from './account-deletion';
import { FeatureService } from '@/features/feature.service';
import { MfaService } from '@/mfa/mfa.service';

const PROFILE_TTL = 60 * 60 * 24 * 30;

/** The dev-only sign-in endpoint: never in production, and only when asked for. */
export function devLoginAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_LOGIN === 'true';
}

/** A profile with its active school, as `*, school:school_id(*)` returned it. */
const WITH_SCHOOL = {
  include: { school_user_profile_school_idToschool: true },
} as const;

type ProfileWithSchool = Prisma.user_profileGetPayload<typeof WITH_SCHOOL>;

/**
 * Rename the school relation to the `school` key clients read, with the
 * logo's URL (`logo_url`, null without one) beside its stored key.
 */
function withSchool({
  school_user_profile_school_idToschool: school,
  ...profile
}: ProfileWithSchool) {
  return {
    ...profile,
    school: school && { ...school, logo_url: optionalImageUrl(school.logo_path) },
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly emailDomains: EmailDomainService,
    private readonly emailCodes: EmailCodeService,
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
    private readonly erasure: ErasureLogService,
    private readonly features: FeatureService,
    // Global (src/mfa); optional only so unit tests can leave it out.
    @Optional() private readonly mfa?: MfaService,
  ) {}

  /**
   * Schools that require single sign-on get it for every address on their
   * domain: no email code is sent, so access follows the school's own
   * account system (a suspended account there cannot sign in here).
   */
  private async refuseIfSsoRequired(email: string) {
    const required = await this.emailDomains.ssoRequirement(email);
    if (required) {
      throw new ForbiddenException(
        `Your school signs in with ${required.label}. Use "Continue with ${required.label}".`,
      );
    }
  }

  /** `ip` is the client asking: codes are capped per (address, client). */
  async sendOtp(email: string, ip?: string) {
    await this.refuseIfSsoRequired(email);
    try {
      await this.emailCodes.send(email, ip);
      return 'OTP sent to email';
    } catch (err) {
      // A rate limit (429) keeps its own message; any other failure reads as
      // it always has.
      if (err instanceof HttpException && !(err instanceof BadRequestException)) throw err;
      this.logger.error(`Failed to send OTP to ${redactEmail(email)}: ${String(err)}`);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  /**
   * Dev-only: a sign-in code handed back instead of mailed, so local scripts
   * (seed, smoke) can sign in. Off unless ALLOW_DEV_LOGIN=true outside
   * production; when off the route does not exist.
   */
  async devCode(email: string): Promise<{ code: string }> {
    if (!devLoginAllowed()) throw new NotFoundException();
    return { code: await this.emailCodes.issue(email) };
  }

  async verifyOtp(
    email: string,
    token: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    await this.refuseIfSsoRequired(email);
    try {
      let verifiedEmail: string;
      try {
        verifiedEmail = await this.emailCodes.verify(email, token, req.ip);
      } catch (err) {
        this.logger.warn(`OTP verification failed for ${redactEmail(email)}: ${(err as Error).message}`);
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      const user = await this.accounts.userForVerifiedEmail(verifiedEmail);
      const { id: userId, email: userEmail } = user;
      // An authenticator code may be due first: then this throws 403 MFA_REQUIRED.
      if (this.mfa) await this.mfa.startSession(reply, req, userId, 'email-code');
      else await this.sessions.create(reply, req, userId, 'email-code');
      const expiresIn = Math.floor(SESSION_TTL_MS / 1000);

      // The session lives in the HttpOnly cookie; the token is never handed
      // to page scripts. The fields stay for clients that read the shape.
      const session = {
        access_token: '',
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      };

      let profile = await this.prisma.user_profile
        .findUnique({ where: { id: userId }, ...WITH_SCHOOL })
        .then((row) => (row ? withSchool(row) : null))
        .catch(() => null);

      if (!profile) {
        this.logger.log(`Creating new user_profile for ${userId}`);
        try {
          profile = withSchool(
            await this.prisma.user_profile.create({
              data: { id: userId, email: userEmail },
              ...WITH_SCHOOL,
            }),
          );
        } catch (insertError) {
          this.logger.error(
            `Failed to create user_profile for ${userId}: ${(insertError as Error).message}`,
          );
        }
      } else if (!profile.email && userEmail) {
        // Backfill email for existing profiles created before the column
        // existed; populated lazily on the user's next login.
        try {
          profile = withSchool(
            await this.prisma.user_profile.update({
              where: { id: userId },
              data: { email: userEmail },
              ...WITH_SCHOOL,
            }),
          );
        } catch (updateError) {
          this.logger.error(
            `Failed to backfill email for user_profile ${userId}: ${(updateError as Error).message}`,
          );
        }
      }

      if (profile) {
        profile = {
          ...profile,
          ...(await this.organisationFields(userId, profile.school_id)),
        };
        await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
      }

      return { session, user, profile };
    } catch (err) {
      // A disabled account (403) keeps its own message.
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
      this.logger.error(`Unexpected error verifying OTP: ${String(err)}`);
      throw new UnauthorizedException('Invalid or expired OTP');
    }
  }

  /**
   * The organisation fields every profile response carries: whether the user
   * is an organisation admin, the organisation (null before setup), and the
   * platform features effective for the user's active school (the
   * organisation's when they have none).
   */
  private async organisationFields(userId: string, schoolId?: string | null) {
    const [isAdmin, organisation, features] = await Promise.all([
      isOrgAdmin(this.prisma, userId).catch(() => false),
      organisationSummary(this.prisma).catch(() => null),
      this.features.effective(schoolId ?? null).catch((err: Error) => {
        this.logger.error(`Failed to load features for ${userId}: ${err.message}`);
        return null;
      }),
    ]);
    return { is_org_admin: isAdmin, organisation, features };
  }

  async getProfile(userId: string) {
    const cached = await this.cache.get(`profile:${userId}`);
    // Entries written by sign-in, onboarding or a profile edit lack the
    // organisation fields; rebuild those.
    if (cached?.email && 'is_org_admin' in cached && cached.features) return cached;

    let row;
    let message: string | undefined;
    try {
      row = await this.prisma.user_profile.findUnique({
        where: { id: userId },
        include: {
          school_user_profile_school_idToschool: true,
          school_management: { select: { role: true } },
        },
      });
    } catch (err) {
      message = (err as Error).message;
    }

    if (!row) {
      this.logger.error(`Profile not found for ${userId}: ${message}`);
      throw new NotFoundException('User profile not found');
    }

    const { school_management: memberships, ...rest } = row;
    const profile: Record<string, any> = {
      ...withSchool(rest as typeof withSchool extends (row: infer R) => any ? R : never),
      school_management: memberships,
    };

    // Backfill email for existing profiles (e.g. users with an active session
    // who won't re-run verifyOtp). getProfile has no session, so the email is
    // read from the account.
    if (!profile.email) {
      let lookupError: string | undefined;
      const account = await this.prisma.app_user
        .findUnique({ where: { id: userId }, select: { email: true } })
        .catch((err: Error) => {
          lookupError = err.message;
          return null;
        });
      const authEmail = account?.email;

      if (!authEmail) {
        this.logger.error(
          `Failed to backfill email for user_profile ${userId}: ${lookupError ?? 'no account email'}`,
        );
      } else {
        try {
          await this.prisma.user_profile.update({
            where: { id: userId },
            data: { email: authEmail },
          });
          profile.email = authEmail;
        } catch (updateError) {
          this.logger.error(
            `Failed to persist backfilled email for user_profile ${userId}: ${(updateError as Error).message}`,
          );
        }
      }
    }

    if (memberships.length === 1) {
      profile.school_management = { role: memberships[0].role };
    }

    Object.assign(
      profile,
      await this.organisationFields(userId, (row as { school_id: string | null }).school_id),
    );

    await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
    return profile;
  }

  async onboard(userId: string, dto: OnboardDto) {
    const data = await this.onboardProfile(userId, dto);
    return {
      ...data,
      ...(await this.organisationFields(
        userId,
        (data as { school_id?: string | null } | null)?.school_id,
      )),
    };
  }

  private async onboardProfile(userId: string, dto: OnboardDto) {
    // Account type is chosen once: a student account cannot re-onboard as
    // staff and pick up a staff membership through a join request.
    const current = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { account_type: true } })
      .catch(() => null);

    // Parent accounts (src/parent-portal) never become staff or students.
    if (current?.account_type === 'parent') {
      throw new ForbiddenException('Parent accounts cannot onboard as staff or students');
    }

    if (current?.account_type === 'student' && dto.accountType !== 'student') {
      throw new ForbiddenException('Student accounts cannot onboard as staff');
    }

    if (dto.accountType === 'student') {
      const data = await this.upsertProfile(
        userId,
        {
          first_name: dto.firstName,
          last_name: dto.lastName,
          account_type: 'student',
          role: null,
        },
        'Failed to onboard student',
      );

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
    }

    const names = { first_name: dto.firstName, last_name: dto.lastName };

    // Already in a school (appointed its admin by an organisation admin, or
    // joined by code or email domain): keep it.
    const existing = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null);

    if (existing?.school_id) {
      // Just update the name
      const data = await this.upsertProfile(userId, names);
      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
    }

    if (dto.schoolId) {
      // Joining an existing school always goes through the join-request flow,
      // which an existing admin must approve. Admin rights are only granted
      // by an organisation admin (OrganisationService.appointAdmin); we never
      // auto-grant admin from a client-supplied schoolId, since that let any
      // user claim ownership of any school lacking an admin.
      //
      // Go through the join request flow.
      const data = await this.upsertProfile(userId, names);

      let joinRequest;
      try {
        joinRequest = await this.prisma.school_join_request.create({
          data: { user_id: userId, school_id: dto.schoolId },
          select: { id: true, school_id: true, status: true },
        });
      } catch (reqError) {
        this.logger.error(
          `Failed to create join request for user ${userId}: ${(reqError as Error).message}`,
        );
        throw new BadRequestException('Failed to submit join request');
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return { ...data, joinRequest };
    }

    // No school selected - just save name
    const data = await this.upsertProfile(userId, names);
    await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
    return data;
  }

  /**
   * Insert-or-update the profile with just these columns (what a PostgREST
   * upsert did), returning it with its school.
   */
  private async upsertProfile(
    userId: string,
    fields: Pick<
      Prisma.user_profileUncheckedCreateInput,
      'first_name' | 'last_name' | 'account_type' | 'role' | 'school_id'
    >,
    failure = 'Failed to onboard user',
  ) {
    try {
      return withSchool(
        await this.prisma.user_profile.upsert({
          where: { id: userId },
          create: { id: userId, ...fields },
          update: fields,
          ...WITH_SCHOOL,
        }),
      );
    } catch (err) {
      this.logger.error(`${failure} ${userId}: ${(err as Error).message}`);
      throw new BadRequestException('Failed to complete onboarding');
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data = await this.saveProfile(userId, dto);
    return {
      ...data,
      ...(await this.organisationFields(
        userId,
        (data as { school_id?: string | null } | null)?.school_id,
      )),
    };
  }

  private async saveProfile(userId: string, dto: UpdateProfileDto) {
    let data;
    try {
      data = withSchool(
        await this.prisma.user_profile.update({
          where: { id: userId },
          data: { first_name: dto.firstName, last_name: dto.lastName },
          ...WITH_SCHOOL,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to update profile for ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to update profile');
    }

    await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
    return data;
  }

  /**
   * Whether this account may be deleted now, and if not why (see
   * account-deletion.ts): `{ canDelete, blockers: [{ code, message, action? }] }`.
   */
  deletionCheck(userId: string) {
    return accountDeletionCheck(this.prisma, userId);
  }

  async deleteAccount(userId: string) {
    // Refuse before anything is touched: owners must hand over first, and a
    // school-managed student account is the school's to remove. This also
    // keeps the Restrict owner foreign keys from failing the transaction.
    const { blockers } = await accountDeletionCheck(this.prisma, userId);
    if (blockers.length > 0) throw new AccountDeletionBlockedException(blockers);

    // The deletion itself is shared with the organisation-admin and student
    // erasure paths (src/erasure/account-erasure.ts).
    const prep = await prepareAccountErasure(this.prisma, userId);

    try {
      await this.sessions.revokeAll(userId, 'account_deleted');
    } catch (err) {
      this.logger.error(
        `Failed to revoke sessions for ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    try {
      await this.prisma.$transaction((tx) =>
        eraseAccountRows(tx, this.erasure, prep, {
          actor: userId,
          reason: 'user_request',
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to delete account ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    await finishAccountErasure({ erasure: this.erasure, cache: this.cache }, prep);
    this.logger.log(`Account deleted for user ${userId}`);
    return 'Account deleted successfully';
  }
}
