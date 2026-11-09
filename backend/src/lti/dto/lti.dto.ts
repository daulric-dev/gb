import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };

export class CreateLtiToolDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;

  /** The tool's OIDC login initiation URL. */
  @ApiProperty() @IsUrl(URL_OPTIONS) @MaxLength(2048) loginUrl!: string;

  /** Default launch URL (target_link_uri). */
  @ApiProperty() @IsUrl(URL_OPTIONS) @MaxLength(2048) targetLinkUri!: string;

  /** Redirect URIs the id_token may be posted to (exact match). */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl(URL_OPTIONS, { each: true })
  @MaxLength(2048, { each: true })
  redirectUris!: string[];

  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTIONS) @MaxLength(2048) jwksUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8192) publicKeyPem?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() agsEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendName?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() customParams?: Record<string, string>;

  /** Schools to deploy to; omitted or empty = every school. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  schoolIds?: string[];
}

export class UpdateLtiToolDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTIONS) @MaxLength(2048) loginUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTIONS) @MaxLength(2048) targetLinkUri?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl(URL_OPTIONS, { each: true })
  @MaxLength(2048, { each: true })
  redirectUris?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl(URL_OPTIONS)
  @MaxLength(2048)
  jwksUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(8192)
  publicKeyPem?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() agsEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendName?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sendEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() customParams?: Record<string, string>;
}

export class AddLtiDeploymentDto {
  /** null = every school. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  schoolId?: string | null;
}

export class CreateLtiItemDto {
  @ApiProperty() @IsUUID() toolId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;

  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() customParams?: Record<string, string>;

  /** Points for a gradebook column the tool can send scores to (AGS). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  points?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  indent?: number;
}

export class UpdateLtiItemDto {
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() customParams?: Record<string, string>;
}

export class StartLtiLaunchDto {
  @ApiProperty() @IsUUID() moduleItemId!: string;
}
