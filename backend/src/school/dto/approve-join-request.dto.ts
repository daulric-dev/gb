import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveJoinRequestDto {
  @ApiProperty({ example: 'member', enum: ['admin', 'member', 'teacher'] })
  @IsEnum(['admin', 'member', 'teacher'])
  @IsNotEmpty()
  role!: 'admin' | 'member' | 'teacher';
}
