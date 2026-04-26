import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ExcludeDto {
  @IsBoolean()
  @IsNotEmpty()
  isExcluded!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exclusionReason?: string;
}
