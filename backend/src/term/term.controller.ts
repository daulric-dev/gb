import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { TermService } from './term.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

@ApiTags('Terms')
@ApiBearerAuth()
@Controller('terms')
@UseGuards(AuthGuard)
export class TermController {
  constructor(private readonly termService: TermService) {}

  @Get()
  findByYear(@Query('yearId') yearId: string) {
    return this.termService.findByYear(yearId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.termService.findOne(id);
  }

  @Post()
  create(@Req() req, @Body() dto: CreateTermDto) {
    return this.termService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTermDto) {
    return this.termService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.termService.delete(id);
  }
}