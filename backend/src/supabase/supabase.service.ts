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
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
  }

  getServiceClient() {
    return this.serviceClient;
  }

  async ensureBucket(bucketName: string, isPublic = false): Promise<boolean> {
    const supabase = this.getServiceClient();
  
    const { data: bucket, error } = await supabase.storage.getBucket(bucketName);
    if (bucket) return true;
    
    if (error && !error.message.toLowerCase().includes('not found')) {
      throw error;
    }

    const { data: created, error: createError } = await this.getServiceClient()
      .storage
      .createBucket(bucketName, { public: isPublic });

    if (createError) throw createError;
    return true;
  }

  async uploadFile(bucketName: string, path: string, file: Buffer, contentType: string): Promise<{ path: string, publicUrl: string } | null> {
    await this.ensureBucket(bucketName);
    const { data, error } = await this.getServiceClient()
      .storage.from(bucketName).upload(path, file, {
        contentType,
        upsert: true,
      });

    if (error || !data) return null;

    const { data: publicUrl } = this.getServiceClient()
      .storage
      .from(bucketName)
      .getPublicUrl(data.path);

    return { path: data.path, publicUrl: publicUrl.publicUrl };
  }

  // Transitional: clear the old gb_refresh_token cookie if it's still hanging
  // around in clients from the previous auth implementation. Safe to remove
  // after a few weeks once active users have rotated through.
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
