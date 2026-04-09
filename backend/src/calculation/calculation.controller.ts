import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { CalculationService } from './calculation.service';

@ApiTags('Calculations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('calculations')
export class CalculationController {
  constructor(private readonly calculationService: CalculationService) {}

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
    @Query('termId') termId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    return this.calculationService.calculateClassTermResults(
      termId,
      studentGroupId,
    );
  }

  @Get('class-year')
  async getClassYearResults(
    @Query('academicYearId') academicYearId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
    return this.calculationService.calculateClassYearResults(
      academicYearId,
      studentGroupId,
    );
  }

  @Get('class-summary')
  async getClassSummary(
    @Query('termId') termId: string,
    @Query('studentGroupId') studentGroupId: string,
  ) {
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