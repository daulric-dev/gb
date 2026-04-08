import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolService } from './school.service';
import { AuthGuard } from '@/auth/auth.guard';
import { CreateSchoolDto } from './dto/create-school.dto';

@ApiTags('Schools')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('schools')
export class SchoolController {
  constructor(private readonly schoolService: SchoolService) {}

  @Get()
  async findAll() {
    return this.schoolService.findAll();
  }

  @Post()
  async create(@Body() dto: CreateSchoolDto) {
    return this.schoolService.create(dto);
  }
}
