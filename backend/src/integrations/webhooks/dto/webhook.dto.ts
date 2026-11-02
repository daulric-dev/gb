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
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT } from '@/integrations/audit/integration-audit.service';
import {
  MAX_HEADER_NAME,
  MAX_HEADER_VALUE,
  MAX_HEADERS,
} from '@/integrations/webhooks/webhook-headers';
import { CUSTOM_SECRET_MAX } from '@/integrations/webhooks/webhook-secret';
import { MAX_CA_BYTES } from '@/integrations/webhooks/webhook-tls';

export const MAX_URL = 2048;
export const MAX_NAME = 100;
export const DELIVERIES_DEFAULT_LIMIT = 50;
export const DELIVERIES_MAX_LIMIT = 200;
export const DELIVERY_STATUSES = ['pending', 'succeeded', 'failed', 'abandoned'] as const;

/**
 * One custom header. In create / update the list is the full desired set:
 * `id` + no value keeps a saved header's value (it may be renamed), `id` +
 * value replaces it, no `id` is new (value required); saved headers missing
 * from the list are deleted. Rules (name, reserved names, value) are checked
 * by the service (webhook-headers.ts).
 */
export class WebhookHeaderDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'A saved header to keep or change' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ maxLength: MAX_HEADER_NAME, example: 'X-API-Key' })
  @IsString()
  @MaxLength(MAX_HEADER_NAME)
  name!: string;

  @ApiPropertyOptional({
    maxLength: MAX_HEADER_VALUE,
    description: 'Write-only. Required for a new header; blank or missing keeps a saved one',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HEADER_VALUE)
  value?: string;
}

/**
 * Certificate checks for https URLs. `verify` false sends even when the
 * receiver's certificate can't be verified (audited, alerted). `caCert`: a
 * PEM bundle of CA certificates to trust instead of the public roots; ''
 * clears it. Checked by the service (webhook-tls.ts).
 */
export class WebhookTlsDto {
  @ApiPropertyOptional({ default: true, description: "Verify the receiver's SSL/TLS certificate" })
  @IsOptional()
  @IsBoolean()
  verify?: boolean;

  @ApiPropertyOptional({ maxLength: MAX_CA_BYTES, description: "PEM CA certificate(s) to trust; '' clears" })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CA_BYTES)
  caCert?: string;
}

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

  @ApiPropertyOptional({
    type: [WebhookHeaderDto],
    maxItems: MAX_HEADERS,
    description: 'Custom headers sent with every delivery (values write-only)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HEADERS)
  @ValidateNested({ each: true })
  @Type(() => WebhookHeaderDto)
  headers?: WebhookHeaderDto[];

  @ApiPropertyOptional({
    minLength: 16,
    maxLength: CUSTOM_SECRET_MAX,
    description: 'Your own signing secret (16-256 printable characters); generated when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_SECRET_MAX)
  signingSecret?: string;

  @ApiPropertyOptional({ type: WebhookTlsDto, description: 'SSL/TLS certificate checks (https only)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookTlsDto)
  tls?: WebhookTlsDto;
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

  @ApiPropertyOptional({
    type: [WebhookHeaderDto],
    maxItems: MAX_HEADERS,
    description: 'Custom headers sent with every delivery (values write-only)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HEADERS)
  @ValidateNested({ each: true })
  @Type(() => WebhookHeaderDto)
  headers?: WebhookHeaderDto[];

  @ApiPropertyOptional({ type: WebhookTlsDto, description: 'SSL/TLS certificate checks (https only)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookTlsDto)
  tls?: WebhookTlsDto;
}

/** POST .../webhooks/:id/rotate-secret - body optional. */
export class RotateSecretDto {
  @ApiPropertyOptional({
    minLength: 16,
    maxLength: CUSTOM_SECRET_MAX,
    description: 'Your own signing secret (16-256 printable characters); generated when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_SECRET_MAX)
  signingSecret?: string;
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
