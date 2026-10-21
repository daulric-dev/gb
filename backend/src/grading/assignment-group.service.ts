import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { isUniqueViolation } from '@/common/db-values';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';

const GROUP_SELECT = {
  id: true,
  course_id: true,
  name: true,
  weight: true,
  position: true,
} satisfies Prisma.assignment_groupSelect;

/** The `AssignmentGroup` contract. */
export function toAssignmentGroup(g: any) {
  return {
    id: g.id as string,
    courseId: g.course_id as string,
    name: g.name as string,
    weight:
      g.weight === null || g.weight === undefined ? null : Number(g.weight),
    position: (g.position as number) ?? 0,
  };
}

/**
 * A course's weighted categories (Assignments 30%, Quizzes 20%, Exam 50%).
 *
 * Weights need not total 100: the course total renormalises over the groups
 * that have marks (see gradebook.calc.ts), so a teacher can set them as they
 * think of them. Deleting a group does not delete its work - the foreign key
 * moves those activities to Ungrouped.
 */
@Injectable()
export class AssignmentGroupService {
  private readonly logger = new Logger(AssignmentGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  /** Every group in a course, in display order. Used by the gradebook too. */
  async loadForCourse(courseId: string) {
    let data;
    try {
      data = await this.prisma.assignment_group.findMany({
        where: { course_id: courseId },
        select: GROUP_SELECT,
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
    } catch (error) {
      this.logger.error(
        `Failed to load assignment groups: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to load assignment groups');
    }
    return data.map((g) => toAssignmentGroup(g));
  }

  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    return this.loadForCourse(courseId);
  }

  private nameConflict(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException(
        'This course already has a group with that name',
      );
    }
    this.logger.error(
      `Failed to save assignment group: ${(error as Error | undefined)?.message}`,
    );
    throw new BadRequestException('Failed to save the assignment group');
  }

  async create(
    userId: string,
    courseId: string,
    input: { name: string; weight?: number | null },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the group a name');

    const last = await this.prisma.assignment_group.findFirst({
      where: { course_id: courseId },
      select: { position: true },
      orderBy: { position: 'desc' },
    });

    try {
      const data = await this.prisma.assignment_group.create({
        data: {
          course_id: courseId,
          name,
          weight: input.weight ?? null,
          position: (last?.position ?? -1) + 1,
        },
        select: GROUP_SELECT,
      });
      return toAssignmentGroup(data);
    } catch (error) {
      this.nameConflict(error);
    }
  }

  async update(
    userId: string,
    courseId: string,
    groupId: string,
    patch: { name?: string; weight?: number | null },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const changes: Prisma.assignment_groupUpdateManyMutationInput = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Give the group a name');
      changes.name = name;
    }
    if (patch.weight !== undefined) changes.weight = patch.weight;

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    let data;
    try {
      [data] = await this.prisma.assignment_group.updateManyAndReturn({
        where: { id: groupId, course_id: courseId },
        data: changes,
        select: GROUP_SELECT,
      });
    } catch (error) {
      this.nameConflict(error);
    }
    if (!data) throw new NotFoundException('Assignment group not found');
    return toAssignmentGroup(data);
  }

  /** Its activities fall back to Ungrouped (FK on delete set null). */
  async remove(userId: string, courseId: string, groupId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    let count: number;
    try {
      ({ count } = await this.prisma.assignment_group.deleteMany({
        where: { id: groupId, course_id: courseId },
      }));
    } catch (error) {
      this.logger.error(
        `Failed to delete assignment group: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to delete the assignment group');
    }
    if (count === 0) {
      throw new NotFoundException('Assignment group not found');
    }
  }

  /**
   * Set the display order. Every id must be one of the course's groups; any
   * the client leaves out keep their place after the ones it sent, so a stale
   * list cannot drop a group off the end.
   */
  async reorder(userId: string, courseId: string, groupIds: string[]) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const current = await this.loadForCourse(courseId);
    const known = new Set(current.map((g) => g.id));
    if (groupIds.some((id) => !known.has(id))) {
      throw new NotFoundException('Assignment group not found');
    }

    const sent = [...new Set(groupIds)];
    const rest = current.map((g) => g.id).filter((id) => !sent.includes(id));
    const order = [...sent, ...rest];

    try {
      await this.prisma.$transaction(
        order.map((id, i) =>
          this.prisma.assignment_group.updateMany({
            where: { id, course_id: courseId },
            data: { position: i },
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to reorder groups: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to reorder the groups');
    }

    return this.loadForCourse(courseId);
  }
}
