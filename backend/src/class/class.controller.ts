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
import { ClassService } from './class.service';
import { AuthGuard } from '@/auth/auth.guard';
import { ClassTeacherGuard } from './class-teacher.guard';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AddTeacherDto } from './dto/add-teacher.dto';

@ApiTags('Classes')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('classes')
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  @Get()
  async getMyClasses(
    @Req() req: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.classService.getMyClasses(req.user.id, academicYearId);
  }

  @Post()
  async createClass(@Req() req: any, @Body() dto: CreateClassDto) {
    return this.classService.createClass(req.user.id, dto);
  }

  @Get(':classId')
  async getClassById(@Param('classId') classId: string) {
    return this.classService.getClassById(classId);
  }

  @UseGuards(ClassTeacherGuard)
  @Patch(':classId')
  async updateClass(
    @Param('classId') classId: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classService.updateClass(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Delete(':classId')
  async deleteClass(@Param('classId') classId: string) {
    return this.classService.deleteClass(classId);
  }

  @Get('school-teachers')
  async getSchoolTeachers(@Req() req: any) {
    return this.classService.getSchoolTeachers(req.user.id);
  }

  @Get(':classId/my-subjects')
  async getMySubjects(@Req() req: any, @Param('classId') classId: string) {
    return this.classService.getMySubjectsForClass(req.user.id, classId);
  }

  @Get(':classId/teachers')
  async getTeachers(@Param('classId') classId: string) {
    return this.classService.getTeachers(classId);
  }

  @UseGuards(ClassTeacherGuard)
  @Post(':classId/teachers')
  async addTeacher(
    @Param('classId') classId: string,
    @Body() dto: AddTeacherDto,
  ) {
    return this.classService.addTeacher(classId, dto);
  }

  @UseGuards(ClassTeacherGuard)
  @Delete(':classId/teachers/:teacherId')
  async removeTeacher(
    @Param('classId') classId: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.classService.removeTeacher(classId, teacherId);
  }
}
