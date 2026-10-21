import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

const EXPO_TOKEN = /^Expo(nent)?PushToken\[.+\]$/;

export type PushPlatform = 'ios' | 'android' | 'web';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android notification channel the app created (e.g. `attendance`). */
  channelId?: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Expo push notifications to signed-in devices.
 *
 * A token belongs to whoever last registered it, so a shared phone stops
 * notifying its previous owner. Sending is best effort: it never throws, and
 * a token Expo says is gone is forgotten.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  /** Swappable in tests. */
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (
    url,
    init,
  ) => fetch(url, init);

  constructor(private readonly supabaseService: SupabaseService) {}

  async register(userId: string, token: string, platform: PushPlatform) {
    const { error } = await this.supabaseService
      .getServiceClient()
      .from('push_device')
      .upsert(
        {
          user_id: userId,
          token: token.trim(),
          platform,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );

    if (error) {
      this.logger.error(`Failed to register push device: ${error.message}`);
      throw new BadRequestException('Failed to register the device');
    }
  }

  /** Only ever the caller's own token; anyone else's is left alone. */
  async unregister(userId: string, token: string) {
    const { error } = await this.supabaseService
      .getServiceClient()
      .from('push_device')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    if (error) {
      this.logger.error(`Failed to remove push device: ${error.message}`);
      throw new BadRequestException('Failed to remove the device');
    }
  }

  /** Push to every device of these users. Never throws. */
  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    try {
      const unique = [...new Set(userIds.filter(Boolean))];
      if (unique.length === 0) return;

      const { data, error } = await this.supabaseService
        .getServiceClient()
        .from('push_device')
        .select('token')
        .in('user_id', unique);

      if (error) {
        this.logger.error(`Failed to load push devices: ${error.message}`);
        return;
      }

      const tokens = [
        ...new Set(
          (data ?? [])
            .map((d: any) => d.token as string)
            .filter((t) => EXPO_TOKEN.test(t)),
        ),
      ];
      if (tokens.length === 0) return;

      const gone: string[] = [];
      for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
        const chunk = tokens.slice(i, i + CHUNK_SIZE);
        gone.push(...(await this.sendChunk(chunk, message)));
      }

      if (gone.length > 0) await this.forget(gone);
    } catch (err) {
      this.logger.error(`Push send failed: ${(err as Error).message}`);
    }
  }

  /** Send one batch; returns the tokens Expo says no longer exist. */
  private async sendChunk(
    tokens: string[],
    message: PushMessage,
  ): Promise<string[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: 'default',
            priority: 'high',
            ...(message.channelId ? { channelId: message.channelId } : {}),
          })),
        ),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`Expo push rejected (${res.status}): ${text}`);
        return [];
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(json?.data) ? json.data : [];
      const gone: string[] = [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status !== 'error') return;
        if (ticket.details?.error === 'DeviceNotRegistered' && tokens[i]) {
          gone.push(tokens[i]);
        } else {
          this.logger.warn(
            `Expo push ticket error: ${ticket.details?.error ?? ''} ${ticket.message ?? ''}`,
          );
        }
      });
      return gone;
    } catch (err) {
      this.logger.error(`Expo push request failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async forget(tokens: string[]) {
    const { error } = await this.supabaseService
      .getServiceClient()
      .from('push_device')
      .delete()
      .in('token', tokens);
    if (error) {
      this.logger.error(`Failed to forget push devices: ${error.message}`);
    }
  }
}
