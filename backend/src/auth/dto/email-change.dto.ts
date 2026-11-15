import { IsEmail, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'new.address@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty({ example: '12345678', description: 'The 8-digit code mailed to the new address' })
  @Matches(/^\s*\d{8}\s*$/, { message: 'Enter the 8-digit code' })
  code!: string;
}
