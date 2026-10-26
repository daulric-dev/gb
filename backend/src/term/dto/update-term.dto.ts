import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';

export class UpdateTermDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  startDate?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  endDate?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(50)
  sortOrder?: number;
}
