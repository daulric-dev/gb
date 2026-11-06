import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@/cache/cache.service';
import { ImagesService } from '@/images/images.service';
import { optionalImageUrl } from '@/images/public-url';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';

/** Largest logo accepted. */
export const SCHOOL_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The active school's logo. The controller gates every route on
 * `school:update`. Same presigned flow as course banners (ImagesService):
 * ticket → PUT to `uploads/school-logos/<schoolId>-<random>.<ext>` → complete
 * verifies the bytes and serves them from `school-logos/<schoolId>-<random>.<ext>`.
 * JPEG, PNG and WebP only; SVG is refused because it can carry script.
 */
@Injectable()
export class SchoolLogoService {
  private readonly logger = new Logger(SchoolLogoService.name);

  constructor(
    private readonly images: ImagesService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly auditLog?: AuditLogService,
  ) {}

  async createTicket(schoolId: string, contentType: string, totalSize: number) {
    const { staging } = this.images.newImagePath(
      'school-logos',
      schoolId,
      contentType,
    );
    return this.images.createImageTicket(
      staging,
      contentType,
      totalSize,
      SCHOOL_LOGO_MAX_BYTES,
    );
  }

  async complete(schoolId: string, path: string, actorId?: string) {
    const served = this.images.servedPathFor('school-logos', schoolId, path);
    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { logo_path: true },
    });
    await this.images.finalizeImage(path, served, SCHOOL_LOGO_MAX_BYTES);

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.school.findUniqueOrThrow({
          where: { id: schoolId },
          select: { logo_path: true },
        });
        await tx.school.update({
          where: { id: schoolId },
          data: { logo_path: served },
          select: { id: true },
        });
        if (actorId) {
          await this.auditLog?.record(
            tx,
            schoolId,
            { id: actorId },
            {
              entity: 'school',
              entityId: schoolId,
              action: 'update',
              changes: auditChanges(
                { logo_path: current.logo_path },
                { logo_path: served },
              ),
            },
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to set school logo: ${(error as Error).message}`,
      );
      await this.images.removeImage(served);
      throw new BadRequestException('Failed to save the logo');
    }
    if (before?.logo_path && before.logo_path !== served) {
      await this.images.removeImage(before.logo_path);
    }
    await this.forgetProfiles(schoolId);
    return { logoUrl: optionalImageUrl(served) };
  }

  async remove(schoolId: string, actorId?: string) {
    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { logo_path: true },
    });
    if (before?.logo_path) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.school.update({
            where: { id: schoolId },
            data: { logo_path: null },
            select: { id: true },
          });
          if (actorId) {
            await this.auditLog?.record(
              tx,
              schoolId,
              { id: actorId },
              {
                entity: 'school',
                entityId: schoolId,
                action: 'update',
                changes: auditChanges(
                  { logo_path: before.logo_path },
                  { logo_path: null },
                ),
              },
            );
          }
        });
      } catch (error) {
        this.logger.error(
          `Failed to clear school logo: ${(error as Error).message}`,
        );
        throw new BadRequestException('Failed to remove the logo');
      }
      await this.images.removeImage(before.logo_path);
      await this.forgetProfiles(schoolId);
    }
    return { logoUrl: null };
  }

  /**
   * Every member's cached profile embeds the school (and so its logo URL);
   * drop them so the next profile load shows the new logo.
   */
  private async forgetProfiles(schoolId: string) {
    const members = await this.prisma.user_profile.findMany({
      where: { school_id: schoolId },
      select: { id: true },
    });
    await Promise.all(members.map((m) => this.cache.delete(`profile:${m.id}`)));
  }
}
