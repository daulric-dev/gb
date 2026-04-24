import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteUploadDto {
  @ApiProperty({ example: 'avatars/user-123.png' })
  @IsString()
  @IsNotEmpty()
  path: string;
}
