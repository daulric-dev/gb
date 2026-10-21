import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { authCookieDomain } from '@/config/origins';

export const SESSION_COOKIE = 'gb_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
/** Extend the session when it is used after this much of it has passed. */
const RENEW_AFTER_MS = 24 * 60 * 60_000;
const CACHE_TTL_S = 60;

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Server-side sessions in an HttpOnly cookie.
 *
 * The cookie holds a random 256-bit token; the database holds its hash, so
 * sessions can be listed and revoked (sign out everywhere, disable a user)
 * and a database leak does not hand any out. Lookups are cached for a
 * minute, so a revoked session stops working within that minute.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Start a session and set the cookie on the response. */
  async create(
    reply: FastifyReply,
    req: FastifyRequest,
    userId: string,
    method: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        user_id: userId,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        method,
        user_agent: req.headers['user-agent']?.slice(0, 500) ?? null,
        ip: req.ip ?? null,
      },
    });
    await this.prisma.app_user.update({
      where: { id: userId },
      data: { last_sign_in_at: new Date() },
    });

    this.setCookie(reply, token, expiresAt);
    return token;
  }

  /** The signed-in user for a request, or null. */
  async resolve(req: FastifyRequest, reply?: FastifyReply): Promise<SessionUser | null> {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const hash = hashToken(token);
    const cacheKey = `session:${hash}`;

    const cached = (await this.cache.get(cacheKey)) as SessionUser | null;
    if (cached) return cached;

    const row = await this.prisma.session.findUnique({
      where: { token_hash: hash },
      select: {
        id: true,
        expires_at: true,
        revoked_at: true,
        last_seen_at: true,
        app_user: { select: { id: true, email: true, disabled_at: true } },
      },
    });
    const now = Date.now();
    if (
      !row ||
      row.revoked_at ||
      row.expires_at.getTime() <= now ||
      row.app_user.disabled_at
    ) {
      if (reply) this.clearCookie(reply);
      return null;
    }

    // Sliding expiry, written at most once a day per session.
    if (now - row.last_seen_at.getTime() > RENEW_AFTER_MS) {
      const expiresAt = new Date(now + SESSION_TTL_MS);
      await this.prisma.session.update({
        where: { id: row.id },
        data: { last_seen_at: new Date(now), expires_at: expiresAt },
      });
      if (reply) this.setCookie(reply, token, expiresAt);
    }

    const user: SessionUser = {
      sessionId: row.id,
      userId: row.app_user.id,
      email: row.app_user.email,
    };
    await this.cache.set(cacheKey, user, CACHE_TTL_S);
    return user;
  }

  /** Sign this device out. */
  async revoke(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE];
    this.clearCookie(reply);
    if (!token) return;
    const hash = hashToken(token);
    await this.prisma.session.updateMany({
      where: { token_hash: hash, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await this.cache.delete(`session:${hash}`);
  }

  /** Sign a user out everywhere (account deleted or disabled). */
  async revokeAll(userId: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { user_id: userId, revoked_at: null },
      select: { token_hash: true },
    });
    await this.prisma.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    await Promise.all(sessions.map((s) => this.cache.delete(`session:${s.token_hash}`)));
  }

  private setCookie(reply: FastifyReply, token: string, expires: Date) {
    reply.setCookie(SESSION_COOKIE, token, {
      domain: authCookieDomain(),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  private clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { domain: authCookieDomain(), path: '/' });
  }
}
