import { IsIn, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PushContent } from '../push-content';

/**
 * Category on/off per channel, e.g. `{ push: { grades: false } }`. Only the
 * categories given change; unknown keys and non-boolean values are ignored.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ example: { grades: false, chat: true } })
  @IsOptional()
  @IsObject()
  push?: Record<string, boolean>;

  @ApiPropertyOptional({ example: { attendance: false } })
  @IsOptional()
  @IsObject()
  email?: Record<string, boolean>;
}

/** `full`, `generic`, or null (school: follow the organisation; organisation: the default). */
export class UpdatePushContentDto {
  @ApiProperty({ enum: ['full', 'generic'], nullable: true })
  @IsIn(['full', 'generic', null])
  pushContent!: PushContent | null;
}
