import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsBoolean,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateStudentDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEnum(['male', 'female'])
  gender?: 'male' | 'female' | null;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsDateString()
  enrollementDate?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
