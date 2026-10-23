import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * How due dates move into the copy. At most one of: shift by `shiftDays`,
 * shift by the gap between `sourceStartDate` and `targetStartDate`, or
 * `clearDueDates`. None keeps every date as it was.
 */
export class CopyDatesDto {
  @ApiPropertyOptional({ description: 'Move every date by this many days' })
  @IsOptional()
  @IsInt()
  @Min(-3660)
  @Max(3660)
  shiftDays?: number;

  @ApiPropertyOptional({ description: 'First day of the source course (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({ strict: true })
  sourceStartDate?: string;

  @ApiPropertyOptional({ description: 'First day of the new course (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({ strict: true })
  targetStartDate?: string;

  @ApiPropertyOptional({ description: 'Copy activities with no due date' })
  @IsOptional()
  @IsBoolean()
  clearDueDates?: boolean;
}

export class CopyCourseDto extends CopyDatesDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
}

export class ImportCourseContentDto extends CopyDatesDto {
  @ApiProperty({ description: 'The course to take content from' })
  @IsUUID()
  sourceCourseId!: string;
}
