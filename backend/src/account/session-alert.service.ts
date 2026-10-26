import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import { sessionAlertsEnabled } from './session.config';
import { newSignInEmail } from './templates/new-sign-in';
import { tokenReuseEmail } from './templates/token-reuse';

export interface AlertSession {
  userId: string;
  device: string;
  ip: string | null;
}

/**
 * Security emails about sessions: a sign-in from a new device, and a session
 * ended because an old copy of its token was used. Never throws: callers fire
 * and forget, and a mail failure is only logged, so it can't break sign-in.
 */
@Injectable()
export class SessionAlertService {
  private readonly logger = new Logger(SessionAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** "New sign-in to GradeBook". */
  newSignIn(session: AlertSession, at = new Date()): Promise<void> {
    return this.deliver('new sign-in', session, (devicesUrl) =>
      newSignInEmail({ device: session.device, ip: session.ip, at, devicesUrl }),
    );
  }

  /** "A GradeBook device was signed out" (token reuse). */
  tokenReuse(session: AlertSession, at = new Date()): Promise<void> {
    return this.deliver('token reuse', session, (devicesUrl) =>
      tokenReuseEmail({ device: session.device, ip: session.ip, at, devicesUrl }),
    );
  }

  /** Signed-in devices on the web: the student portal or the staff dashboard. */
  async devicesUrl(userId: string): Promise<string> {
    const profile = await this.prisma.user_profile
      .findUnique({ where: { id: userId }, select: { account_type: true } })
      .catch(() => null);
    const page = profile?.account_type === 'student' ? '/portal/settings' : '/dashboard/settings';
    return `${primaryOrigin()}${page}#devices`;
  }

  private async deliver(
    kind: string,
    session: AlertSession,
    build: (devicesUrl: string) => { subject: string; text: string; html: string },
  ): Promise<void> {
    try {
      if (!sessionAlertsEnabled()) return;
      if (!this.mail.configured()) {
        this.logger.log(`Email is not configured; skipped the ${kind} alert for ${session.userId}`);
        return;
      }
      const user = await this.prisma.app_user.findUnique({
        where: { id: session.userId },
        select: { email: true },
      });
      if (!user?.email) return;
      await this.mail.send({ to: user.email, ...build(await this.devicesUrl(session.userId)) });
    } catch (err) {
      this.logger.warn(`Failed to send the ${kind} alert for ${session.userId}: ${(err as Error).message}`);
    }
  }
}
