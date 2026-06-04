import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({ example: 'a3f1c2d4-...', description: 'school_role id' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  roleId!: string;
}
