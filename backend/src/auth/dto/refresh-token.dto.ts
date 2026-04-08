import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ example: 'v1.MDA4OWE3ZT...' })
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}
