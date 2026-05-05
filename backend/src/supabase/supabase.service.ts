import { Injectable } from '@nestjs/common';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';

type Schema = 'public' | 'student' | 'grading' | 'reporting' | 'staff';

const BASE64_PREFIX = 'base64-';

@Injectable()
export class SupabaseService {
  private serviceClient: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  createUserClient(req: FastifyRequest, reply: FastifyReply, schema: Schema) {
    return createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUSHABLE_KEY!,
      {
        db: { schema },
        cookies: {
          getAll: () =>
            Object.entries(req.cookies ?? {}).map(([name, value]) => ({
              name,
              value: String(value ?? ''),
            })),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => {
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
    return this.readAuthTokenCookie(req);
  }

  extractRefreshToken(req: FastifyRequest): string | null {
    const cookies: Record<string, string> = (req as any).cookies ?? {};
    const key = Object.keys(cookies).find((n) => n.includes('refresh_token'));
    return key ? cookies[key] || null : null;
  }

  getServiceClient() {
    return this.serviceClient;
  }

  private readAuthTokenCookie(req: FastifyRequest): string | null {
    const cookies: Record<string, string> = (req as any).cookies ?? {};
    const names = Object.keys(cookies);

    const baseKey = names.find(
      (n) => n.startsWith('sb-') && n.endsWith('-auth-token'),
    );

    const key =
      baseKey ??
      names
        .find((n) => n.startsWith('sb-') && n.includes('-auth-token.'))
        ?.replace(/\.\d+$/, '');

    if (!key) return null;

    let raw: string;

    if (cookies[key]) {
      raw = cookies[key];
    } else {
      const chunks: string[] = [];
      for (let i = 0; ; i++) {
        const chunk = cookies[`${key}.${i}`];
        if (!chunk) break;
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
      return parsed.access_token ?? null;
    } catch {
      return raw || null;
    }
  }
}
