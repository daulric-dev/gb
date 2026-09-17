import {
  Body,
  Controller,
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
import { PaginationQueryDto } from '@/pagination/pagination.dto';
import { VersioningService } from '@/versioning/versioning.service';
import { StudentService } from './student.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@ApiTags('Students')
@ApiBearerAuth()
@Controller('students')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly versioning: VersioningService,
  ) {}

  @RequirePermission('student', 'read')
  @Get()
  async findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    const hasPaginationParams =
      pagination?.page !== undefined || pagination?.cursor !== undefined;

    if (!hasPaginationParams) {
      const raw = await this.studentService.findAll(req.user.id, search);
      return this.versioning.resolve(req, 'student.list')(raw);
    }

    const raw = await this.studentService.findAllPaginated(
      req.user.id,
      pagination,
      search,
    );
    return this.versioning.resolve(req, 'student.paginated')(raw);
  }

  @RequirePermission('student', 'read')
  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const raw = await this.studentService.findOne(req.user.id, id);
    return this.versioning.resolve(req, 'student.detail')(raw);
  }

  @RequirePermission('student', 'create')
  @Post()
  async create(@Req() req: any, @Body() dto: CreateStudentDto) {
    const raw = await this.studentService.create(req.user.id, dto);
    return this.versioning.resolve(req, 'student.created')(raw);
  }

  @RequirePermission('student', 'update')
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    const raw = await this.studentService.update(req.user.id, id, dto);
    return this.versioning.resolve(req, 'student.updated')(raw);
  }
}
