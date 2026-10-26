import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { EmailCodeService } from '@/account/email-code.service';
import { SessionService, SESSION_TTL_MS } from '@/account/session.service';
import { AccountService } from '@/account/account.service';
import { CacheService } from '@/cache/cache.service';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { ErasureLogService } from '@/erasure/erasure-log.service';
import { plan, userStoragePrefixes } from '@/erasure/erasure-plan';
import { objectKey } from '@/storage/keys';
import { OnboardDto } from './dto/onboard.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

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

/** Rename the school relation to the `school` key clients read. */
function withSchool({
  school_user_profile_school_idToschool: school,
  ...profile
}: ProfileWithSchool) {
  return { ...profile, school };
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
      this.logger.error(`Failed to send OTP to ${email}: ${String(err)}`);
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
        this.logger.warn(`OTP verification failed for ${email}: ${(err as Error).message}`);
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      const user = await this.accounts.userForVerifiedEmail(verifiedEmail);
      const { id: userId, email: userEmail } = user;
      await this.sessions.create(reply, req, userId, 'email-code');
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

  async getProfile(userId: string) {
    const cached = await this.cache.get(`profile:${userId}`);
    if (cached?.email) return cached;

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

    await this.cache.set(`profile:${userId}`, profile, PROFILE_TTL);
    return profile;
  }

  async onboard(userId: string, dto: OnboardDto) {
    // Account type is chosen once. Re-onboarding a student account as staff
    // would hand it a teacher membership (and every default teacher
    // permission) on dedicated deployments.
    const current = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { account_type: true } })
      .catch(() => null);

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

    if (process.env.DEDICATED_DEPLOYMENT === 'true') {
      const school = await this.prisma.school
        .findFirst({ where: { is_active: true }, select: { id: true } })
        .catch(() => null);

      if (!school) {
        throw new BadRequestException(
          'No school found on this dedicated instance',
        );
      }

      // Preserve an existing membership role (e.g. the school creator's
      // 'admin', set by SchoolService.create) - the dedicated branch runs for
      // every onboard, including theirs.
      const membership = await this.prisma.school_management
        .findFirst({
          where: { user_id: userId, school_id: school.id },
          select: { role: true },
        })
        .catch(() => null);

      if (membership) {
        const data = await this.upsertProfile(userId, {
          first_name: dto.firstName,
          last_name: dto.lastName,
          school_id: school.id,
          role: membership.role,
        });
        await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
        return data;
      }

      // Brand-new staff on a dedicated deployment: save profile and submit a join
      // request for the single school so an admin must approve them.
      const data = await this.upsertProfile(userId, {
        first_name: dto.firstName,
        last_name: dto.lastName,
      });

      let joinRequest = await this.prisma.school_join_request
        .findFirst({
          where: { user_id: userId, school_id: school.id, status: 'pending' },
          select: { id: true, school_id: true, status: true },
        })
        .catch(() => null);

      if (!joinRequest) {
        try {
          joinRequest = await this.prisma.school_join_request.create({
            data: { user_id: userId, school_id: school.id },
            select: { id: true, school_id: true, status: true },
          });
        } catch (reqError) {
          this.logger.error(
            `Failed to create join request for user ${userId}: ${(reqError as Error).message}`,
          );
          throw new BadRequestException('Failed to submit join request');
        }
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return { ...data, joinRequest };
    }

    const names = { first_name: dto.firstName, last_name: dto.lastName };

    // Check if user already has a school_id (set when they created a school)
    const existing = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { school_id: true } })
      .catch(() => null);

    if (existing?.school_id) {
      // User created a school - just update name
      const data = await this.upsertProfile(userId, names);
      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
    }

    if (dto.schoolId) {
      // Joining an existing school always goes through the join-request flow,
      // which an existing admin must approve. Admin rights are only ever
      // granted to the user who *creates* a school (see SchoolService.create);
      // we never auto-grant admin from a client-supplied schoolId, since that
      // let any user claim ownership of any school lacking an admin.
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

  async deleteAccount(userId: string) {
    const [files, profile] = await Promise.all([
      this.prisma.file
        .findMany({
          where: { owner_id: userId },
          select: { school_id: true, bucket: true, storage_path: true },
        })
        .catch(() => []),
      this.prisma.user_profile
        .findUnique({ where: { id: userId }, select: { school_id: true } })
        .catch(() => null),
    ]);
    const prefixes = userStoragePrefixes(
      userId,
      files.map((f) => f.school_id),
    );

    try {
      await this.sessions.revokeAll(userId, 'account_deleted');
    } catch (err) {
      this.logger.error(
        `Failed to revoke sessions for ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user_profile.deleteMany({ where: { id: userId } });
        // Cascades to sessions and linked sign-in identities.
        await tx.app_user.deleteMany({ where: { id: userId } });
        await this.erasure.record(tx, {
          kind: 'account',
          subjectTable: 'account.app_user',
          subjectIds: [userId],
          schoolId: profile?.school_id ?? null,
          actor: userId,
          reason: 'user_request',
          replay: plan.of(
            plan.prefixes(prefixes),
            plan.del('file_manager.file', { owner_id: [userId] }, true),
            plan.del('public.user_profile', { id: [userId] }),
            plan.del('account.app_user', { id: [userId] }),
          ),
        });
      });
    } catch (err) {
      this.logger.error(
        `Failed to delete account ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    await this.erasure.removeObjects(
      files.map((f) => objectKey(f.bucket as string, f.storage_path as string)),
      prefixes,
    );
    await this.cache.delete(`profile:${userId}`);
    this.logger.log(`Account deleted for user ${userId}`);
    return 'Account deleted successfully';
  }
}
