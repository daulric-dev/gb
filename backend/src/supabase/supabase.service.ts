import { Injectable } from '@nestjs/common';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';

type Schema = 'public' | 'student' | 'grading' | 'reporting' | 'staff';

interface SessionCookie {
  access_token?: string;
  refresh_token?: string;
}

const BASE64_PREFIX = 'base64-';
const MAX_CHUNKS = 10;

@Injectable()
export class SupabaseService {
  private serviceClient: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  private readonly cookieRef = (process.env.SUPABASE_URL ?? '')
    .replace(/^https?:\/\//, '')
    .split('.')[0];

  private readonly cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  };

  createUserClient(req: FastifyRequest, reply: FastifyReply, schema: Schema) {
    const jar = new Map<string, string>(
      Object.entries(req.cookies ?? {}).map(([k, v]) => [k, String(v ?? '')]),
    );

    return createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUSHABLE_KEY!,
      {
        db: { schema },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
              jar.set(name, value);
              // Our overrides come last intentionally — we enforce httpOnly/secure/sameSite
              // regardless of what the library passes.
              reply.setCookie(name, value, {
                ...options,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
              });
            });
          },
        },
      },
    );
  }

  extractAccessToken(req: FastifyRequest): string | null {
    return this.readAuthSession(req)?.access_token ?? null;
  }

  extractRefreshToken(req: FastifyRequest): string | null {
    // First check the Supabase session cookie
    const fromSession = this.readAuthSession(req)?.refresh_token;
    if (fromSession) return fromSession;

    // Fallback: standalone refresh token cookie (e.g. gb_refresh_token)
    const cookies = req.cookies ?? {};
    const key = Object.keys(cookies).find((n) => n.includes('refresh_token'));
    return key ? cookies[key] || null : null;
  }

  async refreshSession(refreshToken: string) {
    const { data, error } =
      await this.serviceClient.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) return null;
    return data.session;
  }

  setSessionCookies(
    reply: FastifyReply,
    session: { access_token: string; refresh_token: string },
  ) {
    const encoded =
      BASE64_PREFIX +
      Buffer.from(
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
      ).toString('base64url');

    const cookieName = `sb-${this.cookieRef}-auth-token`;

    reply.setCookie(cookieName, encoded, this.cookieOptions);
    reply.setCookie('gb_refresh_token', session.refresh_token, this.cookieOptions);
  }

  clearSessionCookies(reply: FastifyReply) {
    const cookieName = `sb-${this.cookieRef}-auth-token`;
    const clearOptions = { ...this.cookieOptions, maxAge: 0 };

    reply.setCookie(cookieName, '', clearOptions);
    reply.setCookie('gb_refresh_token', '', clearOptions);
  }

  getServiceClient() {
    return this.serviceClient;
  }

  private readAuthSession(req: FastifyRequest): SessionCookie | null {
    const cookies = req.cookies ?? {};
    const names = Object.keys(cookies);

    const baseKey = names.find(
      (n) => n.startsWith('sb-') && n.endsWith('-auth-token'),
    );

    const key =
      baseKey ??
      (() => {
        const chunked = names.find(
          (n) => n.startsWith('sb-') && n.includes('-auth-token.'),
        );
        if (!chunked) return undefined;
        return chunked.slice(0, chunked.lastIndexOf('.'));
      })();

    if (!key) return null;

    let raw: string;

    const direct = cookies[key];
    if (direct !== undefined) {
      raw = direct;
    } else {
      const chunks: string[] = [];
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const chunk = cookies[`${key}.${i}`];
        if (chunk === undefined) break;
        chunks.push(chunk);
      }
      if (chunks.length === 0) return null;
      raw = chunks.join('');
    }

    if (raw.startsWith(BASE64_PREFIX)) {
      try {
        raw = Buffer.from(
          raw.substring(BASE64_PREFIX.length),
          'base64url',
        ).toString('utf-8');
      } catch {
        return null;
      }
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as SessionCookie;
    } catch {
      return null;
    }
  }
}
