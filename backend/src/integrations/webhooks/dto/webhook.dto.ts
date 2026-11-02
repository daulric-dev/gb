import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT } from '@/integrations/audit/integration-audit.service';

export const MAX_URL = 2048;
export const MAX_NAME = 100;
export const DELIVERIES_DEFAULT_LIMIT = 50;
export const DELIVERIES_MAX_LIMIT = 200;
export const DELIVERY_STATUSES = ['pending', 'succeeded', 'failed', 'abandoned'] as const;

/** POST .../webhooks */
export class CreateWebhookDto {
  @ApiProperty({ maxLength: MAX_NAME })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME)
  name!: string;

  @ApiProperty({ description: 'Any http:// or https:// URL, internal addresses included', maxLength: MAX_URL })
  @IsString()
  @MaxLength(MAX_URL)
  url!: string;

  @ApiProperty({
    type: [String],
    description: 'Event type keys (GET /webhooks/event-types); "*" means every current type',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** PATCH .../webhooks/:id - any subset. Turning it on clears an auto-disable. */
export class UpdateWebhookDto {
  @ApiPropertyOptional({ maxLength: MAX_NAME })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_URL })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL)
  url?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** QUERY .../webhooks/:id/deliveries - newest first. */
export class ListDeliveriesQueryDto {
  @ApiPropertyOptional({ enum: DELIVERY_STATUSES })
  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  status?: (typeof DELIVERY_STATUSES)[number];

  @ApiPropertyOptional({ description: 'An event type key' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: DELIVERIES_MAX_LIMIT, default: DELIVERIES_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DELIVERIES_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'The id of the last delivery shown' })
  @IsOptional()
  @IsUUID()
  before?: string;
}

/** QUERY .../webhooks/audit */
export class ListIntegrationAuditQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: AUDIT_MAX_LIMIT, default: AUDIT_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'The id of the last entry shown' })
  @IsOptional()
  @IsUUID()
  before?: string;
}
