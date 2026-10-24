import {
  IsOptional,
  IsDateString,
  IsInt,
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
  @Max(50)
  sortOrder?: number;
}
