import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsDateString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export class CreateTermDto {
  @IsUUID()
  @IsNotEmpty()
  academicYearId!: string;

  /** Free text: "Michaelmas", "Semester 1", "Fall 2026". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  examWeight!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  courseworkWeight!: number;

  @IsOptional()
  @IsBoolean()
  isMinistryReporting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  sortOrder?: number;
}
