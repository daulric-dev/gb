import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_MAX_QUESTIONS,
  AI_MAX_SOURCE_CHARS,
  AI_PROVIDER_KINDS,
  AI_QUESTION_KINDS,
  type AiProviderKind,
  type AiQuestionKind,
} from './ai.constants';

export class CreateAiProviderDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @ApiProperty({ enum: AI_PROVIDER_KINDS }) @IsIn(AI_PROVIDER_KINDS) kind!: AiProviderKind;
  /** anthropic: optional override; openai_compatible: required. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  /** Default for anthropic: claude-opus-5-5. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) model?: string;
  /** Write-only. */
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) apiKey!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  monthlyCap?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  /** The provider runs on the organisation's private network (http and private addresses allowed for it). Default false. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPrivateNetwork?: boolean;
  /** Schools may choose it in their AI settings. Default true. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() availableToSchools?: boolean;
}

export class UpdateAiProviderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  /** Empty clears an anthropic override; required for openai_compatible. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) model?: string;
  /** Write-only: a non-empty value replaces the stored key. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) apiKey?: string;
  /** null removes the cap. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  monthlyCap?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPrivateNetwork?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() availableToSchools?: boolean;
}

export class AiOrgSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepPrompts?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) userHourlyLimit?: number;
}

export class AiSchoolSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowStudentWork?: boolean;
  /**
   * One of the organisation's providers that is available to schools, or
   * null for the organisation default. Left out: unchanged.
   */
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  providerId?: string | null;
}

export class QuizDraftDto {
  /** A page of this course to write from (or `text`). */
  @ApiPropertyOptional() @IsOptional() @IsUUID() pageId?: string;
  /** Pasted text to write from (or `pageId`). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_SOURCE_CHARS) text?: string;
  @ApiProperty({ minimum: 1, maximum: AI_MAX_QUESTIONS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AI_MAX_QUESTIONS)
  count!: number;
  @ApiProperty({ enum: AI_QUESTION_KINDS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_QUESTION_KINDS.length)
  @IsIn(AI_QUESTION_KINDS, { each: true })
  kinds!: AiQuestionKind[];
}

export class RubricFeedbackDto {
  @ApiProperty() @IsUUID() studentId!: string;
}

export class PageSummaryDto {
  /** The editor's current (unsaved) text; the saved page when omitted. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_SOURCE_CHARS) text?: string;
}
