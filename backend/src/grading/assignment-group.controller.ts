import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { AssignmentGroupService } from './assignment-group.service';
import {
  CreateAssignmentGroupDto,
  ReorderAssignmentGroupsDto,
  UpdateAssignmentGroupDto,
} from './dto/assignment-group.dto';

/**
 * A course's weighted assignment groups. Staff read them; the teacher (or a
 * school admin) changes them. Access is the course role, not the catalog.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('courses/:courseId/assignment-groups')
@UseGuards(AuthGuard)
export class AssignmentGroupController {
  constructor(private readonly groups: AssignmentGroupService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.groups.list(req.user.id as string, courseId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateAssignmentGroupDto,
  ) {
    return this.groups.create(req.user.id as string, courseId, dto);
  }

  // Declared before `:groupId` so "reorder" is never read as an id.
  @Patch('reorder')
  async reorder(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ReorderAssignmentGroupsDto,
  ) {
    return this.groups.reorder(req.user.id as string, courseId, dto.groupIds);
  }

  @Patch(':groupId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateAssignmentGroupDto,
  ) {
    return this.groups.update(req.user.id as string, courseId, groupId, dto);
  }

  /** Its activities move to Ungrouped; nothing else is deleted. */
  @Delete(':groupId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ) {
    await this.groups.remove(req.user.id as string, courseId, groupId);
  }
}
