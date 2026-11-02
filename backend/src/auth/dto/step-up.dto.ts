import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** POST /auth/step-up/verify. */
export class VerifyStepUpDto {
  @ApiProperty({
    example: '12345678',
    description: '8-digit code from the "Confirm it\'s you" email',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}
