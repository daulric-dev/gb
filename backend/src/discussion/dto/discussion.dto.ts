import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── topics ──────────────────────────────────────────────────────────────────

/**
 * The moderation flags (pinned, locked, published, post-first) are for staff;
 * a student starting a topic in a course that allows it gets the defaults.
 */
export class CreateTopicDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;

  /** Markdown. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLocked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;

  /** Students see other replies only after posting their own. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireInitialPost?: boolean;
}

export class UpdateTopicDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLocked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireInitialPost?: boolean;
}

// ── replies ─────────────────────────────────────────────────────────────────

export class CreateReplyDto {
  /** Markdown. */
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10000) body!: string;

  /**
   * The reply being answered. Threads are one level deep: answering a reply
   * to a reply lands beside it, under the same top-level reply.
   */
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

export class UpdateReplyDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(10000) body!: string;
}

// ── settings ────────────────────────────────────────────────────────────────

export class UpdateDiscussionSettingsDto {
  @ApiProperty() @IsBoolean() studentsCanCreateTopics!: boolean;
}
