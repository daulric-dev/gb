import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { SessionService } from '@/account/session.service';
import { openSecret, sealSecret } from '@/account/secret-box';
import { deviceLabel, DEVICE_HEADER } from '@/account/device-label';
import { AuditLogService, type AuditLogEntry } from '@/audit-log/audit-log.service';
import { MailService } from '@/mail/mail.service';
import { primaryOrigin } from '@/config/origins';
import type { Prisma } from '@/generated/prisma/client';
import {
  base32Decode,
  cleanCode,
  hashRecoveryCode,
  matchStep,
  newRecoveryCodes,
  newSecret,
  normalizeRecoveryCode,
  otpauthUri,
} from './totp';
import { holdsPrivilegedRole, mfaRequiredFor, mfaRequiredForAdmins } from './mfa.policy';
import { mfaChangedEmail, mfaResetEmail, recoveryCodeUsedEmail } from './mfa.emails';

/** secret-box purpose for authenticator secrets; the user id is the AAD. */
export const MFA_SECRET_INFO = 'gradebook:mfa-totp:v1';
export const MFA_REQUIRED = 'MFA_REQUIRED';
export const MFA_ENROLMENT_REQUIRED = 'MFA_ENROLMENT_REQUIRED';
export const MFA_CHALLENGE_EXPIRED = 'MFA_CHALLENGE_EXPIRED';
export const MFA_INVALID_CODE = 'MFA_INVALID_CODE';
export const MFA_LOCKED = 'MFA_LOCKED';

/** How long the sign-in challenge (between the first factor and the code) lives. */
export const CHALLENGE_TTL_S = 5 * 60;
/** Wrong codes one challenge takes before it is dropped. */
export const MAX_CHALLENGE_ATTEMPTS = 5;
/** Wrong sign-in codes in a row (across challenges) before the account's codes lock. */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCKOUT_MS = 15 * 60_000;
/** A secret being set up must be confirmed within this. */
export const PENDING_TTL_MS = 15 * 60_000;
const GATE_CACHE_TTL_S = 60;

/**
 * Routes an enrolment-gated session may still call: who am I, sign out, the
 * two-step routes themselves and step-up (which setting one up needs).
 */
const GATE_ALLOWED = /^(?:\/api)?\/auth\/(?:me|logout|mfa(?:\/[^?]*)?|step-up\/(?:send|verify)|dev\/step-up-code)(?:\?|$)/;

interface Challenge {
  userId: string;
  method: string;
  attempts: number;
  expiresAt: number;
}

export interface MfaUser {
  id: string;
  email?: string;
  sessionId?: string;
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  /** The organisation requires an authenticator app for this user's role. */
  required: boolean;
  /** This session may only set one up until it has (403 MFA_ENROLMENT_REQUIRED elsewhere). */
  enrolmentRequired: boolean;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const challengeKey = (token: string) => `mfa:challenge:${sha256(token)}`;
const gateKey = (sessionId: string) => `mfa:gate:${sessionId}`;

function apiError(status: number, code: string, message: string, extra: object = {}) {
  return new HttpException({ statusCode: status, code, message, ...extra }, status);
}

export function mfaRequiredError(token: string): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: MFA_REQUIRED,
    // Old app versions with no code step show this.
    message:
      'This account uses an authenticator app. Enter its code to finish signing in (update the app if it does not ask).',
    mfaToken: token,
    expiresIn: CHALLENGE_TTL_S,
  });
}

export function enrolmentRequiredError(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: MFA_ENROLMENT_REQUIRED,
    message:
      'Your organisation requires an authenticator app for your role. Set one up in two-step verification to continue.',
  });
}

const invalidCode = () =>
  apiError(HttpStatus.BAD_REQUEST, MFA_INVALID_CODE, 'That code is not right. Try the current code.');

const challengeExpired = () =>
  apiError(
    HttpStatus.BAD_REQUEST,
    MFA_CHALLENGE_EXPIRED,
    'This sign-in has expired. Start again with a new emailed code.',
  );

