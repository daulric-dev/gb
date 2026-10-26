import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { isNotFound } from '@/common/db-values';
import { FileQueueService } from '@/queue/file-queue.service';
import { SharePrincipalType, type ShareTargetDto } from './dto/share-file.dto';

const SHARE_COLUMNS = {
  id: true,
  principal_type: true,
  principal_id: true,
  can_download: true,
  created_at: true,
} satisfies Prisma.file_shareSelect;

/**
 * Manages a file's share list. All methods assume ownership has already been
 * verified by the caller (FileManagerService) — they operate on a known file.
 */
@Injectable()
export class FileShareService {
  private readonly logger = new Logger(FileShareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: FileQueueService,
  ) {}

  async list(fileId: string) {
    return this.prisma.file_share.findMany({
      where: { file_id: fileId },
      select: SHARE_COLUMNS,
      orderBy: { created_at: 'asc' },
    });
  }

  async share(
    fileId: string,
    schoolId: string,
    createdBy: string,
    targets: ShareTargetDto[],
  ) {
    await this.assertCoursesInSchool(schoolId, targets);
    await this.assertUsersInSchool(schoolId, targets);
    await this.assertRolesInSchool(schoolId, targets);

    let data: Prisma.file_shareGetPayload<{ select: typeof SHARE_COLUMNS }>[];
    try {
      // Re-sharing with a principal updates the existing row in place.
      data = await this.prisma.$transaction(
        targets.map((t) => {
          const row = {
            school_id: schoolId,
            can_download: t.canDownload ?? false,
            created_by: createdBy,
          };
          return this.prisma.file_share.upsert({
            where: {
              file_id_principal_type_principal_id: {
                file_id: fileId,
                principal_type: t.principalType,
                principal_id: t.principalId,
              },
            },
            create: {
              file_id: fileId,
              principal_type: t.principalType,
              principal_id: t.principalId,
              ...row,
            },
            update: row,
            select: SHARE_COLUMNS,
          });
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to create shares for ${fileId}: ${(error as Error).message}`,
      );
      throw error;
    }

    for (const share of data ?? []) {
      await this.queue.enqueueShareNotify({ shareId: share.id });
    }

    return data ?? [];
  }

  /**
   * A course share must name a course of the file's own school; anything else
   * would be a share nobody can ever match, or a probe for course ids.
   */
  private async assertCoursesInSchool(
    schoolId: string,
    targets: ShareTargetDto[],
  ) {
    const courseIds = idsOf(targets, SharePrincipalType.Course);
    if (courseIds.length === 0) return;

    const data = await this.prisma.course.findMany({
      where: { school_id: schoolId, id: { in: courseIds } },
      select: { id: true },
    });

    if ((data ?? []).length !== courseIds.length) {
      throw new NotFoundException('Course not found');
    }
  }

  /**
   * A user share must name a member of the file's school: someone whose
   * current school it is, or who holds a membership in it. Anything else would
   * leak the file (and a chat DM) across schools.
   */
  private async assertUsersInSchool(
    schoolId: string,
    targets: ShareTargetDto[],
  ) {
    const userIds = idsOf(targets, SharePrincipalType.User);
    if (userIds.length === 0) return;

    const data = await this.prisma.user_profile.findMany({
      where: {
        id: { in: userIds },
        OR: [
          { school_id: schoolId },
          { school_management: { some: { school_id: schoolId } } },
        ],
      },
      select: { id: true },
    });

    if ((data ?? []).length !== userIds.length) {
      throw new BadRequestException('User is not a member of this school');
    }
  }

  /** A role share must name one of the file's school's own roles. */
  private async assertRolesInSchool(
    schoolId: string,
    targets: ShareTargetDto[],
  ) {
    const roleIds = idsOf(targets, SharePrincipalType.Role);
    if (roleIds.length === 0) return;

    const data = await this.prisma.school_role.findMany({
      where: { school_id: schoolId, id: { in: roleIds } },
      select: { id: true },
    });

    if ((data ?? []).length !== roleIds.length) {
      throw new BadRequestException('Role does not belong to this school');
    }
  }

  async updateDownload(fileId: string, shareId: string, canDownload: boolean) {
    try {
      return await this.prisma.file_share.update({
        where: { id: shareId, file_id: fileId },
        data: { can_download: canDownload },
        select: SHARE_COLUMNS,
      });
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundException('Share not found');
      throw error;
    }
  }

  async revoke(fileId: string, shareId: string) {
    await this.prisma.file_share.deleteMany({
      where: { id: shareId, file_id: fileId },
    });
    return { id: shareId, revoked: true };
  }
}

/** Distinct principal ids of one type. */
function idsOf(targets: ShareTargetDto[], type: SharePrincipalType): string[] {
  return [
    ...new Set(
      targets.filter((t) => t.principalType === type).map((t) => t.principalId),
    ),
  ];
}
