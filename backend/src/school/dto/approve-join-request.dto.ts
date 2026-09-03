import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveJoinRequestDto {
  @ApiProperty({
    example: 'member',
    enum: ['admin', 'member', 'teacher'],
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['admin', 'member', 'teacher'])
  role!: 'admin' | 'member' | 'teacher' | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  customRoleIds?: string[];
}
