import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { SupabaseService } from '@/supabase/supabase.service';
import { CalculationService } from './calculation.service';

@ApiTags('Calculations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('calculations')
export class CalculationController {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private async verifyClassTeacher(userId: string, studentGroupId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('role')
      .eq('id', userId)
      .single();

    if (profile?.role === 'admin') return;

    const { data: assignment } = await supabase
      .schema('staff')
      .from('teacher_group_assignment')
      .select('id')
      .eq('user_profile_id', userId)
      .eq('student_group_id', studentGroupId)
      .eq('is_class_teacher', true)
      .single();

    if (!assignment) {
      throw new ForbiddenException('Only the class teacher can view class summary');
    }
  }

  @Get('student-term')
  async getStudentTermResult(
    @Query('studentId') studentId: string,
    @Query('termId') termId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    return this.calculationService.calculateStudentTermResult(
      studentId,
      termId,
      studentGroupId,
    );
  }

  @Get('student-year')
  async getStudentYearResult(
    @Query('studentId') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    return this.calculationService.calculateStudentYearResult(
      studentId,
      academicYearId,
      studentGroupId,
    );
  }

  @Get('class-term')
  async getClassTermResults(
    @Req() req: any,
    @Query('termId') termId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    await this.verifyClassTeacher(req.user.id, studentGroupId);
    return this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );
  }

  @Get('class-year')
  async getClassYearResults(
    @Req() req: any,
    @Query('academicYearId') academicYearId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    await this.verifyClassTeacher(req.user.id, studentGroupId);
    return this.calculationService.calculateClassYearResults(
      academicYearId,
      studentGroupId,
    );
  }

  @Get('class-summary')
  async getClassSummary(
    @Req() req: any,
    @Query('termId') termId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    await this.verifyClassTeacher(req.user.id, studentGroupId);

    const results = await this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );

    return results.map((r) => ({
      student: {
        id: r.studentId,
        firstName: r.firstName,
        lastName: r.lastName,
      },
      subjects: r.subjects.map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        average: s.termComposite,
      })),
      overallAverage: r.overallAverage,
      position: r.position,
    }));
  }
}
