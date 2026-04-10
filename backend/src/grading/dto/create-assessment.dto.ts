import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsOptional,
  IsDateString,
  IsNumber,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateAssessmentDto {
  @IsUUID()
  @IsNotEmpty()
  termId: string;

  @IsUUID()
  @IsNotEmpty()
  subjectId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsEnum(['exam', 'coursework'])
  @IsNotEmpty()
  assessmentType: 'exam' | 'coursework';

  @IsOptional()
  @IsDateString()
  assessmentDate?: string;

  @IsNumber()
  @Min(1)
  @Max(1000)
  maxScore: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
