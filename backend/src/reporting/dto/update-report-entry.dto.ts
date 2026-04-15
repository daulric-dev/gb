import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateReportEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  teacherRemark?: string; // subject teacher's comment

  @IsOptional()
  @IsString()
  @MaxLength(5)
  letterGrade?: string; // e.g. "A", "B+", "C"
}
