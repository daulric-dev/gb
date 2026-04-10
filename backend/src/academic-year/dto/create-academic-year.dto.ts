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
  name: string;

  @ApiProperty({ example: '2025-09-01' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiProperty({ example: 'term_based', enum: ['term_based', 'year_based'] })
  @IsEnum(['term_based', 'year_based'])
  @IsNotEmpty()
  gradingModel: 'term_based' | 'year_based';

  @ApiPropertyOptional({ example: 40 })
  @ValidateIf((o) => o.gradingModel === 'year_based')
  @IsInt()
  @Min(0)
  @Max(100)
  yearExamWeight?: number;

  @ApiPropertyOptional({ example: 60 })
  @ValidateIf((o) => o.gradingModel === 'year_based')
  @IsInt()
  @Min(0)
  @Max(100)
  yearCourseworkWeight?: number;
}
