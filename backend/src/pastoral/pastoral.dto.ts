import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_NOTE_FILES,
  PASTORAL_KINDS,
  PASTORAL_SEVERITIES,
  PASTORAL_STATUSES,
  type PastoralKind,
  type PastoralSeverity,
  type PastoralStatus,
} from './pastoral.constants';

export class CreatePastoralNoteDto {
  @ApiProperty() @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ enum: PASTORAL_SEVERITIES })
  @IsOptional() @IsIn(PASTORAL_SEVERITIES)
  severity?: PastoralSeverity;

  @ApiProperty({ description: 'The day it happened (YYYY-MM-DD)' })
  @IsDateString({ strict: true })
  occurredOn!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(20000)
  body!: string;

  @ApiPropertyOptional({ description: 'Follow up by (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({ strict: true })
  followUpOn?: string;

  @ApiPropertyOptional({ description: 'Staff member who follows up' })
  @IsOptional() @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ type: [String], description: 'Your own files to attach' })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_NOTE_FILES) @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class UpdatePastoralNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PASTORAL_SEVERITIES })
  @IsOptional() @IsIn(PASTORAL_SEVERITIES)
  severity?: PastoralSeverity;

  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  occurredOn?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsDateString({ strict: true })
  followUpOn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID()
  assignedTo?: string | null;

  @ApiPropertyOptional({ enum: PASTORAL_STATUSES })
  @IsOptional() @IsIn(PASTORAL_STATUSES)
  status?: PastoralStatus;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the attachments' })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_NOTE_FILES) @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class PastoralNoteQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  studentId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PASTORAL_STATUSES })
  @IsOptional() @IsIn(PASTORAL_STATUSES)
  status?: PastoralStatus;

  @ApiPropertyOptional({ enum: PASTORAL_SEVERITIES })
  @IsOptional() @IsIn(PASTORAL_SEVERITIES)
  severity?: PastoralSeverity;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'From (YYYY-MM-DD, inclusive)' })
  @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'To (YYYY-MM-DD, inclusive)' })
  @IsOptional() @IsDateString({ strict: true })
  to?: string;
}

export class CreatePastoralCategoryDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60)
  label!: string;

  @ApiProperty({ enum: PASTORAL_KINDS }) @IsIn(PASTORAL_KINDS)
  kind!: PastoralKind;

  @ApiPropertyOptional({ description: 'Needs pastoral-note:safeguarding (always true for the safeguarding kind)' })
  @IsOptional() @IsBoolean()
  isSafeguarding?: boolean;
}

export class UpdatePastoralCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60)
  label?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isSafeguarding?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000)
  position?: number;
}

export class UpdatePastoralSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Days after resolving that a note is purged; null keeps notes until the student is removed' })
  @ValidateIf((_o, v) => v !== null) @IsInt() @Min(30) @Max(36500)
  retentionDays!: number | null;
}

/** Withhold a note from subject access exports (src/data-export), or release it. */
export class SetSarWithheldDto {
  @ApiProperty() @IsBoolean()
  withheld!: boolean;

  @ApiPropertyOptional({ description: 'Why (the exemption relied on); required when withholding' })
  @ValidateIf((o: SetSarWithheldDto) => o.withheld === true) @IsString() @IsNotEmpty() @MaxLength(2000)
  reason?: string;
}
