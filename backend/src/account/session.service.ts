import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { authCookieDomain, authCookieSecure } from '@/config/origins';
import type { Prisma } from '@/generated/prisma/client';
import { authSecret } from './secret';
import { DEVICE_HEADER, deviceLabel } from './device-label';
import { SessionAlertService } from './session-alert.service';
import {
  KNOWN_DEVICE_WINDOW_MS,
  rotationGraceMs,
  sessionAlertsEnabled,
  sessionMaxAgeMs,
} from './session.config';

export const SESSION_COOKIE = 'gb_session';
/** The sliding expiry: a session unused for this long ends. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
/** Renew (and rotate the token of) a session used this long after the last renewal. */
export const RENEW_AFTER_MS = 24 * 60 * 60_000;
const CACHE_TTL_S = 60;
/** A second cache purge after revoking, for a lookup that was mid-flight. */
const REPURGE_AFTER_MS = 1000;

/** Why a session ended, kept in `account.session.revoked_reason`. */
export type RevokeReason =
  | 'logout'
  | 'signed_out'
  | 'signed_out_others'
  | 'signed_out_all'
  | 'admin'
  | 'platform_admin'
  | 'token_reuse'
  | 'account_deleted'
  | 'deactivated';

/** One row of Signed-in devices. Never carries a token or its hash. */
export interface SessionSummary {
  id: string;
  current: boolean;
  method: string;
  device: string;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
}

