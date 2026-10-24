import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';

const NOTIFICATION_COLUMNS = {
  id: true,
  type: true,
  file_id: true,
  share_id: true,
  title: true,
  body: true,
  can_download: true,
  read_at: true,
  created_at: true,
} satisfies Prisma.notificationSelect;
const MAX_NOTIFICATIONS = 50;

@Injectable()
export class FileNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Most recent notifications for the user, newest first. */
  async list(userId: string) {
    return this.prisma.notification.findMany({
      where: { user_id: userId },
      select: NOTIFICATION_COLUMNS,
      orderBy: { created_at: 'desc' },
      take: MAX_NOTIFICATIONS,
    });
  }

  /** Count of the user's unread notifications. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { user_id: userId, read_at: null },
    });
    return { count: count ?? 0 };
  }

  /** Mark all of the user's unread notifications as read. */
  async markAllRead(userId: string): Promise<{ count: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
    return { count };
  }
}
