import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ImagesService } from '@/images/images.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
} from './access/course-access.service';
import { COURSE_BANNER_MAX_BYTES } from './course-appearance';
import { CourseService } from './course.service';

/**
 * A course's cover image. Whoever may change the course's settings (its
 * teachers, or a school admin with `course:update`) may set or remove it.
 *
 * Uploads are presigned: the ticket names a staging key
 * `uploads/course-banners/<courseId>-<random>.<ext>`, the client PUTs the
 * bytes straight to storage, and completing verifies them (ImagesService) and
 * writes them to `course-banners/<courseId>-<random>.<ext>`. The previous
 * cover is deleted once the course points at the new one.
 */
@Injectable()
export class CourseBannerService {
  private readonly logger = new Logger(CourseBannerService.name);

  constructor(
    private readonly access: CourseAccessService,
    private readonly courses: CourseService,
    private readonly images: ImagesService,
    private readonly prisma: PrismaService,
  ) {}

  async createTicket(
    userId: string,
    courseId: string,
    contentType: string,
    totalSize: number,
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const { staging } = this.images.newImagePath(
      'course-banners',
      courseId,
      contentType,
    );
    return this.images.createImageTicket(
      staging,
      contentType,
      totalSize,
      COURSE_BANNER_MAX_BYTES,
    );
  }

  /** Verify the uploaded cover and make it the course's banner. */
  async complete(userId: string, courseId: string, path: string) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    const served = this.images.servedPathFor('course-banners', courseId, path);
    await this.images.finalizeImage(path, served, COURSE_BANNER_MAX_BYTES);

    try {
      await this.prisma.course.update({
        where: { id: courseId },
        data: { banner_image_path: served, updated_at: new Date() },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error(
        `Failed to set course banner: ${(error as Error).message}`,
      );
      await this.images.removeImage(served);
      throw new BadRequestException('Failed to save the cover image');
    }
    if (course.banner_image_path !== served) {
      await this.images.removeImage(course.banner_image_path);
    }

    return this.courses.get(userId, courseId);
  }

  /** Back to the colour (or the id-derived gradient). */
  async remove(userId: string, courseId: string) {
    const { course } = await this.access.require(
      userId,
      courseId,
      MANAGE_ROLES,
    );
    if (course.banner_image_path) {
      try {
        await this.prisma.course.update({
          where: { id: courseId },
          data: { banner_image_path: null, updated_at: new Date() },
          select: { id: true },
        });
      } catch (error) {
        this.logger.error(
          `Failed to clear course banner: ${(error as Error).message}`,
        );
        throw new BadRequestException('Failed to remove the cover image');
      }
      await this.images.removeImage(course.banner_image_path);
    }
    return this.courses.get(userId, courseId);
  }
}
