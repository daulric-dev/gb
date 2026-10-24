import { ArrayUnique, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRolePermissionsDto {
  @ApiProperty({
    example: ['student:read', 'course:create'],
    description: 'Full set of catalog permission keys to grant the role.',
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  keys!: string[];
}
