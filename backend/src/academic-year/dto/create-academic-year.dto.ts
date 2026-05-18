import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
  Max,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2025/2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: '2025-09-01' })
  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @ApiProperty({
    example: 'weighted_continuous',
    enum: [
      'weighted_continuous',
      'weighted_cumulative',
      'continuous_cumulative',
    ],
  })
  @IsEnum([
    'weighted_continuous',
    'weighted_cumulative',
    'continuous_cumulative',
  ])
  @IsNotEmpty()
  gradingModel!:
    | 'weighted_continuous'
    | 'weighted_cumulative'
    | 'continuous_cumulative';

  @ApiPropertyOptional({ example: 40 })
  @ValidateIf((o) => o.gradingModel !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  yearExamWeight?: number;

  @ApiPropertyOptional({ example: 60 })
  @ValidateIf((o) => o.gradingModel !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  yearCourseworkWeight?: number;
}
