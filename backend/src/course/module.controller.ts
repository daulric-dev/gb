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
import { ModuleService } from './module.service';
import {
  CreateModuleDto,
  CreateModuleItemDto,
  ReorderModuleItemsDto,
  ReorderModulesDto,
  UpdateModuleDto,
  UpdateModuleItemDto,
} from './dto/content.dto';

/**
 * Course modules and their items. Access is the caller's course role
 * (CourseAccessService): staff read, teachers and admins write.
 *
 * The static `reorder` routes are declared before their `:moduleId` /
 * `:itemId` siblings so nothing reads "reorder" as an id.
 */
@ApiTags('Course modules')
@ApiBearerAuth()
@Controller('courses/:courseId/modules')
@UseGuards(AuthGuard)
export class ModuleController {
  constructor(private readonly modules: ModuleService) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.modules.list(req.user.id as string, courseId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateModuleDto,
  ) {
    return this.modules.create(req.user.id as string, courseId, dto.title);
  }

  @Patch('reorder')
  async reorder(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ReorderModulesDto,
  ) {
    return this.modules.reorder(req.user.id as string, courseId, dto.moduleIds);
  }

  @Patch(':moduleId')
  async update(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.modules.update(req.user.id as string, courseId, moduleId, dto);
  }

  @Delete(':moduleId')
  @HttpCode(204)
  async remove(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
  ) {
    await this.modules.remove(req.user.id as string, courseId, moduleId);
  }

  // ── items ─────────────────────────────────────────────────────────────────

  @Post(':moduleId/items')
  async createItem(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Body() dto: CreateModuleItemDto,
  ) {
    return this.modules.createItem(
      req.user.id as string,
      courseId,
      moduleId,
      dto,
    );
  }

  @Patch(':moduleId/items/reorder')
  async reorderItems(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Body() dto: ReorderModuleItemsDto,
  ) {
    return this.modules.reorderItems(
      req.user.id as string,
      courseId,
      moduleId,
      dto.itemIds,
    );
  }

  @Patch(':moduleId/items/:itemId')
  async updateItem(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateModuleItemDto,
  ) {
    return this.modules.updateItem(
      req.user.id as string,
      courseId,
      moduleId,
      itemId,
      dto,
    );
  }

  @Delete(':moduleId/items/:itemId')
  @HttpCode(204)
  async removeItem(
    @Req() req: any,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    await this.modules.removeItem(
      req.user.id as string,
      courseId,
      moduleId,
      itemId,
    );
  }
}
