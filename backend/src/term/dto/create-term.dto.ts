import {IsNotEmpty, IsEnum, IsDateString, IsInt, IsOptional, IsBoolean, IsUUID, Min, Max} from 'class-validator';

export class CreateTermDto {
  @IsUUID()
  @IsNotEmpty()
  academicYearId: string;

  @IsEnum(['michaelmas', 'hilary', 'trinity'])
  @IsNotEmpty()
  name: 'michaelmas' | 'hilary' | 'trinity';

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsInt()
  @Min(0)
  @Max(100)
  examWeight: number;

  @IsInt()
  @Min(0)
  @Max(100)
  courseworkWeight: number;

  @IsOptional()
  @IsBoolean()
  isMinistryReporting?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  sortOrder?: number;
}
