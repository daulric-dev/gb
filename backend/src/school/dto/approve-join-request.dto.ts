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

  /**
   * Student requests only: the existing student record to link this login to.
   * Omit to create a new record. Ignored for staff requests, which take a role
   * instead.
   */
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
