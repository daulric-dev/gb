import { Injectable } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';

const NOTIFICATION_COLUMNS =
  'id, type, file_id, share_id, title, body, can_download, read_at, created_at';
const MAX_NOTIFICATIONS = 50;

@Injectable()
export class FileNotificationService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Most recent notifications for the user, newest first. */
  async list(userId: string) {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('notification')
      .select(NOTIFICATION_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_NOTIFICATIONS);
    return data ?? [];
  }

  /** Count of the user's unread notifications. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const { count } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('notification')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    return { count: count ?? 0 };
  }

  /** Mark all of the user's unread notifications as read. */
  async markAllRead(userId: string): Promise<{ count: number }> {
    const { data } = await this.supabase
      .getServiceClient()
      .schema('file_manager')
      .from('notification')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id');
    return { count: (data ?? []).length };
  }
}
