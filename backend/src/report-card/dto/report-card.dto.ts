import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Longest teacher or head comment, in characters (also a CHECK in the database). */
export const REPORT_COMMENT_MAX = 2000;

export class ReportCommentEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId!: string;

  @ApiProperty({ example: 'A steady term; her lab reports have improved a lot.' })
  @IsString()
  @MaxLength(REPORT_COMMENT_MAX)
  body!: string;

  @ApiProperty({ enum: ['draft', 'ready'] })
  @IsIn(['draft', 'ready'])
  status!: 'draft' | 'ready';
}

/** Save several students' comments for one course and term. */
export class SaveReportCommentsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  termId!: string;

  @ApiProperty({ type: [ReportCommentEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReportCommentEntryDto)
  comments!: ReportCommentEntryDto[];
}

export class HeadCommentEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  studentId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(REPORT_COMMENT_MAX)
  body!: string;
}

/** Save several students' head / form tutor comments for one term. */
export class SaveHeadCommentsDto {
  @ApiProperty({ type: [HeadCommentEntryDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => HeadCommentEntryDto)
  comments!: HeadCommentEntryDto[];
}

/** The term's comment deadline; null clears it. */
export class UpdateReportReleaseDto {
  @ApiPropertyOptional({ example: '2026-12-10T17:00:00.000Z', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  commentDeadline!: string | null;
}

export class RegenerateReportsDto {
  @ApiPropertyOptional({ description: 'Only students whose report failed' })
  @IsOptional()
  @IsBoolean()
  failedOnly?: boolean;
}
