import {
  IsOptional,
  IsDateString,
  IsInt,
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class UpdateTermDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  examWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  courseworkWeight?: number;

  @IsOptional()
  @IsBoolean()
  isMinistryReporting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  sortOrder?: number;
}