/**
 * Authenticator-app (TOTP) two-step verification: setting it up, recovery
 * codes, the sign-in challenge after the emailed code (or single sign-on, when
 * the organisation requires it for the user's role), the organisation policy
 * and admin resets. See README.md.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    private readonly mail: MailService,
  ) {}

  // ── secrets ─────────────────────────────────────────────────────────────

  private seal(userId: string, secret: string): string {
    return sealSecret(MFA_SECRET_INFO, Buffer.from(userId), secret);
  }

  private open(userId: string, stored: string | null): Buffer | null {
    if (!stored) return null;
    const secret = openSecret(MFA_SECRET_INFO, Buffer.from(userId), stored);
    if (!secret) {
      this.logger.error(`Authenticator secret for ${userId} could not be decrypted (key changed?)`);
      return null;
    }
    return base32Decode(secret);
  }

  private enabledRow(userId: string) {
    return this.prisma.mfa_totp.findFirst({
      where: { user_id: userId, enabled_at: { not: null }, secret_enc: { not: null } },
    });
  }

  // ── sign-in ─────────────────────────────────────────────────────────────

  /**
   * Called where a first factor has just succeeded, in place of
   * SessionService.create: starts the session, or - when the user must enter
   * an authenticator code - throws 403 `{ code: 'MFA_REQUIRED', mfaToken }`.
   */
  async startSession(reply: FastifyReply, req: FastifyRequest, userId: string, method: string): Promise<void> {
    const token = await this.challengeFor(userId, method);
    if (token) throw mfaRequiredError(token);
    await this.openSession(reply, req, userId, method);
  }

  /**
   * The browser single sign-on callback's version of startSession: where to
   * send the browser. With a challenge, the login page's code step (the
   * single-use token in the URL; it is useless without the code).
   */
  async finishWebSignIn(
    reply: FastifyReply,
    req: FastifyRequest,
    userId: string,
    method: string,
    destination: string,
  ): Promise<string> {
    const token = await this.challengeFor(userId, method);
    if (token) {
      const params = new URLSearchParams({ token, next: destination });
      return `${primaryOrigin()}/login/two-step?${params.toString()}`;
    }
    await this.openSession(reply, req, userId, method);
    return `${primaryOrigin()}${destination}`;
  }

  /**
   * A challenge token when this sign-in needs an authenticator code: the user
   * has one set up, and signed in with an emailed code - or with single
   * sign-on while the organisation requires it for their role (otherwise the
   * identity provider's own multi-factor policy applies).
   */
  async challengeFor(userId: string, method: string): Promise<string | null> {
    const row = await this.enabledRow(userId);
    if (!row) return null;
    if (method !== 'email-code' && !(await mfaRequiredFor(this.prisma, userId))) return null;
    const token = randomBytes(32).toString('base64url');
    const challenge: Challenge = {
      userId,
      method,
      attempts: 0,
      expiresAt: Date.now() + CHALLENGE_TTL_S * 1000,
    };
    await this.cache.set(challengeKey(token), challenge, CHALLENGE_TTL_S);
    return token;
  }

  /**
   * Start the session; an email-code session for someone the organisation
   * requires an authenticator app of, who has none, is limited to setting
   * one up (account.mfa_enrolment_gate).
   */
  private async openSession(reply: FastifyReply, req: FastifyRequest, userId: string, method: string) {
    const token = await this.sessions.create(reply, req, userId, method);
    if (method !== 'email-code') return;
    if (!(await this.enrolmentNeeded(userId))) return;
    const session = await this.prisma.session.findUnique({
      where: { token_hash: sha256(token) },
      select: { id: true },
    });
    if (!session) return;
    await this.prisma.mfa_enrolment_gate.create({ data: { session_id: session.id, user_id: userId } });
    await this.cache.set(gateKey(session.id), true, GATE_CACHE_TTL_S);
  }

  private async enrolmentNeeded(userId: string): Promise<boolean> {
    if (!(await mfaRequiredFor(this.prisma, userId))) return false;
    return !(await this.enabledRow(userId));
  }

  /**
   * `POST /auth/mfa/verify`: finish a challenged sign-in with an authenticator
   * code or a recovery code, and start the session.
   */
  async verifyChallenge(
    req: FastifyRequest,
    reply: FastifyReply,
    input: { token: string; code?: string; recoveryCode?: string },
    now = Date.now(),
  ): Promise<{ signedIn: true; recoveryCodeUsed: boolean; recoveryCodesRemaining: number }> {
    if (typeof input.token !== 'string' || !input.token) throw challengeExpired();
    const key = challengeKey(input.token);
    const challenge = (await this.cache.get(key)) as Challenge | null;
    if (!challenge || challenge.expiresAt <= now) throw challengeExpired();
    const { userId } = challenge;

    const row = await this.enabledRow(userId);
    if (!row) {
      await this.cache.delete(key);
      throw challengeExpired();
    }
    if (row.locked_until && row.locked_until.getTime() > now) {
      await this.cache.delete(key);
      throw this.lockedError(row.locked_until, now);
    }

    const usingRecovery = !input.code && !!input.recoveryCode;
    const ok = usingRecovery
      ? await this.consumeRecoveryCode(userId, input.recoveryCode!)
      : await this.acceptCode(userId, row.secret_enc, row.last_used_step, input.code ?? '', now);

    if (!ok) {
      await this.recordFailure(userId, challenge, key, now);
      throw invalidCode();
    }

    // Single use: only the first request to get here proceeds.
    const first = await this.cache.setIfAbsent(`${key}:used`, true, CHALLENGE_TTL_S);
    await this.cache.delete(key);
    if (!first) throw challengeExpired();

    await this.prisma.mfa_totp.update({
      where: { user_id: userId },
      data: { failed_attempts: 0, locked_until: null, updated_at: new Date(now) },
    });
    await this.openSession(reply, req, userId, challenge.method);

    const remaining = await this.remainingRecoveryCodes(userId);
    await this.record(userId, userId, 'read', usingRecovery ? 'sign_in_recovery_code' : 'sign_in_verified', {
      method: challenge.method,
    });
    if (usingRecovery) {
      void this.notify(userId, (settingsUrl) =>
        recoveryCodeUsedEmail({
          at: new Date(now),
          settingsUrl,
          device: deviceLabel(
            headerOf(req, 'user-agent') ?? null,
            headerOf(req, DEVICE_HEADER),
            headerOf(req, 'x-gradebook-client') === 'native',
          ),
          ip: req.ip ?? null,
          remaining,
        }),
      );
    }
    return { signedIn: true, recoveryCodeUsed: usingRecovery, recoveryCodesRemaining: remaining };
  }

  private lockedError(until: Date, now: number) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - now) / 60_000));
    return apiError(
      HttpStatus.TOO_MANY_REQUESTS,
      MFA_LOCKED,
      `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  private async recordFailure(userId: string, challenge: Challenge, key: string, now: number) {
    const updated = await this.prisma.mfa_totp.update({
      where: { user_id: userId },
      data: { failed_attempts: { increment: 1 } },
      select: { failed_attempts: true },
    });
    const locked = updated.failed_attempts >= MAX_FAILED_ATTEMPTS;
    if (locked) {
      await this.prisma.mfa_totp.update({
        where: { user_id: userId },
        data: { failed_attempts: 0, locked_until: new Date(now + LOCKOUT_MS) },
      });
    }
    const attempts = challenge.attempts + 1;
    if (locked || attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await this.cache.delete(key);
    } else {
      const ttl = Math.max(1, Math.ceil((challenge.expiresAt - now) / 1000));
      await this.cache.set(key, { ...challenge, attempts }, ttl);
    }
    this.logger.warn(`Wrong authenticator code for ${userId}${locked ? ' (codes locked)' : ''}`);
    await this.record(userId, userId, 'read', locked ? 'sign_in_locked' : 'sign_in_failed', {
      method: challenge.method,
    });
  }

  /**
   * Check a code against the stored secret and remember its time step, so it
   * (or an older one) is never accepted again. The update is conditional on
   * the step, so two requests racing with one code cannot both pass.
   */
  private async acceptCode(
    userId: string,
    stored: string | null,
    lastUsedStep: bigint | null,
    code: string,
    now: number,
  ): Promise<boolean> {
    const key = this.open(userId, stored);
    if (!key) return false;
    const step = matchStep(key, code, now, lastUsedStep);
    if (step === null) return false;
    const { count } = await this.prisma.mfa_totp.updateMany({
      where: {
        user_id: userId,
        OR: [{ last_used_step: null }, { last_used_step: { lt: step } }],
      },
      data: { last_used_step: step },
    });
    return count === 1;
  }

  /** Mark a recovery code used; true only for an unused code of this user. */
  private async consumeRecoveryCode(userId: string, code: string, now = new Date()): Promise<boolean> {
    if (normalizeRecoveryCode(code).length !== 10) return false;
    const { count } = await this.prisma.mfa_recovery_code.updateMany({
      where: { user_id: userId, code_hash: hashRecoveryCode(code), used_at: null },
      data: { used_at: now },
    });
    return count === 1;
  }

  private remainingRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.mfa_recovery_code.count({ where: { user_id: userId, used_at: null } });
  }

  // ── enrolment gate ──────────────────────────────────────────────────────

  /**
   * From AuthGuard: 403 MFA_ENROLMENT_REQUIRED when this session is limited
   * to setting up an authenticator app and the route is not one of those.
   */
  async assertSessionAllowed(request: { url?: string; user?: { sessionId?: string } }): Promise<void> {
    const sessionId = request.user?.sessionId;
    if (!sessionId) return;
    if (await this.isGated(sessionId)) {
      if (!GATE_ALLOWED.test(request.url ?? '')) throw enrolmentRequiredError();
    }
  }

  private async isGated(sessionId: string): Promise<boolean> {
    const cached = await this.cache.get(gateKey(sessionId));
    if (typeof cached === 'boolean') return cached;
    const row = await this.prisma.mfa_enrolment_gate.findUnique({
      where: { session_id: sessionId },
      select: { session_id: true },
    });
    await this.cache.set(gateKey(sessionId), !!row, GATE_CACHE_TTL_S);
    return !!row;
  }

  private async clearGates(userId: string) {
    const rows = await this.prisma.mfa_enrolment_gate.findMany({
      where: { user_id: userId },
      select: { session_id: true },
    });
    if (rows.length === 0) return;
    await this.prisma.mfa_enrolment_gate.deleteMany({ where: { user_id: userId } });
    await Promise.all(rows.map((r) => this.cache.set(gateKey(r.session_id), false, GATE_CACHE_TTL_S)));
  }

  // ── the user's own settings ─────────────────────────────────────────────

  async status(user: MfaUser): Promise<MfaStatus> {
    const [row, remaining, required, gated] = await Promise.all([
      this.enabledRow(user.id),
      this.remainingRecoveryCodes(user.id),
      mfaRequiredFor(this.prisma, user.id).catch(() => false),
      user.sessionId ? this.isGated(user.sessionId) : Promise.resolve(false),
    ]);
    return {
      enabled: !!row,
      enabledAt: row?.enabled_at?.toISOString() ?? null,
      recoveryCodesRemaining: row ? remaining : 0,
      required,
      enrolmentRequired: gated,
    };
  }

  /**
   * Start setting up (or replacing) an authenticator app: a new secret, kept
   * as pending until a code from it is confirmed. The active one, if any,
   * keeps working meanwhile.
   */
  async startEnrolment(
    user: MfaUser,
    at = Date.now(),
  ): Promise<{ secret: string; otpauthUri: string; issuer: string; account: string }> {
    const secret = newSecret();
    const sealed = this.seal(user.id, secret);
    const now = new Date(at);
    await this.prisma.mfa_totp.upsert({
      where: { user_id: user.id },
      create: { user_id: user.id, pending_secret_enc: sealed, pending_created_at: now },
      update: { pending_secret_enc: sealed, pending_created_at: now, updated_at: now },
    });
    const issuer = issuerName();
    const account = user.email ?? user.id;
    return { secret, otpauthUri: otpauthUri(secret, account, issuer), issuer, account };
  }

  /**
   * Confirm the pending secret with a code from it: it becomes the active
   * one, and ten new recovery codes replace any old ones. The codes are
   * returned once and stored only as hashes.
   */
  async confirmEnrolment(user: MfaUser, code: string, now = Date.now()): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.mfa_totp.findUnique({ where: { user_id: user.id } });
    if (
      !row?.pending_secret_enc ||
      !row.pending_created_at ||
      now - row.pending_created_at.getTime() > PENDING_TTL_MS
    ) {
      throw new BadRequestException('This set-up has expired. Start again.');
    }
    const key = this.open(user.id, row.pending_secret_enc);
    const step = key ? matchStep(key, cleanCode(code), now) : null;
    if (step === null) throw invalidCode();

    const replacing = !!row.enabled_at;
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfa_totp.update({
        where: { user_id: user.id },
        data: {
          secret_enc: row.pending_secret_enc,
          pending_secret_enc: null,
          pending_created_at: null,
          enabled_at: new Date(now),
          last_used_step: step,
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date(now),
        },
      });
      await this.replaceRecoveryCodes(tx, user.id, recoveryCodes);
    });
    await this.clearGates(user.id);
    await this.record(user.id, user.id, replacing ? 'update' : 'create', replacing ? 'replaced' : 'enabled');
    void this.notify(user.id, (settingsUrl) => mfaChangedEmail({ at: new Date(now), settingsUrl, enabled: true }));
    return { recoveryCodes };
  }

  private async replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string, codes: string[]) {
    await tx.mfa_recovery_code.deleteMany({ where: { user_id: userId } });
    await tx.mfa_recovery_code.createMany({
      data: codes.map((c) => ({ user_id: userId, code_hash: hashRecoveryCode(c) })),
    });
  }

  /** New recovery codes (the old ones stop working). */
  async regenerateRecoveryCodes(user: MfaUser): Promise<{ recoveryCodes: string[] }> {
    if (!(await this.enabledRow(user.id))) {
      throw new ConflictException('Set up an authenticator app first.');
    }
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.$transaction((tx) => this.replaceRecoveryCodes(tx, user.id, recoveryCodes));
    await this.record(user.id, user.id, 'update', 'recovery_codes_regenerated');
    return { recoveryCodes };
  }

  /**
   * Turn two-step verification off, with a current code or a recovery code.
   * Refused while the organisation requires it for the user's role (they can
   * replace the app instead).
   */
  async disable(user: MfaUser, input: { code?: string; recoveryCode?: string }, now = Date.now()) {
    const row = await this.enabledRow(user.id);
    if (!row) throw new ConflictException('Two-step verification is not on.');
    if (await mfaRequiredFor(this.prisma, user.id)) {
      throw new ConflictException(
        'Your organisation requires an authenticator app for your role. You can move it to a new phone instead.',
      );
    }
    const ok = input.code
      ? await this.acceptCode(user.id, row.secret_enc, row.last_used_step, input.code, now)
      : input.recoveryCode
        ? await this.consumeRecoveryCode(user.id, input.recoveryCode)
        : false;
    if (!ok) throw invalidCode();
    await this.remove(user.id);
    await this.record(user.id, user.id, 'delete', 'disabled');
    void this.notify(user.id, (settingsUrl) => mfaChangedEmail({ at: new Date(now), settingsUrl, enabled: false }));
    return { enabled: false };
  }

  private async remove(userId: string) {
    await this.prisma.$transaction([
      this.prisma.mfa_recovery_code.deleteMany({ where: { user_id: userId } }),
      this.prisma.mfa_totp.deleteMany({ where: { user_id: userId } }),
    ]);
  }

  // ── organisation ────────────────────────────────────────────────────────

  async policy(): Promise<{ requireMfaForAdmins: boolean }> {
    return { requireMfaForAdmins: await mfaRequiredForAdmins(this.prisma) };
  }

  async setPolicy(actorId: string, requireMfaForAdmins: boolean) {
    const org = await this.prisma.organisation.findFirst({
      select: { id: true, require_mfa_for_admins: true },
    });
    if (!org) throw new NotFoundException('The organisation is not set up yet');
    if (org.require_mfa_for_admins !== requireMfaForAdmins) {
      await this.prisma.$transaction(async (tx) => {
        await tx.organisation.update({
          where: { id: org.id },
          data: { require_mfa_for_admins: requireMfaForAdmins, updated_at: new Date() },
        });
        await this.audit.record(tx, null, { id: actorId }, {
          entity: 'organisation',
          entityId: org.id,
          action: 'update',
          changes: {
            require_mfa_for_admins: { before: org.require_mfa_for_admins, after: requireMfaForAdmins },
          },
        });
      });
      this.logger.log(`Organisation admin ${actorId} set require_mfa_for_admins=${requireMfaForAdmins}`);
    }
    return { requireMfaForAdmins };
  }

  /**
   * An organisation admin removes someone's authenticator app and recovery
   * codes (a lost phone). They sign in with an emailed code again, and are
   * asked to set one up again if their role requires it. The user is emailed.
   */
  async adminReset(actorId: string, userId: string) {
    const row = await this.prisma.mfa_totp.findUnique({
      where: { user_id: userId },
      select: { enabled_at: true },
    });
    if (!row?.enabled_at) throw new NotFoundException('This person has no authenticator app set up');
    await this.remove(userId);
    await this.record(actorId, userId, 'delete', 'reset_by_admin');
    const actor = await this.prisma.user_profile
      .findUnique({ where: { id: actorId }, select: { first_name: true, last_name: true } })
      .catch(() => null);
    const by = [actor?.first_name, actor?.last_name].filter(Boolean).join(' ').trim() || 'An administrator';
    void this.notify(userId, (settingsUrl) => mfaResetEmail({ at: new Date(), settingsUrl, by }));
    this.logger.log(`Organisation admin ${actorId} reset two-step verification for ${userId}`);
    return { reset: true };
  }

  /** Whether the user is one the policy covers (for the admin console's lists). */
  holdsPrivilegedRole(userId: string) {
    return holdsPrivilegedRole(this.prisma, userId);
  }

  // ── audit and mail ──────────────────────────────────────────────────────

  /**
   * Organisation-scope audit entry about a user's two-step verification. Never
   * throws: a failed write is logged, not allowed to fail sign-in.
   */
  private async record(
    actorId: string,
    userId: string,
    action: AuditLogEntry['action'],
    event: string,
    extra: Record<string, string> = {},
  ) {
    try {
      const changes: AuditLogEntry['changes'] = { event: { before: null, after: event } };
      for (const [k, v] of Object.entries(extra)) changes[k] = { before: null, after: v };
      await this.audit.record(this.prisma, null, { id: actorId }, {
        entity: 'user_mfa',
        entityId: userId,
        action,
        changes,
      });
    } catch (err) {
      this.logger.error(`Failed to audit ${event} for ${userId}: ${(err as Error).message}`);
    }
  }

  private async notify(
    userId: string,
    build: (settingsUrl: string) => { subject: string; text: string; html: string },
  ): Promise<void> {
    try {
      if (!this.mail.configured()) return;
      const user = await this.prisma.app_user.findUnique({
        where: { id: userId },
        select: { email: true, user_profile: { select: { account_type: true } } },
      });
      if (!user?.email) return;
      const type = user.user_profile?.account_type;
      const page =
        type === 'student' ? '/portal/settings' : type === 'parent' ? '/parent/settings' : '/dashboard/settings';
      await this.mail.send({ to: user.email, ...build(`${primaryOrigin()}${page}#two-step`) });
    } catch (err) {
      this.logger.warn(`Failed to send a two-step verification email for ${userId}: ${(err as Error).message}`);
    }
  }
}

/** The name authenticator apps list the account under. */
export function issuerName(): string {
  return (process.env.MFA_ISSUER ?? '').trim() || 'GradeBook';
}

function headerOf(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}
