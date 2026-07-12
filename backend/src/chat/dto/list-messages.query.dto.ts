import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsISO8601, Max, Min } from 'class-validator';

/** Cursor pagination for a conversation's history (newest first). */
export class ListMessagesQueryDto {
  @ApiPropertyOptional({
    description: 'Return messages created strictly before this ISO timestamp.',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
