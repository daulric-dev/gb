import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { CourseAccessService, MANAGE_ROLES, STAFF_ROLES } from '@/course/access/course-access.service';
import { ActivityService } from '@/grading/activity.service';
import type { CreateLtiItemDto } from './dto/lti.dto';
import { normaliseCustomParams } from './lti-values';

/**
 * "External tool" module items: an LTI resource link to a registered tool,
 * optionally with a gradebook column (line item) the tool can post scores
 * to. The column is an ordinary offline activity created and published
 * through ActivityService, so the gradebook treats it like any other work.
 */
@Injectable()
export class LtiLinkService {
  private readonly logger = new Logger(LtiLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly activities: ActivityService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Enabled tools deployed to every school or to this course's school. */
  async availableTools(userId: string, courseId: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const tools = await this.prisma.lti_tool.findMany({
      where: {
        enabled: true,
        deployments: { some: { OR: [{ school_id: course.school_id }, { school_id: null }] } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, ags_enabled: true },
    });
    return tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      agsEnabled: t.ags_enabled,
    }));
  }

  /** The deployment a school launches a tool through: its own, else the all-schools one. */
  async deploymentFor(toolId: string, schoolId: string) {
    const rows = await this.prisma.lti_deployment.findMany({
      where: { tool_id: toolId, OR: [{ school_id: schoolId }, { school_id: null }] },
      select: { id: true, deployment_id: true, school_id: true },
    });
    return rows.find((d) => d.school_id === schoolId) ?? rows.find((d) => d.school_id === null) ?? null;
  }

  async createItem(userId: string, courseId: string, moduleId: string, dto: CreateLtiItemDto) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const module = await this.prisma.module.findFirst({
      where: { id: moduleId, course_id: courseId },
      select: { id: true },
    });
    if (!module) throw new NotFoundException('Module not found');

    const tool = await this.prisma.lti_tool.findFirst({
      where: { id: dto.toolId, enabled: true },
      select: { id: true, name: true, ags_enabled: true },
    });
    if (!tool) throw new NotFoundException('Tool not found');
    const deployment = await this.deploymentFor(tool.id, course.school_id);
    if (!deployment) throw new NotFoundException('Tool not found');
    if (dto.points !== undefined && !tool.ags_enabled) {
      throw new BadRequestException('This tool is not set up to send grades back');
    }

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Give the item a title');
    const custom = normaliseCustomParams(dto.customParams);

    // The gradebook column first, through the grading service (it checks the
    // caller may create work and writes its own audit entry).
    let activityId: string | null = null;
    if (dto.points !== undefined) {
      const activity = await this.activities.create(userId, courseId, {
        kind: 'offline',
        title,
        points: dto.points,
      });
      activityId = activity.id;
      await this.activities.publish(userId, activityId);
    }

    const top = await this.prisma.module_item.findFirst({
      where: { module_id: moduleId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = top ? top.position + 1 : 0;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const item = await tx.module_item.create({
          data: {
            module_id: moduleId,
            course_id: courseId,
            item_type: 'external_tool',
            title,
            position,
            indent: dto.indent ?? 0,
          },
          select: { id: true, module_id: true, position: true, indent: true, is_published: true },
        });
        const link = await tx.lti_resource_link.create({
          data: {
            tool_id: tool.id,
            deployment_id: deployment.id,
            course_id: courseId,
            module_item_id: item.id,
            custom_params: custom,
            created_by: userId,
          },
          select: { id: true },
        });
        if (activityId) {
          await tx.lti_line_item.create({
            data: { tool_id: tool.id, course_id: courseId, activity_id: activityId, resource_link_id: link.id },
          });
        }
        await this.auditLog?.record(tx, course.school_id, { id: userId }, {
          entity: 'module_item',
          entityId: item.id,
          action: 'create',
          changes: auditChanges(null, {
            module_id: moduleId,
            item_type: 'external_tool',
            title,
            lti_tool_id: tool.id,
            lti_resource_link_id: link.id,
            custom_params: custom,
            activity_id: activityId,
          }),
        });
        return { item, link };
      });
      return {
        id: result.item.id,
        moduleId: result.item.module_id,
        position: result.item.position,
        itemType: 'external_tool' as const,
        title,
        indent: result.item.indent,
        isPublished: result.item.is_published,
        activityId,
        externalTool: {
          toolId: tool.id,
          toolName: tool.name,
          resourceLinkId: result.link.id,
          activityId,
          points: dto.points ?? null,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to add external tool: ${(error as Error).message}`);
      // Do not leave a column behind for an item that was never made.
      if (activityId) {
        await this.prisma.activity.deleteMany({ where: { id: activityId } }).catch(() => undefined);
      }
      throw new BadRequestException('Failed to add the external tool');
    }
  }

  private async loadLink(courseId: string, itemId: string) {
    const link = await this.prisma.lti_resource_link.findFirst({
      where: { module_item_id: itemId, course_id: courseId },
      select: {
        id: true,
        custom_params: true,
        tool: { select: { id: true, name: true, enabled: true, ags_enabled: true } },
        line_items: { select: { id: true, activity_id: true, activity: { select: { points: true } } } },
      },
    });
    if (!link) throw new NotFoundException('External tool item not found');
    return link;
  }

  private shapeLink(link: Awaited<ReturnType<LtiLinkService['loadLink']>>) {
    const line = link.line_items[0];
    return {
      resourceLinkId: link.id,
      toolId: link.tool.id,
      toolName: link.tool.name,
      toolEnabled: link.tool.enabled,
      customParams: (link.custom_params ?? {}) as Record<string, string>,
      lineItem: line ? { id: line.id, activityId: line.activity_id, points: Number(line.activity.points) } : null,
    };
  }

  async getItem(userId: string, courseId: string, itemId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);
    return this.shapeLink(await this.loadLink(courseId, itemId));
  }

  async updateItem(userId: string, courseId: string, itemId: string, customParams: unknown) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const link = await this.loadLink(courseId, itemId);
    const custom = normaliseCustomParams(customParams);
    await this.prisma.$transaction(async (tx) => {
      await tx.lti_resource_link.update({ where: { id: link.id }, data: { custom_params: custom } });
      await this.auditLog?.record(tx, course.school_id, { id: userId }, {
        entity: 'lti_resource_link',
        entityId: link.id,
        action: 'update',
        changes: auditChanges({ custom_params: link.custom_params }, { custom_params: custom }),
      });
    });
    return this.shapeLink(await this.loadLink(courseId, itemId));
  }
}
