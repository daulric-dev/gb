import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from './access/course-access.service';

/**
 * Files a course offers, opened by its staff.
 *
 * A module item can link a colleague's file, which the file manager would
 * not let another teacher open. Course staff may read any file the course
 * itself offers - linked by one of its module items (drafts included) or
 * shared with the course - plus their own. Anything else is not found.
 */
@Injectable()
export class CourseFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly files: FileManagerService,
  ) {}

  async read(userId: string, courseId: string, fileId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);

    const [linked, shared, owned] = await Promise.all([
      this.prisma.module_item.findFirst({
        where: { course_id: courseId, file_id: fileId },
        select: { id: true },
      }),
      this.prisma.file_share.findFirst({
        where: {
          file_id: fileId,
          principal_type: 'course',
          principal_id: courseId,
        },
        select: { id: true },
      }),
      this.prisma.file.findFirst({
        where: { id: fileId, owner_id: userId, deleted_at: null },
        select: { id: true },
      }),
    ]);
    if (!linked && !shared && !owned) {
      throw new NotFoundException('File not found');
    }

    return this.files.readContentForAuthorisedCaller(fileId);
  }
}
