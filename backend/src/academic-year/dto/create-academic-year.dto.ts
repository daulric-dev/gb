import { IsString, IsNotEmpty, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
