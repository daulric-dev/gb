import {
  IsString,
  IsDateString,
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

  // Activating a year is PATCH /academic-years/:id/activate (it deactivates
  // the school's other years in the same transaction), not a field here.
}
