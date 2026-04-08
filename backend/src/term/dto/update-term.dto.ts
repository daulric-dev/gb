import { IsOptional, IsDateString, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class UpdateTermDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  examWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  courseworkWeight?: number;

  @IsOptional()
  @IsBoolean()
  isMinistryReporting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  sortOrder?: number;
}
