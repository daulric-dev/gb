import {
  IsString,
  IsDateString,
  IsEnum,
  IsInt,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  IsOptional,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAcademicYearDto {
  @ApiPropertyOptional({ example: '2025/2026 Updated' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: '2025-09-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    example: 'weighted_continuous',
    enum: [
      'weighted_continuous',
      'weighted_cumulative',
      'continuous_cumulative',
    ],
  })
  @IsOptional()
  @IsEnum([
    'weighted_continuous',
    'weighted_cumulative',
    'continuous_cumulative',
  ])
  gradingModel?:
    | 'weighted_continuous'
    | 'weighted_cumulative'
    | 'continuous_cumulative';

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  yearExamWeight?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  yearCourseworkWeight?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
