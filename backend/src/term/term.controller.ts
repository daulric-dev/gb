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
import { VersioningService } from '@/versioning/versioning.service';
import { TermService } from './term.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
@ApiTags('Terms')
@ApiBearerAuth()
@Controller('terms')
@UseGuards(AuthGuard)
export class TermController {
  constructor(
    private readonly termService: TermService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  async findByYear(@Req() req: any, @Query('yearId') yearId: string) {
    const raw = await this.termService.findByYear(yearId);
    return this.versioning.resolve(req, 'term.list')(raw);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const raw = await this.termService.findOne(id);
    return this.versioning.resolve(req, 'term.detail')(raw);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateTermDto) {
    const raw = await this.termService.create(req.user.id, dto);
    return this.versioning.resolve(req, 'term.created')(raw);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTermDto) {
    const raw = await this.termService.update(id, dto);
    return this.versioning.resolve(req, 'term.updated')(raw);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const raw = await this.termService.delete(id);
    return this.versioning.resolve(req, 'term.deleted')(raw);
  }
}
