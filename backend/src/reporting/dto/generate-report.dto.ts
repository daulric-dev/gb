import { IsUUID, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class GenerateReportDto {
  @IsUUID()
  @IsNotEmpty()
  termId: string;

  @IsUUID()
  @IsNotEmpty()
  studentGroupId: string;

  @IsEnum(['term', 'year_end'])
  @IsNotEmpty()
  reportType: 'term' | 'year_end';

  @IsOptional()
  @IsUUID()
  studentId?: string; // if provided, generate for one student only
}