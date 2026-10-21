import { Injectable, Logger } from '@nestjs/common';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authCookieDomain } from '@/config/origins';
import { PrismaService } from '@/prisma/prisma.service';

type Schema =
  | 'public'
  | 'student'
  | 'grading'
  | 'reporting'
  | 'staff'
  | 'course';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private serviceClient: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  constructor(private readonly prisma: PrismaService) {}

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
                domain: authCookieDomain(),
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

  async signOut(req: FastifyRequest, reply: FastifyReply) {
    const client = this.createUserClient(req, reply, 'public');
    await client.auth.signOut();
    this.clearLegacyRefreshCookie(reply);
  }

  async getUser(req: FastifyRequest, reply: FastifyReply) {
    const client = this.createUserClient(req, reply, 'public');
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      return data.user;
    } catch {
      return null;
    }
  }

  getServiceClient() {
    return this.serviceClient;
  }

  async getUserSchoolId(userId: string): Promise<string> {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });

    if (!profile?.school_id) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return profile.school_id;
  }

  private clearLegacyRefreshCookie(reply: FastifyReply) {
    reply.setCookie('gb_refresh_token', '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
  }
}
