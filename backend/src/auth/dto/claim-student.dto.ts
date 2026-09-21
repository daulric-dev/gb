import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClaimStudentDto {
  @ApiProperty({
    example: 'RXKT-9WMB-2FQH',
    description: 'The claim code issued by the school. Case and dashes are ignored.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}
