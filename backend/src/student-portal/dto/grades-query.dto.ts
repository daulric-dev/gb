import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GradesQueryDto {
  @ApiPropertyOptional({ description: 'Limit results to one term.' })
  @IsOptional()
  @IsUUID()
  termId?: string;
}