/** A cached lookup; `expiresAt` (ms) keeps a cached session from outliving its expiry. */
interface CachedSession extends SessionUser {
  expiresAt?: number;
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const tokenTag = (random: string) =>
  createHmac('sha256', authSecret())
    .update(`session:${random}`)
    .digest('base64url');

/** A new cookie token: 256 random bits, tagged with the server secret. */
function newToken(): string {
  const random = randomBytes(32).toString('base64url');
  return `${random}.${tokenTag(random)}`;
}

/**
 * The token that replaces `token` at rotation: derived from it with the
 * server secret, so it can't be guessed from the old token, and every request
 * that rotates (or presents the old token during the grace period) arrives at
 * the same replacement without the server keeping any token in clear.
 */
export function rotatedToken(token: string): string {
  const random = createHmac('sha256', authSecret())
    .update(`rotate:${token}`)
    .digest('base64url');
  return `${random}.${tokenTag(random)}`;
}

/**
 * Whether a cookie value is a token this server issued - not whether its
 * session is still live, which needs the database. Lets the rate limiter,
 * which runs before any guard, give real sessions their own bucket without a
 * lookup, while made-up cookie values fall back to the client address.
 */
export function isIssuedSessionToken(
  token: string | undefined,
): token is string {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expected = Buffer.from(tokenTag(token.slice(0, dot)));
  const given = Buffer.from(token.slice(dot + 1));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Native apps send this header ("native") to be given their token directly. */
export const NATIVE_CLIENT_HEADER = 'x-gradebook-client';
/** Response header carrying a new session token to a native app. */
export const SESSION_TOKEN_HEADER = 'x-session-token';

/**
 * The session token on a request: the `gb_session` cookie (web), or an
 * `Authorization: Bearer <token>` header (the mobile app, which can't rely on
 * native cookie storage - it drops Secure cookies over http and is unreliable
 * across LAN addresses). Both carry the same server-issued token.
 */
export function sessionTokenFrom(req: TokenRequest): string | undefined {
  return tokenSource(req)?.token;
}

type TokenRequest = {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * The token and how it came: a cookie (web) or a bearer header (the app).
 * The app's bearer token wins over a cookie its native cookie jar may still
 * replay: the keychain copy is the one it keeps current through rotations, and
 * a stale jar cookie would otherwise look like a copied token.
 */
function tokenSource(
  req: TokenRequest,
): { token: string; via: 'cookie' | 'bearer' } | undefined {
  const auth = req.headers?.authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  const match = value ? /^Bearer\s+(\S+)$/i.exec(value.trim()) : null;
  const bearer = match ? { token: match[1], via: 'bearer' as const } : undefined;
  if (bearer && headerOf(req, NATIVE_CLIENT_HEADER) === 'native') return bearer;
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return { token: cookie, via: 'cookie' };
  return bearer;
}

function headerOf(req: TokenRequest, name: string): string | undefined {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

const isNative = (req: TokenRequest) => headerOf(req, NATIVE_CLIENT_HEADER) === 'native';

const SESSION_SELECT = {
  id: true,
  user_id: true,
  token_hash: true,
  previous_token_hash: true,
  rotated_at: true,
  expires_at: true,
  absolute_expires_at: true,
  revoked_at: true,
  last_seen_at: true,
  user_agent: true,
  device: true,
  method: true,
  app_user: { select: { id: true, email: true, disabled_at: true } },
} as const;

/**
 * Server-side sessions in an HttpOnly cookie (or a bearer token for the
 * mobile app).
 *
 * The cookie holds a random 256-bit token; the database holds its hash, so
 * sessions can be listed and revoked (Signed-in devices, sign out everywhere,
 * an admin signing a member out) and a database leak does not hand any out.
 *
 * - **Lifetime.** A session slides: each day it is used it is extended by
 *   another 30 days, but never past `absolute_expires_at`
 *   (SESSION_MAX_AGE_DAYS after sign-in, default 90).
 * - **Rotation.** At that daily renewal the token itself is replaced. The new
 *   one goes out as the cookie (web) or an `X-Session-Token` header (the app).
 *   The replaced token keeps working for SESSION_ROTATION_GRACE_SECONDS, for
 *   requests already in flight; presented after that it must be a copy, so the
 *   whole session is revoked (`token_reuse`) and the user is emailed.
 * - **Cache.** Lookups are cached for a minute under `session:<hash>`; every
 *   revocation deletes those keys, so it takes effect at once.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly alerts: SessionAlertService,
  ) {}

  /** Start a session and set the cookie on the response. */
  async create(
    reply: FastifyReply,
    req: FastifyRequest,
    userId: string,
    method: string,
  ): Promise<string> {
    const token = newToken();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + sessionMaxAgeMs());
    const expiresAt = cappedExpiry(now.getTime(), absoluteExpiresAt);
    const userAgent = req.headers['user-agent']?.slice(0, 500) ?? null;
    const device = deviceLabel(userAgent, headerOf(req, DEVICE_HEADER), isNative(req));
    const ip = req.ip ?? null;

    // Before the new row and last_sign_in_at exist, or every device is known.
    const alert = await this.isNewDevice(userId, device, method, userAgent, now);

    await this.prisma.session.create({
      data: {
        user_id: userId,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        absolute_expires_at: absoluteExpiresAt,
        method,
        user_agent: userAgent,
        device,
        ip,
      },
    });
    await this.prisma.app_user.update({
      where: { id: userId },
      data: { last_sign_in_at: now },
    });

    this.setCookie(reply, token, expiresAt);
    // The mobile app keeps its token in secure storage and sends it as a
    // bearer token instead of relying on the cookie.
    if (isNative(req)) this.sendTokenHeader(reply, token);

    // Fire and forget: mail must never hold up or fail a sign-in.
    if (alert) void this.alerts.newSignIn({ userId, device, ip }, now);
    return token;
  }

  /** The signed-in user for a request, or null. */
  async resolve(
    req: FastifyRequest,
    reply?: FastifyReply,
  ): Promise<SessionUser | null> {
    const source = tokenSource(req);
    if (!source) return null;
    const hash = hashToken(source.token);
    const cacheKey = `session:${hash}`;

    const cached = (await this.cache.get(cacheKey)) as CachedSession | null;
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
      return { sessionId: cached.sessionId, userId: cached.userId, email: cached.email };
    }

    // The current token, or the one the last rotation replaced.
    const row = await this.prisma.session.findFirst({
      where: { OR: [{ token_hash: hash }, { previous_token_hash: hash }] },
      select: SESSION_SELECT,
    });
    const now = Date.now();
    if (
      !row ||
      row.revoked_at ||
      row.expires_at.getTime() <= now ||
      row.absolute_expires_at.getTime() <= now ||
      row.app_user.disabled_at
    ) {
      if (reply) this.clearCookie(reply);
      return null;
    }
    const user: SessionUser = {
      sessionId: row.id,
      userId: row.app_user.id,
      email: row.app_user.email,
    };

    if (row.token_hash !== hash) {
      // The token the last rotation replaced.
      if (row.rotated_at && now - row.rotated_at.getTime() <= rotationGraceMs()) {
        // A request that was in flight: let it through and hand the current
        // token over again. Not cached, so the grace period ends on time.
        this.sendRotated(reply, req, source.via, rotatedToken(source.token), row.expires_at);
        return user;
      }
      await this.revokeForReuse(row, req);
      if (reply) this.clearCookie(reply);
      return null;
    }

    let expiresAt = row.expires_at;
    let currentHash = hash;
    if (now - row.last_seen_at.getTime() > RENEW_AFTER_MS) {
      const renewed = await this.rotate(row, source.token, now);
      if (!renewed) {
        if (reply) this.clearCookie(reply);
        return null;
      }
      this.sendRotated(reply, req, source.via, renewed.token, renewed.expiresAt);
      this.touchKnownDevice(row, now);
      expiresAt = renewed.expiresAt;
      currentHash = hashToken(renewed.token);
    }

    const entry: CachedSession = { ...user, expiresAt: expiresAt.getTime() };
    await this.cache.set(`session:${currentHash}`, entry, CACHE_TTL_S);
    return user;
  }

  /**
   * The daily renewal: extend the expiry (capped at the absolute lifetime) and
   * replace the token, atomically on the token still being current. When a
   * concurrent request got there first it rotated to the same derived token,
   * so this one hands that out too.
   */
  private async rotate(
    row: { id: string; absolute_expires_at: Date },
    token: string,
    now: number,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const hash = hashToken(token);
    const next = rotatedToken(token);
    const nextHash = hashToken(next);
    const expiresAt = cappedExpiry(now, row.absolute_expires_at);

    const { count } = await this.prisma.session.updateMany({
      where: { id: row.id, token_hash: hash, revoked_at: null },
      data: {
        token_hash: nextHash,
        previous_token_hash: hash,
        rotated_at: new Date(now),
        last_seen_at: new Date(now),
        expires_at: expiresAt,
      },
    });
    if (count === 0) {
      const fresh = await this.prisma.session.findUnique({
        where: { id: row.id },
        select: { token_hash: true, revoked_at: true, expires_at: true },
      });
      if (!fresh || fresh.revoked_at || fresh.token_hash !== nextHash) return null;
      return { token: next, expiresAt: fresh.expires_at };
    }
    await this.cache.delete(`session:${hash}`);
    return { token: next, expiresAt };
  }

  /** An old token came back after the grace period: it was copied. */
  private async revokeForReuse(
    row: { id: string; user_id: string; device: string | null; user_agent: string | null },
    req: FastifyRequest,
  ) {
    const ip = req.ip ?? null;
    const revoked = await this.revokeWhere({ id: row.id }, 'token_reuse');
    this.logger.warn(
      `Session ${row.id} of user ${row.user_id} revoked: a replaced token was used again (from ${ip ?? 'unknown address'})`,
    );
    if (revoked > 0) {
      void this.alerts.tokenReuse({
        userId: row.user_id,
        device: row.device ?? deviceLabel(row.user_agent),
        ip,
      });
    }
  }

  /** A user's live sessions, the current one first. */
  async list(userId: string, currentSessionId?: string): Promise<SessionSummary[]> {
    const now = new Date();
    const rows = await this.prisma.session.findMany({
      where: {
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: now },
        absolute_expires_at: { gt: now },
      },
      select: {
        id: true,
        method: true,
        device: true,
        user_agent: true,
        ip: true,
        created_at: true,
        last_seen_at: true,
        expires_at: true,
        absolute_expires_at: true,
      },
      orderBy: { last_seen_at: 'desc' },
    });
    return rows
      .map((r) => ({
        id: r.id,
        current: r.id === currentSessionId,
        method: r.method,
        device: r.device ?? deviceLabel(r.user_agent),
        ip: r.ip,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt:
          r.expires_at < r.absolute_expires_at ? r.expires_at : r.absolute_expires_at,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current));
  }

  /**
   * Sign out one of the user's own sessions. 404 for a session that is not
   * theirs or already ended. Says whether it was the one making the request.
   */
  async revokeOwn(
    userId: string,
    sessionId: string,
    currentSessionId?: string,
  ): Promise<{ current: boolean }> {
    const revoked = await this.revokeWhere(
      { id: sessionId, user_id: userId },
      'signed_out',
    );
    if (revoked === 0) throw new NotFoundException('Session not found');
    return { current: sessionId === currentSessionId };
  }

  /** Sign the user out everywhere except this session. */
  async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    return this.revokeWhere(
      { user_id: userId, id: { not: currentSessionId } },
      'signed_out_others',
    );
  }

