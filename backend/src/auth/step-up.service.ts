import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EmailCodeService } from '@/account/email-code.service';
import { SessionService } from '@/account/session.service';

export interface StepUpUser {
  id: string;
  email?: string;
  sessionId?: string;
}

const devLoginAllowed = () =>
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_LOGIN === 'true';

/**
 * Step-up confirmation: a signed-in user proves again that they hold their
 * email before changing single sign-on settings. The code is an ordinary
 * EmailCodeService code with purpose 'step_up' - same length, expiry, send
 * caps and per-client attempt limits as sign-in, but never interchangeable
 * with a sign-in code. Confirming marks only the session that asked
 * (SessionService.elevate, ten minutes).
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    private readonly codes: EmailCodeService,
    private readonly sessions: SessionService,
  ) {}

  private address(user: StepUpUser): string {
    if (!user.email || !user.sessionId) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    return user.email;
  }

  /** Mail a code to the signed-in user's own address (never one from the body). */
  async send(user: StepUpUser, ip?: string): Promise<{ sent: true }> {
    await this.codes.send(this.address(user), ip, 'step_up');
    return { sent: true };
  }

  /** Check the code and confirm this session until the returned time. */
  async verify(user: StepUpUser, code: string, ip?: string): Promise<{ elevatedUntil: string }> {
    const email = this.address(user);
    try {
      await this.codes.verify(email, code, ip, 'step_up');
    } catch (err) {
      this.logger.warn(`Step-up failed for ${user.id}: ${(err as Error).message}`);
      // 400, not 401: the session is fine, and clients treat 401 as signed out.
      throw new BadRequestException('Invalid or expired code');
    }
    const until = await this.sessions.elevate(user.sessionId!);
    this.logger.log(`User ${user.id} confirmed a step-up on session ${user.sessionId}`);
    return { elevatedUntil: until.toISOString() };
  }

  /**
   * Dev-only, like `POST /auth/dev/code`: a step-up code for the signed-in
   * user handed back instead of mailed. 404 unless ALLOW_DEV_LOGIN=true
   * outside production.
   */
  async devCode(user: StepUpUser): Promise<{ code: string }> {
    if (!devLoginAllowed()) throw new NotFoundException();
    return { code: await this.codes.issue(this.address(user), undefined, 'step_up') };
  }
}
