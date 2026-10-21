import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';

const GROUP_COLUMNS = 'id, course_id, name, weight, position';

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
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
  ) {}

  private get db() {
    return this.supabaseService.getServiceClient().schema('course');
  }

  /** Every group in a course, in display order. Used by the gradebook too. */
  async loadForCourse(courseId: string) {
    const { data, error } = await this.db
      .from('assignment_group')
      .select(GROUP_COLUMNS)
      .eq('course_id', courseId)
      .order('position', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      this.logger.error(`Failed to load assignment groups: ${error.message}`);
      throw new BadRequestException('Failed to load assignment groups');
    }
    return (data ?? []).map((g: any) => toAssignmentGroup(g));
  }

  async list(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    return this.loadForCourse(courseId);
  }

  private nameConflict(error: any): never {
    if (error?.code === '23505') {
      throw new ConflictException(
        'This course already has a group with that name',
      );
    }
    this.logger.error(`Failed to save assignment group: ${error?.message}`);
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

    const { data: last } = await this.db
      .from('assignment_group')
      .select('position')
      .eq('course_id', courseId)
      .order('position', { ascending: false })
      .limit(1);

    const { data, error } = await this.db
      .from('assignment_group')
      .insert({
        course_id: courseId,
        name,
        weight: input.weight ?? null,
        position: ((last?.[0]?.position as number | undefined) ?? -1) + 1,
      })
      .select(GROUP_COLUMNS)
      .single();

    if (error || !data) this.nameConflict(error);
    return toAssignmentGroup(data);
  }

  async update(
    userId: string,
    courseId: string,
    groupId: string,
    patch: { name?: string; weight?: number | null },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Give the group a name');
      changes.name = name;
    }
    if (patch.weight !== undefined) changes.weight = patch.weight;

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const { data, error } = await this.db
      .from('assignment_group')
      .update(changes)
      .eq('id', groupId)
      .eq('course_id', courseId)
      .select(GROUP_COLUMNS)
      .maybeSingle();

    if (error) this.nameConflict(error);
    if (!data) throw new NotFoundException('Assignment group not found');
    return toAssignmentGroup(data);
  }

  /** Its activities fall back to Ungrouped (FK on delete set null). */
  async remove(userId: string, courseId: string, groupId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const { data, error } = await this.db
      .from('assignment_group')
      .delete()
      .eq('id', groupId)
      .eq('course_id', courseId)
      .select('id');

    if (error) {
      this.logger.error(`Failed to delete assignment group: ${error.message}`);
      throw new BadRequestException('Failed to delete the assignment group');
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
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

    for (let i = 0; i < order.length; i++) {
      const { error } = await this.db
        .from('assignment_group')
        .update({ position: i })
        .eq('id', order[i])
        .eq('course_id', courseId);

      if (error) {
        this.logger.error(`Failed to reorder groups: ${error.message}`);
        throw new BadRequestException('Failed to reorder the groups');
      }
    }

    return this.loadForCourse(courseId);
  }
}
