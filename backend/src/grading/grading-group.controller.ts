import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { GradingGroupService } from './grading-group.service';
import {
  CreateGradingGroupDto,
  ResolveSchemeQueryDto,
  UpdateGradingGroupDto,
} from './dto/grading-group.dto';

/**
 * Weighted grading groups - Assignments 20%, Quizzes 20%, Exam 60%.
 *
 * Gated on the assessment permissions: a scheme decides what assessments are
 * worth, so anyone who may manage assessments may shape it.
 */
@ApiTags('Grading')
@ApiBearerAuth()
@Controller('grading-groups')
@UseGuards(AuthGuard, PermissionGuard)
export class GradingGroupController {
  constructor(private readonly groups: GradingGroupService) {}

  /** The scheme in force for a term, or for one subject within it. */
  @RequirePermission('assessment', 'read')
  @Get()
  async resolve(@Req() req: any, @Query() query: ResolveSchemeQueryDto) {
    return this.groups.resolve(
      req.user.id as string,
      query.termId,
      query.subjectId,
    );
  }

  @RequirePermission('assessment', 'update')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateGradingGroupDto) {
    return this.groups.create(req.user.id as string, dto);
  }

  @RequirePermission('assessment', 'update')
  @Patch(':groupId')
  async update(
    @Req() req: any,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGradingGroupDto,
  ) {
    return this.groups.update(req.user.id as string, groupId, dto);
  }

  @RequirePermission('assessment', 'update')
  @Delete(':groupId')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('groupId') groupId: string) {
    await this.groups.remove(req.user.id as string, groupId);
  }
}
