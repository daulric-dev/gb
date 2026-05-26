import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AcademicYearService } from './academic-year.service';
import { AuthGuard } from '@/auth/auth.guard';
import { VersioningService } from '@/versioning/versioning.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
@ApiTags('Academic Years')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('academic-years')
export class AcademicYearController {
  constructor(
    private readonly academicYearService: AcademicYearService,
    private readonly versioning: VersioningService,
  ) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateAcademicYearDto) {
    const raw = await this.academicYearService.create(req.user.id, dto);
    return this.versioning.resolve(req, 'academicYear.created')(raw);
  }

  @Get()
  async findAll(@Req() req: any) {
    const raw = await this.academicYearService.findAll(req.user.id);
    return this.versioning.resolve(req, 'academicYear.list')(raw);
  }

  @Get('active')
  async findActive(@Req() req: any) {
    const raw = await this.academicYearService.findActive(req.user.id);
    return this.versioning.resolve(req, 'academicYear.detail')(raw);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const raw = await this.academicYearService.findOne(req.user.id, id);
    return this.versioning.resolve(req, 'academicYear.detail')(raw);
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateAcademicYearDto,
  ) {
    const raw = await this.academicYearService.update(req.user.id, id, dto);
    return this.versioning.resolve(req, 'academicYear.updated')(raw);
  }

  @Patch(':id/activate')
  async setActive(@Req() req: any, @Param('id') id: string) {
    const raw = await this.academicYearService.setActive(req.user.id, id);
    return this.versioning.resolve(req, 'academicYear.updated')(raw);
  }

  @Patch(':id/deactivate')
  async deactivate(@Req() req: any, @Param('id') id: string) {
    const raw = await this.academicYearService.deactivate(req.user.id, id);
    return this.versioning.resolve(req, 'academicYear.updated')(raw);
  }
}
