import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class IssueClaimCodeDto {
  @ApiPropertyOptional({
    example: 14,
    description: 'Days until the code expires (1-90). Defaults to 14.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  ttlDays?: number;
}
