import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * PUT /schools/current/sso/providers/:key and
 * PUT /organisation/schools/:id/sso/providers/:key. Every field is optional;
 * what is left out stays as it is.
 */
export class UpdateSchoolSsoProviderDto {
  /** Turning it on needs the school's own client ID and secret (400 otherwise). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  /** Empty string clears it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  clientId?: string;

  /** Write-only, encrypted at rest; empty string clears it. Never returned. */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  clientSecret?: string;

  /**
   * Non-secret settings by key (the provider's `settingFields`); a value of
   * null or "" removes it. Unknown keys are a 400.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string', nullable: true } })
  @IsOptional()
  @IsObject()
  settings?: Record<string, string | null>;
}
