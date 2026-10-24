import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportGradebookDto {
  /** The sheet's text, in the shape the gradebook export produces. */
  @ApiProperty({
    example: 'Last name,First name,Student ID,Essay (10)\r\nRivera,Jordan,…,8\r\n',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000_000)
  csv!: string;
}
