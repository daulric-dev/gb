import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { ShareNotifyJobData } from '../queue.constants';

/**
 * Writes the in-app "a file was shared with you" notifications for one share:
 * one row per recipient, never for the person who shared it. Re-running it is
 * harmless - (user_id, share_id) is unique and duplicates are skipped.
 */
@Injectable()
export class FileShareNotifyHandler {
  private readonly logger = new Logger(FileShareNotifyHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(data: ShareNotifyJobData): Promise<void> {
    const share = await this.prisma.file_share.findUnique({
      where: { id: data.shareId },
      select: {
        id: true,
        file_id: true,
        school_id: true,
        principal_type: true,
        principal_id: true,
        can_download: true,
      },
    });

    if (!share) {
      this.logger.warn(`Share-notify skipped: share ${data.shareId} not found`);
      return;
    }

    const file = await this.prisma.file.findUnique({
      where: { id: share.file_id },
      select: { id: true, name: true, owner_id: true },
    });

    if (!file) {
      this.logger.warn(`Share-notify skipped: file ${share.file_id} gone`);
      return;
    }

    const recipients = await this.recipientsOf(share);
    const targets = [...new Set(recipients)].filter(
      (id) => !!id && id !== file.owner_id,
    );
    if (targets.length === 0) return;

    const { count } = await this.prisma.notification.createMany({
      data: targets.map((userId) => ({
        school_id: share.school_id,
        user_id: userId,
        file_id: file.id,
        share_id: share.id,
        type: 'file_share',
        title: `"${file.name}" was shared with you`,
        body: share.can_download
          ? 'You can view and download this file.'
          : 'You can view this file.',
        can_download: share.can_download,
      })),
      skipDuplicates: true,
    });
    this.logger.log(`Share ${share.id}: notified ${count} user(s)`);
  }

  /** The user ids a share reaches, before the sharer is removed. */
  private async recipientsOf(share: {
    school_id: string;
    principal_type: string;
    principal_id: string;
  }): Promise<string[]> {
    switch (share.principal_type) {
      case 'user':
        return [share.principal_id];

      case 'role': {
        // Members of this school holding the custom role.
        const rows = await this.prisma.school_management_role.findMany({
          where: {
            school_role_id: share.principal_id,
            school_management: { school_id: share.school_id },
          },
          select: { school_management: { select: { user_id: true } } },
        });
        return rows.map((r) => r.school_management.user_id);
      }

      case 'course': {
        const course = await this.prisma.course.findFirst({
          where: { id: share.principal_id, school_id: share.school_id },
          select: { id: true },
        });
        if (!course) return [];
        const [staff, students] = await Promise.all([
          this.prisma.course_staff.findMany({
            where: { course_id: course.id },
            select: { user_profile_id: true },
          }),
          this.prisma.course_student.findMany({
            where: {
              course_id: course.id,
              status: 'active',
              student: { user_profile_id: { not: null } },
            },
            select: { student: { select: { user_profile_id: true } } },
          }),
        ]);
        // As in FileAccessService: staff rows outlive leaving the school, so
        // they count only while the user is still a member of it.
        const members = await this.prisma.school_management.findMany({
          where: {
            school_id: share.school_id,
            user_id: { in: staff.map((s) => s.user_profile_id) },
          },
          select: { user_id: true },
        });
        return [
          ...members.map((m) => m.user_id),
          ...students.map((s) => s.student.user_profile_id as string),
        ];
      }

      default:
        return [];
    }
  }
}
