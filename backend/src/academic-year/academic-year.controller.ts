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
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

@ApiTags('Academic Years')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('academic-years')
export class AcademicYearController {
  constructor(private readonly academicYearService: AcademicYearService) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateAcademicYearDto) {
    return this.academicYearService.create(req.user.id, dto);
  }

  @Get()
  async findAll(@Req() req: any) {
    return this.academicYearService.findAll(req.user.id);
  }

  @Get('active')
  async findActive(@Req() req: any) {
    return this.academicYearService.findActive(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.academicYearService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAcademicYearDto) {
    return this.academicYearService.update(id, dto);
  }

  @Patch(':id/activate')
  async setActive(@Req() req: any, @Param('id') id: string) {
    return this.academicYearService.setActive(req.user.id, id);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return this.academicYearService.deactivate(id);
  }
}
