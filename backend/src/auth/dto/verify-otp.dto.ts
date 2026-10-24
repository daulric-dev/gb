import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: 'teacher@school.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: '12345678',
    description: '8-digit code from the sign-in email',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
