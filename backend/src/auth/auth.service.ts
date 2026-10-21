import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { EmailDomainService } from '@/email-domain/email-domain.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { OnboardDto } from './dto/onboard.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const PROFILE_TTL = 60 * 60 * 24 * 30;

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
    private readonly supabaseService: SupabaseService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly emailDomains: EmailDomainService,
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

  async sendOtp(email: string) {
    await this.refuseIfSsoRequired(email);
    try {
      const supabase = this.supabaseService.getServiceClient();

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) {
        this.logger.error(`Failed to send OTP to ${email}: ${error.message}`);
        throw new BadRequestException('Failed to send OTP');
      }

      return 'OTP sent to email';
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Unexpected error sending OTP: ${String(err)}`);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  async verifyOtp(
    email: string,
    token: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    await this.refuseIfSsoRequired(email);
    try {
      // Verify on the user client so the SSR adapter writes the auth-token
      // cookie via setAll synchronously inside this call.
      const userClient = this.supabaseService.createUserClient(
        req,
        reply,
        'public',
      );

      const { data, error } = await userClient.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error || !data.session) {
        this.logger.error(
          `OTP verification failed for ${email}: ${error?.message}`,
        );
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      const userId = data.session.user.id;
      const userEmail = data.session.user.email;

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

      return {
        session: data.session,
        user: data.session.user,
        profile,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
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
      ...withSchool(rest),
      school_management: memberships,
    };

    // Backfill email for existing profiles (e.g. users with an active session
    // who won't re-run verifyOtp). getProfile has no session, so the email is
    // sourced from the auth user via the admin API.
    if (!profile.email) {
      const supabase = this.supabaseService.getServiceClient();
      const { data: authData, error: adminError } =
        await supabase.auth.admin.getUserById(userId);
      const authEmail = authData?.user?.email;

      if (adminError || !authEmail) {
        this.logger.error(
          `Failed to backfill email for user_profile ${userId}: ${adminError?.message ?? 'no auth email'}`,
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
      // every onboard, including theirs. Brand-new members default to teacher.
      const membership = await this.prisma.school_management
        .findFirst({
          where: { user_id: userId, school_id: school.id },
          select: { role: true },
        })
        .catch(() => null);

      const role = membership?.role ?? 'teacher';

      const data = await this.upsertProfile(userId, {
        first_name: dto.firstName,
        last_name: dto.lastName,
        school_id: school.id,
        role,
      });

      // Canonical membership so the permission layer recognizes the user.
      // Without this, a dedicated-instance user has a school_id but no
      // school_management row, and PermissionGuard treats them as a non-member.
      if (!membership) {
        try {
          await this.prisma.school_management.create({
            data: { user_id: userId, school_id: school.id, role },
          });
        } catch (managementError) {
          this.logger.error(
            `Failed to create school_management for ${userId} at ${school.id}: ${(managementError as Error).message}`,
          );
        }
      }

      await this.cache.set(`profile:${userId}`, data, PROFILE_TTL);
      return data;
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
    try {
      await this.prisma.user_profile.deleteMany({ where: { id: userId } });
    } catch (profileError) {
      this.logger.error(
        `Failed to delete user_profile for ${userId}: ${(profileError as Error).message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    const supabase = this.supabaseService.getServiceClient();
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      this.logger.error(
        `Failed to delete auth user ${userId}: ${authError.message}`,
      );
      throw new BadRequestException('Failed to delete account');
    }

    await this.cache.delete(`profile:${userId}`);
    this.logger.log(`Account deleted for user ${userId}`);
    return 'Account deleted successfully';
  }
}
