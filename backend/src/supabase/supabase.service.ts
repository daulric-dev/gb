import { Injectable } from '@nestjs/common';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';

type Schema = 'public' | 'student' | 'grading' | 'reporting' | 'staff';

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

  getServiceClient() {
    return this.serviceClient;
  }
}
