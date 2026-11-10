import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { MailService } from '@/mail/mail.service';
import { AccountService } from '@/account/account.service';
import { normalizeEmail } from '@/account/email-code.service';
import { accountEmailHtml } from '@/account/templates/layout';
import { primaryOrigin } from '@/config/origins';

/**
 * Rostered students have no login until they sign in. This links a
 * rostered student record to the account that proves the roster email:
 * on every verified sign-in (registered as an AccountService hook, like
 * organisation invites), and straight after a dry run's apply creates a
 * student whose email already has an account. Only an account in no school
 * (and not a parent, nor staff with memberships) is linked, to one unlinked,
 * active student record; the profile becomes that school's student.
 */
@Injectable()
export class RosterClaimService implements OnModuleInit {
  private readonly logger = new Logger(RosterClaimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly accounts: AccountService,
  ) {}

  onModuleInit() {
    this.accounts.onVerifiedSignIn(async (user) => {
      await this.claimFor(user);
    });
  }

  /** Returns the linked student id, or null when nothing applied. */
  async claimFor(user: { id: string; email: string }): Promise<string | null> {
    const email = normalizeEmail(user.email);
    const links = await this.prisma.roster_link.findMany({
      where: { entity: 'student', email, disabled_at: null },
      select: { target_id: true },
    });
    if (links.length === 0) return null;
    const student = await this.prisma.student.findFirst({
      where: { id: { in: links.map((l) => l.target_id) }, user_profile_id: null, is_active: true },
      select: { id: true, school_id: true, first_name: true, last_name: true },
    });
    if (!student?.school_id) return null;

    const profile = await this.prisma.user_profile.findUnique({
      where: { id: user.id },
      select: {
        school_id: true,
        account_type: true,
        first_name: true,
        last_name: true,
        _count: { select: { school_management: true } },
      },
    });
    if (profile?.school_id || profile?.account_type === 'parent') return null;
    if (profile && profile._count.school_management > 0) return null;
    const schoolId = student.school_id;

    const linked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.student.updateMany({
        where: { id: student.id, user_profile_id: null },
        data: { user_profile_id: user.id },
      });
      if (count !== 1) return false;
      if (profile) {
        await tx.user_profile.update({
          where: { id: user.id },
          data: {
            school_id: schoolId,
            account_type: 'student',
            role: null,
            is_active: true,
            first_name: profile.first_name ?? student.first_name,
            last_name: profile.last_name ?? student.last_name,
          },
        });
      } else {
        await tx.user_profile.create({
          data: {
            id: user.id,
            email,
            school_id: schoolId,
            account_type: 'student',
            first_name: student.first_name,
            last_name: student.last_name,
          },
        });
      }
      return true;
    });
    if (!linked) return null;
    await Promise.all([
      this.cache.delete(`profile:${user.id}`),
      this.cache.delete(`student-context:${user.id}`),
      this.cache.delete(`students:${schoolId}`),
    ]);
    this.logger.log(`Linked rostered student ${student.id} to account ${user.id}`);
    return student.id;
  }

  /** Link a just-created student to an existing account with the email, if any. */
  async claimExisting(email: string): Promise<string | null> {
    const account = await this.prisma.app_user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, disabled_at: true },
    });
    if (!account || account.disabled_at) return null;
    return this.claimFor(account);
  }

  /** "You've been added to <School>": only when the source opted in. Never throws. */
  async notifyStudent(email: string, schoolId: string): Promise<void> {
    try {
      if (!this.mail.configured()) return;
      const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });
      const place = school?.name || 'your school';
      const subject = `You've been added to ${place} on GradeBook`;
      const what = `${place} has added you as a student on GradeBook.`;
      const how = 'Sign in with this email address and your student account is set up straight away.';
      const signInUrl = `${primaryOrigin()}/login`;
      const footer = "If you weren't expecting this, you can ignore this email.";
      await this.mail.send({
        to: email,
        subject,
        text: [what, how, `Sign in: ${signInUrl}`, footer].join('\n\n'),
        html: accountEmailHtml({
          title: subject,
          preheader: what,
          heading: subject,
          paragraphs: [what, how],
          details: [['School', place]],
          button: { label: 'Sign in to GradeBook', href: signInUrl },
          footer,
        }),
      });
    } catch (err) {
      this.logger.warn(`Failed to email a rostered student: ${(err as Error).message}`);
    }
  }
}
