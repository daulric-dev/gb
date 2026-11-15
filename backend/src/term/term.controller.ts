import {
  Body,
  Controller,
  Delete,
  Get,
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
import { VersioningService } from '@/versioning/versioning.service';
import { TermService } from './term.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
@ApiTags('Terms')
@ApiBearerAuth()
@Controller('terms')
@UseGuards(AuthGuard, PermissionGuard)
export class TermController {
  constructor(
    private readonly termService: TermService,
    private readonly versioning: VersioningService,
  ) {}

  @RequirePermission('term', 'read', 'active')
  @Get()
  async findByYear(@Req() req: any, @Query('yearId') yearId: string) {
    const userId: string = req.user.id;
    const raw = await this.termService.findByYear(userId, yearId);
    return this.versioning.resolve(req, 'term.list')(raw);
  }

  @RequirePermission('term', 'read', 'active')
  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const userId: string = req.user.id;
    const raw = await this.termService.findOne(userId, id);
    return this.versioning.resolve(req, 'term.detail')(raw);
  }

  @RequirePermission('term', 'create', 'active')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateTermDto) {
    const userId: string = req.user.id;
    const raw = await this.termService.create(userId, dto);
    return this.versioning.resolve(req, 'term.created')(raw);
  }

  @RequirePermission('term', 'update', 'active')
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTermDto,
  ) {
    const userId: string = req.user.id;
    const raw = await this.termService.update(userId, id, dto);
    return this.versioning.resolve(req, 'term.updated')(raw);
  }

  @RequirePermission('term', 'delete', 'active')
  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const userId: string = req.user.id;
    const raw = await this.termService.delete(userId, id);
    return this.versioning.resolve(req, 'term.deleted')(raw);
  }
}
