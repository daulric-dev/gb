import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ClamavScanner } from '@/scan/clamav.scanner';

type Schema = 'public' | 'student' | 'grading' | 'reporting' | 'staff';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private serviceClient: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  constructor(private readonly scanner: ClamavScanner) {}

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
                domain:
                  process.env.NODE_ENV === 'production'
                    ? `.${new URL(process.env.FRONTEND_URL!).hostname.split('.').slice(-2).join('.')}`
                    : undefined,
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
    const { data, error } = await this.serviceClient
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .single();

    if (error || !data?.school_id) {
      throw new Error(`Could not resolve school for user ${userId}`);
    }
    return data.school_id;
  }

  async uploadFile(bucketName: string, path: string, file: Buffer,contentType: string): Promise<{ path: string; publicUrl: string } | null> {
    await this.scanOrThrow(file, `${bucketName}/${path}`);

    const { data, error } = await this.getServiceClient()
      .storage.from(bucketName)
      .upload(path, file, {
        contentType,
        upsert: true,
      });

    if (error || !data) return null;

    const { data: publicUrl } = this.getServiceClient()
      .storage.from(bucketName)
      .getPublicUrl(data.path);

    return { path: data.path, publicUrl: publicUrl.publicUrl };
  }

  async scanOrThrow(file: Buffer, label: string): Promise<void> {
    const verdict = await this.scanner.scan(file);
    if (!verdict.clean) {
      this.logger.warn(
        `Upload blocked (infected): ${label} — ${verdict.signature ?? 'threat detected'}`,
      );
      throw new BadRequestException(
        `File rejected: failed virus scan${verdict.signature ? ` (${verdict.signature})` : ''}`,
      );
    }
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
