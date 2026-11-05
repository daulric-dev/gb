import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** Give one student a later due date on one activity, or change theirs. */
export class SetExtensionDto {
  @ApiProperty({ example: '2026-11-12T17:00:00.000Z' })
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional({ example: 'Off sick for the week' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
