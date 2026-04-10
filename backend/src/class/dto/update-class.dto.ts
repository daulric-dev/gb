import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateClassDto {
  @ApiProperty({ example: 'Class 3A - 2000' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
