import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { COURSE_TABLES, SCHOOL_TABLES, type CourseTable, type SchoolTable } from '../analytics.service';

/** ?termId&academicYearId on school reads. */
export class SchoolFilterDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

export class SchoolExportDto extends SchoolFilterDto {
  @ApiPropertyOptional({ enum: SCHOOL_TABLES, default: 'courses' })
  @IsOptional()
  @IsIn([...SCHOOL_TABLES])
  table?: SchoolTable;
}

export class CourseExportDto {
  @ApiPropertyOptional({ enum: COURSE_TABLES, default: 'activities' })
  @IsOptional()
  @IsIn([...COURSE_TABLES])
  table?: CourseTable;
}

/** PUT /analytics/settings: any subset; null switches a rule off. */
export class AnalyticsSettingsDto {
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 100, description: 'At risk below this current grade (percent).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  minGrade?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 50, description: 'At risk with at least this many missing in the window.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(50)
  missingCount?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 26, description: 'The window for missing work and attendance, in weeks.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(26)
  windowWeeks?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 100, description: 'At risk below this attendance percent (needs attendance).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  minAttendance?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 2, maximum: 10, description: 'At risk below this average mastery level (needs mastery).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(2)
  @Max(10)
  masteryBelowLevel?: number | null;
}
