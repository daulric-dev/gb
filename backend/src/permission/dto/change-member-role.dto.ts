import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeMemberRoleDto {
  @ApiProperty({
    example: 'teacher',
    enum: ['admin', 'member', 'teacher'],
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['admin', 'member', 'teacher'])
  role!: 'admin' | 'member' | 'teacher' | null;
}
