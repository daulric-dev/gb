import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CopyDatesDto } from '../dto/course-copy.dto';

export const LIBRARY_VISIBILITIES = ['school', 'organisation'] as const;
export type LibraryVisibility = (typeof LIBRARY_VISIBILITIES)[number];

/** Chosen parts of the source course; all empty means the whole course. */
export class LibrarySelectionDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  moduleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Activities (assignments and quizzes)' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  activityIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  pageIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  rubricIds?: string[];
}

class LibraryMetadataDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  subject?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  gradeLevel?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: LIBRARY_VISIBILITIES })
  @IsOptional() @IsIn(LIBRARY_VISIBILITIES)
  visibility?: LibraryVisibility;
}

export class PublishLibraryItemDto extends LibraryMetadataDto {
  @ApiProperty({ description: 'The course to publish from (you must be able to edit it)' })
  @IsUUID()
  sourceCourseId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ type: LibrarySelectionDto })
  @IsOptional() @ValidateNested() @Type(() => LibrarySelectionDto)
  selection?: LibrarySelectionDto;
}

export class UpdateLibraryItemDto extends LibraryMetadataDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  title?: string;
}

export class RepublishLibraryItemDto {
  @ApiPropertyOptional({ type: LibrarySelectionDto, description: 'Omit to keep the previous version\'s selection' })
  @IsOptional() @ValidateNested() @Type(() => LibrarySelectionDto)
  selection?: LibrarySelectionDto;

  @ApiPropertyOptional({ description: 'What changed in this version' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class LibraryBrowseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  subject?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  gradeLevel?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ enum: ['all', 'school', 'organisation', 'mine'] })
  @IsOptional() @IsIn(['all', 'school', 'organisation', 'mine'])
  scope?: 'all' | 'school' | 'organisation' | 'mine';

  @ApiPropertyOptional({ description: 'Items published from this course' })
  @IsOptional() @IsUUID()
  sourceCourseId?: string;
}

export class LibraryVersionQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  version?: number;
}

class NewCourseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() termId?: string;
}

export class ImportLibraryItemDto extends CopyDatesDto {
  @ApiPropertyOptional({ description: 'Version number; the latest when omitted' })
  @IsOptional() @IsInt() @Min(1) @Max(100000)
  version?: number;

  @ApiPropertyOptional({ description: 'Append to this course (you must be able to edit it)' })
  @IsOptional() @IsUUID()
  targetCourseId?: string;

  @ApiPropertyOptional({ type: NewCourseDto, description: 'Or create a new draft course' })
  @IsOptional() @ValidateNested() @Type(() => NewCourseDto)
  newCourse?: NewCourseDto;
}
