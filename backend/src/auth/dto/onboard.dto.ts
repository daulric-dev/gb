import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OnboardDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  /**
   * Which onboarding flow to enter. This only chooses a route, never a
   * privilege: staff still require an admin to approve their join request,
   * and students still require a valid school-issued claim code. Defaults to
   * 'staff' so existing clients keep working.
   */
  @ApiPropertyOptional({ example: 'staff', enum: ['staff', 'student'] })
  @IsOptional()
  @IsIn(['staff', 'student'])
  accountType?: 'staff' | 'student';
}
