import { IsOptional, IsString, IsNumber, Min, Max, MaxLength } from 'class-validator';

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  classTeacherRemark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  conduct?: string; // e.g. "Good", "Excellent", "Needs Improvement"

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  attendancePercentage?: number;
}