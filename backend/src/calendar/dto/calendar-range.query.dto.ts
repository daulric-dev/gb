import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The window a calendar reads, as ISO dates or timestamps. `from` is
 * inclusive, `to` exclusive; both default (see CalendarService.range).
 */
export class CalendarRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
