import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT } from './sso-audit.service';

/**
 * QUERY /schools/current/sso/audit and QUERY /organisation/schools/:id/sso/audit:
 * one page of a school's single sign-on activity, newest first. An empty body
 * is the first page of AUDIT_DEFAULT_LIMIT entries.
 */
export class ListSsoAuditQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: AUDIT_MAX_LIMIT,
    default: AUDIT_DEFAULT_LIMIT,
  })
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
