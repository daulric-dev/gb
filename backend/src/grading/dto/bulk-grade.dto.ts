import {
  IsUUID,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class GradeEntry {
  @IsUUID()
  @IsNotEmpty()
  studentId!: string;

  @IsNumber()
  @Min(0)
  @Max(1000)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class BulkGradeDto {
  @IsUUID()
  @IsNotEmpty()
  assessmentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => GradeEntry)
  grades!: GradeEntry[];
}
