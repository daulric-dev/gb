import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BandInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  label!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  minPercentage!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  maxPercentage!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  gpaPoints?: number | null;

  @IsBoolean()
  isPass!: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
