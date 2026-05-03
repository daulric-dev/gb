import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJoinRequestDto {
  @ApiPropertyOptional({ example: 'I am a teacher at this school.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