  /** Sign this device out. */
  async revoke(
    req: FastifyRequest,
    reply: FastifyReply,
    reason: RevokeReason = 'logout',
  ): Promise<void> {
    const token = sessionTokenFrom(req);
    this.clearCookie(reply);
    if (!token) return;
    const hash = hashToken(token);
    await this.revokeWhere(
      { OR: [{ token_hash: hash }, { previous_token_hash: hash }] },
      reason,
    );
    // A token no row knows may still sit in the cache.
    await this.cache.delete(`session:${hash}`);
  }

  /** Sign a user out everywhere (account deleted, signed out by an admin, ...). */
  async revokeAll(
    userId: string,
    reason: RevokeReason = 'account_deleted',
  ): Promise<number> {
    return this.revokeWhere({ user_id: userId }, reason);
  }

  /**
   * Revoke the live sessions matching `where` and drop their cache entries
   * (current and previous token), so they stop working on the next request.
   * Returns how many were revoked.
   */
  private async revokeWhere(
    where: Prisma.sessionWhereInput,
    reason: RevokeReason,
  ): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: { ...where, revoked_at: null },
      select: { id: true, token_hash: true, previous_token_hash: true },
    });
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.session.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, revoked_at: null },
      data: { revoked_at: new Date(), revoked_reason: reason },
    });
    const keys = rows.flatMap((r) =>
      [r.token_hash, r.previous_token_hash]
        .filter((h): h is string => !!h)
        .map((h) => `session:${h}`),
    );
    await this.forget(keys);
    // A lookup that read the row just before the update may cache it again
    // right after the delete above; a second purge closes that window.
    setTimeout(() => void this.forget(keys).catch(() => undefined), REPURGE_AFTER_MS).unref?.();
    return count;
  }

  private async forget(keys: string[]) {
    await Promise.all(keys.map((k) => this.cache.delete(k)));
  }

  /**
   * Whether to send a "new sign-in" alert, and remember this device either
   * way. Alert when the user has signed in before (never on a brand-new
   * account's first sign-in) and this device label + sign-in method was not
   * seen in the last 90 days: no `account.known_device` row for it (kept apart
   * from sessions, which are purged a day after they end), nor - for sessions
   * from before device labels were stored - a recent session with the same
   * user agent. Never throws.
   */
  private async isNewDevice(
    userId: string,
    device: string,
    method: string,
    userAgent: string | null,
    now: Date,
  ): Promise<boolean> {
    try {
      const since = new Date(now.getTime() - KNOWN_DEVICE_WINDOW_MS);
      const fingerprint = deviceFingerprint(method, device);
      const [user, known] = await Promise.all([
        this.prisma.app_user.findUnique({
          where: { id: userId },
          select: { last_sign_in_at: true },
        }),
        this.prisma.known_device.findUnique({
          where: { user_id_fingerprint: { user_id: userId, fingerprint } },
          select: { last_seen_at: true },
        }),
      ]);
      await this.prisma.known_device.upsert({
        where: { user_id_fingerprint: { user_id: userId, fingerprint } },
        create: { user_id: userId, fingerprint, first_seen_at: now, last_seen_at: now },
        update: { last_seen_at: now },
      });

      if (!sessionAlertsEnabled() || !user?.last_sign_in_at) return false;
      if (known && known.last_seen_at >= since) return false;
      if (!userAgent) return true;
      const legacy = await this.prisma.session.count({
        where: {
          user_id: userId,
          method,
          device: null,
          user_agent: userAgent,
          created_at: { gte: since },
        },
      });
      return legacy === 0;
    } catch (err) {
      this.logger.warn(`New-device check failed for ${userId}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Keep an active device known (at each daily rotation). Best effort. */
  private touchKnownDevice(
    row: { user_id: string; method: string; device: string | null },
    now: number,
  ) {
    if (!row.device) return;
    void this.prisma.known_device
      .updateMany({
        where: { user_id: row.user_id, fingerprint: deviceFingerprint(row.method, row.device) },
        data: { last_seen_at: new Date(now) },
      })
      .catch(() => undefined);
  }

  /**
   * Hand a rotated token to the client: the cookie for a cookie session, the
   * `X-Session-Token` header for the app (bearer token or native client).
   * Headers set here go out with whatever status the request ends in.
   */
  private sendRotated(
    reply: FastifyReply | undefined,
    req: TokenRequest,
    via: 'cookie' | 'bearer',
    token: string,
    expiresAt: Date,
  ) {
    if (!reply) return;
    if (via === 'cookie') this.setCookie(reply, token, expiresAt);
    if (via === 'bearer' || isNative(req)) this.sendTokenHeader(reply, token);
  }

  private sendTokenHeader(reply: FastifyReply, token: string) {
    reply.header(SESSION_TOKEN_HEADER, token);
    reply.header('Cache-Control', 'no-store');
  }

  private setCookie(reply: FastifyReply, token: string, expires: Date) {
    reply.setCookie(SESSION_COOKIE, token, {
      domain: authCookieDomain(),
      httpOnly: true,
      secure: authCookieSecure(),
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  /** Remove the session cookie from the browser. */
  clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, {
      domain: authCookieDomain(),
      path: '/',
    });
  }
}

/** A known device: the sign-in method and device label, hashed. */
export function deviceFingerprint(method: string, device: string): string {
  return hashToken(`${method}\n${device}`);
}

/** 30 days from `now`, but never past the absolute lifetime. */
function cappedExpiry(now: number, absolute: Date): Date {
  return new Date(Math.min(now + SESSION_TTL_MS, absolute.getTime()));
}
