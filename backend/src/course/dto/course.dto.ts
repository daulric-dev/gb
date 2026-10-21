import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export class ListCoursesQueryDto {
  @ApiPropertyOptional({ enum: COURSE_STATUSES })
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
}

export class CreateCourseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: COURSE_STATUSES })
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() gradeScaleId?: string | null;
}

export class AddCourseStaffDto {
  @ApiProperty() @IsUUID() userProfileId!: string;

  @ApiProperty({ enum: ['teacher', 'ta'] })
  @IsIn(['teacher', 'ta'])
  role!: 'teacher' | 'ta';
}

export class UpdateCourseStaffDto {
  @ApiProperty({ enum: ['teacher', 'ta'] })
  @IsIn(['teacher', 'ta'])
  role!: 'teacher' | 'ta';
}

export class EnrollStudentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  studentIds!: string[];
}

export class JoinCourseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20) joinCode!: string;
}
