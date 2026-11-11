import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_TEXTS,
  MAX_TEXT_CHARS,
  TRANSLATION_ENGINES,
  type TranslationEngine,
} from './translation.constants';

/** `PUT /organisation/translation`. */
export class TranslationSettingsDto {
  @ApiProperty({ enum: TRANSLATION_ENGINES }) @IsIn(TRANSLATION_ENGINES) engine!: TranslationEngine;
  /** LibreTranslate only: the server's address. Ignored (stored as null) for the other engines. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  url?: string | null;
  /** Write-only. Omit to keep the stored key, null (or empty) to clear it. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  key?: string | null;
  /** LibreTranslate on the organisation's private network: http and private addresses allowed. Default false. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPrivateNetwork?: boolean;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

/**
 * `POST /translation`. Counts and sizes are checked here and again by the
 * service (total size, language codes) so the limits hold for any caller.
 */
export class TranslateTextsDto {
  @ApiProperty({ type: [String], maxItems: MAX_TEXTS })
  @IsArray()
  @ArrayMaxSize(MAX_TEXTS)
  @IsString({ each: true })
  @MaxLength(MAX_TEXT_CHARS, { each: true })
  texts!: string[];
  /** ISO 639-1; a region is dropped (`zh-CN` → `zh`). */
  @ApiProperty({ example: 'es' }) @IsString() @MaxLength(35) to!: string;
  /** ISO 639-1; omit to let the engine detect it. */
  @ApiPropertyOptional({ example: 'en' }) @IsOptional() @IsString() @MaxLength(35) from?: string;
}

/** `POST /courses/:courseId/activities/:activityId/translate`. */
export class TranslateActivityDto {
  @ApiProperty({ example: 'es' }) @IsString() @MaxLength(35) to!: string;
}
