import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A student's quiz accommodation: a time multiplier or extra minutes (not
 * both), and/or an exemption from Lockdown. Used for one activity and for a
 * student's school-wide default.
 */
export class SetAccommodationDto {
  @ApiPropertyOptional({ enum: [1.25, 1.5, 2], nullable: true, example: 1.5 })
  @IsOptional()
  @IsIn([1.25, 1.5, 2])
  timeMultiplier?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 600, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  extraMinutes?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  lockdownExempt?: boolean;

  @ApiPropertyOptional({ example: 'Uses a screen reader' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
